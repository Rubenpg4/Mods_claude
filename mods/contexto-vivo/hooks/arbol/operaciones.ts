import type { EngineInterface } from 'claude-code'

import type { Nodo } from '../../types'

import { CARACTERES_POR_TOKEN, enLinea, k } from '../comun/formato'
import { fotografiar, marcarCompactado, olvidarConversacion } from '../contexto/medicion'
import {
  cambiarArbol,
  cambiarBorrando,
  cambiarConsulta,
  cambiarHead,
  cambiarOcupado,
  cambiarRestaurando,
  cambiarSeleccion,
  leerArbol,
  leerHead,
} from '../estado/arbol'
import { leerTotal } from '../estado/contexto'
import { cambiarPestana, PANEL } from '../estado/panel'
import { leerAplicado } from '../estado/selector'
import { restaurarModo } from '../selector/aplicar'
import {
  ayudante,
  canonizar,
  enCola,
  escribirDisco,
  estadoSesion,
  type EstadoSesion,
  leerDisco,
  mensajeDe,
  mensajesDe,
  soloRuidoTras,
} from './disco'
import { INJERTO, NOTA_FICHEROS, transcribir } from './mensajes'
import {
  abandonarTrasRewind,
  borrables,
  buscarNodo,
  descendientes,
  etiquetaNodo,
  origenEnCadena,
  recortar,
  rewindDe,
  sinRewindVacio,
  sinVacios,
  turnos,
  VACIO,
  vivificar,
} from './modelo'
import { avisarRewind } from './rewind'

// El árbol de checkpoints de la conversación, con la lógica de rewind.
//
// El motor guarda cada sesión en un transcript (`<sesión>.jsonl`) donde cada
// mensaje apunta a su anterior: la conversación es la cadena que sube desde el
// último. Un checkpoint es solo un puntero a un mensaje de esa cadena
// (`sesion` + `uuid`); no copia nada.
//
// Restaurar un checkpoint, o hacerle un fork, es lo que hace /branch: escribir
// una sesión nueva con la cadena hasta ese mensaje y abrirla con /resume. El
// modelo ve los mensajes de verdad, como tras un rewind: sin /clear, sin una
// transcripción pegada y sin compactar. La sesión de la que se viene no se
// toca y sigue en el árbol.
//
// Como las ramas comparten los uuid de sus mensajes comunes, el padre de un
// checkpoint nuevo es el checkpoint más profundo que está en su cadena: el
// árbol sale de la historia real, también tras un rewind nativo. Lo que ese
// rewind deja atrás se marca como abandonado y se avisa; borrarlo lo decide la
// persona (el motor no dice si también restauró los ficheros).
//
// Leer y bifurcar transcripts lo hace `scripts/transcript.cjs` con node: pasan
// con facilidad de los 4 MiB que `$.fs.read` deja leer. El índice vive en
// `~/.claude/contexto-vivo/ramas/<proyecto>/indice.json`.
//
// Este fichero: las operaciones (cargar, checkpoint, nombrar, restaurar, fork,
// borrar, limpiar e injertar). La forma pura del árbol está en modelo.ts, el
// disco en disco.ts, el vigía del rewind en rewind.ts y las consultas en
// consultas.ts.

type $ = EngineInterface

// Al empezar la sesión (también al llegar a ella con /resume): el árbol del
// proyecto y el HEAD que esta sesión tenga en él.
//
// El índice se pone en el panel al momento; corregir los checkpoints antiguos
// lee los transcripts (node, una vez por sesión) y llega después.
export async function cargarArbol($: $): Promise<void> {
  const sesion = await $.session.id()
  await enCola(async () => {
    const leido = await leerDisco($)
    await cambiarArbol($, () => leido)
    await cambiarHead($, h => leido.heads[sesion] ?? h)
  })
  // En la cola, pero sin esperarla: quien carga no se queda parado.
  void enCola(async () => {
    const leido = await leerDisco($)
    const a = sinVacios(await canonizar($, leido))
    if (a === leido) return
    await escribirDisco($, a)
    const quedan = (id: string | null) => id !== null && buscarNodo(a, id) !== undefined
    await cambiarHead($, h => a.heads[sesion] ?? (quedan(h) ? h : null))
    await cambiarSeleccion($, s => (quedan(s) ? s : null))
  }).catch(error => $.ui.log(`árbol: ${mensajeDe(error)}`, { to: 'debug' }))
}

