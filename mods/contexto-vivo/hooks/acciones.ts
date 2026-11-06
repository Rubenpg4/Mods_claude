import type { EngineInterface, ModelUsage, RenderSurface, SessionRateLimit } from 'claude-code'

import type { Foto, Hallazgo, Limite, Llamada, Total } from '../types'
import {
  CARACTERES_POR_TOKEN,
  CATEGORIAS,
  corta,
  enLinea,
  ESFUERZO_IA,
  etiquetar,
  ficheroIA,
  informeIA,
  k,
  MODELO_IA,
  nombreHerramienta,
  ordenar,
  promptIA,
  sector,
  tituloIA,
  VENTANAS,
} from './calculo'
import type { Config } from './config'
import {
  cambiarAhora,
  cambiarAviso,
  cambiarConfirmar,
  cambiarFoto,
  cambiarHistorial,
  cambiarIgnorados,
  cambiarLimites,
  cambiarLlamadas,
  cambiarMensajes,
  cambiarSubagentes,
  cambiarTotal,
  leerAhora,
  leerAviso,
  leerLimites,
  leerConservar,
  leerLlamadas,
  leerSubagentes,
  leerTotal,
  leerUltimoPrompt,
} from './estado'

const CLAVE_IGNORADOS = 'ignorados'
const CLAVE_LIMITES = 'limites'

// Tras compactar, la primera petición reescribe la caché por fuerza: no avisar.
const marcas = { recienCompactado: false }

function tokensDe(usage: ModelUsage): number {
  return usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
}

// La hora que leen el panel y la fila para la cuenta atrás de 5h/7d.
export async function marcarHora($: EngineInterface): Promise<void> {
  const ahora = await $.clock.now()
  await cambiarAhora($, () => ahora)
}

// ── Ventanas de uso (5h, 7d) ────────────────────────────────────────────────
//
// El motor solo las conoce tras una respuesta de la API: al abrir claude no hay
// ninguna. La última lectura se guarda en `$.store` y se carga al empezar, así
// la fila y el panel las muestran desde el primer minuto; la primera respuesta
// las renueva. Una ventana cuyo reinicio ya pasó se ve vacía (`ventanas`).

function esLimite(x: unknown): x is Limite {
  const l = x as Partial<Limite> | null
  return (
    l !== null &&
    typeof l === 'object' &&
    typeof l.tipo === 'string' &&
    typeof l.libre === 'number' &&
    (l.reinicio === undefined || typeof l.reinicio === 'number')
  )
}

// Apunta las ventanas que trae una medida del motor; sin ninguna (aún no ha
// habido respuesta) se queda la lectura anterior.
export async function apuntarLimites($: EngineInterface, rateLimits: readonly SessionRateLimit[]): Promise<void> {
  const nuevos: Limite[] = rateLimits
    .filter(l => l.kind in VENTANAS)
    .map(l => {
      const reinicio = l.resetsAt === undefined ? NaN : Date.parse(l.resetsAt)
      return {
        tipo: VENTANAS[l.kind] ?? l.kind,
        libre: Math.max(0, Math.round(100 - l.percentUsed)),
        ...(Number.isFinite(reinicio) ? { reinicio } : {}),
      }
    })
  if (nuevos.length === 0) return
  let cambio = false
  await cambiarLimites($, previos => {
    cambio = JSON.stringify(previos) !== JSON.stringify(nuevos)
    return cambio ? nuevos : previos
  })
  if (cambio) await $.store.set(CLAVE_LIMITES, nuevos)
}

async function limitesGuardados($: EngineInterface): Promise<Limite[]> {
  const guardados = await $.store.get(CLAVE_LIMITES)
  return Array.isArray(guardados) ? guardados.filter(esLimite) : []
}

// La última lectura guardada, si en esta sesión aún no hay ninguna.
export async function cargarLimites($: EngineInterface): Promise<void> {
  const validos = await limitesGuardados($)
  if (validos.length > 0) await cambiarLimites($, actuales => (actuales.length > 0 ? actuales : validos))
}

// Lo que dibujan la fila y el panel: la lectura de la sesión o, mientras no
// hay ninguna (justo tras /clear, que no pasa por `session.start`), la
// guardada. Leer el valor primero suscribe el dibujo a él.
export async function limitesVisibles($: EngineInterface): Promise<Limite[]> {
  const actuales = await leerLimites($)
  return actuales.length > 0 ? actuales : limitesGuardados($)
}

