import type { EngineInterface, ModelUsage } from 'claude-code'

import type { Foto, Llamada, Rotura, Total } from '../../types'

import { sector } from '../comun/barras'
import { CARACTERES_POR_TOKEN, corta, enLinea, etiquetar, k, nombreHerramienta, ordenar } from '../comun/formato'
import type { Config } from '../config'
import {
  cambiarAviso,
  cambiarFoto,
  cambiarHistorial,
  cambiarLlamadas,
  cambiarRoturas,
  cambiarSubagentes,
  cambiarTotal,
  leerAviso,
  leerHistorial,
  leerLlamadas,
  leerSubagentes,
  leerTotal,
  leerUltimoPrompt,
} from '../estado/contexto'
import { cambiarConfirmar, cambiarMensajes, leerConservar } from '../estado/panel'
import { leerAplicado } from '../estado/selector'
import { apuntarLimites, marcarHora } from './limites'
import { CATEGORIAS } from './reparto'

// Medición de la conversación principal: ocupación y caché tras cada respuesta
// (con sus avisos), el desglose de /context (`fotografiar`), cada llamada a
// herramienta, cada turno y cada subagente; compactar y olvidar la conversación.

// Tras compactar, la primera petición reescribe la caché por fuerza: no avisar.
// La hora y el modelo de la última respuesta, para explicar una caché rota.
const marcas: { recienCompactado: boolean; hora: number | null; modelo: string | null } = {
  recienCompactado: false,
  hora: null,
  modelo: null,
}

// El turno en curso: el siguiente al último que se cerró.
async function turnoActual($: EngineInterface): Promise<number> {
  return ((await leerHistorial($)).at(-1)?.n ?? 0) + 1
}

function tokensDe(usage: ModelUsage): number {
  return usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
}

// Ocupación y caché tras una respuesta de la conversación principal; avisa al
// cruzar los umbrales y cuando la caché se invalida.
export async function refrescar($: EngineInterface, cfg: Config, usage: ModelUsage | null = null): Promise<void> {
  // La cifra va en la fila de «auto mode on»: nada en la línea de estado.
  $.ui.status(undefined)
  const { context, rateLimits } = await $.session.usage()
  // Los límites no dependen de la conversación: se apuntan aunque esté vacía.
  await apuntarLimites($, rateLimits)
  await marcarHora($)
  if (context.tokens === undefined || context.percent === undefined) return
  const anterior = await leerTotal($)
  const entrada = usage === null ? 0 : tokensDe(usage)
  const cache = usage === null || entrada === 0 ? (anterior?.cache ?? null) : Math.round((usage.cache_read_input_tokens / entrada) * 100)
  const ahora: Total = {
    tokens: context.tokens,
    ventana: context.window,
    porcentaje: context.percent,
    cache,
    cacheEscrito: usage?.cache_creation_input_tokens ?? anterior?.cacheEscrito ?? 0,
  }
  await cambiarTotal($, () => ahora)

  if (usage !== null) {
    const invalidada =
      !marcas.recienCompactado &&
      (anterior?.cache ?? 0) >= 80 &&
      cache !== null &&
      cache < 50 &&
      ahora.cacheEscrito >= 20000
    marcas.recienCompactado = false
    const [hora, modelo] = await Promise.all([$.clock.now(), leerAplicado($).then(a => a.modelo)])
    if (invalidada && cache !== null) {
      // Se apunta para el diagnóstico, con lo que ayuda a explicarla.
      const rotura: Rotura = {
        hora,
        turno: await turnoActual($),
        reescritos: ahora.cacheEscrito,
        antes: anterior?.cache ?? 0,
        despues: cache,
        ...(marcas.hora === null ? {} : { pausa: hora - marcas.hora }),
        ...(marcas.modelo === null ? {} : { modeloAntes: marcas.modelo }),
        ...(modelo === null ? {} : { modelo }),
      }
      await cambiarRoturas($, lista => [...lista.slice(-19), rotura])
      if (cfg.emergentes) $.ui.toast(`⟲ Caché invalidada: se reescribieron ≈${k(ahora.cacheEscrito)} tokens (caché ${cache} %)`)
    }
    marcas.hora = hora
    marcas.modelo = modelo
  }

  const previo = await leerAviso($)
  const nivel = [cfg.aviso, cfg.critico].filter(u => ahora.porcentaje >= u).at(-1) ?? 0
  if (nivel === previo.nivel) return

  const lista = await leerLlamadas($)
  const ultima = lista.at(-1)?.orden ?? 0
  await cambiarAviso($, () => ({ nivel, desde: nivel > previo.nivel ? ultima : previo.desde }))
  if (nivel < previo.nivel || !cfg.emergentes) return

  const [peor] = ordenar(
    lista.filter(l => l.orden > previo.desde).map(l => ({
      nombre: `${nombreHerramienta(l.herramienta)} ${l.etiqueta}`.trim(),
      tokens: l.tokens,
    })),
    1,
  )
  const detalle = peor === undefined ? '' : ` · lo que más ha pesado: ${peor.nombre.slice(0, 60)} (≈${k(peor.tokens)})`
  $.ui.toast(`${sector(ahora.porcentaje)} Contexto al ${ahora.porcentaje} % (${k(ahora.tokens)}/${k(ahora.ventana)})${detalle}`)
}