// La sesión a la que se acaba de restaurar o hacer fork, en `$.store` para que
// sobreviva al reinicio del mod con el /resume.
const CLAVE_ABRIR = 'arbol-abrir'

// Si esta sesión viene de restaurar o de un fork, abre el panel en la pestaña
// Árbol (una sola vez).
export async function abrirArbolSiToca($: $): Promise<void> {
  const pendiente = await $.store.get(CLAVE_ABRIR)
  if (pendiente === undefined || pendiente !== (await $.session.id())) return
  await $.store.delete(CLAVE_ABRIR)
  await cambiarPestana($, () => 'arbol')
  await $.ui.open({ id: PANEL, title: 'Contexto' })
}

// Una conversación vacía (al abrir claude o tras /clear): sin ningún nodo
// elegido ni nada a medias de la conversación anterior y, si el proyecto tiene
// árbol, la pestaña Árbol con el árbol entero. `abrir` abre además el panel.
export async function verArbolEntero($: $, abrir: boolean): Promise<void> {
  await cambiarSeleccion($, () => null)
  await cambiarConsulta($, () => null)
  await cambiarBorrando($, () => null)
  await cambiarRestaurando($, () => null)
  const a = await leerArbol($)
  if (a === null || a.nodos.length === 0) return
  await cambiarPestana($, () => 'arbol')
  if (abrir) await $.ui.open({ id: PANEL, title: 'Contexto' })
}

// Vuelve a leer el índice del disco (otra sesión puede haberlo cambiado),
// sin checkpoints vacíos y sin tocar el HEAD.
export function recargarArbol($: $): Promise<void> {
  return enCola(async () => {
    const leido = await leerDisco($)
    const a = sinVacios(leido)
    if (a === leido) await cambiarArbol($, () => leido)
    else await escribirDisco($, a)
  })
}

// El modelo y el esfuerzo de la última petición, para guardarlos en el checkpoint.
async function modoActual($: $): Promise<Pick<Nodo, 'modelo' | 'esfuerzo'>> {
  const apl = await leerAplicado($)
  const modelo = apl.modelo ?? (await $.session.model().catch(() => null))
  return {
    ...(modelo === null || modelo === '' ? {} : { modelo }),
    ...(apl.esfuerzo === null || apl.esfuerzo === '' ? {} : { esfuerzo: apl.esfuerzo }),
  }
}

async function crearCheckpoint($: $, nombre?: string): Promise<Nodo | null> {
  const sesion = await $.session.id()
  const e = await estadoSesion($, sesion)
  // Sin ningún prompt (turno 0: solo filas de comandos, tras /clear o al
  // abrir) no hay nada a lo que volver: no es un checkpoint.
  if (e === null || e.uuid === null || e.mensajes === 0 || e.turnos === 0) return null
  // El HEAD que el índice guarda para esta sesión: tras /clear (otra sesión)
  // no hay ninguno y la cadena nueva no es un rewind.
  const leido = await canonizar($, await leerDisco($))
  const { arbol: a, ids: abandonados } = abandonarTrasRewind(leido, sesion, leido.heads[sesion] ?? null, e.cadena)
  avisarRewind($, abandonados.length)
  const origen = origenEnCadena(a, e.cadena, a.heads[sesion] ?? (await leerHead($)))

  // Nada nuevo desde el checkpoint más cercano: la sesión está en él, y como
  // mucho se le pone nombre. Lo mismo si lo único que se ha añadido es lo que
  // el motor escribe al reanudar tras una interrupción.
  const enOrigen =
    origen !== undefined &&
    (origen.uuid === e.uuid || (await soloRuidoTras($, sesion, e.uuid, origen.uuid)))
  if (origen !== undefined && enOrigen) {
    // Sin mensajes nuevos, el modo que valga ahora es el de este punto.
    const conModo = { ...origen, ...(await modoActual($)) }
    const actual = nombre === undefined || nombre === origen.nombre ? conModo : { ...conModo, nombre }
    await escribirDisco(
      $,
      vivificar(
        { ...a, nodos: a.nodos.map(n => (n.id === origen.id ? actual : n)), heads: { ...a.heads, [sesion]: origen.id } },
        origen.id,
      ),
    )
    await cambiarHead($, () => origen.id)
    return actual
  }

  // El primer checkpoint de un fork con nombre se llama como el fork.
  const titulo = a.titulos[sesion]
  const primero = !a.nodos.some(n => n.sesion === sesion)
  const nombreFinal = nombre ?? (titulo !== undefined && primero ? titulo : undefined)
  const id = `n${a.siguiente}`
  const nodo: Nodo = {
    id,
    padre: origen?.id ?? null,
    ...(nombreFinal === undefined ? {} : { nombre: nombreFinal }),
    creado: await $.clock.now(),
    sesion,
    uuid: e.uuid,
    mensajes: e.mensajes,
    turnos: e.turnos,
    tokens: (await leerTotal($))?.tokens ?? 0,
    prompt: enLinea(e.prompt).slice(0, 80),
    ...(await modoActual($)),
  }
  await escribirDisco(
    $,
    vivificar(recortar({ ...a, siguiente: a.siguiente + 1, nodos: [...a.nodos, nodo], heads: { ...a.heads, [sesion]: id } }), id),
  )
  await cambiarHead($, () => id)
  return nodo
}