// La hora para la cuenta atrás: la del tic de cada minuto (suscribe el dibujo)
// o, si aún no ha marcado ninguna, la del reloj.
export async function horaVisible($: EngineInterface): Promise<number> {
  const ahora = await leerAhora($)
  return ahora > 0 ? ahora : $.clock.now()
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
    if (invalidada && cfg.emergentes) {
      $.ui.toast(`⟲ Caché invalidada: se reescribieron ≈${k(ahora.cacheEscrito)} tokens (caché ${cache} %)`)
    }
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

// Los hallazgos ignorados se guardan entre sesiones.
export async function cargarIgnorados($: EngineInterface): Promise<void> {
  const guardados = await $.store.get(CLAVE_IGNORADOS)
  if (Array.isArray(guardados)) {
    const claves = guardados.filter((x): x is string => typeof x === 'string')
    await cambiarIgnorados($, () => claves)
  }
}

export async function ignorar($: EngineInterface, clave: string): Promise<void> {
  const claves = await cambiarIgnorados($, lista => (lista.includes(clave) ? lista : [...lista, clave].slice(-200)))
  await $.store.set(CLAVE_IGNORADOS, claves)
}

export async function restaurarIgnorados($: EngineInterface): Promise<void> {
  await cambiarIgnorados($, () => [])
  await $.store.delete(CLAVE_IGNORADOS)
}

// Abre un fichero en VS Code. En Windows `code` es un .cmd que solo arranca a
// través de cmd, así que la ruta no puede llevar caracteres que cmd interprete.
export async function abrir($: EngineInterface, ruta: string): Promise<void> {
  try {
    await $.process.run(['code', ruta])
    return
  } catch {
    // Sigue con cmd.
  }
  if (/[&|<>^"%!]/.test(ruta)) {
    $.ui.toast(`No se abre ${corta(ruta)}: la ruta tiene caracteres especiales`)
    return
  }
  try {
    await $.process.run(['cmd', '/c', 'code', ruta])
  } catch {
    $.ui.toast('No se encontró el comando code de VS Code')
  }
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

// ── Resolver con IA ─────────────────────────────────────────────────────────

// La carpeta de datos del mod: `contexto-vivo/<sub>` en la `.claude` sobre la
// del mod; si el mod no está bajo una, en la `.claude` del proyecto.
export async function carpetaDatos($: EngineInterface, sub: string): Promise<string> {
  const raiz = (await $.session.root()).replace(/\\/g, '/')
  const proyecto = raiz.replace(/[^A-Za-z0-9]/g, '-')
  const mod = $.plugin.root.replace(/\\/g, '/')
  const i = mod.lastIndexOf('/.claude/')
  const claude = i >= 0 ? mod.slice(0, i + 8) : `${raiz}/.claude`
  return `${claude}/contexto-vivo/${sub}/${proyecto}`
}

// Los argumentos de `claude` para la sesión aparte.
export function argumentosIA(titulo: string, prompt: string): string[] {
  return ['--model', MODELO_IA, '--effort', ESFUERZO_IA, '-n', titulo, prompt]
}

// La orden de PowerShell que arranca la sesión aparte, con cada argumento
// entre comillas simples (una comilla simple se dobla).
export function ordenPwsh(titulo: string, prompt: string): string {
  return ['claude', ...argumentosIA(titulo, prompt).map(a => (/^[A-Za-z0-9-]+$/.test(a) ? a : `'${a.replace(/'/g, "''")}'`))].join(' ')
}

// Una orden para `pwsh -EncodedCommand`: UTF-16LE en base64. Así ni Windows
// Terminal (que parte en `;`) ni cmd ni pwsh tocan comillas ni acentos.
export function codificarPwsh(orden: string): string {
  let binario = ''
  for (let i = 0; i < orden.length; i++) {
    const c = orden.charCodeAt(i)
    binario += String.fromCharCode(c & 0xff, c >> 8)
  }
  return btoa(binario)
}

// Las órdenes con que se intenta abrir la sesión aparte, por orden: una
// pestaña nueva en la ventana de Windows Terminal más reciente (con el perfil
// por defecto) y, si no está, una consola con `start`. En las dos corre
// PowerShell 7 con -NoExit: al salir de Claude queda la consola en el proyecto.
export function lanzadoresIA(directorio: string, titulo: string, prompt: string): string[][] {
  const pwsh = ['pwsh', '-NoLogo', '-NoExit', '-EncodedCommand', codificarPwsh(ordenPwsh(titulo, prompt))]
  return [
    ['wt.exe', '-w', '0', 'new-tab', '-d', directorio, ...pwsh],
    ['cmd', '/c', 'start', '', '/D', directorio, ...pwsh],
  ]
}

// Escribe el informe del hallazgo y abre una sesión de Claude Code aparte
// (Sonnet, esfuerzo alto) en el proyecto que empieza leyéndolo. Si no se puede
// abrir una terminal, copia la orden para pegarla a mano.
export async function resolverConIA($: EngineInterface, h: Hallazgo, superficie?: RenderSurface): Promise<void> {
  const [raiz, sesion, ahora, total] = await Promise.all([
    $.session.root(),
    $.session.id(),
    $.clock.now(),
    leerTotal($),
  ])
  const fecha = new Date(ahora).toISOString().slice(0, 19).replace('T', ' ')
  const ruta = `${await carpetaDatos($, 'informes')}/${ficheroIA(h, fecha)}`
  const informe = informeIA(h, {
    fecha,
    proyecto: raiz,
    sesion,
    ventana: total?.ventana,
    porcentaje: total?.porcentaje,
  })
  try {
    await $.fs.write(ruta, informe)
  } catch (error) {
    $.ui.toast(`✦ No se pudo escribir el informe: ${error instanceof Error ? error.message : String(error)}`)
    return
  }
  const titulo = tituloIA(h)
  const prompt = promptIA(ruta)
  const seguro = !/[&|<>^"%!]/.test(raiz)
  for (const orden of lanzadoresIA(raiz, titulo, prompt)) {
    if (orden[0] === 'cmd' && !seguro) continue
    try {
      const r = await $.process.run(orden, { timeoutMs: 15_000 })
      if (r.exitCode === 0) {
        $.ui.toast(`✦ Chat con ${MODELO_IA} (${ESFUERZO_IA}) abierto para «${h.texto.slice(0, 50)}» · informe en ${corta(ruta)}`)
        return
      }
    } catch {
      // Sigue con la siguiente.
    }
  }
  const manual = ordenPwsh(titulo, prompt)
  const copia = await $.ui.copy({ text: manual, ...(superficie === undefined ? {} : { surface: superficie }) })
  $.ui.toast(
    copia.isCopied
      ? `✦ No se pudo abrir una terminal: orden copiada, pégala en una terminal en ${raiz}`
      : `✦ No se pudo abrir una terminal. Informe en ${ruta}; ábrelo con: ${manual}`,
  )
}
