import { expect, mock, test } from 'claude-code/testing'

import {
  abandonarTrasRewind,
  borrables,
  corteDeRewind,
  enLinea,
  etiquetaNodo,
  filasArbol,
  fundirDuplicados,
  NOTA_FICHEROS,
  origenEnCadena,
  pasos,
  rewindDe,
  sinVacios,
  soloRuido,
  VIGIA_MS,
  vivificar,
} from '../hooks/arbol'
import { codificarPwsh, lanzadoresIA, ordenPwsh, resumirEntrada } from '../hooks/acciones'
import { diagnosticar, ficheroIA, informeIA, tituloIA } from '../hooks/calculo'
import { leerConfig } from '../hooks/config'
import { etiquetaTramo } from '../hooks/selector'

// El estilo del tramo de la barra del esfuerzo que muestra `nivel`: el actual
// va en negrita; los demás, atenuados.
async function tramo(banda: { find: (q: { type: string; text: string }) => Promise<unknown> }, nivel: string) {
  const el = (await banda.find({ type: 'Text', text: etiquetaTramo(nivel) })) as { props?: Record<string, unknown> } | undefined
  return el?.props ?? {}
}

// Las 12:00 UTC: 5h reinicia en 2h 14m (lleva el 55 % y ha gastado el 37 %, por
// debajo del ritmo); 7d en 3d 4h (lleva el 55 % y ha gastado el 60 %, por encima).
const T0 = Date.parse('2026-11-05T12:00:00Z')
const LIMITES = [
  { kind: 'five_hour', percentUsed: 37, resetsAt: '2026-11-05T14:14:00Z' },
  { kind: 'seven_day', percentUsed: 60, resetsAt: '2026-11-08T16:00:00Z' },
]

const PANEL = {
  plugin: 'contexto-vivo',
  component: 'Pane',
  requestId: 'contexto-vivo',
  props: {
    title: 'Contexto',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 120 },
    view: {},
  },
} as const

const DESGLOSE = {
  categories: [
    { name: 'System prompt', tokens: 4000, color: 'promptBorder', isDeferred: false, kind: 'used' },
    { name: 'Memory files', tokens: 9000, color: 'remember', isDeferred: false, kind: 'used' },
    { name: 'MCP tools', tokens: 1200, color: 'claude', isDeferred: false, kind: 'used' },
    { name: 'Messages', tokens: 130000, color: 'permission', isDeferred: false, kind: 'used' },
    { name: 'Free space', tokens: 40000, color: 'inactive', isDeferred: false, kind: 'free' },
    { name: 'Autocompact buffer', tokens: 17000, color: 'warning', isDeferred: false, kind: 'buffer' },
  ],
  totalTokens: 143000,
  maxTokens: 200000,
  rawMaxTokens: 200000,
  autocompactSource: 'auto',
  percentage: 72,
  gridRows: [],
  model: 'opus',
  memoryFiles: [{ path: 'C:/repo/CLAUDE.md', type: 'Project', tokens: 9000 }],
  mcpTools: [
    { name: 'mcp__claude_ai_Notion__notion-fetch', serverName: 'claude.ai Notion', tokens: 1200, isLoaded: true },
  ],
  agents: [],
  isAutoCompactEnabled: true,
  autoCompactThreshold: 167000,
  apiUsage: null,
}

const USO = (cacheLeido: number, cacheEscrito: number) => ({
  input_tokens: 1000,
  output_tokens: 10,
  cache_read_input_tokens: cacheLeido,
  cache_creation_input_tokens: cacheEscrito,
  model: 'opus',
})

// Recorre un turno de streaming hasta su resultado.
async function recorrer(flujo: unknown): Promise<void> {
  const iterable = flujo as AsyncIterable<unknown> | Promise<unknown>
  if (iterable !== null && typeof (iterable as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function') {
    for await (const _ of iterable as AsyncIterable<unknown>) {
      // Solo se consume.
    }
  } else {
    await iterable
  }
}

test('el mod entero: llamadas, turnos, subagentes, pestañas, diagnóstico y compactar', async ($, on) => {
  const avisos: string[] = []
  const registro: string[] = []
  const guardado = new Map<string, unknown>()
  let uso = { tokens: 100000, window: 200000, percent: 50 }
  let usoPaso = USO(0, 0)
  const reloj = mock.clock(on, { now: T0 })

  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.usage', (_, e) => ({
    value: {
      startedAt: 0,
      context: { ...uso, breakdown: (e as { breakdown?: string } | undefined)?.breakdown ? DESGLOSE : undefined },
      rateLimits: LIMITES,
    },
  }))
  on('ui.toast', (_, e) => {
    avisos.push(e.text)
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.log', (_, e) => {
    registro.push(e.text)
    return { value: undefined }
  })
  on('store.get', (_, e) => ({ value: guardado.get((e as { key: string }).key) }))
  on('store.set', (_, e) => {
    const { key, value } = e as { key: string; value: unknown }
    guardado.set(key, value)
    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    guardado.delete((e as { key: string }).key)
    return { value: undefined }
  })
  on('agent.list', () => ({
    value: [{ id: 'a1', description: 'Investiga el ASG de dev', type: 'infra-explorer', status: 'running' }],
  }))
  on('turn.step', async function* () {
    return { turnId: 't', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage: usoPaso }
  })
  on('turn.complete', (_, e) => ({ text: (e as { answer: string }).answer }))
  on('session.compact', () => ({
    messages: [{ role: 'user', text: 'Resumen de la conversación', toolUses: [] }],
    tokensBefore: 150000,
    tokensAfter: 30000,
  }))
  // El motor bajo el plugin: dibuja la cola que le llega.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{String((e.props as { tail?: string }).tail ?? '')}</Text>
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {}, text: 'x'.repeat(700) }))
  // Sin conversación que guardar: el árbol no crea checkpoints aquí.
  on('session.messages', () => ({ value: [] }))
  on('session.id', () => ({ value: 's1' }))
  on('session.root', () => ({ value: '/repo' }))
  // El modelo que muestra /model: la fila lo lee en cada dibujo.
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('fs.read', () => {
    throw new Error('ENOENT')
  })
  // ✦ Resolver con IA: el informe se escribe y se abre una terminal aparte.
  const escritos = new Map<string, string>()
  on('fs.write', (_, e) => {
    const { path, text } = e as { path: string; text: string }
    escritos.set(path, text)
    return { value: undefined }
  })
  const lanzados: string[][] = []
  let hayTerminal = true
  on('process.run', (_, e) => {
    const argv = (e as { argv: string[] }).argv
    lanzados.push([...argv])
    if (!hayTerminal && argv[0] === 'wt.exe') throw new Error('spawn wt.exe ENOENT')
    return { value: { exitCode: hayTerminal ? 0 : 1, stdout: '', stderr: '' } }
  })
  const copiado: string[] = []
  on('ui.copy', (_, e) => {
    copiado.push((e as { text: string }).text)
    return { value: { isCopied: true } }
  })

  const arrancar = () => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const cerrarTurno = (n: number) =>
    $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: `t${n}`, reason: 'answer' } as never)
  const paso = (agentId?: string) =>
    recorrer($.turn.step({ turnId: 't', index: 0, model: 'opus', messageCount: 1, ...(agentId ? { agentId } : {}) } as never))

  // Tres turnos: 50 %, 62 % y 75 %, con dos lecturas del mismo fichero.
  await arrancar()
  await cerrarTurno(1)
  await $.tool.call({ tool: 'Read', file_path: 'C:/repo/docs/plan.md' })
  await $.tool.call({ tool: 'Read', file_path: 'C:/repo/docs/plan.md' })
  uso = { tokens: 124000, window: 200000, percent: 62 }
  await arrancar()
  await cerrarTurno(2)
  expect(avisos.length).toBe(0)
  uso = { tokens: 150000, window: 200000, percent: 75 }
  usoPaso = USO(40000, 1000)
  await paso()
  await cerrarTurno(3)
  // Un subagente que lleva 42k en su propia ventana.
  await paso('a1')
  await $.command.run({ command: 'contexto-top', args: '', origin: { kind: 'human' } } as never)

  expect(avisos.length).toBe(1)
  expect(avisos[0]).toContain('Read docs/plan.md')
  expect(registro[0]).toContain('docs/plan.md leído 2 veces')
  expect(registro[0]).toContain('CLAUDE.md en memoria')
  expect(registro[0]).toContain('infra-explorer')
  expect(registro[0]).toContain('compacta en ~1 turnos')

  const fila = await $.ui.mount({
    plugin: 'contexto-vivo',
    surface: 'terminal',
    component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: 'auto mode on' },
  })
  expect((await fila.find({ type: 'Text' }))?.text).toBe(
    '  ◕ ctx 75% ▰▰▰▰▰▰▰▰▱▱ 150k/200k  ·  ~1 turno  ·  ◔ 5h 37% ↻ 2h 14m · ◑ 7d 60% ↗  ·  ⚠ 2  ·  claude-opus-5-5',
  )
  // El tic de cada minuto mueve la cuenta atrás sin esperar a una respuesta.
  await reloj.advance(60_000)
  expect((await fila.find({ type: 'Text' }))?.text).toContain('◔ 5h 37% ↻ 2h 13m')
  await fila.unmount()

  // Límites de uso: barra con la marca del ritmo, % usado, reinicio y proyección.
  const limites = await $.ui.mount({ ...PANEL, surface: 'terminal' })
  expect(await limites.find({ type: 'Text', text: /Límites de uso/ })).toBeDefined()
  expect(await limites.find({ type: 'Text', text: /^5h .*▕.* 37 % {2}↻ 2h 13m/ })).toBeDefined()
  expect(await limites.find({ type: 'Text', text: /^7d .*▕.* 60 % {2}↻ 3d 3h/ })).toBeDefined()
  // Sin trama: el carril es liso, de color de fondo.
  expect(await limites.find({ type: 'Text', text: /[░▒]/ })).toBeUndefined()
  expect(await limites.find({ type: 'Text', text: /⚠ 7d: a este ritmo se agota en ~2d 13h/ })).toBeDefined()
  expect(await limites.find({ type: 'Text', text: /no llegas al límite/ })).toBeUndefined()
  await limites.unmount()

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANEL, surface })
    // Cabecera: nivel, caché y botón de compactar (cerca del umbral).
    expect((await ui.find({ type: 'Text', text: /75 %/ }))?.text).toBe('◕ 75 %')
    expect(await ui.find({ type: 'Text', text: /^95%$/ })).toBeDefined()
    expect(await ui.find({ key: 'compactar' })).toBeDefined()

    // ◐ Reparto, con el anillo y la navegación por migas.
    expect(await ui.find(surface === 'terminal' ? { type: 'Raster' } : { type: 'Svg' })).toBeDefined()
    await ui.press({ key: 'entrar-Memoria' })
    expect(await ui.find({ key: 'abrir-C:/repo/CLAUDE.md' })).toBeDefined()
    await ui.press({ key: 'atras' })
    await ui.press({ key: 'entrar-Herramientas MCP' })
    await ui.press({ key: 'entrar-Herramientas MCP/claude.ai Notion' })
    expect(await ui.find({ type: 'Text', text: /notion-fetch/ })).toBeDefined()
    await ui.press({ key: 'miga-0' })
    expect(await ui.find({ key: 'atras' })).toBeUndefined()

    // ∿ Tendencia: gráfico, ritmo y compactar dentro de la pestaña.
    await ui.press({ key: 'pestana-tendencia' })
    expect(await ui.find(surface === 'terminal' ? { key: 'tendencia' } : { type: 'Svg' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\+25k por turno/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Turnos que más crecieron/ })).toBeDefined()
    expect(await ui.find({ key: 'compactar' })).toBeDefined()

    // ◆ Subagentes.
    await ui.press({ key: 'pestana-subagentes' })
    expect(await ui.find({ type: 'Text', text: /infra-explorer/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Investiga el ASG de dev/ })).toBeDefined()

    // ≡ Llamadas.
    await ui.press({ key: 'pestana-llamadas' })
    expect(await ui.find({ type: 'Text', text: /Lo que más pesa/ })).toBeDefined()

    await ui.press({ key: 'pestana-reparto' })
    await ui.unmount()
  }

  // ▲ Diagnóstico: ignorar, restaurar y que lo ignorado se guarde.
  const ui = await $.ui.mount({ ...PANEL, surface: 'terminal' })
  await ui.press({ key: 'pestana-diagnostico' })
  expect(await ui.find({ type: 'Text', text: /Diagnóstico · 2 avisos/ })).toBeDefined()
  await ui.press({ key: 'diag-ignorar-relectura:C:/repo/docs/plan.md' })
  expect(await ui.find({ type: 'Text', text: /Diagnóstico · 1 aviso$/ })).toBeDefined()
  expect(guardado.get('ignorados')).toEqual(['relectura:C:/repo/docs/plan.md'])
  await ui.press({ key: 'restaurar' })
  expect(await ui.find({ type: 'Text', text: /Diagnóstico · 2 avisos/ })).toBeDefined()

  // Cada hallazgo enseña sus pruebas y se lleva a una sesión aparte en Sonnet
  // (esfuerzo alto) con un informe que las recoge.
  expect(await ui.find({ type: 'Text', text: /· 2 lecturas que suman/ })).toBeDefined()
  await ui.press({ key: 'diag-ia-relectura:C:/repo/docs/plan.md' })
  const [rutaInforme, informe] = [...escritos]
    .map(([r, t]) => [r.replaceAll('\\', '/'), t] as const)
    .find(([r]) => r.includes('/contexto-vivo/informes/')) ?? ['', '']
  expect(rutaInforme).toMatch(/\/contexto-vivo\/informes\/-repo\/20261105120\d+-relectura-C-repo-docs-plan-md\.md$/)
  expect(informe).toContain('# Problema de contexto: docs/plan.md leído 2 veces')
  expect(informe).toContain('- Fichero: C:/repo/docs/plan.md')
  expect(informe).toContain('Lectura #1: entera')
  expect(informe).toContain('Lectura #2: entera')
  expect(informe).toContain('## Lo que te pido')
  const terminal = lanzados.at(-1) ?? []
  expect(terminal.slice(0, -1)).toEqual(['wt.exe', '-w', '0', 'new-tab', '-d', '/repo', 'pwsh', '-NoLogo', '-NoExit', '-EncodedCommand'])
  const bytes = atob(terminal.at(-1) ?? '')
  let orden = ''
  for (let i = 0; i < bytes.length; i += 2) orden += String.fromCharCode(bytes.charCodeAt(i) | (bytes.charCodeAt(i + 1) << 8))
  expect(orden).toMatch(
    /^claude --model sonnet --effort high -n 'Contexto · docs\/plan\.md leído 2 veces' 'Lee el informe \S*\/contexto-vivo\/informes\/-repo\/\d+-relectura-C-repo-docs-plan-md\.md y ayúdame/,
  )
  expect(avisos.at(-1)).toContain('✦ Chat con sonnet (high) abierto')
  // Sin Windows Terminal se prueba con cmd; si tampoco, la orden se copia.
  hayTerminal = false
  lanzados.length = 0
  await ui.press({ key: 'diag-ia-relectura:C:/repo/docs/plan.md' })
  expect(lanzados.map(a => a[0])).toEqual(['wt.exe', 'cmd'])
  expect(copiado.at(-1)).toMatch(/^claude --model sonnet --effort high -n 'Contexto · docs\/plan\.md leído 2 veces' 'Lee el informe .*plan-md\.md y /)
  expect(avisos.at(-1)).toContain('orden copiada')

  // Compactar pide confirmación y avisa del resultado.
  await ui.press({ key: 'pestana-tendencia' })
  await ui.press({ key: 'compactar' })
  expect(await ui.find({ key: 'compactar-si' })).toBeDefined()
  await ui.press({ key: 'compactar-si' })
  expect(avisos.at(-1)).toBe('⇣ Conversación compactada 150k → 30k')
  expect(await ui.find({ key: 'compactar-si' })).toBeUndefined()
  // Y, como tras un /compact, se olvidan las llamadas de antes: la relectura
  // de plan.md ya no está en la conversación.
  await ui.press({ key: 'pestana-diagnostico' })
  expect(await ui.find({ type: 'Text', text: /plan\.md/ })).toBeUndefined()
  await ui.unmount()
})

