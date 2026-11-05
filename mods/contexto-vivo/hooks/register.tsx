import type { Register, Timer } from 'claude-code'

import {
  cargarIgnorados,
  fotografiar,
  marcarHora,
  olvidarConversacion,
  refrescar,
  registrarLlamada,
  registrarPaso,
  registrarTurno,
  terminarSubagente,
  trasCompactar,
} from './acciones'
import {
  buscar,
  cargarArbol,
  checkpoint,
  comparar,
  etiquetaNodo,
  exportar,
  forkear,
  informeArbol,
  informeBusqueda,
  informeComparacion,
  resolver,
  restaurar,
  soltarHead,
} from './arbol'
import { diagnosticar, enLinea, informe, pie, tendencia } from './calculo'
import { leerConfig } from './config'
import {
  cambiarPestana,
  cambiarUltimoPrompt,
  leerAhora,
  leerArbol,
  leerFoto,
  leerHead,
  leerHistorial,
  leerIgnorados,
  leerLlamadas,
  leerSubagentes,
  leerTotal,
} from './estado'
import { dibujarPanel } from './panel'

const PANEL = 'contexto-vivo'
let tic: Timer | null = null

const ARBOL_VACIO = { version: 1 as const, siguiente: 1, nodos: [], heads: {} }

// Contexto vivo: panel /contexto (reparto navegable, diagnóstico, tendencia,
// subagentes, llamadas y árbol de checkpoints), resumen /contexto-top, los
// comandos del árbol (/cp, /cp-ir, /cp-fork, /cp-arbol, /cp-diff, /cp-buscar,
// /cp-exportar) y la cifra en la fila de «auto mode on». Los umbrales vienen de
// /config.
export const register: Register = (on, opciones) => {
  const cfg = leerConfig(opciones)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'contexto',
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
      name: 'cp-exportar',
      description: 'Exporta la conversación de un checkpoint a Markdown: /cp-exportar [id o nombre]',
    })
    const r = await next(e)
    await cargarArbol($).catch(error => $.ui.log(`árbol: ${String(error)}`, { to: 'debug' }))
    await cargarIgnorados($)
    await marcarHora($)
    await refrescar($, cfg)
    // Un tic por minuto para que la cuenta atrás de 5h/7d no se quede parada
    // mientras no hay respuestas. Una recarga del módulo cancela el anterior.
    tic ??= $.clock.every(60_000, () => void marcarHora($))

    return r
  })

  on('command.run', { command: 'contexto' }, async $ => {
    await fotografiar($)
    await $.ui.open({ id: PANEL, title: 'Contexto' })

    return {}
  })

  on('command.run', { command: 'contexto-top' }, async $ => {
    await fotografiar($)
    // `$.ui.log` lo muestra sin que el modelo lo lea, así no ocupa contexto.
    $.ui.log(
      informe(
        await leerFoto($),
        await leerLlamadas($),
        await leerHistorial($),
        await leerSubagentes($),
        cfg,
        await leerIgnorados($),
        await leerTotal($),
      ),
    )

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

  on('turn.step', async function* ($, e, next) {
    const respuesta = yield* next(e)
    if (e.agentId === undefined) await refrescar($, cfg, respuesta.usage)
    else if (respuesta.usage !== null) await registrarPaso($, e.agentId, respuesta.usage)

    return respuesta
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined) {
      await terminarSubagente($, e.agentId)
      return r
    }
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

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await soltarHead($)
      await olvidarConversacion($)
    }

    return next(e)
  })

  // A la izquierda, en la fila de «auto mode on»: se añade como cola y la línea
  // del motor (sus indicadores vivos) se queda como está.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const f = await leerFoto($)
    const t = await leerTotal($)
    const avisos = diagnosticar(f, await leerLlamadas($), cfg, await leerIgnorados($)).length
    const turnos = tendencia(await leerHistorial($), f, t).turnosRestantes
    const cola = pie(t, turnos, avisos, await leerAhora($))

    return next({ ...e, props: { ...e.props, tail: `${e.props.tail ?? ''}${cola}` } })
  })

  on('ui.render', { component: 'Pane', requestId: PANEL }, async ($, e) => dibujarPanel($, e, cfg))
}
