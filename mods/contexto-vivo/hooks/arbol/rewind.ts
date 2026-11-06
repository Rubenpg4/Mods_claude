import type { EngineInterface } from 'claude-code'

import { cambiarHead, cambiarSeleccion } from '../estado/arbol'
import { ayudante, enCola, escribirDisco, type EstadoSesion, leerDisco, mensajeDe } from './disco'
import { type ConTexto, corteDeRewind, type Guardado } from './mensajes'
import { abandonarTrasRewind, buscarNodo, origenEnCadena } from './modelo'

// Rewind nativo, en cuanto pasa.
//
// El motor no avisa de un rewind, y el transcript no cambia hasta el siguiente
// mensaje; lo que cambia al momento es la conversación que tiene en memoria,
// que se acorta. Un vigía la mira cada `VIGIA_MS`: si tiene menos mensajes que
// la vez anterior, se compara con el transcript para saber a qué prompt se
// volvió, el HEAD pasa al checkpoint de ese punto y lo de después se marca
// como abandonado. Si no se puede saber, no se toca nada: lo hará el
// siguiente checkpoint.

type $ = EngineInterface

// Tras /clear la conversación vuelve a estar vacía: el siguiente checkpoint
// empieza una raíz nueva. Lo que el vigía vio era de la conversación de antes.
export async function soltarHead($: $): Promise<void> {
  visto = null
  await cambiarHead($, () => null)
}

export function avisarRewind($: $, n: number): void {
  if (n === 0) return
  $.ui.toast(
    `⤺ Rewind: ${n === 1 ? '1 checkpoint queda' : `${n} checkpoints quedan`} fuera de la conversación · /ctx → Árbol para borrar o conservar`,
    { timeoutMs: 8000 },
  )
}

export const VIGIA_MS = 1000

let vigia: { cancel: () => void } | null = null
// Lo que tenía la conversación la última vez que se miró.
let visto: { sesion: string; mensajes: number } | null = null
let mirando = false

export function arrancarVigia($: $): void {
  vigia?.cancel()
  visto = null
  vigia = $.clock.every(VIGIA_MS, () => void vigilarRewind($))
}

export async function vigilarRewind($: $): Promise<void> {
  if (mirando) return
  mirando = true
  try {
    const sesion = await $.session.id()
    const memoria = await $.session.messages()
    const antes = visto
    visto = { sesion, mensajes: memoria.length }
    // Quedarse sin ningún mensaje es un /clear (o una sesión nueva), no un
    // rewind: si lo fuera, el siguiente checkpoint lo marca igualmente.
    if (antes === null || antes.sesion !== sesion || memoria.length === 0 || memoria.length >= antes.mensajes) return
    await enCola(() => seguirRewind($, sesion, memoria)).catch(error =>
      $.ui.log(`árbol: rewind: ${mensajeDe(error)}`, { to: 'debug' }),
    )
  } catch {
    // La conversación no se pudo leer ahora: se mira en la próxima vuelta.
  } finally {
    mirando = false
  }
}

async function seguirRewind($: $, sesion: string, memoria: readonly ConTexto[]): Promise<void> {
  const a = await leerDisco($)
  // El HEAD que el índice guarda para esta sesión (puede ser un checkpoint de
  // la sesión de la que salió). Sin él (recién empezada, tras /clear) no hay
  // nada que dejar atrás.
  const actual = buscarNodo(a, a.heads[sesion])
  if (actual === undefined) return
  const e = await ayudante<EstadoSesion>($, ['estado', sesion])
  if (e.uuid === null) return
  const corte = corteDeRewind(await ayudante<Guardado[]>($, ['mensajes', sesion, e.uuid]), memoria)
  const i = corte === null ? -1 : e.cadena.indexOf(corte)
  // Si el motor ya hubiera escrito el rewind, la cadena del transcript vale tal cual.
  const cadena = i < 0 ? e.cadena : e.cadena.slice(0, i)
  const { arbol, ids } = abandonarTrasRewind(a, sesion, actual.id, cadena)
  if (ids.length === 0) return
  const origen = origenEnCadena(arbol, cadena, null)
  const { [sesion]: _antes, ...otros } = arbol.heads
  await escribirDisco($, { ...arbol, heads: origen === undefined ? otros : { ...otros, [sesion]: origen.id } })
  await cambiarHead($, () => origen?.id ?? null)
  await cambiarSeleccion($, s => (s !== null && ids.includes(s) ? (origen?.id ?? null) : s))
  avisarRewind($, ids.length)
}