// Guarda la conversación tal como está. Sin cambios desde el último checkpoint
// no crea nada; con `nombre`, se lo pone al checkpoint (nuevo o ese).
export function checkpoint($: $, nombre?: string): Promise<Nodo | null> {
  return enCola(() => crearCheckpoint($, nombre))
}

export function nombrar($: $, id: string, nombre: string): Promise<void> {
  return enCola(async () => {
    const a = await leerDisco($)
    const limpio = enLinea(nombre).slice(0, 60)
    await escribirDisco($, {
      ...a,
      nodos: a.nodos.map(n => {
        if (n.id !== id) return n
        const { nombre: _anterior, ...resto } = n
        return limpio === '' ? resto : { ...resto, nombre: limpio }
      }),
    })
  })
}

// Llevar la conversación a un checkpoint: guardar lo que haya de nuevo,
// escribir una sesión con la conversación hasta él (como /branch) y abrirla
// con /resume. `nombre` la convierte en un fork con nombre: se ve así en
// /resume y su primer checkpoint lo lleva.
//
// La sesión de la que se viene no se toca. Si el motor no cambiara de sesión,
// la rama ya está escrita: se dice cómo abrirla.
async function irA($: $, id: string, nombre?: string): Promise<void> {
  const fork = nombre !== undefined
  await cambiarRestaurando($, () => null)
  await cambiarOcupado($, () => (fork ? `Creando el fork «${nombre}»…` : `Restaurando ${id}…`))
  try {
    await checkpoint($).catch(error => $.ui.log(`árbol: ${mensajeDe(error)}`, { to: 'debug' }))
    const nodo = buscarNodo(await enCola(() => leerDisco($)), id)
    if (nodo === undefined) {
      $.ui.toast(`No existe el checkpoint ${id}`)
      return
    }
    const etiqueta = etiquetaNodo(nodo)
    // Un punto que un rewind dejó atrás: puede que su código ya no esté en
    // disco. Se le dice al modelo en la conversación nueva (antes de quitarle
    // la marca al volver a él).
    const avisar = nodo.abandonado === true
    const rama = await ayudante<{ id: string }>($, ['fork', nodo.sesion, nodo.uuid, ...(fork ? [nombre] : [])])
    await enCola(async () => {
      const a = await leerDisco($)
      await escribirDisco(
        $,
        vivificar(
          { ...a, heads: { ...a.heads, [rama.id]: nodo.id }, titulos: fork ? { ...a.titulos, [rama.id]: nombre } : a.titulos },
          nodo.id,
        ),
      )
    })

    // La sesión nueva abre el panel en el árbol al empezar, aunque el mod se
    // reinicie con el /resume (lo hace `abrirArbolSiToca`).
    await $.store.set(CLAVE_ABRIR, rama.id)
    await $.command.run({ command: 'resume', args: rama.id })
    if ((await $.session.id()) !== rama.id) {
      $.ui.log(
        `⑂ La rama está lista en la sesión ${rama.id}: ábrela con /resume ${rama.id} o claude --resume ${rama.id}${
          avisar ? '. Un rewind dejó atrás ese punto: los ficheros pueden no coincidir con la conversación.' : ''
        }`,
      )
      $.ui.toast(`⑂ Rama creada, pero no se abrió sola: /resume ${rama.id.slice(0, 8)}…`)
      return
    }
    // Una conversación nueva: lo medido en la anterior no vale, y la caché se
    // reescribe en la próxima petición por fuerza (no avisar de ello).
    await olvidarConversacion($)
    marcarCompactado()
    await cambiarArbol($, () => null)
    await cargarArbol($)
    await cambiarHead($, () => nodo.id)
    await cambiarSeleccion($, () => nodo.id)
    await abrirArbolSiToca($)
    // El modelo y el esfuerzo con que se trabajaba en ese punto.
    const modo = await restaurarModo($, nodo.modelo, nodo.esfuerzo)
    const avisado = avisar && (await anotarFicheros($))
    await fotografiar($)
    const nota = `${modo.length > 0 ? ` · ${modo.join(' ')}` : ''}${avisado ? ' · ⚠ los ficheros pueden no coincidir (Claude lo sabe)' : ''}`
    $.ui.toast(fork ? `⑂ Fork «${nombre}» desde ${etiqueta}${nota}` : `⤺ En ${etiqueta} · ${turnos(nodo.turnos)}${nota}`, {
      timeoutMs: avisado ? 8000 : 4000,
    })
  } catch (error) {
    $.ui.toast(`No se pudo ${fork ? 'crear el fork' : 'restaurar'}: ${mensajeDe(error)}`)
  } finally {
    await cambiarOcupado($, () => null)
  }
}

