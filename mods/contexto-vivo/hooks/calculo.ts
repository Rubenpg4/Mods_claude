import type { Entrada, Fila, Foto, Hallazgo, Llamada, Quesito, Subagente, Total, Turno } from '../types'
import type { Config } from './config'

// Caracteres por token al estimar un resultado (texto en español y código).
export const CARACTERES_POR_TOKEN = 3.5

export const CATEGORIAS: Record<string, string> = {
  'System prompt': 'Prompt de sistema',
  'System tools': 'Herramientas',
  'MCP tools': 'Herramientas MCP',
  'Custom agents': 'Agentes',
  'Memory files': 'Memoria',
  Skills: 'Skills',
  Messages: 'Mensajes',
  'Free space': 'Libre',
  'Autocompact buffer': 'Reserva de compactación',
}

// Colores fijos (0xRRGGBB) del gráfico, la barra y las leyendas.
export const PALETA: Record<string, number> = {
  'Prompt de sistema': 0x8e8e93,
  Herramientas: 0x5ac8fa,
  'Herramientas MCP': 0xbf5af2,
  Agentes: 0xff9f0a,
  Memoria: 0xffd60a,
  Skills: 0x30d158,
  Conversación: 0x0a84ff,
}
export const GRIS = 0xaeaeb2
// Colores de nivel para los gráficos: bien, aviso, alerta.
export const VERDE = 0x30d158
export const AMBAR = 0xff9f0a
export const ROJO = 0xff453a

// Colores de las porciones dentro de una categoría; lo que no cabe va a «Resto».
const TONOS = [0x0a84ff, 0x30d158, 0xff9f0a, 0xbf5af2, 0xff453a, 0x64d2ff, 0xffd60a, 0xff6482, 0x66d4cf]
// Categorías que Claude Code no desglosa por elemento.
export const SIN_DETALLE = new Set(['Prompt de sistema', 'Herramientas'])

export const VENTANAS: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'gasto' }

const SECTORES = ['○', '◔', '◑', '◕', '●']
const OCTAVOS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']
const ESCALONES = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']

export function k(n: number): string {
  if (Math.abs(n) < 1000) return String(Math.round(n))
  return `${(n / 1000).toFixed(Math.abs(n) < 10000 ? 1 : 0)}k`
}

export function css(rgb: number): string {
  return `#${rgb.toString(16).padStart(6, '0')}`
}

export function ordenar<T extends { tokens: number }>(filas: T[], cuantas: number): T[] {
  return [...filas].sort((a, b) => b.tokens - a.tokens).slice(0, cuantas)
}

export function corta(ruta: string): string {
  return ruta.split(/[\\/]/).slice(-2).join('/')
}

export function nombreHerramienta(herramienta: string): string {
  if (!herramienta.startsWith('mcp__')) return herramienta
  return herramienta.slice(5).replace(/^claude_ai_/, '').replace('__', '·')
}

// Familia de una herramienta, con su color: en qué se va «Mensajes».
export function familia(herramienta: string): { nombre: string; rgb: number } {
  if (herramienta.startsWith('mcp__')) return { nombre: 'Respuestas MCP', rgb: 0xda8fff }
  if (['Read', 'Grep', 'Glob', 'NotebookRead'].includes(herramienta)) return { nombre: 'Lecturas', rgb: 0x64d2ff }
  if (['Bash', 'PowerShell', 'Monitor'].includes(herramienta)) return { nombre: 'Bash', rgb: 0xff6961 }
  if (['Edit', 'Write', 'NotebookEdit'].includes(herramienta)) return { nombre: 'Ediciones', rgb: 0x34c759 }
  if (['Agent', 'Task', 'Workflow'].includes(herramienta)) return { nombre: 'Subagentes', rgb: 0xffb340 }
  if (['WebFetch', 'WebSearch'].includes(herramienta)) return { nombre: 'Web', rgb: 0x66d4cf }
  return { nombre: 'Otras herramientas', rgb: GRIS }
}