// El desglose de /context: `summary` lo estima en local, sin llamadas a la API;
// `full` cuenta con la API cada herramienta y fichero, como /context.
export async function fotografiar($: EngineInterface, detalle: 'summary' | 'full' = 'summary'): Promise<void> {
  const { context } = await $.session.usage({ breakdown: detalle })
  const b = context.breakdown
  if (b === undefined) return

  const porServidor = new Map<string, number>()
  for (const t of b.mcpTools) {
    if (t.isLoaded) porServidor.set(t.serverName, (porServidor.get(t.serverName) ?? 0) + t.tokens)
  }
  const nueva: Foto = {
    tokens: b.totalTokens,
    ventana: b.rawMaxTokens,
    porcentaje: b.percentage,
    compacta: b.isAutoCompactEnabled ? (b.autoCompactThreshold ?? null) : null,
    exacto: detalle === 'full',
    categorias: b.categories
      .filter(c => c.kind !== 'deferred')
      .map(c => ({ nombre: CATEGORIAS[c.name] ?? c.name, tokens: c.tokens, color: c.color, tipo: c.kind })),
    memoria: b.memoryFiles.map(f => ({ nombre: corta(f.path), tokens: f.tokens, ruta: f.path })),
    mcp: [...porServidor].map(([nombre, tokens]) => ({ nombre, tokens })),
    // Solo las cargadas: las diferidas no ocupan la ventana hasta que se buscan.
    mcpHerramientas: b.mcpTools
      .filter(t => t.isLoaded)
      .map(t => ({ nombre: t.name.split('__').slice(2).join('__') || t.name, tokens: t.tokens, grupo: t.serverName })),
    skills: (b.skills?.skillFrontmatter ?? []).map(s => ({
      nombre: s.name,
      tokens: s.tokens,
      nota: s.pluginName ?? s.source,
    })),
    agentes: b.agents.map(a => ({ nombre: a.agentType, tokens: a.tokens })),
  }
  await cambiarFoto($, () => nueva)
}

// Las claves de `tool.call` que no son argumentos de la herramienta.
const RESERVADAS = new Set(['tool', 'tool_use_id', 'consent', 'agentId'])
const LARGO_ENTRADA = 400
const LARGO_MUESTRA = 600

// Los argumentos de una llamada en JSON compacto y recortado: la prueba de qué
// se pidió (el comando, la consulta, el offset/limit…).
export function resumirEntrada(entrada: Record<string, unknown>): string | undefined {
  const propios = Object.fromEntries(Object.entries(entrada).filter(([clave]) => !RESERVADAS.has(clave)))
  if (Object.keys(propios).length === 0) return undefined
  let texto: string
  try {
    texto = JSON.stringify(propios)
  } catch {
    return undefined
  }
  return texto.length > LARGO_ENTRADA ? `${texto.slice(0, LARGO_ENTRADA)}…` : texto
}

// Lo que la conversación principal acaba de recibir de una herramienta.
export async function registrarLlamada(
  $: EngineInterface,
  cfg: Config,
  herramienta: string,
  id: string,
  entrada: Record<string, unknown>,
  texto: string,
): Promise<void> {
  const ruta = typeof entrada.file_path === 'string' ? entrada.file_path : undefined
  const tokens = Math.ceil(texto.length / CARACTERES_POR_TOKEN)
  const [turno, hora] = await Promise.all([turnoActual($), $.clock.now()])
  const lista: Llamada[] = await cambiarLlamadas($, previa => [
    ...previa.slice(-299),
    {
      id,
      orden: (previa.at(-1)?.orden ?? 0) + 1,
      herramienta,
      etiqueta: etiquetar(entrada).slice(0, 120),
      tokens,
      ruta,
      parcial: entrada.offset !== undefined || entrada.limit !== undefined,
      ...(typeof entrada.offset === 'number' ? { desde: entrada.offset } : {}),
      ...(typeof entrada.limit === 'number' ? { cuantas: entrada.limit } : {}),
      turno,
      hora,
      entrada: resumirEntrada(entrada),
      // De una lectura basta la ruta: el fichero se puede volver a abrir.
      muestra: herramienta === 'Read' || texto.trim() === '' ? undefined : texto.slice(0, LARGO_MUESTRA),
    },
  ])
  if (!cfg.emergentes) return
  // Avisos inmediatos solo en los casos graves.
  if (herramienta === 'Read' && ruta !== undefined) {
    const veces = lista.filter(l => l.herramienta === 'Read' && l.ruta === ruta).length
    if (veces === 3) $.ui.toast(`⚠ ${corta(ruta)} leído 3 veces en esta conversación`)
  }
  if (tokens >= cfg.golpe) {
    $.ui.toast(`⚠ ${nombreHerramienta(herramienta)} ${etiquetar(entrada).slice(0, 50)} añadió ≈${k(tokens)} de golpe`)
  }
}

