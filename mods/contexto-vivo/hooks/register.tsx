import type { Register, Timer } from 'claude-code'

import { buscar, comparar, exportar, informeArbol, informeBusqueda, informeComparacion } from './arbol/consultas'
import { etiquetaNodo, resolver } from './arbol/modelo'
import {
  abrirArbolSiToca,
  cargarArbol,
  checkpoint,
  forkear,
  recargarArbol,
  restaurar,
  verArbolEntero,
} from './arbol/operaciones'
import { arrancarVigia, soltarHead } from './arbol/rewind'
import { enLinea } from './comun/formato'
import { diagnosticar } from './contexto/diagnostico'
import { cargarIgnorados } from './contexto/ignorados'
import { informe, pie } from './contexto/informes'
import { apuntarLimites, cargarLimites, horaVisible, limitesVisibles, marcarHora } from './contexto/limites'
import {
  fotografiar,
  olvidarConversacion,
  refrescar,
  registrarLlamada,
  registrarPaso,
  registrarTurno,
  terminarSubagente,
  trasCompactar,
} from './contexto/medicion'
import { tendencia } from './contexto/tendencia'
import { leerArbol, leerHead } from './estado/arbol'
import {
  cambiarUltimoPrompt,
  leerFoto,
  leerHistorial,
  leerIgnorados,
  leerLlamadas,
  leerRoturas,
  leerSeguimiento,
  leerSubagentes,
  leerTotal,
} from './estado/contexto'
import { cambiarPestana, PANEL } from './estado/panel'
import { cambiarAplicado, leerAplicado } from './estado/selector'
import { sinResolver } from './ia/informe'
import { cargarSeguimiento } from './ia/lanzar'
import { acabaTurno, comandoModelo, empiezaTurno, esPropio, soltarEsfuerzo } from './selector/aplicar'
import { dibujarBanda } from './selector/banda'
import { esNivel } from './selector/modelos'
import { leerConfig } from './config'
import { dibujarPanel } from './panel/index'

let tic: Timer | null = null

const ARBOL_VACIO = { version: 2 as const, siguiente: 1, nodos: [], heads: {}, titulos: {} }

