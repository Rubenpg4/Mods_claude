import { expect, mock, test } from 'claude-code/testing'

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
    '  ◕ ctx 75% ▰▰▰▰▰▰▰▰▱▱ 150k/200k  ·  ~1 turno  ·  ◔ 5h 37% ↻ 2h 14m · ◑ 7d 60% ↗  ·  ⚠ 2',
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

  // Compactar pide confirmación y avisa del resultado.
  await ui.press({ key: 'pestana-tendencia' })
  await ui.press({ key: 'compactar' })
  expect(await ui.find({ key: 'compactar-si' })).toBeDefined()
  await ui.press({ key: 'compactar-si' })
  expect(avisos.at(-1)).toBe('⇣ Conversación compactada 150k → 30k')
  expect(await ui.find({ key: 'compactar-si' })).toBeUndefined()
  await ui.unmount()
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