test('los límites 5h/7d se ven desde el primer minuto y sobreviven a /clear', async ($, on) => {
  const reloj = mock.clock(on, { now: T0 })
  // Lo guardado por una sesión anterior: 5h al 37 %, 7d al 60 %.
  const guardado = new Map<string, unknown>([
    [
      'limites',
      [
        { tipo: '5h', libre: 63, reinicio: Date.parse('2026-11-05T14:14:00Z') },
        { tipo: '7d', libre: 40, reinicio: Date.parse('2026-11-08T16:00:00Z') },
      ],
    ],
  ])
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('store.get', (_, e) => ({ value: guardado.get((e as { key: string }).key) }))
  on('store.set', (_, e) => {
    const { key, value } = e as { key: string; value: unknown }
    guardado.set(key, value)
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  // El motor bajo el plugin: dibuja la cola que le llega.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{String((e.props as { tail?: string }).tail ?? '')}</Text>
  })
  on('session.id', () => ({ value: 's1' }))
  on('session.root', () => ({ value: '/repo' }))
  // Recién abierto: sin respuestas, el motor no tiene cifra ni ventanas.
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [] } }))
  on('session.messages', () => ({ value: [] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', () => ({ sessionId: 's1' }))
  on('session.measure', (_, e) => ({ changed: e.changed }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const fila = await $.ui.mount({
    plugin: 'contexto-vivo',
    surface: 'terminal',
    component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: 'auto mode on' },
  })
  expect((await fila.find({ type: 'Text' }))?.text).toBe('  ○ ctx —  ·  ◔ 5h 37% ↻ 2h 14m · ◑ 7d 60% ↗')
  const panel = await $.ui.mount({ ...PANEL, surface: 'terminal' })
  expect(await panel.find({ type: 'Text', text: /^5h .*▕.* 37 % {2}↻ 2h 14m/ })).toBeDefined()
  await panel.unmount()

  // El motor mide una ventana que se mueve: se apunta y se guarda.
  await $.session.measure({ context: { window: 200000 }, rateLimits: LIMITES.map(l => ({ ...l, percentUsed: l.percentUsed + 3 })), changed: ['rateLimits'] } as never)
  expect((await fila.find({ type: 'Text' }))?.text).toBe('  ○ ctx —  ·  ◑ 5h 40% ↻ 2h 14m · ◕ 7d 63% ↗')
  expect(guardado.get('limites')).toEqual([
    { tipo: '5h', libre: 60, reinicio: Date.parse('2026-11-05T14:14:00Z') },
    { tipo: '7d', libre: 37, reinicio: Date.parse('2026-11-08T16:00:00Z') },
  ])

  // /clear olvida la conversación, no los límites de la cuenta.
  await $.session.end({ reason: 'clear' } as never)
  expect((await fila.find({ type: 'Text' }))?.text).toContain('◑ 5h 40% ↻ 2h 14m')

  // Pasado el reinicio de la 5h sin respuestas, la ventana vuelve a empezar.
  await reloj.advance(2 * 3_600_000 + 15 * 60_000)
  expect((await fila.find({ type: 'Text' }))?.text).toMatch(/ {2}○ 5h 0% · ◕ 7d 63%/)
  await fila.unmount()
})

test('con el estado vacío, la fila dibuja los límites guardados', async ($, on) => {
  mock.clock(on, { now: T0 })
  const guardado = new Map<string, unknown>()
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('store.get', (_, e) => ({ value: guardado.get((e as { key: string }).key) }))
  on('store.set', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{String((e.props as { tail?: string }).tail ?? '')}</Text>
  })
  on('session.id', () => ({ value: 's1' }))
  on('session.root', () => ({ value: '/repo' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [] } }))
  on('session.messages', () => ({ value: [] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  // Al arrancar no había nada guardado: el estado se queda sin límites.
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  guardado.set('limites', [{ tipo: '5h', libre: 63, reinicio: Date.parse('2026-11-05T14:14:00Z') }])
  const fila = await $.ui.mount({
    plugin: 'contexto-vivo',
    surface: 'terminal',
    component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: 'auto mode on' },
  })
  expect((await fila.find({ type: 'Text' }))?.text).toBe('  ○ ctx —  ·  ◔ 5h 37% ↻ 2h 14m')
  await fila.unmount()
})

test('los umbrales salen de /config', { options: { avisoPorcentaje: 40, avisosEmergentes: false } }, async ($, on) => {
  const avisos: string[] = []
  mock.clock(on, { now: T0 })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('store.get', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', (_, e) => {
    avisos.push(e.text)
    return { value: undefined }
  })
  on('session.usage', () => ({
    value: { startedAt: 0, context: { tokens: 90000, window: 200000, percent: 45 }, rateLimits: [] },
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // Al 45 % ya está por encima del aviso (40 %), pero los emergentes están apagados.
  expect(avisos.length).toBe(0)
  const ui = await $.ui.mount({ ...PANEL, surface: 'terminal' })
  expect(await ui.find({ key: 'compactar' })).toBeDefined()
  // Sin suscripción no hay ventanas de uso: la tarjeta no sale.
  expect(await ui.find({ type: 'Text', text: /Límites de uso/ })).toBeUndefined()
  await ui.unmount()
})

test('el selector ejecuta /model y /effort de verdad al pulsar y oculta sus filas', async ($, on) => {
  const avisos: string[] = []
  const ejecutados: string[] = []
  let modelo = 'claude-opus-5-5'
  const reloj = mock.clock(on, { now: T0 })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('store.get', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', (_, e) => {
    avisos.push(e.text)
    return { value: undefined }
  })
  on('session.usage', () => ({
    value: { startedAt: 0, context: { tokens: 90000, window: 200000, percent: 45 }, rateLimits: [] },
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.model', () => ({ value: modelo }))
  on('command.list', () => ({
    value: [
      { name: 'model', description: '', source: 'builtin' },
      { name: 'effort', description: '', source: 'builtin' },
    ],
  }))
  // El motor bajo el plugin: /model cambia el modelo de la sesión.
  on('command.run', (_, e) => {
    const { command, args } = e as { command: string; args?: string }
    ejecutados.push(`/${command} ${args ?? ''}`.trim())
    if (command === 'model') modelo = args ?? modelo
    return { text: '' }
  })
  on('ui.log', () => ({ value: undefined }))
  const esfuerzos: unknown[] = []
  on('turn.step', async function* (_, e) {
    const { turnId, index, effort } = e as { turnId: string; index: number; effort?: unknown }
    esfuerzos.push(effort)
    return { turnId, index, answer: '', toolUses: [], stopReason: 'end_turn', usage: USO(0, 0) }
  })
  on('agent.list', () => ({ value: [] }))
  // El motor dibuja el texto de una fila de comando y nada en la banda.
  on('ui.render', ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const texto = (e.props as { text?: unknown }).text
    return typeof texto === 'string' ? <Text>{texto}</Text> : <Box />
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const banda = await $.ui.mount({
    plugin: 'contexto-vivo',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 80, scroll: { offset: 0, bodyRows: 20 }, view: {} },
  } as never)

  // Plegada: una línea con el modelo de la sesión.
  expect(await banda.find({ type: 'Text', text: '◆ Opus 5.5' })).toBeDefined()
  expect(await banda.find({ key: 'selector-modelo-sonnet' })).toBeUndefined()

  // Desplegada: los chips; pulsar Sonnet ejecuta /model y la banda lo refleja.
  await banda.press({ key: 'selector-desplegar' })
  await banda.press({ key: 'selector-modelo-sonnet' })
  expect(ejecutados).toContain('/model claude-sonnet-5-5')
  expect(await banda.find({ type: 'Text', text: ' ● Sonnet 5.5 ' })).toBeDefined()
  // Sin avisos emergentes cuando todo va bien: la banda ya lo muestra.
  expect(avisos).toEqual([])
  // Mismo ancho activo o no: la fila no se recoloca.
  expect(await banda.find({ type: 'Text', text: ' ○ Opus 5.5 ' })).toBeDefined()

  // Pulsar un esfuerzo ejecuta el /effort real al momento; las peticiones
  // salen con lo que tenga la sesión, sin que el mod lo toque.
  await banda.press({ key: 'selector-esfuerzo-xhigh' })
  expect(ejecutados.filter(x => x.startsWith('/effort'))).toEqual(['/effort xhigh'])
  expect((await tramo(banda, 'xhigh')).weight).toBe('bold')
  // Los demás tramos llevan su color pero van atenuados y sin negrita.
  expect(await tramo(banda, 'max')).toMatchObject({ backgroundColor: '#0a84ff', dimColor: true })
  expect((await tramo(banda, 'max')).weight).toBeUndefined()
  await recorrer($.turn.step({ turnId: 't', index: 0, model: modelo, effort: 'xhigh', messageCount: 1 } as never))
  expect(esfuerzos).toEqual(['xhigh'])

  // Las filas que el motor escribe por esos comandos salen vacías; las de un
  // /effort escrito a mano, no.
  const fila = (command: string, args: string, text: string) =>
    $.ui.mount({
      plugin: 'contexto-vivo',
      surface: 'terminal',
      component: 'CommandOutput',
      props: { command, args, text, isErrored: false },
    } as never)
  const propia = await fila('effort', 'xhigh', 'Set effort level to xhigh')
  expect(await propia.find({ type: 'Text', text: /Set effort/ })).toBeUndefined()
  await propia.unmount()
  const ajena = await fila('effort', 'low', 'Set effort level to low')
  expect(await ajena.find({ type: 'Text', text: /Set effort/ })).toBeDefined()
  await ajena.unmount()
  const eco = await $.ui.mount({
    plugin: 'contexto-vivo',
    surface: 'terminal',
    component: 'UserMessage',
    props: { text: '/effort xhigh', origin: { kind: 'plugin', name: 'contexto-vivo' }, isExpanded: false },
  } as never)
  expect(await eco.find({ type: 'Text', text: /effort/ })).toBeUndefined()
  await eco.unmount()

  // Un /model escrito a mano también se refleja.
  await $.command.run({ command: 'model', args: 'claude-haiku-5-5', origin: { kind: 'human' } } as never)
  expect(await banda.find({ type: 'Text', text: ' ● Haiku 5.5 ' })).toBeDefined()

  // /modelo con argumentos aplica directo.
  await $.command.run({ command: 'modelo', args: 'fable low', origin: { kind: 'human' } } as never)
  await reloj.advance(20)
  expect(ejecutados).toContain('/model claude-fable-5-1')
  expect(ejecutados).toContain('/effort low')
  expect((await tramo(banda, 'low')).weight).toBe('bold')

  // Un /effort escrito a mano también se refleja.
  await $.command.run({ command: 'effort', args: 'high', origin: { kind: 'human' } } as never)
  expect((await tramo(banda, 'high')).weight).toBe('bold')

  await banda.press({ key: 'selector-plegar' })
  expect(await banda.find({ key: 'selector-modelo-sonnet' })).toBeUndefined()
  await banda.unmount()
})

test('el selector cambia el modelo por /config y espera al final del turno', async ($, on) => {
  const ejecutados: string[] = []
  const ajustes: Record<string, unknown> = {}
  let modelo = 'claude-opus-5-5'
  const reloj = mock.clock(on, { now: T0 })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('store.get', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { tokens: 90000, window: 200000, percent: 45 }, rateLimits: [] },
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.model', () => ({ value: modelo }))
  const fila = (key: string, label: string, options: string[]) => ({
    key,
    label,
    kind: 'choice',
    value: options[0],
    options,
    provider: { kind: 'engine' },
    isLocked: false,
  })
  on('config.list', () => ({
    value: [
      fila('model', 'Model', ['default', 'claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']),
      fila('effortLevel', 'Effort', ['low', 'medium', 'high', 'xhigh', 'max']),
    ],
  }))
  on('config.set', (_, e) => {
    const { key, value } = e as { key: string; value: string }
    ajustes[key] = value
    if (key === 'model') modelo = value
    return { value }
  })
  on('command.run', (_, e) => {
    ejecutados.push((e as { command: string }).command)
    return { text: '' }
  })
  on('turn.start', (_, e) => ({ turnId: (e as { turnId: string }).turnId }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const banda = await $.ui.mount({
    plugin: 'contexto-vivo',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 80, scroll: { offset: 0, bodyRows: 20 }, view: {} },
  } as never)
  await banda.press({ key: 'selector-desplegar' })

  // Sin turno: el modelo se aplica al momento por /config, sin ningún comando;
  // el esfuerzo, al momento por /effort.
  await banda.press({ key: 'selector-modelo-haiku' })
  expect(ajustes).toEqual({ model: 'claude-haiku-5-5' })
  expect(ejecutados).toEqual([])
  expect(await banda.find({ type: 'Text', text: ' ● Haiku 5.5 ' })).toBeDefined()
  await banda.press({ key: 'selector-esfuerzo-low' })
  expect(ejecutados).toEqual(['effort'])
  expect((await tramo(banda, 'low')).weight).toBe('bold')

  // Con un turno en marcha: los dos esperan y se aplican al acabar.
  await $.turn.start({ turnId: 't9' } as never)
  await banda.press({ key: 'selector-modelo-sonnet' })
  await banda.press({ key: 'selector-esfuerzo-max' })
  expect(modelo).toBe('claude-haiku-5-5')
  expect(ejecutados).toEqual(['effort'])
  expect(await banda.find({ type: 'Text', text: ' ⧗ Sonnet 5.5 ' })).toBeDefined()
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't9', reason: 'answer' } as never)
  await reloj.advance(20)
  expect(modelo).toBe('claude-sonnet-5-5')
  expect(ejecutados).toEqual(['effort', 'effort'])
  expect(await banda.find({ type: 'Text', text: ' ● Sonnet 5.5 ' })).toBeDefined()
  expect((await tramo(banda, 'max')).weight).toBe('bold')
  await banda.unmount()
})

// El motor de juguete del árbol: cada sesión es un transcript de registros
// enlazados por su padre, como el `.jsonl` de verdad.
type Registro = { uuid: string; padre: string | null; role: 'user' | 'assistant'; text: string; toolUses: unknown[] }

const tu = (text: string) => ({ role: 'user' as const, text, toolUses: [] })
const claude = (text: string, toolUses: unknown[] = []) => ({ role: 'assistant' as const, text, toolUses })

test('árbol de checkpoints: guardar, nombrar, restaurar, fork, rewind, comparar, exportar, buscar, borrar y /clear', async ($, on) => {
  const avisos: string[] = []
  const registro: string[] = []
  const disco = new Map<string, string>()
  const transcripts = new Map<string, Registro[]>([['s1', []]])
  const titulos = new Map<string, string>()
  let sesion = 's1'
  let uuids = 0
  let forks = 0
  let resumeFunciona = true
  let nodeFunciona = true
  let modelo = 'claude-opus-5-5'
  const cambiosDeModo: string[] = []
  const reloj = mock.clock(on, { now: T0 })

  // La cadena de un registro, de la raíz a él.
  const cadena = (s: string, uuid: string | null) => {
    const porUuid = new Map((transcripts.get(s) ?? []).map(r => [r.uuid, r]))
    const lista: Registro[] = []
    for (let r = uuid === null ? undefined : porUuid.get(uuid); r !== undefined; r = r.padre === null ? undefined : porUuid.get(r.padre)) {
      lista.unshift(r)
    }
    return lista
  }
  const hoja = (s: string) => transcripts.get(s)?.at(-1)?.uuid ?? null
  // Un turno: el prompt y la respuesta, colgando de la hoja (o de `desde`,
  // como tras un rewind nativo).
  const decir = (prompt: string, respuesta: string, toolUses: unknown[] = [], desde?: string) => {
    const lista = transcripts.get(sesion) ?? []
    const padre = desde ?? hoja(sesion)
    const p = { uuid: `u${++uuids}`, padre, ...tu(prompt) }
    const r = { uuid: `u${++uuids}`, padre: p.uuid, ...claude(respuesta, toolUses) }
    transcripts.set(sesion, [...lista, p, r])
  }
  const conversacion = () => cadena(sesion, hoja(sesion)).map(({ role, text, toolUses }) => ({ role, text, toolUses }))

  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { tokens: 20000, window: 200000, percent: 10 }, rateLimits: [] },
  }))
  on('ui.toast', (_, e) => {
    avisos.push(e.text)
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.log', (_, e) => {
    registro.push(e.text)
    return { value: undefined }
  })
  const abiertos: string[] = []
  on('ui.open', (_, e) => {
    abiertos.push((e as { id: string }).id)
    return { value: { isPlaced: false } }
  })
  const almacen = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: almacen.get((e as { key: string }).key) }))
  on('store.set', (_, e) => {
    const { key, value } = e as { key: string; value: unknown }
    almacen.set(key, value)
    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    almacen.delete((e as { key: string }).key)
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', () => ({ sessionId: sesion }))
  on('turn.complete', (_, e) => ({ text: (e as { answer: string }).answer }))
  // Tras un rewind nativo, el motor tiene ya la conversación corta en memoria
  // mientras el transcript sigue igual hasta el siguiente mensaje.
  let enMemoria: ReturnType<typeof conversacion> | null = null
  on('session.messages', () => ({ value: enMemoria ?? conversacion() }))
  // Un mensaje que el mod añade a la conversación (la nota de los ficheros).
  on('session.append', (_, e, next) => {
    const { message } = e as { message: { content: { text: string }[] } }
    const texto = message.content.map(b => b.text).join('\n')
    transcripts.set(sesion, [...(transcripts.get(sesion) ?? []), { uuid: `u${++uuids}`, padre: hoja(sesion), ...tu(texto) }])
    return next(e)
  })
  on('session.id', () => ({ value: sesion }))
  on('session.root', () => ({ value: 'C:\\repo' }))
  on('fs.read', (_, e) => {
    const ruta = (e as { path: string }).path
    const texto = disco.get(ruta)
    if (texto === undefined) throw new Error(`ENOENT ${ruta}`)
    return { value: texto }
  })
  on('fs.write', (_, e) => {
    const { path, text } = e as { path: string; text: string }
    disco.set(path, text)
    return { value: undefined }
  })
  // El motor: /resume cambia de sesión, /clear empieza otra vacía, y una
  // compactación que llega hasta aquí se resume.
  let resumenesDelMotor = 0
  let limpiezas = 0
  on('command.run', async (_, e) => {
    const { command, args } = e as { command: string; args: string }
    if (command === 'compact') await $.session.compact({ instructions: args })
    if (command === 'resume' && resumeFunciona && transcripts.has(args)) sesion = args
    if (command === 'model' || command === 'effort') cambiosDeModo.push(`/${command} ${args}`)
    if (command === 'model') modelo = args
    if (command === 'clear') {
      limpiezas++
      sesion = `${sesion}+`
      transcripts.set(sesion, [])
    }
    return {}
  })
  on('session.compact', () => {
    resumenesDelMotor++
    return { messages: [tu('resumen del motor')] }
  })
  // `scripts/transcript.cjs` sobre los transcripts de juguete.
  const ordenes: string[] = []
  on('process.run', (_, e) => {
    const { argv } = e as { argv: string[] }
    if (!nodeFunciona) throw new Error('spawn node ENOENT')
    expect(argv[0]).toBe('node')
    expect(argv[1]?.replaceAll('\\', '/')).toMatch(/\/scripts\/transcript\.cjs$/)
    const [orden = '', a = '', b = '', c] = argv.slice(2)
    ordenes.push(orden)
    const salida = (x: unknown) => ({ value: { exitCode: 0, stdout: JSON.stringify(x), stderr: '' } })
    const mensajes = (s: string, uuid: string) => cadena(s, uuid).map(({ role, text, toolUses, uuid: u }) => ({ role, text, toolUses, uuid: u }))
    if (orden === 'estado') {
      const lista = cadena(a, hoja(a))
      const prompts = lista.filter(r => r.role === 'user')
      const ultimo = lista.at(-1)
      return salida({
        uuid: hoja(a),
        cadena: lista.map(r => r.uuid),
        mensajes: lista.length,
        turnos: prompts.length,
        prompt: prompts.at(-1)?.text ?? '',
        ultimo: ultimo === undefined ? '' : `${ultimo.role}:${ultimo.text}`,
      })
    }
    if (orden === 'fork') {
      const id = `f${++forks}`
      transcripts.set(id, cadena(a, b))
      if (c !== undefined) titulos.set(id, c)
      return salida({ id, ruta: `C:/x/${id}.jsonl` })
    }
    if (orden === 'mensajes') return salida(mensajes(a, b))
    if (orden === 'anclas') return salida(Object.fromEntries(argv.slice(4).map(u => [u, u])))
    if (orden === 'buscar') {
      // El script lee la ruta tal cual; el disco de juguete la guarda normalizada.
      const ruta = [...disco.keys()].find(r => normal(r) === normal(b))
      const puntos = JSON.parse(disco.get(ruta ?? '') ?? '[]') as { id: string; sesion: string; uuid: string }[]
      const vistos = new Set<string>()
      const resultados: { id: string; quien: string; texto: string; i: number }[] = []
      for (const p of puntos) {
        for (const m of mensajes(p.sesion, p.uuid)) {
          if (vistos.has(m.uuid)) continue
          vistos.add(m.uuid)
          const i = m.text.toLowerCase().indexOf(a.toLowerCase())
          if (i >= 0) resultados.push({ id: p.id, quien: m.role === 'user' ? 'tú' : 'Claude', texto: m.text, i })
        }
      }
      return salida({ resultados, total: resultados.length })
    }
    return { value: { exitCode: 1, stdout: JSON.stringify({ error: `orden desconocida: ${orden}` }), stderr: '' } }
  })

  const turno = (n: number) =>
    $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: `t${n}`, reason: 'answer' } as never)
  const normal = (r: string) => r.replaceAll('\\', '/')
  const indice = () => {
    const ruta = [...disco.keys()].find(r => normal(r).endsWith('/indice.json'))
    return JSON.parse(disco.get(ruta ?? '') ?? 'null') as {
      version: number
      nodos: {
        id: string
        padre: string | null
        nombre?: string
        sesion: string
        uuid: string
        modelo?: string
        esfuerzo?: string
        turnos: number
        mensajes: number
        abandonado?: true
      }[]
      heads: Record<string, string>
      titulos: Record<string, string>
      rewind?: { sesion: string; ids: string[] }
    }
  }
  const fichero = (final: string) => disco.get([...disco.keys()].find(r => normal(r).endsWith(final)) ?? '')
  const cmd = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'human' } } as never)

  on('session.model', () => ({ value: modelo }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  // Tres turnos: cada checkpoint es un puntero al último mensaje del turno.
  decir('diseña la API', 'propongo REST')
  await turno(1)
  decir('con versiones', 'v1 y v2', [{ tool_use_id: 't1', tool: 'Read', input: { file_path: 'api.ts' }, text: 'export const v = 2' }])
  await turno(2)
  // /cp sin cambios nombra el checkpoint en que estás.
  await cmd('cp', 'base REST')
  expect(registro.at(-1)).toBe('◆ Checkpoint n2: base REST')
  // El tercer turno, con otro modelo y otro esfuerzo: el checkpoint los guarda.
  await cmd('model', 'claude-sonnet-5-5')
  await cmd('effort', 'high')
  cambiosDeModo.length = 0
  decir('pasa a GraphQL', 'hecho GraphQL')
  await turno(3)

  // Fuera de una carpeta .claude, el mod guarda en la .claude del proyecto, y
  // solo el índice: los mensajes siguen en el transcript del motor.
  expect([...disco.keys()].map(normal)).toEqual(['C:/repo/.claude/contexto-vivo/ramas/C--repo/indice.json'])
  let a = indice()
  expect(a.version).toBe(2)
  expect(a.nodos.map(n => [n.id, n.padre, n.sesion, n.uuid, n.turnos])).toEqual([
    ['n1', null, 's1', 'u2', 1],
    ['n2', 'n1', 's1', 'u4', 2],
    ['n3', 'n2', 's1', 'u6', 3],
  ])
  expect(a.nodos[1]?.nombre).toBe('base REST')
  expect(a.nodos.map(n => [n.modelo, n.esfuerzo])).toEqual([
    ['claude-opus-5-5', undefined],
    ['claude-opus-5-5', undefined],
    ['claude-sonnet-5-5', 'high'],
  ])

  // Restaurar desde el panel, como rewind: una sesión nueva con la cadena
  // hasta n2 y /resume a ella. Sin /clear, sin transcripción y sin compactar.
  const panel = await $.ui.mount({ ...PANEL, surface: 'terminal' })
  await panel.press({ key: 'pestana-arbol' })
  await panel.press({ key: 'nodo-n2' })
  await panel.press({ key: 'ir' })
  await panel.unmount()
  expect(sesion).toBe('f1')
  expect(limpiezas).toBe(0)
  expect(resumenesDelMotor).toBe(0)
  expect(conversacion()).toEqual([
    tu('diseña la API'),
    claude('propongo REST'),
    tu('con versiones'),
    claude('v1 y v2', [{ tool_use_id: 't1', tool: 'Read', input: { file_path: 'api.ts' }, text: 'export const v = 2' }]),
  ])
  // Y vuelve al modelo con que se trabajaba en n2.
  expect(avisos.at(-1)).toBe('⤺ En base REST · 2 turnos · Opus 5.5')
  expect(modelo).toBe('claude-opus-5-5')
  expect(cambiosDeModo).toEqual(['/model claude-opus-5-5'])
  // La sesión nueva abre el panel en el árbol, ya cargado y con su HEAD, sin
  // tener que guardar nada; y solo una vez.
  expect(abiertos).toEqual(['contexto-vivo'])
  expect(almacen.size).toBe(0)
  const tras = await $.ui.mount({ ...PANEL, surface: 'terminal' })
  expect(await tras.find({ type: 'Text', text: /Árbol · 3 checkpoints/ })).toBeDefined()
  expect(await tras.find({ type: 'Text', text: /◉ +base REST +t\d+ +\S+ ← aquí/ })).toBeDefined()
  expect(await tras.find({ key: 'arbol-guardar' })).toBeDefined()
  expect(await tras.find({ type: 'Text', text: /Aún no hay checkpoints/ })).toBeUndefined()
  await tras.unmount()
  // Si el mod se reinicia con el /resume, el arranque de la sesión lo abre.
  almacen.set('arbol-abrir', sesion)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(abiertos).toEqual(['contexto-vivo', 'contexto-vivo'])
  expect(almacen.size).toBe(0)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(abiertos.length).toBe(2)
  expect(indice().heads.f1).toBe('n2')
  // La sesión de la que se viene no se ha tocado.
  expect(cadena('s1', hoja('s1')).map(r => r.text).at(-1)).toBe('hecho GraphQL')

  // Lo que se diga ahora abre una rama desde n2: su padre sale de la cadena.
  decir('mejor gRPC', 'hecho gRPC')
  await turno(4)
  expect(indice().nodos.at(-1)).toMatchObject({ id: 'n4', padre: 'n2', sesion: 'f1', turnos: 3, mensajes: 6 })

  // El panel: la pestaña Árbol con la bifurcación, el detalle y las acciones.
  const ui = await $.ui.mount({ ...PANEL, surface: 'terminal' })
  await ui.press({ key: 'pestana-arbol' })
  expect(await ui.find({ type: 'Text', text: /Árbol · 4 checkpoints/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /├─ ○ +«pasa a GraphQL»/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /└─ ◉ +«mejor gRPC».* ← aquí/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /✂/ })).toBeUndefined()
  await ui.press({ key: 'nodo-n3' })
  expect(await ui.find({ type: 'Text', text: /se separa en base REST · \+1 aquí \/ \+1 en la actual/ })).toBeDefined()
  expect(await ui.find({ key: 'ir' })).toBeDefined()
  expect(await ui.find({ key: 'fork-n3' })).toBeDefined()
  expect(await ui.find({ key: 'injertar' })).toBeDefined()
  // Nombrar desde el panel.
  await $.ui.input({ plugin: 'contexto-vivo', key: 'nombre-n3', text: 'rama GraphQL' })
  expect(indice().nodos.find(n => n.id === 'n3')?.nombre).toBe('rama GraphQL')
  // Comparar con la actual: lo propio de cada lado desde base REST.
  await ui.press({ key: 'comparar' })
  expect(await ui.find({ type: 'Text', text: /^n2 base REST$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^n3 rama GraphQL · \+1 turno$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /«mejor gRPC»/ })).toBeDefined()
  // Exportar a Markdown, leyendo la conversación del transcript.
  await ui.press({ key: 'exportar' })
  expect(normal(avisos.at(-1) ?? '')).toMatch(/^⇩ Exportado a .*\/exportes\/n3-rama-graphql\.md$/)
  const md = fichero('/exportes/n3-rama-graphql.md') ?? ''
  expect(md).toMatch(/^# rama GraphQL\n/)
  expect(md).toContain('## 🧑 Persona\n\npasa a GraphQL')
  expect(md).toContain('<details><summary>→ Read <code>{"file_path":"api.ts"}</code></summary>')
  // Buscar en todos los checkpoints: cada mensaje una vez, y cada acierto lleva
  // a su checkpoint.
  await $.ui.input({ plugin: 'contexto-vivo', key: 'arbol-buscar', text: 'grpc' })
  expect(await ui.find({ type: 'Text', text: /⌕ «grpc» · 2 aciertos/ })).toBeDefined()
  await ui.press({ key: 'hallado-0' })
  expect(await ui.find({ type: 'Text', text: /es la conversación actual/ })).toBeDefined()
  await ui.press({ key: 'consulta-cerrar' })
  expect(await ui.find({ type: 'Text', text: /⌕/ })).toBeUndefined()
  // Borrar pide confirmación y solo quita del árbol.
  await ui.press({ key: 'nodo-n3' })
  await ui.press({ key: 'borrar' })
  await ui.press({ key: 'borrar-si' })
  expect(avisos.at(-1)).toBe('✕ Borrado 1 checkpoint')
  expect(indice().nodos.map(n => n.id)).toEqual(['n1', 'n2', 'n4'])
  expect(transcripts.get('s1')?.length).toBe(6)
  // También se puede borrar la rama en que está la conversación: la
  // confirmación dice cuántos caen y que va la actual. Aquí se cancela.
  await ui.press({ key: 'nodo-n1' })
  await ui.press({ key: 'borrar' })
  expect(await ui.find({ type: 'Text', text: /¿Borrar este checkpoint y los 2 que cuelgan de él\?/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Incluye la conversación actual/ })).toBeDefined()
  await ui.press({ key: 'borrar-no' })
  expect(indice().nodos.map(n => n.id)).toEqual(['n1', 'n2', 'n4'])

  // Fork con nombre desde n1, como /branch: la sesión nueva lleva el nombre y
  // su primer checkpoint también.
  await $.ui.input({ plugin: 'contexto-vivo', key: 'fork-n1', text: 'solo GET' })
  await ui.unmount()
  expect(sesion).toBe('f2')
  expect(titulos.get('f2')).toBe('solo GET')
  expect(avisos.at(-1)).toBe('⑂ Fork «solo GET» desde «diseña la API»')
  expect(conversacion()).toEqual([tu('diseña la API'), claude('propongo REST')])
  decir('solo GET', 'vale, GET')
  await turno(5)
  expect(indice().nodos.at(-1)).toMatchObject({ id: 'n5', padre: 'n1', nombre: 'solo GET', sesion: 'f2' })

  // /cp-ir llega justo tras el comando.
  await cmd('cp-ir', 'n4')
  await reloj.advance(10)
  expect(sesion).toBe('f3')
  expect(avisos.at(-1)).toBe('⤺ En «mejor gRPC» · 3 turnos')
  expect(conversacion().at(-1)).toEqual(claude('hecho gRPC'))
  // Un rewind nativo dentro de la sesión (seguir desde un mensaje anterior):
  // el checkpoint nuevo cuelga de n2, que es lo que hay en su cadena.
  // f3 se abrió desde el árbol en n4, que es un checkpoint de f1: el rewind
  // (a antes de «mejor gRPC») se ve en cuanto pasa, aunque n4 sea de otra
  // sesión, porque comparten los mensajes.
  await reloj.advance(VIGIA_MS)
  enMemoria = conversacion().slice(0, 4)
  await reloj.advance(VIGIA_MS)
  const avisosTrasRewind = avisos.length
  expect(avisos.at(-1)).toBe('⤺ Rewind: 1 checkpoint queda fuera de la conversación · /ctx → Árbol para borrar o conservar')
  expect(indice().heads.f3).toBe('n2')
  enMemoria = null
  decir('mejor SOAP', 'hecho SOAP', [], 'u4')
  await turno(6)
  expect(avisos.length).toBe(avisosTrasRewind)
  expect(indice().nodos.at(-1)).toMatchObject({ id: 'n6', padre: 'n2', sesion: 'f3', turnos: 3 })
  expect(indice().nodos.filter(n => n.abandonado === true).map(n => n.id)).toEqual(['n4'])
  expect(indice().rewind).toEqual({ sesion: 'f3', ids: ['n4'] })

  // /cp-fork sin id parte de la conversación actual.
  await cmd('cp-fork', '-- probar SOAP 1.2')
  await reloj.advance(10)
  expect(sesion).toBe('f4')
  expect(titulos.get('f4')).toBe('probar SOAP 1.2')
  expect(indice().heads.f4).toBe('n6')

  // Si el motor no cambia de sesión, la rama ya está escrita y se dice cómo
  // abrirla; si node no está, no se toca nada.
  resumeFunciona = false
  await cmd('cp-ir', 'n1')
  await reloj.advance(10)
  expect(sesion).toBe('f4')
  expect(registro.at(-1)).toBe('⑂ La rama está lista en la sesión f5: ábrela con /resume f5 o claude --resume f5')
  resumeFunciona = true
  nodeFunciona = false
  await cmd('cp-ir', 'n1')
  await reloj.advance(10)
  expect(avisos.at(-1)).toMatch(/^No se pudo restaurar: no se pudo ejecutar node para leer el transcript/)
  expect(sesion).toBe('f4')
  nodeFunciona = true

  // Nada de esto ha vaciado ni compactado; un /compact normal sigue siendo un
  // resumen del motor.
  expect(limpiezas).toBe(0)
  expect(resumenesDelMotor).toBe(0)
  await cmd('compact', 'la tarea actual')
  expect(resumenesDelMotor).toBe(1)

  // /cp-diff, /cp-buscar y /cp-exportar escriben su resultado.
  await cmd('cp-diff', 'n4 n5')
  expect(registro.at(-1)).toContain('Se separan en n1 «diseña la API» (1 turno en común)')
  expect(registro.at(-1)).toContain('«solo GET»')
  expect(registro.at(-1)).toContain('«con versiones»')
  await cmd('cp-buscar', 'REST')
  expect(registro.at(-1)).toMatch(/^«REST» · 1 acierto\nn1 «diseña la API» · Claude: propongo REST/)
  await cmd('cp-exportar', 'base')
  expect(normal(registro.at(-1) ?? '')).toMatch(/^⇩ n2 exportado a .*\/exportes\/n2-base-rest\.md$/)

  // Antes del /clear hay un nodo elegido en el panel.
  const previo = await $.ui.mount({ ...PANEL, surface: 'terminal' })
  await previo.press({ key: 'pestana-arbol' })
  await previo.press({ key: 'nodo-n2' })
  expect(await previo.find({ key: 'borrar' })).toBeDefined()
  await previo.press({ key: 'pestana-reparto' })
  await previo.unmount()

  // Tras /clear la conversación empieza de cero: una raíz nueva.
  const abandonadosAntes = indice().nodos.filter(n => n.abandonado === true).map(n => n.id)
  await $.session.end({ reason: 'clear' } as never)
  // El panel enseña el árbol entero, sin ningún nodo elegido ni HEAD (sin
  // ninguno no hay detalle con «Borrar»), y se abre en cuanto la sesión nueva
  // está.
  const vacio = await $.ui.mount({ ...PANEL, surface: 'terminal' })
  expect(await vacio.find({ type: 'Text', text: /^Árbol · \d+ checkpoints$/ })).toBeDefined()
  expect(await vacio.find({ key: 'borrar' })).toBeUndefined()
  await vacio.unmount()
  const abiertosAntes = abiertos.length
  await reloj.advance(50)
  expect(abiertos.length).toBe(abiertosAntes + 1)
  // El vigía no toma la conversación vacía por un rewind, aunque la vea
  // vaciarse antes de que cambie la sesión: nada más queda marcado.
  await reloj.advance(VIGIA_MS)
  enMemoria = []
  await reloj.advance(VIGIA_MS)
  expect(indice().nodos.filter(n => n.abandonado === true).map(n => n.id)).toEqual(abandonadosAntes)
  enMemoria = null
  sesion = 's2'
  // Solo lo que el motor escribe por un comando, sin ningún prompt: turno 0,
  // que no se guarda como checkpoint.
  transcripts.set('s2', [{ uuid: `u${++uuids}`, padre: null, ...claude('Set model to sonnet') }])
  const nodosAntes = indice().nodos.length
  await cmd('cp')
  expect(registro.at(-1)).toBe('No hay conversación que guardar todavía.')
  await turno(7)
  expect(indice().nodos.length).toBe(nodosAntes)
  decir('otra cosa', 'vale')
  await turno(7)
  expect(indice().nodos.at(-1)).toMatchObject({ id: 'n7', padre: null, sesion: 's2' })

  // /cp-arbol sin sitio para el panel escribe el árbol.
  await cmd('cp-arbol')
  expect(registro.at(-1)).toContain('Árbol de checkpoints · 6 nodos')
  expect(registro.at(-1)).toContain('◉ n7 «otra cosa»')
  expect(registro.at(-1)).toContain('◆ n5 solo GET · t2 · ')

  // Borrar la rama en que está la conversación: se queda sin checkpoint y el
  // siguiente turno empieza otra raíz.
  const fin = await $.ui.mount({ ...PANEL, surface: 'terminal' })
  await fin.press({ key: 'pestana-arbol' })
  await fin.press({ key: 'nodo-n7' })
  await fin.press({ key: 'borrar' })
  await fin.press({ key: 'borrar-si' })
  expect(avisos.at(-1)).toBe('✕ Borrado 1 checkpoint · la conversación actual sigue, sin checkpoint')
  expect(indice().nodos.map(n => n.id)).not.toContain('n7')
  expect(indice().heads.s2).toBeUndefined()
  decir('y ahora', 'hecho')
  await turno(8)
  expect(indice().nodos.at(-1)).toMatchObject({ id: 'n8', padre: null, sesion: 's2' })

  // Limpiar el árbol entero pide confirmación, deja los transcripts y no
  // reutiliza los ids.
  await fin.press({ key: 'arbol-limpiar' })
  expect(await fin.find({ type: 'Text', text: /¿Borrar los 6 checkpoints del árbol\?/ })).toBeDefined()
  await fin.press({ key: 'arbol-limpiar-no' })
  expect(indice().nodos).toHaveLength(6)
  await fin.press({ key: 'arbol-limpiar' })
  await fin.press({ key: 'arbol-limpiar-si' })
  expect(avisos.at(-1)).toBe('✕ Árbol limpio · 6 checkpoints borrados')
  expect(indice()).toMatchObject({ nodos: [], heads: {}, siguiente: 9 })
  expect(transcripts.get('s1')?.length).toBe(6)
  expect(await fin.find({ type: 'Text', text: /Aún no hay checkpoints/ })).toBeDefined()
  decir('de nuevo', 'vale')
  await turno(9)
  expect(indice().nodos).toMatchObject([{ id: 'n9', padre: null, sesion: 's2' }])

  // Un rewind nativo en la misma sesión deja fuera lo que había después: se
  // marca y se avisa, pero no se borra hasta que la persona lo pide.
  const raiz = hoja('s2') ?? undefined
  decir('paso A', 'hecho A')
  await turno(10)
  await cmd('cp', 'hito A')
  decir('paso B', 'hecho B')
  await turno(11)
  expect(await fin.find({ type: 'Text', text: /⤺ Rewind/ })).toBeUndefined()
  // El rewind se ve en cuanto pasa: el motor acorta la conversación en memoria
  // (vuelve a antes de «paso A») y el transcript aún no ha cambiado.
  await reloj.advance(VIGIA_MS)
  const avisosAntes = avisos.length
  enMemoria = conversacion().slice(0, -4)
  await reloj.advance(VIGIA_MS)
  expect(avisos.slice(avisosAntes)).toEqual([
    '⤺ Rewind: 2 checkpoints quedan fuera de la conversación · /ctx → Árbol para borrar o conservar',
  ])
  expect(indice().nodos.map(n => [n.id, n.abandonado ?? false])).toEqual([
    ['n9', false],
    ['n10', true],
    ['n11', true],
  ])
  expect(indice().heads.s2).toBe('n9')
  expect(await fin.find({ type: 'Text', text: /◉ +«de nuevo».* ← aquí/ })).toBeDefined()
  // Mirar otra vez sin cambios no repite nada.
  await reloj.advance(VIGIA_MS)
  expect(avisos.length).toBe(avisosAntes + 1)
  // Lo que se diga ahora cuelga de n9, sin volver a avisar.
  enMemoria = null
  decir('otra vía', 'vale', [], raiz)
  await turno(12)
  expect(avisos.length).toBe(avisosAntes + 1)
  expect(indice().nodos.map(n => [n.id, n.padre, n.abandonado ?? false])).toEqual([
    ['n9', null, false],
    ['n10', 'n9', true],
    ['n11', 'n10', true],
    ['n12', 'n9', false],
  ])
  expect(indice().rewind).toEqual({ sesion: 's2', ids: ['n11', 'n10'] })
  // El panel lo dice y ofrece borrar solo lo automático: «hito A» se queda.
  expect(await fin.find({ type: 'Text', text: /⤺ Rewind: 2 checkpoints quedaron fuera de la conversación \(◌\)/ })).toBeDefined()
  expect(await fin.find({ type: 'Text', text: /Se queda 1 con nombre, con ramas o abiertos en otra sesión/ })).toBeDefined()
  expect(await fin.find({ type: 'Text', text: /◌ +«paso B»/ })).toBeDefined()
  expect(await fin.find({ type: 'Text', text: /◌ rewind/ })).toBeDefined()
  await fin.press({ key: 'nodo-n11' })
  expect(await fin.find({ type: 'Text', text: /Un rewind lo dejó fuera de la conversación/ })).toBeDefined()
  expect(await fin.find({ key: 'rewind-borrar' })).toBeDefined()
  await fin.press({ key: 'rewind-borrar' })
  expect(avisos.at(-1)).toBe('✕ Borrado 1 checkpoint del rewind · queda 1 con nombre, con ramas o abiertos en otra sesión')
  expect(indice().nodos.map(n => n.id)).toEqual(['n9', 'n10', 'n12'])
  expect(indice().nodos.find(n => n.id === 'n10')).toMatchObject({ nombre: 'hito A', abandonado: true })
  expect(indice().rewind).toBeUndefined()
  expect(await fin.find({ type: 'Text', text: /⤺ Rewind:/ })).toBeUndefined()
  // Otro rewind, sin que el vigía llegue a verlo: lo detecta el siguiente
  // checkpoint. «Conservar» quita el aviso y deja el checkpoint, marcado.
  decir('tercera vía', 'vale', [], raiz)
  await turno(13)
  expect(avisos.at(-1)).toBe('⤺ Rewind: 1 checkpoint queda fuera de la conversación · /ctx → Árbol para borrar o conservar')
  expect(indice().rewind).toEqual({ sesion: 's2', ids: ['n12'] })
  await fin.press({ key: 'rewind-conservar' })
  expect(indice().rewind).toBeUndefined()
  expect(indice().nodos.find(n => n.id === 'n12')?.abandonado).toBe(true)
  expect(await fin.find({ type: 'Text', text: /⤺ Rewind:/ })).toBeUndefined()

  // Restaurar un punto abandonado trae la conversación, no los ficheros: se
  // confirma, y Claude recibe una nota para releerlos antes de editar.
  await fin.press({ key: 'nodo-n12' })
  await fin.press({ key: 'ir' })
  expect(await fin.find({ type: 'Text', text: /¿Restaurar un punto que un rewind dejó atrás\?/ })).toBeDefined()
  await fin.press({ key: 'ir-no' })
  expect(await fin.find({ type: 'Text', text: /¿Restaurar un punto/ })).toBeUndefined()
  const antesDeVolver = sesion
  await fin.press({ key: 'ir' })
  await fin.press({ key: 'ir-si' })
  expect(sesion).not.toBe(antesDeVolver)
  expect(conversacion().slice(-2)).toEqual([claude('vale'), tu(NOTA_FICHEROS)])
  expect(avisos.at(-1)).toMatch(/^⤺ En «otra vía» · \d+ turnos · ⚠ los ficheros pueden no coincidir \(Claude lo sabe\)$/)
  // Se ha vuelto a él: deja de estar abandonado.
  expect(indice().nodos.find(n => n.id === 'n12')?.abandonado).toBeUndefined()
  // Lo siguiente cuelga de n12; la nota no es un prompt.
  decir('sigo aquí', 'ok')
  await turno(14)
  expect(indice().nodos.at(-1)).toMatchObject({ padre: 'n12', sesion })
  await fin.unmount()
  expect(ordenes).not.toContain(undefined)
})

test('el camino de la conversación actual nunca queda plegado', () => {
  const nodo = (id: string, padre: string | null, creado: number) => ({
    id,
    padre,
    creado,
    sesion: 's',
    uuid: id,
    mensajes: 0,
    turnos: 0,
    tokens: 0,
    prompt: '',
  })
  // n1 → n2 → n3 (aquí), con una rama corta n1 → n4.
  const a = { version: 2 as const, siguiente: 5, heads: {}, titulos: {}, nodos: [nodo('n1', null, 1), nodo('n2', 'n1', 2), nodo('n3', 'n2', 3), nodo('n4', 'n1', 4)] }
  // Sin el camino, n2 (un solo hijo) se plegaría bajo n1.
  expect(filasArbol(a, 'n3', null, false).map(f => [f.nodo.id, f.plegados])).toEqual([
    ['n1', 0],
    ['n2', 0],
    ['n3', 0],
    ['n4', 0],
  ])
  // Lo que no está en el camino sí se pliega: n4 y n5 son una cadena fuera del
  // camino, así que n6 aparece bajo n1 con dos plegados.
  const b = { ...a, siguiente: 7, nodos: [...a.nodos, nodo('n5', 'n4', 5), nodo('n6', 'n5', 6)] }
  expect(filasArbol(b, 'n3', null, false).map(f => [f.nodo.id, f.plegados])).toEqual([
    ['n1', 0],
    ['n2', 0],
    ['n3', 0],
    ['n6', 2],
  ])
})

test('un rewind marca lo que deja atrás y solo se borra lo que no deja huérfanos', () => {
  const nodo = (id: string, padre: string | null, sesion = 's', nombre?: string) => ({
    id,
    padre,
    ...(nombre === undefined ? {} : { nombre }),
    creado: Number(id.slice(1)),
    sesion,
    uuid: `u${id}`,
    mensajes: 0,
    turnos: 0,
    tokens: 0,
    prompt: '',
  })
  // s: n1 → n2 → n3 → n4 (HEAD). f: un fork desde n2 con su propio n5.
  const a = {
    version: 2 as const,
    siguiente: 6,
    heads: { s: 'n4', f: 'n5' },
    titulos: {},
    nodos: [nodo('n1', null), nodo('n2', 'n1'), nodo('n3', 'n2'), nodo('n4', 'n3'), nodo('n5', 'n2', 'f')],
  }
  // Sin rewind (el HEAD sigue en la cadena) o sin HEAD: nada.
  expect(abandonarTrasRewind(a, 's', 'n4', ['un1', 'un2', 'un3', 'un4', 'x']).ids).toEqual([])
  expect(abandonarTrasRewind(a, 's', null, ['un1']).ids).toEqual([])
  // Cuenta la cadena, no la sesión de cada checkpoint: f salió de s con los
  // mismos mensajes, y un rewind en f a n1 deja fuera n5 y n2, que es de s.
  expect(abandonarTrasRewind(a, 'f', 'n5', ['un1', 'w']).ids).toEqual(['n5', 'n2'])
  // Vuelta a n1 en s: n4, n3 y n2 quedan fuera.
  const r = abandonarTrasRewind(a, 's', 'n4', ['un1', 'y'])
  expect(r.ids).toEqual(['n4', 'n3', 'n2'])
  expect(r.arbol.nodos.filter(n => n.abandonado === true).map(n => n.id)).toEqual(['n2', 'n3', 'n4'])
  expect(r.arbol.rewind).toEqual({ sesion: 's', ids: ['n4', 'n3', 'n2'] })
  // Un segundo rewind sin responder al aviso se suma al primero.
  const b = { ...r.arbol, heads: { ...r.arbol.heads, s: 'n6' }, nodos: [...r.arbol.nodos, nodo('n6', 'n1')] }
  expect(abandonarTrasRewind(b, 's', 'n6', ['un1', 'z']).arbol.rewind).toEqual({ sesion: 's', ids: ['n4', 'n3', 'n2', 'n6'] })
  expect(rewindDe(b, 's')).toEqual({ sesion: 's', ids: ['n4', 'n3', 'n2'] })
  expect(rewindDe(b, 'f')).toBeUndefined()
  // Volver a un punto le quita la marca a su camino, y sale del aviso.
  const vuelto = vivificar(r.arbol, 'n3')
  expect(vuelto.nodos.filter(n => n.abandonado === true).map(n => n.id)).toEqual(['n4'])
  expect(rewindDe(vuelto, 's')).toEqual({ sesion: 's', ids: ['n4'] })
  expect(vivificar(a, 'n4')).toBe(a)

  // Borrar: ni los nombrados, ni los HEAD, ni nadie de quien cuelgue algo que se queda.
  const c = {
    ...a,
    heads: { s: 'n9' },
    nodos: [nodo('n1', null), nodo('n2', 'n1'), nodo('n3', 'n2', 's', 'hito'), nodo('n4', 'n3'), nodo('n7', 'n1'), nodo('n8', 'n7'), nodo('n9', 'n1')],
  }
  // n2 sostiene al nombrado n3; n4 cuelga del nombrado y se va.
  expect([...borrables(c, ['n4', 'n3', 'n2'])].sort()).toEqual(['n4'])
  // Una cadena entera de automáticos se va de una vez; un HEAD, nunca.
  expect([...borrables(c, ['n8', 'n7'])].sort()).toEqual(['n7', 'n8'])
  expect([...borrables(c, ['n9'])]).toEqual([])
  // Si solo se borra el padre, el hijo que se queda lo sostiene.
  expect([...borrables(c, ['n7'])]).toEqual([])
})

test('el corte de un rewind sale de comparar la memoria del motor con el transcript', () => {
  const escritos = [
    { ...tu('uno'), uuid: 'p1' },
    { ...claude('r1'), uuid: 'a1' },
    { ...tu('dos'), uuid: 'p2' },
    { role: 'user' as const, text: '', toolUses: [], toolResults: [{ tool_use_id: 'x', text: 'ok', isError: false }], uuid: 'tr' },
    { ...claude('r2'), uuid: 'a2' },
    { ...tu('tres'), uuid: 'p3' },
    { ...claude('r3'), uuid: 'a3' },
  ]
  // Vuelta a antes de «dos»: el primer prompt quitado es p2.
  expect(corteDeRewind(escritos, [tu('uno'), claude('r1')])).toBe('p2')
  // Vuelta al principio.
  expect(corteDeRewind(escritos, [])).toBe('p1')
  // Lo que pone el motor (comandos, recordatorios) no cuenta como prompt.
  expect(corteDeRewind(escritos, [tu('uno'), tu('<system-reminder>x</system-reminder>'), claude('r1'), tu('dos')])).toBe('p3')
  // Lo que el motor tiene en memoria y no es ningún prompt del transcript (un
  // aviso, una notificación) se ignora.
  expect(corteDeRewind(escritos, [tu('uno'), tu('<task-notification>x</task-notification>'), claude('r1')])).toBe('p2')
  // Sin prompts de menos no hay rewind; si no casan (una compactación), tampoco.
  expect(corteDeRewind(escritos, [tu('uno'), tu('dos'), tu('tres')])).toBeNull()
  expect(corteDeRewind(escritos, [tu('Resumen de la conversación anterior'), claude('vale')])).toBeNull()
  expect(corteDeRewind(escritos, [tu('Resumen de la conversación anterior'), tu('tres'), claude('r3')])).toBeNull()
})

test('dos checkpoints en el mismo mensaje se funden en el más antiguo', () => {
  const nodo = (id: string, padre: string | null, creado: number, uuid: string) => ({
    id,
    padre,
    creado,
    sesion: 's',
    uuid,
    mensajes: 0,
    turnos: 0,
    tokens: 0,
    prompt: '',
  })
  // n6 y n7 apuntan a registros distintos del mismo mensaje; n8 cuelga de n7.
  const a = {
    version: 2 as const,
    siguiente: 9,
    heads: { s: 'n7' },
    titulos: {},
    nodos: [nodo('n5', null, 1, 'a'), nodo('n6', 'n5', 2, 'sys1'), nodo('n7', 'n6', 3, 'sys2'), nodo('n8', 'n7', 4, 'b')],
  }
  const r = fundirDuplicados(a, new Map([['n6', 'msg'], ['n7', 'msg']]))
  expect(r.nodos.map(n => [n.id, n.padre, n.uuid])).toEqual([
    ['n5', null, 'a'],
    ['n6', 'n5', 'msg'],
    ['n8', 'n6', 'b'],
  ])
  expect(r.heads).toEqual({ s: 'n6' })
})

test('el padre de un checkpoint es el más profundo de su cadena', async () => {
  const nodo = (id: string, uuid: string, creado: number) => ({
    id,
    padre: null,
    creado,
    sesion: 's',
    uuid,
    mensajes: 0,
    turnos: 0,
    tokens: 0,
    prompt: '',
  })
  const a = { version: 2 as const, siguiente: 4, heads: {}, titulos: {}, nodos: [nodo('n1', 'u2', 1), nodo('n2', 'u4', 2), nodo('n3', 'u4', 3)] }
  // Fuera de la cadena no cuenta nadie; dentro, el más profundo.
  expect(origenEnCadena(a, ['u1', 'u9'], null)).toBeUndefined()
  expect(origenEnCadena(a, ['u1', 'u2', 'u3'], null)?.id).toBe('n1')
  // Dos en el mismo mensaje: el HEAD de la sesión y, si no, el más reciente.
  expect(origenEnCadena(a, ['u1', 'u2', 'u3', 'u4', 'u5'], null)?.id).toBe('n3')
  expect(origenEnCadena(a, ['u1', 'u2', 'u3', 'u4', 'u5'], 'n2')?.id).toBe('n2')
})

test('los checkpoints de turno 0 sin nombre se quitan del árbol', async () => {
  const nodo = (id: string, padre: string | null, turnos: number, nombre?: string) => ({
    id,
    padre,
    creado: Number(id.slice(1)),
    sesion: 's',
    uuid: `u${id}`,
    mensajes: 1,
    turnos,
    tokens: 0,
    prompt: '',
    ...(nombre === undefined ? {} : { nombre }),
  })
  const a = {
    version: 2 as const,
    siguiente: 6,
    heads: { s0: 'n1', s1: 'n3', s2: 'n4' },
    titulos: {},
    nodos: [nodo('n1', null, 0), nodo('n2', 'n1', 0), nodo('n3', 'n2', 1), nodo('n4', null, 0, 'vacío a propósito'), nodo('n5', null, 2)],
    rewind: { sesion: 's0', ids: ['n2'] },
  }
  const b = sinVacios(a)
  // Los hijos de los vacíos suben al primer padre que queda; los nombrados se quedan.
  expect(b.nodos.map(n => [n.id, n.padre])).toEqual([
    ['n3', null],
    ['n4', null],
    ['n5', null],
  ])
  // La sesión que estaba en uno se queda sin HEAD, y el aviso de rewind sin nodos se va.
  expect(b.heads).toEqual({ s1: 'n3', s2: 'n4' })
  expect(b.rewind).toBeUndefined()
  // Sin vacíos, el mismo árbol.
  expect(sinVacios(b)).toBe(b)
})

test('el texto de la conversación llega al panel sin secuencias de escape', async () => {
  const esc = String.fromCharCode(27)
  expect(enLinea(`${esc}[2mCompacted${esc}[22m (ctrl+o)
	vale`)).toBe('Compacted (ctrl+o) vale')
  expect(enLinea(`${esc}]8;;https://x.dev${String.fromCharCode(7)}enlace`)).toBe('enlace')
  // Las filas que pone el motor al ejecutar un comando no son prompts.
  const ps = pasos([
    tu('arregla el login'),
    claude(`listo ${esc}[1mOK${esc}[0m`),
    tu(`<local-command-stdout>${esc}[2mCompacted${esc}[22m</local-command-stdout>`),
    tu('<command-name>/compact</command-name>'),
    claude('resumen'),
  ])
  expect(ps).toEqual([{ prompt: 'arregla el login', respuesta: 'resumen', herramientas: 0 }])
  // Lo guardado por versiones anteriores también sale limpio.
  expect(etiquetaNodo({ turnos: 1, prompt: `${esc}[2mCompacted${esc}[22m` })).toBe('«Compacted»')
})

test('la respuesta del motor a una interrupción no es un punto nuevo del árbol', () => {
  const interrumpido = { role: 'user' as const, text: '[Request interrupted by user]', toolUses: [] }
  const respuesta = { role: 'assistant' as const, text: 'No response requested.', toolUses: [] }
  expect(soloRuido([respuesta])).toBe(true)
  expect(soloRuido([respuesta, { ...respuesta, text: ' no response requested ' }])).toBe(true)
  expect(soloRuido([])).toBe(false)
  // Lo que escribe la persona o Claude de verdad sí cuenta.
  expect(soloRuido([interrumpido])).toBe(false)
  expect(soloRuido([respuesta, claude('vale')])).toBe(false)
  expect(soloRuido([{ ...respuesta, toolUses: [{ tool: 'Bash' }] }])).toBe(false)
})

test('el informe para la IA recoge argumentos, resultado y encargo de cada hallazgo', () => {
  const cfg = leerConfig({})
  const llamada = {
    id: 'b1',
    orden: 7,
    herramienta: 'Bash',
    etiqueta: 'git log',
    tokens: 9000,
    entrada: resumirEntrada({ tool: 'Bash', tool_use_id: 'x', command: 'git log', description: 'historial' }),
    muestra: 'commit 941ed23\n```raro```',
  }
  expect(llamada.entrada).toBe('{"command":"git log","description":"historial"}')
  const [h] = diagnosticar(null, [llamada], cfg, [])
  expect(h?.tipo).toBe('bash')
  expect(h?.pruebas).toEqual([
    'Llamada #7 a Bash: ≈9.0k tokens de resultado en la conversación',
    'Argumentos: {"command":"git log","description":"historial"}',
  ])
  if (h === undefined) return
  const texto = informeIA(h, { fecha: '2026-11-06 10:00:00', proyecto: 'C:/repo', sesion: 's1', ventana: 200000, porcentaje: 40 })
  expect(texto).toContain('- Coste: ≈9.0k tokens (4.5 % de una ventana de 200k)')
  expect(texto).toContain('Ocupación de aquella sesión al detectarlo: 40 %')
  expect(texto).toContain("commit 941ed23\n'''raro'''")
  expect(texto).toContain('Propón la versión filtrada del mismo comando')
  expect(ficheroIA(h, '2026-11-06 10:00:00')).toBe('20261106100000-bash-b1.md')
  expect(resumirEntrada({ tool: 'Read', tool_use_id: 'x' })).toBeUndefined()
  expect(resumirEntrada({ command: 'x'.repeat(1000) })?.length).toBe(401)

  // Los servidores MCP cargados, con sus herramientas más pesadas.
  const foto = {
    tokens: 0, ventana: 200000, porcentaje: 0, compacta: null, exacto: false, categorias: [], memoria: [], skills: [], agentes: [],
    mcp: [{ nombre: 'Notion', tokens: 18000 }, { nombre: 'Slack', tokens: 6000 }],
    mcpHerramientas: [
      { nombre: 'fetch', tokens: 9000, grupo: 'Notion' },
      { nombre: 'search', tokens: 9000, grupo: 'Notion' },
      { nombre: 'send', tokens: 6000, grupo: 'Slack' },
    ],
  }
  const [mcp] = diagnosticar(foto, [], cfg, [])
  expect(mcp?.pruebas).toContain('Servidor Notion: ≈18k (2 herramientas)')
  expect(mcp?.pruebas.at(-1)).toBe('Las más pesadas: Notion·fetch ≈9.0k, Notion·search ≈9.0k, Slack·send ≈6.0k')
})

test('la sesión aparte se abre en una pestaña de PowerShell 7, con cmd si no hay Windows Terminal', () => {
  const h = { clave: 'x', tipo: 'otra', gravedad: 'media', texto: 'Grep "a;b" & más', consejo: '', tokens: 1, pruebas: [] } as const
  expect(tituloIA({ ...h, pruebas: [] })).toBe('Contexto · Grep ab más')
  // Las comillas simples se doblan; lo demás pasa tal cual dentro de la orden.
  const orden = ordenPwsh('uno;dos', "Lee C:/Rubén/a;b.md y l'otro")
  expect(orden).toBe("claude --model sonnet --effort high -n 'uno;dos' 'Lee C:/Rubén/a;b.md y l''otro'")
  // UTF-16LE en base64, como lo espera -EncodedCommand.
  expect(codificarPwsh('é;')).toBe('6QA7AA==')
  const pwsh = ['pwsh', '-NoLogo', '-NoExit', '-EncodedCommand', codificarPwsh(orden)]
  const [wt, cmd] = lanzadoresIA('C:/repo', 'uno;dos', "Lee C:/Rubén/a;b.md y l'otro")
  expect(wt).toEqual(['wt.exe', '-w', '0', 'new-tab', '-d', 'C:/repo', ...pwsh])
  expect(cmd).toEqual(['cmd', '/c', 'start', '', '/D', 'C:/repo', ...pwsh])
  // Nada en la orden que Windows Terminal parta.
  expect(wt.join(' ')).not.toContain(';')
})