// Clave del tema y color RGB del nivel de un porcentaje.
export function colorNivel(porcentaje: number | undefined, cfg: Config): string {
  if (porcentaje === undefined) return 'inactive'
  return porcentaje >= cfg.critico ? 'error' : porcentaje >= cfg.aviso ? 'warning' : 'success'
}

export function rgbNivel(porcentaje: number, cfg: Config): number {
  return porcentaje >= cfg.critico ? ROJO : porcentaje >= cfg.aviso ? AMBAR : VERDE
}

export function colorCache(cache: number | null): string {
  if (cache === null) return 'inactive'
  return cache >= 80 ? 'success' : cache >= 50 ? 'warning' : 'error'
}

export function sector(porcentaje: number): string {
  return SECTORES[Math.min(4, Math.max(0, Math.round(porcentaje / 25)))] ?? '○'
}

// Barra de ancho fijo con resolución de octavos de celda.
export function barraFina(valor: number, maximo: number, ancho: number): string {
  const octavos = Math.round((maximo <= 0 ? 0 : Math.min(1, valor / maximo)) * ancho * 8)
  return '█'.repeat(Math.floor(octavos / 8)) + (OCTAVOS[octavos % 8] ?? '')
}

// Barra de diez segmentos ▰▱ para un porcentaje.
export function segmentos(porcentaje: number, ancho = 10): string {
  const llenos = Math.min(ancho, Math.max(0, Math.round((porcentaje / 100) * ancho)))
  return '▰'.repeat(llenos) + '▱'.repeat(ancho - llenos)
}

// Minigráfica de una línea: un escalón por valor (0–100).
export function chispa(valores: number[]): string {
  return valores.map(v => ESCALONES[Math.min(7, Math.max(0, Math.round((v / 100) * 7)))] ?? '▁').join('')
}

export function etiquetar(entrada: Record<string, unknown>): string {
  const texto = (clave: string) =>
    typeof entrada[clave] === 'string' ? (entrada[clave] as string) : undefined
  const ruta = texto('file_path') ?? texto('notebook_path')
  if (ruta !== undefined) return corta(ruta)
  const otra =
    texto('description') ??
    texto('pattern') ??
    texto('command') ??
    texto('query') ??
    texto('url') ??
    texto('skill') ??
    texto('path') ??
    ''
  return otra.replace(/\s+/g, ' ')
}

// Lo usado, por porciones: las categorías de /context, con «Mensajes»
// repartido entre las familias de herramienta y el resto de la conversación.
export function quesitos(f: Foto | null, lista: Llamada[]): Quesito[] {
  if (f === null) return []
  const salida: Quesito[] = []
  for (const c of f.categorias) {
    if (c.tipo !== 'used' || c.tokens <= 0) continue
    if (c.nombre !== 'Mensajes') {
      salida.push({ nombre: c.nombre, tokens: c.tokens, rgb: PALETA[c.nombre] ?? GRIS })
      continue
    }
    const porFamilia = new Map<string, Quesito>()
    for (const l of lista) {
      const fa = familia(l.herramienta)
      const q = porFamilia.get(fa.nombre) ?? { nombre: fa.nombre, tokens: 0, rgb: fa.rgb }
      porFamilia.set(fa.nombre, { ...q, tokens: q.tokens + l.tokens })
    }
    const suma = [...porFamilia.values()].reduce((s, q) => s + q.tokens, 0)
    const escala = suma > c.tokens ? c.tokens / suma : 1
    for (const q of porFamilia.values()) salida.push({ ...q, tokens: Math.round(q.tokens * escala) })
    salida.push({
      nombre: 'Conversación',
      tokens: Math.max(0, c.tokens - Math.round(suma * escala)),
      rgb: PALETA['Conversación'] ?? GRIS,
    })
  }
  return salida.filter(q => q.tokens > 0).sort((a, b) => b.tokens - a.tokens)
}

