import type { Register } from 'claude-code'

import {
  cargarIgnorados,
  fotografiar,
  marcarCompactado,
  refrescar,
  registrarLlamada,
  registrarPaso,
  registrarTurno,
  reiniciar,
  terminarSubagente,
} from './acciones'
import { diagnosticar, informe, pie, tendencia } from './calculo'
import { leerConfig } from './config'
import {
  cambiarFoto,
  cambiarHistorial,
  cambiarSubagentes,
  cambiarUltimoPrompt,
  leerFoto,
  leerHistorial,
  leerIgnorados,
  leerLlamadas,
  leerSubagentes,
  leerTotal,
} from './estado'
import { dibujarPanel } from './panel'

const PANEL = 'contexto-vivo'

// Contexto vivo: panel /contexto (reparto navegable, diagnóstico, tendencia,
// subagentes y llamadas), resumen /contexto-top y la cifra en la fila de
// «auto mode on». Los umbrales vienen de /config.
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
    const r = await next(e)
    await cargarIgnorados($)
    await refrescar($, cfg)

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

  // El texto de cada prompt, para nombrar los turnos en la tendencia.
  on('prompt.submit', async ($, e, next) => {
    await cambiarUltimoPrompt($, () => e.text.replace(/\s+/g, ' ').trim().slice(0, 80))

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

    return r
  })

  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined && !('skip' in r && r.skip !== undefined)) {
      marcarCompactado()
      await reiniciar($)
      await fotografiar($)
    }

    return r
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await reiniciar($)
      await cambiarFoto($, () => null)
      await cambiarHistorial($, () => [])
      await cambiarSubagentes($, () => [])
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
    const cola = pie(t, turnos, avisos)

    return next({ ...e, props: { ...e.props, tail: `${e.props.tail ?? ''}${cola}` } })
  })

  on('ui.render', { component: 'Pane', requestId: PANEL }, async ($, e) => dibujarPanel($, e, cfg))
}
