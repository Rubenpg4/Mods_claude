import { expect, mock, test } from 'claude-code/testing'

import { enLinea, etiquetaNodo, origenEnCadena, pasos } from '../hooks/arbol'

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
  on('fs.read', () => {
    throw new Error('ENOENT')
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
  // Y, como tras un /compact, se olvidan las llamadas de antes: la relectura
  // de plan.md ya no está en la conversación.
  await ui.press({ key: 'pestana-diagnostico' })
  expect(await ui.find({ type: 'Text', text: /plan\.md/ })).toBeUndefined()
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
  on('ui.open', () => ({ value: { isPlaced: false } }))
  on('store.get', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', () => ({ sessionId: sesion }))
  on('turn.complete', (_, e) => ({ text: (e as { answer: string }).answer }))
  on('session.messages', () => ({ value: conversacion() }))
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
      nodos: { id: string; padre: string | null; nombre?: string; sesion: string; uuid: string; turnos: number; mensajes: number }[]
      heads: Record<string, string>
      titulos: Record<string, string>
    }
  }
  const fichero = (final: string) => disco.get([...disco.keys()].find(r => normal(r).endsWith(final)) ?? '')
  const cmd = (command: string, args = '') => $.command.run({ command, args, origin: { kind: 'human' } } as never)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  // Tres turnos: cada checkpoint es un puntero al último mensaje del turno.
  decir('diseña la API', 'propongo REST')
  await turno(1)
  decir('con versiones', 'v1 y v2', [{ tool_use_id: 't1', tool: 'Read', input: { file_path: 'api.ts' }, text: 'export const v = 2' }])
  await turno(2)
  // /cp sin cambios nombra el checkpoint en que estás.
  await cmd('cp', 'base REST')
  expect(registro.at(-1)).toBe('◆ Checkpoint n2: base REST')
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
  expect(avisos.at(-1)).toBe('⤺ En base REST · 2 turnos')
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
  expect(await ui.find({ type: 'Text', text: /├─ ○ «pasa a GraphQL»/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /└─ ◉ «mejor gRPC».* ← aquí/ })).toBeDefined()
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
  // Borrar pide confirmación, solo quita del árbol y no deja borrar la rama en
  // que estás.
  await ui.press({ key: 'nodo-n3' })
  await ui.press({ key: 'borrar' })
  await ui.press({ key: 'borrar-si' })
  expect(avisos.at(-1)).toBe('✕ Borrado 1 checkpoint')
  expect(indice().nodos.map(n => n.id)).toEqual(['n1', 'n2', 'n4'])
  expect(transcripts.get('s1')?.length).toBe(6)
  await ui.press({ key: 'nodo-n1' })
  expect(await ui.find({ key: 'borrar' })).toBeUndefined()

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
  decir('mejor SOAP', 'hecho SOAP', [], 'u4')
  await turno(6)
  expect(indice().nodos.at(-1)).toMatchObject({ id: 'n6', padre: 'n2', sesion: 'f3', turnos: 3 })

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

  // Tras /clear la conversación empieza de cero: una raíz nueva.
  await $.session.end({ reason: 'clear' } as never)
  sesion = 's2'
  transcripts.set('s2', [])
  decir('otra cosa', 'vale')
  await turno(7)
  expect(indice().nodos.at(-1)).toMatchObject({ id: 'n7', padre: null, sesion: 's2' })

  // /cp-arbol sin sitio para el panel escribe el árbol.
  await cmd('cp-arbol')
  expect(registro.at(-1)).toContain('Árbol de checkpoints · 6 nodos')
  expect(registro.at(-1)).toContain('◉ n7 «otra cosa»')
  expect(registro.at(-1)).toContain('◆ n5 solo GET · t2 · ')
  expect(ordenes).not.toContain(undefined)
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