function conTonos<T extends Fila>(filas: T[], extra: (fila: T) => Partial<Entrada>): Entrada[] {
  const orden = [...filas].filter(f => f.tokens > 0).sort((a, b) => b.tokens - a.tokens)
  const salida: Entrada[] = orden
    .slice(0, TONOS.length)
    .map((f, i) => ({ nombre: f.nombre, tokens: f.tokens, rgb: TONOS[i] ?? GRIS, ...extra(f) }))
  const resto = orden.slice(TONOS.length)
  if (resto.length > 0) {
    salida.push({ nombre: `Resto (${resto.length})`, tokens: resto.reduce((s, f) => s + f.tokens, 0), rgb: GRIS })
  }
  return salida
}

// Lo que muestra el reparto en cada nivel: [] las categorías, ['Memoria'] sus
// ficheros, ['Herramientas MCP', 'Notion'] las herramientas de un servidor.
export function entradas(nav: string[], f: Foto | null, lista: Llamada[], largos: Fila[]): Entrada[] {
  const [categoria, sub] = nav
  if (categoria === undefined) {
    return quesitos(f, lista).map(q => ({ ...q, entrar: SIN_DETALLE.has(q.nombre) ? undefined : q.nombre }))
  }
  if (f === null) return []
  if (categoria === 'Memoria') return conTonos(f.memoria, m => ({ ruta: m.ruta }))
  if (categoria === 'Skills') return conTonos(f.skills, s => ({ nota: s.nota }))
  if (categoria === 'Agentes') return conTonos(f.agentes, () => ({}))
  if (categoria === 'Herramientas MCP') {
    if (sub === undefined) return conTonos(f.mcp, m => ({ entrar: m.nombre }))
    return conTonos(f.mcpHerramientas.filter(x => x.grupo === sub), () => ({}))
  }
  if (categoria === 'Conversación') return conTonos(largos, () => ({}))
  // Una familia de herramienta: cada fichero o comando, sumado, con las veces.
  const grupos = new Map<string, Fila & { veces: number }>()
  for (const l of lista) {
    if (familia(l.herramienta).nombre !== categoria) continue
    const clave = l.ruta ?? `${nombreHerramienta(l.herramienta)} ${l.etiqueta}`.trim()
    const previo = grupos.get(clave)
    grupos.set(clave, {
      nombre: l.ruta !== undefined ? corta(l.ruta) : clave,
      tokens: (previo?.tokens ?? 0) + l.tokens,
      ruta: l.ruta,
      veces: (previo?.veces ?? 0) + 1,
    })
  }
  return conTonos([...grupos.values()], g => ({ ruta: g.ruta, nota: g.veces > 1 ? `×${g.veces}` : undefined }))
}