// Deja en la conversación la nota de que los ficheros pueden no coincidir, como
// un mensaje que el modelo lee (como el injerto). Dice si se pudo.
async function anotarFicheros($: $): Promise<boolean> {
  try {
    const hecho = await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: NOTA_FICHEROS }] } })
    if ('deny' in hecho && hecho.deny !== undefined) {
      $.ui.log(`No se pudo avisar de los ficheros: ${String(hecho.deny)}. Pídele a Claude que relea los ficheros antes de editar.`)
      return false
    }
    return true
  } catch (error) {
    $.ui.log(`No se pudo avisar de los ficheros: ${mensajeDe(error)}. Pídele a Claude que relea los ficheros antes de editar.`)
    return false
  }
}

// Volver a un checkpoint, como rewind: la conversación sigue desde ahí.
export function restaurar($: $, id: string): Promise<void> {
  return irA($, id)
}

// Una rama nueva con nombre desde un checkpoint, como /branch.
export function forkear($: $, id: string, nombre: string): Promise<void> {
  const limpio = enLinea(nombre).slice(0, 60)
  return irA($, id, limpio === '' ? `fork de ${id}` : limpio)
}

// Quita del árbol el nodo y todo lo que cuelga de él. Las sesiones siguen en
// disco (en /resume); solo dejan de verse aquí.
//
// Si se lleva la rama en que está la conversación, esta se queda sin
// checkpoint: el siguiente que se guarde cuelga del checkpoint más profundo
// que quede en su cadena (el padre del borrado) o empieza una raíz nueva.
export function borrarRama($: $, id: string): Promise<void> {
  return enCola(async () => {
    await cambiarBorrando($, () => null)
    const a = await leerDisco($)
    if (buscarNodo(a, id) === undefined) return
    const fuera = descendientes(a, id)
    const head = await leerHead($)
    const sinHead = head !== null && fuera.has(head)
    const heads = Object.fromEntries(Object.entries(a.heads).filter(([, h]) => !fuera.has(h)))
    const nodos = a.nodos.filter(n => !fuera.has(n.id))
    await escribirDisco($, sinRewindVacio({ ...a, nodos, heads }))
    if (sinHead) await cambiarHead($, () => null)
    await cambiarSeleccion($, s => (s !== null && fuera.has(s) ? null : s))
    $.ui.toast(
      `✕ Borrado${fuera.size === 1 ? ' 1 checkpoint' : `s ${fuera.size} checkpoints`}${sinHead ? ' · la conversación actual sigue, sin checkpoint' : ''}`,
    )
  })
}