// Apunta el turno que acaba de cerrar la conversación principal.
export async function registrarTurno($: EngineInterface): Promise<void> {
  const t = await leerTotal($)
  if (t === null) return
  const prompt = await leerUltimoPrompt($)
  await cambiarHistorial($, turnos => {
    const previo = turnos.at(-1)
    return [
      ...turnos.slice(-119),
      {
        n: (previo?.n ?? 0) + 1,
        tokens: t.tokens,
        porcentaje: t.porcentaje,
        delta: previo === undefined ? 0 : t.tokens - previo.tokens,
        prompt,
        cache: t.cache,
      },
    ]
  })
}

// Lo lleno que va la ventana de un subagente tras cada una de sus peticiones.
// Las bifurcaciones internas del motor (compactación, memoria) no salen en
// `$.agent.list()` y se ignoran.
export async function registrarPaso($: EngineInterface, agentId: string, usage: ModelUsage): Promise<void> {
  const tokens = tokensDe(usage)
  const conocidos = await leerSubagentes($)
  let datos = conocidos.find(a => a.id === agentId)
  if (datos === undefined) {
    const agente = (await $.agent.list()).find(a => a.id === agentId)
    if (agente === undefined) return
    datos = { id: agentId, tipo: agente.type, descripcion: agente.description, tokens: 0, pico: 0, pasos: 0, activo: true }
  }
  const nuevo = { ...datos, tokens, pico: Math.max(datos.pico, tokens), pasos: datos.pasos + 1, activo: true }
  await cambiarSubagentes($, lista =>
    lista.some(a => a.id === agentId) ? lista.map(a => (a.id === agentId ? nuevo : a)) : [...lista, nuevo].slice(-12),
  )
}

export async function terminarSubagente($: EngineInterface, agentId: string): Promise<void> {
  await cambiarSubagentes($, lista => lista.map(a => (a.id === agentId ? { ...a, activo: false } : a)))
}

export async function reiniciar($: EngineInterface): Promise<void> {
  await cambiarLlamadas($, () => [])
  await cambiarRoturas($, () => [])
  await cambiarAviso($, () => ({ nivel: 0, desde: 0 }))
  await cambiarTotal($, () => null)
  await cambiarConfirmar($, () => false)
}

export function marcarCompactado(): void {
  marcas.recienCompactado = true
}

// Tras compactar, la conversación es otra: se olvidan las llamadas y la cifra
// de antes y se vuelve a medir.
export async function trasCompactar($: EngineInterface): Promise<void> {
  marcarCompactado()
  await reiniciar($)
  await fotografiar($)
}

// Lo que se olvida cuando la conversación empieza de cero (/clear, o un salto
// del árbol, que vacía y carga otra).
export async function olvidarConversacion($: EngineInterface): Promise<void> {
  await reiniciar($)
  await cambiarFoto($, () => null)
  await cambiarHistorial($, () => [])
  await cambiarSubagentes($, () => [])
}

// Compacta con lo que la persona pidió conservar; el resultado, en un aviso.
// Una compactación que pide el propio mod no pasa por su hook de
// `session.compact`: lo que ese hook hace después va aquí.
export async function compactar($: EngineInterface): Promise<void> {
  await cambiarConfirmar($, () => false)
  const instrucciones = (await leerConservar($)).trim()
  const r = await $.session.compact(instrucciones === '' ? {} : { instructions: instrucciones })
  if ('skip' in r && r.skip !== undefined) {
    $.ui.toast(`No se compactó: ${String(r.skip)}`)
    return
  }
  await trasCompactar($)
  const antes = r.tokensBefore === undefined ? '' : ` ${k(r.tokensBefore)}`
  const despues = r.tokensAfter === undefined ? '' : ` → ${k(r.tokensAfter)}`
  $.ui.toast(`⇣ Conversación compactada${antes}${despues}`)
}

// Los mensajes más largos tuyos y del modelo, sin los resultados de herramientas.
export async function cargarMensajes($: EngineInterface): Promise<void> {
  const todos = await $.session.messages()
  const filas = todos.map(m => ({
    nombre: `${m.role === 'user' ? 'Tú' : 'Claude'}: ${enLinea(m.text).slice(0, 70)}`,
    tokens: Math.ceil(m.text.length / CARACTERES_POR_TOKEN),
  }))
  await cambiarMensajes($, () => ordenar(filas, 20))
}