// Malos usos del contexto: relecturas, lecturas enteras grandes, salidas y
// respuestas desmesuradas, y memoria o MCP que se pagan en cada turno.
// Los hallazgos cuya clave está en `ignorados` no se devuelven.
export function diagnosticar(f: Foto | null, lista: Llamada[], cfg: Config, ignorados: string[]): Hallazgo[] {
  const hallazgos: Hallazgo[] = []
  const lecturas = new Map<string, Llamada[]>()
  for (const l of lista) {
    if (l.herramienta === 'Read' && l.ruta !== undefined) {
      lecturas.set(l.ruta, [...(lecturas.get(l.ruta) ?? []), l])
    }
  }
  const repetidas = new Set<string>()
  for (const [ruta, veces] of lecturas) {
    if (veces.length < 2) continue
    repetidas.add(ruta)
    const sobra = veces.reduce((s, l) => s + l.tokens, 0) - Math.max(...veces.map(l => l.tokens))
    hallazgos.push({
      clave: `relectura:${ruta}`,
      gravedad: veces.length >= 3 ? 'alta' : 'media',
      texto: `${corta(ruta)} leído ${veces.length} veces`,
      consejo: 'reutiliza lo ya leído o lee solo la parte que cambió',
      tokens: sobra,
      ruta,
    })
  }
  for (const l of lista) {
    const fa = familia(l.herramienta).nombre
    const gravedad = l.tokens >= cfg.golpe ? 'alta' : 'media'
    if (l.herramienta === 'Read') {
      if (l.parcial === true || (l.ruta !== undefined && repetidas.has(l.ruta)) || l.tokens < cfg.lectura) continue
      hallazgos.push({
        clave: `lectura:${l.id}`,
        gravedad,
        texto: `${l.etiqueta} leído entero`,
        consejo: l.ruta?.endsWith('.md') === true ? 'lee por secciones (offset/limit) o busca con Grep' : 'usa offset/limit o Grep',
        tokens: l.tokens,
        ruta: l.ruta,
      })
    } else if (fa === 'Bash' && l.tokens >= cfg.bash) {
      hallazgos.push({
        clave: `bash:${l.id}`,
        gravedad,
        texto: `Salida de ${l.herramienta}: ${l.etiqueta}`,
        consejo: 'filtra la salida (head, grep, --query)',
        tokens: l.tokens,
      })
    } else if (fa === 'Respuestas MCP' && l.tokens >= cfg.mcp) {
      hallazgos.push({
        clave: `mcp:${l.id}`,
        gravedad,
        texto: `Respuesta de ${nombreHerramienta(l.herramienta)}`,
        consejo: 'pide menos resultados o solo los campos necesarios',
        tokens: l.tokens,
      })
    } else if (fa === 'Subagentes' && l.tokens >= cfg.subagente) {
      hallazgos.push({
        clave: `subagente:${l.id}`,
        gravedad,
        texto: `Informe del subagente «${l.etiqueta}»`,
        consejo: 'pídele solo la conclusión',
        tokens: l.tokens,
      })
    } else if (fa !== 'Bash' && fa !== 'Respuestas MCP' && fa !== 'Subagentes' && l.tokens >= cfg.otra) {
      hallazgos.push({
        clave: `otra:${l.id}`,
        gravedad,
        texto: `${nombreHerramienta(l.herramienta)} ${l.etiqueta}`.trim(),
        consejo: 'acota la búsqueda o la consulta',
        tokens: l.tokens,
      })
    }
  }
  if (f !== null) {
    for (const m of f.memoria) {
      if (m.tokens < cfg.memoria) continue
      hallazgos.push({
        clave: `memoria:${m.ruta ?? m.nombre}`,
        gravedad: m.tokens >= cfg.memoria * 2 ? 'alta' : 'media',
        texto: `${m.nombre} en memoria`,
        consejo: 'se carga en cada turno: recórtalo o pásalo a reglas por carpeta',
        tokens: m.tokens,
        ruta: m.ruta,
      })
    }
    const mcp = f.mcp.reduce((s, m) => s + m.tokens, 0)
    if (mcp >= cfg.mcpCargado) {
      hallazgos.push({
        clave: 'mcp-cargado',
        gravedad: 'media',
        texto: 'Herramientas MCP cargadas',
        consejo: 'desconecta los servidores que no uses aquí',
        tokens: mcp,
      })
    }
  }
  return hallazgos
    .filter(x => !ignorados.includes(x.clave))
    .sort((a, b) => (a.gravedad === b.gravedad ? b.tokens - a.tokens : a.gravedad === 'alta' ? -1 : 1))
}

// Ritmo de crecimiento y turnos que quedan hasta compactar.
export type Tendencia = {
  // Crecimiento medio por turno (últimos cinco turnos que crecieron).
  media: number | null
  // Tokens a los que compacta, o el límite de la ventana sin compactación.
  objetivo: number | null
  turnosRestantes: number | null
  // Los turnos que más crecieron, de mayor a menor.
  mayores: Turno[]
}