// «Borrar» del aviso de rewind: quita del árbol lo abandonado que se puede
// quitar sin dejar huérfano a nadie (`borrables`). Los nombrados y lo que
// tiene otras ramas se quedan, marcados. Las sesiones siguen en disco.
export function borrarAbandonados($: $): Promise<void> {
  return enCola(async () => {
    const a = await leerDisco($)
    const aviso = rewindDe(a, await $.session.id())
    if (aviso === undefined) return
    const fuera = borrables(a, aviso.ids)
    const { rewind: _hecho, ...resto } = a
    await escribirDisco($, { ...resto, nodos: a.nodos.filter(n => !fuera.has(n.id)) })
    await cambiarSeleccion($, s => (s !== null && fuera.has(s) ? null : s))
    const quedan = aviso.ids.length - fuera.size
    $.ui.toast(
      `✕ ${fuera.size === 1 ? 'Borrado 1 checkpoint' : `Borrados ${fuera.size} checkpoints`} del rewind${quedan > 0 ? ` · ${quedan === 1 ? 'queda 1' : `quedan ${quedan}`} con nombre, con ramas o abiertos en otra sesión` : ''}`,
    )
  })
}

// «Conservar» del aviso de rewind: los checkpoints se quedan, marcados.
export function conservarAbandonados($: $): Promise<void> {
  return enCola(async () => {
    const a = await leerDisco($)
    if (a.rewind === undefined) return
    const { rewind: _hecho, ...resto } = a
    await escribirDisco($, resto)
  })
}

// Vacía el árbol del proyecto: todos los checkpoints, de todas las sesiones.
// Las sesiones siguen en disco (en /resume); el siguiente checkpoint empieza
// una raíz nueva. Los ids no se reutilizan, para que no se confundan con los
// de exportaciones anteriores.
export function limpiarArbol($: $): Promise<void> {
  return enCola(async () => {
    await cambiarBorrando($, () => null)
    const a = await leerDisco($)
    await escribirDisco($, { ...VACIO, siguiente: a.siguiente })
    await cambiarHead($, () => null)
    await cambiarSeleccion($, () => null)
    await cambiarConsulta($, () => null)
    $.ui.toast(`✕ Árbol limpio · ${a.nodos.length === 1 ? '1 checkpoint borrado' : `${a.nodos.length} checkpoints borrados`}`)
  })
}

// Trae a la conversación actual lo que se concluyó en otra rama: un resumen de
// lo que esa rama hizo desde que se separó, como un mensaje que el modelo lee.
export function injertar($: $, id: string): Promise<void> {
  return enCola(async () => {
    await cambiarOcupado($, () => `Resumiendo la rama de ${id}…`)
    try {
      const a = await leerDisco($)
      const nodo = buscarNodo(a, id)
      if (nodo === undefined) return
      const actual = await ayudante<EstadoSesion>($, ['estado', await $.session.id()])
      const comun = new Set(actual.cadena)
      // Lo propio de la rama: los mensajes que la conversación actual no tiene.
      const propio = (await mensajesDe($, nodo)).filter(m => m.uuid === undefined || !comun.has(m.uuid))
      if (propio.length === 0) {
        $.ui.toast('Ese checkpoint ya forma parte de la conversación actual')
        return
      }
      const r = await $.model.complete({
        model: 'sonnet',
        effort: 'low',
        maxTokens: 1500,
        system:
          'Resumes una rama alternativa de una conversación de programación para incorporarla a otra rama. ' +
          'Escribe en español, en viñetas breves: objetivo de la rama, decisiones y conclusiones, ficheros y cambios ' +
          'relevantes, y lo que quedó pendiente o descartado y por qué. Sin preámbulo.',
        prompt: transcribir(propio, 60_000),
      })
      if (!r.isAnswered) {
        $.ui.toast(`No se pudo resumir la rama: ${r.reason}`)
        return
      }
      const titulo = etiquetaNodo(nodo)
      const hecho = await $.session.append({
        message: {
          type: 'user',
          content: [
            {
              type: 'text',
              text: `${INJERTO} desde otra rama del árbol de checkpoints: ${titulo} (${id}). Es lo que se hizo allí; tenlo en cuenta en esta rama.]\n\n${r.text}`,
            },
          ],
        },
      })
      if ('deny' in hecho && hecho.deny !== undefined) {
        $.ui.toast(`No se pudo injertar: ${String(hecho.deny)}`)
        return
      }
      $.ui.toast(`⎇ Injertado el resumen de ${titulo} (≈${k(Math.ceil(r.text.length / CARACTERES_POR_TOKEN))})`)
    } catch (error) {
      $.ui.toast(`No se pudo injertar: ${mensajeDe(error)}`)
    } finally {
      await cambiarOcupado($, () => null)
    }
  })
}