// Contexto vivo: panel /ctx (reparto navegable, diagnóstico, tendencia,
// subagentes, llamadas y árbol de checkpoints), resumen /contexto-top, los
// comandos del árbol (/cp, /cp-ir, /cp-fork, /cp-arbol, /cp-diff, /cp-buscar,
// /cp-exportar) y la cifra en la fila de «auto mode on». Los umbrales vienen de
// /config.
export const register: Register = (on, opciones) => {
  const cfg = leerConfig(opciones)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'ctx',
      description: 'Abre el panel de la ventana de contexto en directo',
    })
    await $.command.register({
      name: 'contexto-top',
      description: 'Muestra lo que más ocupa la ventana de contexto y los malos usos',
    })
    await $.command.register({
      name: 'cp',
      description: 'Guarda un checkpoint de la conversación con nombre: /cp <nombre>',
    })
    await $.command.register({
      name: 'cp-ir',
      description: 'Vuelve a un checkpoint del árbol, como rewind: /cp-ir <id o nombre>',
    })
    await $.command.register({
      name: 'cp-fork',
      description: 'Abre una rama con nombre desde un checkpoint, como /branch: /cp-fork [id o nombre] [-- nombre de la rama]',
    })
    await $.command.register({
      name: 'cp-arbol',
      description: 'Abre el árbol de checkpoints de la conversación',
    })
    await $.command.register({
      name: 'cp-diff',
      description: 'Compara dos checkpoints desde que se separan: /cp-diff <a> [b, por defecto el actual]',
    })
    await $.command.register({
      name: 'cp-buscar',
      description: 'Busca un texto en todos los checkpoints del árbol: /cp-buscar <texto>',
    })
    await $.command.register({
      name: 'modelo',
      description: 'Selector de modelo y esfuerzo: /modelo despliega la banda; /modelo sonnet high lo aplica directo',
      argumentHint: '[fable|opus|sonnet|haiku] [low|medium|high|xhigh|max]',
    })
    await $.command.register({
      name: 'cp-exportar',
      description: 'Exporta la conversación de un checkpoint a Markdown: /cp-exportar [id o nombre]',
    })
    const r = await next(e)
    await cargarArbol($).catch(error => $.ui.log(`árbol: ${String(error)}`, { to: 'debug' }))
    // Tras restaurar o hacer un fork, la sesión nueva empieza con el árbol abierto.
    await abrirArbolSiToca($).catch(error => $.ui.log(`árbol: ${String(error)}`, { to: 'debug' }))
    // Una conversación vacía empieza con el árbol entero a la vista, sin
    // ningún nodo elegido.
    if (e.isInteractive) {
      const mensajes = await $.session.messages().catch(() => null)
      if (mensajes !== null && mensajes.length === 0) {
        await verArbolEntero($, true).catch(error => $.ui.log(`árbol: ${String(error)}`, { to: 'debug' }))
      }
    }
    // Un rewind nativo se refleja en el árbol en cuanto pasa, no al acabar el
    // siguiente turno.
    arrancarVigia($)
    await cargarIgnorados($)
    // Los hallazgos llevados a la IA y el sondeo de los que siguen en curso.
    await cargarSeguimiento($).catch(error => $.ui.log(`seguimiento: ${String(error)}`, { to: 'debug' }))
    // Los límites 5h/7d de la última lectura, hasta que llegue la primera
    // respuesta de esta sesión.
    await cargarLimites($)
    await marcarHora($)
    await refrescar($, cfg)
    // Un tic por minuto para que la cuenta atrás de 5h/7d no se quede parada
    // mientras no hay respuestas. Una recarga del módulo cancela el anterior.
    tic ??= $.clock.every(60_000, () => void marcarHora($))

    return r
  })

  on('command.run', { command: 'ctx' }, async $ => {
    await fotografiar($)
    await $.ui.open({ id: PANEL, title: 'Contexto' })

    return {}
  })

  on('command.run', { command: 'contexto-top' }, async $ => {
    await fotografiar($)
    const [f, lista, historial, subagentes, ignorados, seguimiento, t, roturas] = await Promise.all([
      leerFoto($),
      leerLlamadas($),
      leerHistorial($),
      leerSubagentes($),
      leerIgnorados($),
      leerSeguimiento($),
      leerTotal($),
      leerRoturas($),
    ])
    // Los resueltos con IA (o a mano) no salen como avisos, salvo que vuelvan.
    const pendientes = new Set(
      sinResolver(diagnosticar(f, lista, cfg, ignorados, { turnos: historial, subagentes, total: t, roturas }), seguimiento).map(h => h.clave),
    )
    const ocultos = seguimiento.filter(s => s.resuelto !== undefined && !pendientes.has(s.clave)).map(s => s.clave)
    // `$.ui.log` lo muestra sin que el modelo lo lea, así no ocupa contexto.
    $.ui.log(informe(f, lista, historial, subagentes, cfg, [...ignorados, ...ocultos], t, roturas))

    return {}
  })

  // ⎇ Árbol: /cp guarda (y nombra) un checkpoint de la conversación tal como está.
  on('command.run', { command: 'cp' }, async ($, e) => {
    const nombre = e.args.replace(/\s+/g, ' ').trim().slice(0, 60)
    try {
      const nodo = await checkpoint($, nombre === '' ? undefined : nombre)
      $.ui.log(nodo === null ? 'No hay conversación que guardar todavía.' : `◆ Checkpoint ${nodo.id}: ${etiquetaNodo(nodo)}`)
    } catch (error) {
      $.ui.log(`No se pudo guardar el checkpoint: ${String(error)}`)
    }

    return {}
  })

  // /cp-ir <id o nombre>: abre la conversación de ese checkpoint en una sesión
  // nueva con /resume, como rewind. Eso no se puede hacer mientras este
  // comando tiene el turno: va justo después.
  on('command.run', { command: 'cp-ir' }, async ($, e) => {
    const texto = e.args.trim()
    const nodo = resolver((await leerArbol($)) ?? ARBOL_VACIO, texto)
    if (nodo === undefined) {
      $.ui.log(texto === '' ? 'Uso: /cp-ir <id o nombre>. /cp-arbol muestra el árbol.' : `No hay ningún checkpoint «${texto}».`)
      return {}
    }
    $.clock.after(10, () => void restaurar($, nodo.id))

    return {}
  })

  // /cp-fork [id o nombre] [-- nombre de la rama]: una rama con nombre desde
  // ese checkpoint, como /branch; sin id, desde la conversación actual.
  on('command.run', { command: 'cp-fork' }, async ($, e) => {
    const corte = e.args.indexOf('--')
    const referencia = (corte < 0 ? e.args : e.args.slice(0, corte)).trim()
    const nombre = corte < 0 ? '' : e.args.slice(corte + 2).trim()
    const nodo =
      referencia === '' ? ((await checkpoint($)) ?? undefined) : resolver((await leerArbol($)) ?? ARBOL_VACIO, referencia)
    if (nodo === undefined) {
      $.ui.log(
        referencia === ''
          ? 'No hay conversación de la que hacer un fork todavía.'
          : `No hay ningún checkpoint «${referencia}». Uso: /cp-fork [id o nombre] [-- nombre de la rama].`,
      )
      return {}
    }
    $.clock.after(10, () => void forkear($, nodo.id, nombre))

    return {}
  })

  // /cp-diff <a> [b]: qué tiene cada uno desde que sus ramas se separan.
  on('command.run', { command: 'cp-diff' }, async ($, e) => {
    const a = (await leerArbol($)) ?? ARBOL_VACIO
    const [x, y] = e.args.trim().split(/\s+/).filter(p => p !== '')
    const primero = x === undefined ? undefined : resolver(a, x)
    const otro = y === undefined ? await leerHead($) : (resolver(a, y)?.id ?? null)
    if (primero === undefined || otro === null) {
      $.ui.log('Uso: /cp-diff <id o nombre> [otro, por defecto el actual]. /cp-arbol muestra el árbol.')
      return {}
    }
    try {
      $.ui.log(informeComparacion(a, primero.id, otro, await comparar($, primero.id, otro)))
    } catch (error) {
      $.ui.log(`No se pudo comparar: ${String(error)}`)
    }

    return {}
  })

  on('command.run', { command: 'cp-buscar' }, async ($, e) => {
    const texto = e.args.trim()
    if (texto === '') {
      $.ui.log('Uso: /cp-buscar <texto>')
      return {}
    }
    $.ui.log(informeBusqueda(await leerArbol($), texto, await buscar($, texto)))

    return {}
  })

  on('command.run', { command: 'cp-exportar' }, async ($, e) => {
    const texto = e.args.trim()
    const id = texto === '' ? await leerHead($) : resolver((await leerArbol($)) ?? ARBOL_VACIO, texto)?.id
    if (id == null) {
      $.ui.log(texto === '' ? 'Aún no hay checkpoint actual: /cp-exportar <id o nombre>.' : `No hay ningún checkpoint «${texto}».`)
      return {}
    }
    try {
      $.ui.log(`⇩ ${id} exportado a ${await exportar($, id)}`)
    } catch (error) {
      $.ui.log(`No se pudo exportar: ${String(error)}`)
    }

    return {}
  })

  on('command.run', { command: 'cp-arbol' }, async $ => {
    await cambiarPestana($, () => 'arbol')
    const { isPlaced } = await $.ui.open({ id: PANEL, title: 'Contexto' })
    if (!isPlaced) $.ui.log(informeArbol(await leerArbol($), await leerHead($)))

    return {}
  })

  // El texto de cada prompt, para nombrar los turnos en la tendencia.
  on('prompt.submit', async ($, e, next) => {
    await cambiarUltimoPrompt($, () => enLinea(e.text).slice(0, 80))

    return next(e)
  }).catch(($, e, next) => next(e))

  // Solo la conversación principal: lo que hace un subagente no entra en ella.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId !== undefined) return ran

    const texto = ran.deny ?? `${ran.text ?? ''}${(ran.context ?? []).join('')}`
    await registrarLlamada($, cfg, e.tool, e.tool_use_id ?? '', e as unknown as Record<string, unknown>, texto)

    return ran
  }).catch(($, e, next) => next(e))

  // Mientras hay turno principal, el selector guarda lo pulsado para después.
  on('turn.start', ($, e, next) => {
    if (e.agentId === undefined) empiezaTurno()

    return next(e)
  }).catch(($, e, next) => next(e))

  // El modelo y el esfuerzo los manda la sesión (/model y /effort, que el
  // selector cambia): aquí solo se apunta con qué salió cada petición.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      await cambiarAplicado($, () => ({ modelo: e.model, esfuerzo: typeof e.effort === 'string' ? e.effort : null }))
    }
    const respuesta = yield* next(e)
    if (e.agentId === undefined) await refrescar($, cfg, respuesta.usage)
    else if (respuesta.usage !== null) await registrarPaso($, e.agentId, respuesta.usage)

    return respuesta
  })

  // Un /model o /effort escrito a mano: la banda y la fila lo reflejan en el
  // acto, sin esperar a la próxima petición. No depende de PostModelSwitch,
  // que otro plugin puede no dejar pasar.
  on('command.run', { command: 'model' }, async ($, e, next) => {
    const r = await next(e)
    const ahora = await $.session.model().catch(() => null)
    if (ahora !== null) await cambiarAplicado($, a => ({ ...a, modelo: ahora }))

    return r
  }).catch(($, e, next) => next(e))

  // El del selector se apunta en `aplicarEsfuerzo`; uno escrito a mano además
  // manda sobre lo que esperaba al final del turno.
  on('command.run', { command: 'effort' }, async ($, e, next) => {
    const r = await next(e)
    const nivel = e.args.trim().toLowerCase()
    if (esNivel(nivel) && !esPropio('effort', nivel)) {
      await cambiarAplicado($, a => ({ ...a, esfuerzo: nivel }))
      await soltarEsfuerzo($)
    }

    return r
  }).catch(($, e, next) => next(e))

  // Por si llega: un fallback automático también cambia el modelo.
  on('classic.PostModelSwitch', async ($, e, next) => {
    await cambiarAplicado($, a => ({ modelo: e.to_model, esfuerzo: e.effort?.level ?? a.esfuerzo }))

    return next(e)
  }).catch(($, e, next) => next(e))

  // /modelo [modelo] [esfuerzo]: sin argumentos despliega la banda.
  on('command.run', { command: 'modelo' }, async ($, e) => {
    const texto = await comandoModelo($, e.args)

    return texto === undefined ? {} : { text: texto }
  })

  // Lo que el motor escribe por los /model y /effort que lanza el selector:
  // el eco y la salida se dibujan vacíos (lo guardado no cambia).
  on('ui.render', { component: 'CommandOutput' }, ($, e, next) =>
    next(esPropio(e.props.command, e.props.args) ? { ...e, props: { ...e.props, text: '' } } : e),
  )
  on('ui.render', { component: 'UserMessage' }, ($, e, next) => {
    const eco = /^\/(model|effort)\s+(\S+)$/.exec(e.props.text.trim())
    const propio = eco !== null && esPropio(eco[1] ?? '', eco[2] ?? '')

    return next(propio ? { ...e, props: { ...e.props, text: '' } } : e)
  })

  // La banda del selector, siempre sobre el prompt.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => dibujarBanda($, e, await next(e)))

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined) {
      await terminarSubagente($, e.agentId)
      return r
    }
    // Lo pulsado durante el turno, fuera de este hook: el respaldo con
    // `$.command.run` no puede ejecutarse mientras el turno espera aquí.
    $.clock.after(10, () => void acabaTurno($))
    await registrarTurno($)
    await fotografiar($)
    if (cfg.autoCheckpoint) {
      await checkpoint($).catch(error => $.ui.log(`árbol: ${String(error)}`, { to: 'debug' }))
    }

    return r
  })

  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined && !('skip' in r && r.skip !== undefined)) await trasCompactar($)

    return r
  }).catch(($, e, next) => next(e))

  // El motor avisa cuando una ventana de uso se mueve, también sin turno.
  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) await apuntarLimites($, e.rateLimits)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await soltarHead($)
      await olvidarConversacion($)
      // /clear no vuelve a pasar por `session.start`: cuando la sesión nueva
      // ya está, se carga otra vez lo que carga el arranque (el estado puede
      // empezar vacío) y se abre el árbol entero, sin ningún nodo elegido.
      await verArbolEntero($, false)
      $.clock.after(50, () => {
        void (async () => {
          await recargarArbol($)
          await verArbolEntero($, true)
          await cargarIgnorados($)
          await cargarSeguimiento($).catch(error => $.ui.log(`seguimiento: ${String(error)}`, { to: 'debug' }))
          await cargarLimites($)
          await marcarHora($)
          await refrescar($, cfg)
        })().catch(error => $.ui.log(`tras /clear: ${String(error)}`, { to: 'debug' }))
      })
    }

    return next(e)
  })

  // A la izquierda, en la fila de «auto mode on»: se añade como cola y la línea
  // del motor (sus indicadores vivos) se queda como está.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    // Se redibuja cada minuto (tic): las lecturas van a la vez, no en fila.
    const [f, t, historial, subagentes, roturas, lista, ignorados, seguimiento, limites, hora] = await Promise.all([
      leerFoto($),
      leerTotal($),
      leerHistorial($),
      leerSubagentes($),
      leerRoturas($),
      leerLlamadas($),
      leerIgnorados($),
      leerSeguimiento($),
      limitesVisibles($),
      horaVisible($),
    ])
    const entorno = { turnos: historial, subagentes, total: t, roturas }
    const avisos = sinResolver(diagnosticar(f, lista, cfg, ignorados, entorno), seguimiento).length
    const turnos = tendencia(historial, f, t).turnosRestantes
    const cola = pie(t, limites, turnos, avisos, hora)
    // Modelo y esfuerzo al final de la fila: el modelo de la sesión tal como lo
    // muestra /model (se lee en cada dibujo, no queda viejo), o el de la última
    // petición si no se puede leer; el esfuerzo, el del último /effort o petición.
    const apl = await leerAplicado($)
    const modelo = (await $.session.model().catch(() => null)) ?? apl.modelo
    const esfuerzo = apl.esfuerzo
    const etiqueta = [modelo, esfuerzo].filter(x => x !== null && x !== '').join(' ')
    const sufijo = etiqueta === '' ? '' : `  ·  ${etiqueta}`

    return next({ ...e, props: { ...e.props, tail: `${e.props.tail ?? ''}${cola}${sufijo}` } })
  })

  on('ui.render', { component: 'Pane', requestId: PANEL }, async ($, e) => dibujarPanel($, e, cfg))
}