export function tendencia(turnos: Turno[], f: Foto | null, t: Total | null): Tendencia {
  const crecientes = turnos.filter(x => x.delta > 0).slice(-5)
  const media = crecientes.length === 0 ? null : crecientes.reduce((s, x) => s + x.delta, 0) / crecientes.length
  const objetivo = f?.compacta ?? t?.ventana ?? null
  const actual = t?.tokens ?? turnos.at(-1)?.tokens
  const turnosRestantes =
    media === null || objetivo === null || actual === undefined || media <= 0
      ? null
      : Math.max(0, Math.ceil((objetivo - actual) / media))
  const mayores = [...turnos].filter(x => x.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 3)
  return { media, objetivo, turnosRestantes, mayores }
}

// La cola de la línea de «auto mode on»: contexto, turnos, uso libre y avisos.
export function pie(t: Total | null, turnos: number | null, avisos: number): string {
  const alerta = avisos > 0 ? `  ·  ⚠ ${avisos}` : ''
  if (t === null) return `  ○ ctx —${alerta}`
  const restantes = turnos === null ? '' : `  ·  ~${turnos} turno${turnos === 1 ? '' : 's'}`
  const uso = t.limites.map(l => `${l.tipo} ${l.libre}% libre`).join(' · ')
  return `  ${sector(t.porcentaje)} ctx ${t.porcentaje}% ${segmentos(t.porcentaje)} ${k(t.tokens)}/${k(t.ventana)}${restantes}${uso === '' ? '' : `  ·  ${uso}`}${alerta}`
}

// El texto de /contexto-top.
export function informe(
  f: Foto | null,
  lista: Llamada[],
  turnos: Turno[],
  agentes: Subagente[],
  cfg: Config,
  ignorados: string[],
  t: Total | null,
): string {
  const lineas: string[] = []
  const filas = (titulo: string, datos: Fila[]) => {
    if (datos.length === 0) return
    const maximo = datos[0]?.tokens ?? 0
    lineas.push('', titulo)
    for (const d of datos) {
      lineas.push(`  ${k(d.tokens).padStart(6)}  ${barraFina(d.tokens, maximo, 12).padEnd(12)}  ${d.nombre}`)
    }
  }
  if (f !== null) {
    lineas.push(`${sector(f.porcentaje)} Contexto ${f.porcentaje} % · ${k(f.tokens)} / ${k(f.ventana)} (${f.exacto ? 'exacto' : 'estimado'})`)
    const ritmo = tendencia(turnos, f, t)
    if (ritmo.media !== null) {
      const resto = ritmo.turnosRestantes === null ? '' : ` · compacta en ~${ritmo.turnosRestantes} turnos`
      lineas.push(`  +${k(ritmo.media)}/turno${resto} · ${chispa(turnos.slice(-24).map(x => x.porcentaje))}`)
    }
    filas('Reparto de lo usado', ordenar(quesitos(f, lista), 12))
    filas('Memoria', ordenar(f.memoria, 5))
    filas('MCP cargado', ordenar(f.mcp, 5))
  }
  filas(
    'Lo que más pesa (≈)',
    ordenar(
      lista.map(l => ({ nombre: `${nombreHerramienta(l.herramienta)} ${l.etiqueta}`.slice(0, 90), tokens: l.tokens })),
      10,
    ),
  )
  if (agentes.length > 0) {
    lineas.push('', 'Subagentes')
    for (const a of agentes.slice(-6)) {
      lineas.push(`  ${a.activo ? '●' : '○'} ${a.tipo.padEnd(18)} ${k(a.tokens).padStart(6)}  ${a.descripcion.slice(0, 50)}`)
    }
  }
  const hallazgos = diagnosticar(f, lista, cfg, ignorados)
  if (hallazgos.length > 0) {
    lineas.push('', 'Diagnóstico')
    for (const hallazgo of hallazgos.slice(0, 8)) {
      lineas.push(
        `  ${hallazgo.gravedad === 'alta' ? '▲' : '△'} ${hallazgo.texto} (≈${k(hallazgo.tokens)})`,
        `      ↳ ${hallazgo.consejo}`,
      )
    }
  }
  return lineas.length === 0 ? 'Aún no hay datos de contexto.' : lineas.join('\n').trim()
}
