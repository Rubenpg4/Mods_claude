import type { Entrada, Fila, Foto, Hallazgo, Limite, Llamada, Quesito, Subagente, TipoHallazgo, Total, Turno } from '../types'
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

// ── Estilo de los controles ──────────────────────────────────────────────────
// Tres estados para todo lo pulsable del mod:
//   · en reposo: el texto en su color, o atenuado si es secundario;
//   · encima (puntero): un fondo suave del tema y el texto a plena intensidad;
//   · elegido: una píldora rellena del color de acento, con la tinta que mejor
//     se lee encima y en negrita.
// El terminal invierte el botón bajo el puntero, que convierte una píldora
// elegida en otra apagada. Cada botón nombra su propio grupo de hover, y con
// `inverse: false` en ese grupo el estilo lo pone el mod en lugar del motor.
// El foco del teclado (Tab con la banda o el panel enfocados) sigue invirtiendo.

// Fondo del hover: el gris de los bordes del tema, claro u oscuro.
export const FONDO_ENCIMA = 'subtle'
// Fondo liso de las barras: el mismo gris, como carril por llenar.
export const CARRIL = 'subtle'

// Mezcla dos colores 0xRRGGBB: t = 0 da `a`, t = 1 da `b`.
export function mezcla(a: number, b: number, t: number): number {
  const canal = (desplazamiento: number) => {
    const x = (a >> desplazamiento) & 0xff
    const y = (b >> desplazamiento) & 0xff
    return Math.round(x + (y - x) * Math.max(0, Math.min(1, t))) << desplazamiento
  }
  return canal(16) | canal(8) | canal(0)
}

// Negro o blanco, lo que más contraste tenga sobre un fondo 0xRRGGBB.
export function tinta(fondo: number): string {
  const lineal = (c: number) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const l = 0.2126 * lineal((fondo >> 16) & 0xff) + 0.7152 * lineal((fondo >> 8) & 0xff) + 0.0722 * lineal(fondo & 0xff)
  return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? '#000000' : '#ffffff'
}

// El grupo de hover de un control: hasta 64 caracteres y único en el mod (los
// largos, como una ruta, se acortan con un resumen para no chocar).
export function grupo(id: string): string {
  const completo = `cv:${id}`
  if (completo.length <= 64) return completo
  let h = 0
  for (let i = 0; i < completo.length; i++) h = (Math.imul(h, 31) + completo.charCodeAt(i)) | 0
  return `${completo.slice(0, 54)}~${(h >>> 0).toString(36)}`
}

// Lo que va en el `hover` del propio Button: su grupo y sin la inversión.
export function sinInvertir(id: string): { scope: string; inverse: false } {
  return { scope: grupo(id), inverse: false }
}

// Lo que va en el `hover` de un Text dentro del Button: su grupo y el estilo.
export function encima<T extends Record<string, unknown>>(id: string, estilo: T): T & { scope: string } {
  return { scope: grupo(id), ...estilo }
}

export function ordenar<T extends { tokens: number }>(filas: T[], cuantas: number): T[] {
  return [...filas].sort((a, b) => b.tokens - a.tokens).slice(0, cuantas)
}

// Texto de la conversación listo para dibujar en una línea: sin secuencias de
// escape ANSI (las trae la salida de algunos comandos) ni otros caracteres de
// control, que el panel no acepta, y con los espacios juntos.
export function enLinea(texto: string): string {
  return texto
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b[\]P^_][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g, '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
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

// ── Ventanas de uso (5h, 7d) ───────────────────────────────────────────────
const HORA = 3_600_000
const DIA = 24 * HORA
// Lo que dura cada ventana, para saber cuánto de ella ha pasado.
const DURACION: Record<string, number> = { '5h': 5 * HORA, '7d': 7 * DIA }
// Por debajo de esta parte transcurrida la proyección es ruido: no avisa.
const RITMO_MINIMO = 5

// Una ventana de uso lista para dibujar.
export type Ventana = {
  tipo: string
  // Lo gastado, 0–100.
  usado: number
  // Lo transcurrido de la ventana, 0–100: lo que irías gastando al paso del
  // tiempo. null sin hora de reinicio o en ventanas sin duración fija.
  ritmo: number | null
  // Milisegundos hasta el reinicio; null sin dato.
  falta: number | null
  // Milisegundos hasta agotarla al ritmo actual, cuando es antes del reinicio.
  agota: number | null
}

export function ventanas(limites: Limite[], ahora: number): Ventana[] {
  return limites.map(l => {
    // Una lectura cuyo reinicio ya pasó (guardada de otra sesión, o sin
    // respuestas desde entonces): la ventana ha vuelto a empezar.
    if (l.reinicio !== undefined && l.reinicio <= ahora) return { tipo: l.tipo, usado: 0, ritmo: null, falta: null, agota: null }
    const usado = Math.min(100, Math.max(0, 100 - l.libre))
    const falta = l.reinicio === undefined ? null : Math.max(0, l.reinicio - ahora)
    const duracion = DURACION[l.tipo]
    const pasado = falta === null || duracion === undefined ? null : Math.min(duracion, Math.max(0, duracion - falta))
    const ritmo = pasado === null || duracion === undefined ? null : (pasado / duracion) * 100
    // Proyección lineal: gastando como hasta ahora, se agota antes del reinicio
    // justo cuando lo gastado va por delante de lo transcurrido.
    const agota =
      pasado === null || ritmo === null || ritmo < RITMO_MINIMO || usado <= ritmo || usado >= 100
        ? null
        : ((100 - usado) * pasado) / usado
    return { tipo: l.tipo, usado, ritmo, falta, agota }
  })
}

// «45m», «2h 14m», «3d 4h»: lo que falta, redondeado al minuto hacia arriba.
export function duracionCorta(ms: number): string {
  const minutos = Math.max(1, Math.ceil(ms / 60_000))
  if (minutos < 60) return `${minutos}m`
  const horas = Math.floor(minutos / 60)
  if (horas < 24) return `${horas}h ${String(minutos % 60).padStart(2, '0')}m`
  return `${Math.floor(horas / 24)}d ${horas % 24}h`
}

// Clave del tema para una ventana: roja desde el 85 %, ámbar desde el 70 % o
// si va por encima del ritmo.
export function colorVentana(v: Ventana): string {
  if (v.usado >= 85) return 'error'
  if (v.usado >= 70 || v.agota !== null) return 'warning'
  return 'success'
}

// El color más grave de varias ventanas.
export function peorColor(vs: Ventana[]): string {
  const orden = ['success', 'warning', 'error']
  return vs.map(colorVentana).reduce((a, b) => (orden.indexOf(b) > orden.indexOf(a) ? b : a), 'success')
}

// Un tramo de la barra de uso, que se dibuja sobre un carril de color liso:
// `usado`, bloques llenos; `parcial`, la celda del borde (un octavo de bloque
// del color de lo usado sobre el carril); `libre`, carril vacío; la marca del
// ritmo, una raya fina sobre lo usado o sobre el carril.
export type Tramo = { clase: 'usado' | 'parcial' | 'libre' | 'marcaUsado' | 'marcaLibre'; texto: string }

// Barra de uso con resolución de octavos y, si hay ritmo, una marca donde
// irías al paso del tiempo.
export function barraRitmo(usado: number, ritmo: number | null, ancho: number): Tramo[] {
  const octavos = Math.round((Math.min(100, Math.max(0, usado)) / 100) * ancho * 8)
  const llenas = Math.floor(octavos / 8)
  const resto = octavos % 8
  const marca = ritmo === null ? -1 : Math.min(ancho - 1, Math.floor((ritmo / 100) * ancho))
  const tramos: Tramo[] = []
  for (let i = 0; i < ancho; i++) {
    const celda: Tramo =
      i === marca
        ? { clase: i < llenas ? 'marcaUsado' : 'marcaLibre', texto: '▕' }
        : i < llenas
          ? { clase: 'usado', texto: '█' }
          : i === llenas && resto > 0
            ? { clase: 'parcial', texto: OCTAVOS[resto] ?? '' }
            : { clase: 'libre', texto: ' ' }
    const ultimo = tramos.at(-1)
    if (ultimo !== undefined && ultimo.clase === celda.clase) ultimo.texto += celda.texto
    else tramos.push(celda)
  }
  return tramos
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

// Lo que se sabe de una llamada, para las pruebas de un hallazgo.
function pruebasDe(l: Llamada): string[] {
  const p = [`Llamada #${l.orden} a ${l.herramienta}: ≈${k(l.tokens)} tokens de resultado en la conversación`]
  if (l.entrada !== undefined) p.push(`Argumentos: ${l.entrada}`)
  return p
}

// Malos usos del contexto: relecturas, lecturas enteras grandes, salidas y
// respuestas desmesuradas, y memoria o MCP que se pagan en cada turno. Cada
// hallazgo lleva sus pruebas, con las que `informeIA` arma el encargo.
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
    const suma = veces.reduce((s, l) => s + l.tokens, 0)
    const sobra = suma - Math.max(...veces.map(l => l.tokens))
    hallazgos.push({
      clave: `relectura:${ruta}`,
      tipo: 'relectura',
      gravedad: veces.length >= 3 ? 'alta' : 'media',
      texto: `${corta(ruta)} leído ${veces.length} veces`,
      consejo: 'reutiliza lo ya leído o lee solo la parte que cambió',
      tokens: sobra,
      ruta,
      herramienta: 'Read',
      pruebas: [
        `Fichero: ${ruta}`,
        `${veces.length} lecturas que suman ≈${k(suma)} tokens; ≈${k(sobra)} repiten lo ya leído`,
        ...veces.map(
          l => `Lectura #${l.orden}: ${l.parcial === true ? `parcial ${l.entrada ?? ''}`.trim() : 'entera'} · ≈${k(l.tokens)}`,
        ),
      ],
    })
  }
  for (const l of lista) {
    const fa = familia(l.herramienta).nombre
    const gravedad = l.tokens >= cfg.golpe ? 'alta' : 'media'
    const comun = { gravedad, tokens: l.tokens, herramienta: l.herramienta, pruebas: pruebasDe(l), muestra: l.muestra } as const
    if (l.herramienta === 'Read') {
      if (l.parcial === true || (l.ruta !== undefined && repetidas.has(l.ruta)) || l.tokens < cfg.lectura) continue
      hallazgos.push({
        ...comun,
        clave: `lectura:${l.id}`,
        tipo: 'lectura',
        texto: `${l.etiqueta} leído entero`,
        consejo: l.ruta?.endsWith('.md') === true ? 'lee por secciones (offset/limit) o busca con Grep' : 'usa offset/limit o Grep',
        ruta: l.ruta,
        pruebas: [...(l.ruta === undefined ? [] : [`Fichero: ${l.ruta}`]), ...comun.pruebas, 'Leído sin offset ni limit'],
      })
    } else if (fa === 'Bash' && l.tokens >= cfg.bash) {
      hallazgos.push({
        ...comun,
        clave: `bash:${l.id}`,
        tipo: 'bash',
        texto: `Salida de ${l.herramienta}: ${l.etiqueta}`,
        consejo: 'filtra la salida (head, grep, --query)',
      })
    } else if (fa === 'Respuestas MCP' && l.tokens >= cfg.mcp) {
      hallazgos.push({
        ...comun,
        clave: `mcp:${l.id}`,
        tipo: 'mcp',
        texto: `Respuesta de ${nombreHerramienta(l.herramienta)}`,
        consejo: 'pide menos resultados o solo los campos necesarios',
      })
    } else if (fa === 'Subagentes' && l.tokens >= cfg.subagente) {
      hallazgos.push({
        ...comun,
        clave: `subagente:${l.id}`,
        tipo: 'subagente',
        texto: `Informe del subagente «${l.etiqueta}»`,
        consejo: 'pídele solo la conclusión',
      })
    } else if (fa !== 'Bash' && fa !== 'Respuestas MCP' && fa !== 'Subagentes' && l.tokens >= cfg.otra) {
      hallazgos.push({
        ...comun,
        clave: `otra:${l.id}`,
        tipo: 'otra',
        texto: `${nombreHerramienta(l.herramienta)} ${l.etiqueta}`.trim(),
        consejo: 'acota la búsqueda o la consulta',
      })
    }
  }
  if (f !== null) {
    for (const m of f.memoria) {
      if (m.tokens < cfg.memoria) continue
      hallazgos.push({
        clave: `memoria:${m.ruta ?? m.nombre}`,
        tipo: 'memoria',
        gravedad: m.tokens >= cfg.memoria * 2 ? 'alta' : 'media',
        texto: `${m.nombre} en memoria`,
        consejo: 'se carga en cada turno: recórtalo o pásalo a reglas por carpeta',
        tokens: m.tokens,
        ruta: m.ruta,
        pruebas: [
          `Fichero: ${m.ruta ?? m.nombre}`,
          `≈${k(m.tokens)} tokens que viajan en cada petición (umbral del diagnóstico: ${k(cfg.memoria)})`,
          `Toda la memoria cargada: ${f.memoria.map(x => `${x.nombre} ≈${k(x.tokens)}`).join(', ')}`,
        ],
      })
    }
    const mcp = f.mcp.reduce((s, m) => s + m.tokens, 0)
    if (mcp >= cfg.mcpCargado) {
      const pesadas = [...f.mcpHerramientas].sort((a, b) => b.tokens - a.tokens).slice(0, 8)
      hallazgos.push({
        clave: 'mcp-cargado',
        tipo: 'mcp-cargado',
        gravedad: 'media',
        texto: 'Herramientas MCP cargadas',
        consejo: 'desconecta los servidores que no uses aquí',
        tokens: mcp,
        pruebas: [
          `≈${k(mcp)} tokens de esquemas MCP cargados en cada petición (umbral: ${k(cfg.mcpCargado)})`,
          ...[...f.mcp]
            .sort((a, b) => b.tokens - a.tokens)
            .map(m => `Servidor ${m.nombre}: ≈${k(m.tokens)} (${f.mcpHerramientas.filter(x => x.grupo === m.nombre).length} herramientas)`),
          ...(pesadas.length === 0 ? [] : [`Las más pesadas: ${pesadas.map(x => `${x.grupo}·${x.nombre} ≈${k(x.tokens)}`).join(', ')}`]),
        ],
      })
    }
  }
  return hallazgos
    .filter(x => !ignorados.includes(x.clave))
    .sort((a, b) => (a.gravedad === b.gravedad ? b.tokens - a.tokens : a.gravedad === 'alta' ? -1 : 1))
}

// ── Resolver con IA ─────────────────────────────────────────────────────────
//
// Un hallazgo se lleva a una sesión aparte de Claude Code (Sonnet, esfuerzo
// alto): el informe en Markdown con lo detectado y las pruebas, y un encargo
// según el tipo. La sesión arranca en el proyecto y lee el informe.

export const MODELO_IA = 'sonnet'
export const ESFUERZO_IA = 'high'

const ENCARGOS: Record<TipoHallazgo, string> = {
  relectura:
    'El mismo fichero se ha leído varias veces en la misma conversación. Averigua por qué hace falta releerlo (¿es muy largo?, ¿cambia a menudo?, ¿falta un índice?) y propón cómo evitarlo: dividirlo, añadirle un índice o resumen al principio, o una instrucción en CLAUDE.md para leerlo por secciones.',
  lectura:
    'Un fichero grande se ha leído entero de una vez. Revísalo y propón cómo hacer que se lea por partes: dividirlo, añadir un índice con las secciones y sus líneas, o una regla en CLAUDE.md para usar offset/limit o Grep con él.',
  bash:
    'Un comando ha volcado una salida enorme en la conversación. Propón la versión filtrada del mismo comando (flags de salida breve, head/tail, grep, --quiet, formatos compactos) y, si se usa a menudo, una regla en CLAUDE.md o un script del proyecto que lo deje en una salida corta.',
  mcp:
    'Una herramienta MCP ha devuelto una respuesta muy grande. Según sus argumentos y el comienzo de la respuesta, propón cómo pedir menos: paginación, límites, filtros o solo los campos necesarios. Si conviene, redacta una regla para CLAUDE.md con la forma correcta de llamarla.',
  subagente:
    'Un subagente ha devuelto un informe muy largo que entra entero en la conversación principal. Reescribe el encargo para que devuelva solo la conclusión (con un formato y una extensión máximos) y, si es un tipo de agente propio, propón el cambio en su definición.',
  otra:
    'Una herramienta ha devuelto un resultado muy grande. Propón cómo acotar la llamada (rutas, patrones, límites de resultados) y, si se repite, una regla en CLAUDE.md para hacerlo así siempre.',
  memoria:
    'Un fichero de memoria se carga entero en cada petición. Léelo y propón cómo recortarlo sin perder lo importante: qué sobra, qué se puede condensar y qué conviene mover a reglas por carpeta (.claude/rules), a skills o a documentación que se lea solo cuando haga falta.',
  'mcp-cargado':
    'Los esquemas de las herramientas MCP ocupan mucho en cada petición. Ayúdame a decidir qué servidores no hacen falta en este proyecto y cómo desactivarlos solo aquí (settings del proyecto, .mcp.json, permisos), sin perder los que sí uso.',
}

export type ContextoIA = {
  fecha: string
  proyecto: string
  sesion: string
  // Ocupación de la sesión cuando se detectó, si se conoce.
  ventana?: number
  porcentaje?: number
}

// El informe que lee la sesión aparte: qué pasa, pruebas, consejo y encargo.
export function informeIA(h: Hallazgo, c: ContextoIA): string {
  const peso =
    c.ventana === undefined || c.ventana <= 0
      ? `≈${k(h.tokens)} tokens`
      : `≈${k(h.tokens)} tokens (${((h.tokens / c.ventana) * 100).toFixed(1)} % de una ventana de ${k(c.ventana)})`
  const lineas = [
    `# Problema de contexto: ${h.texto}`,
    '',
    `Detectado por el diagnóstico del mod contexto-vivo en otra sesión de Claude Code (${c.sesion}) el ${c.fecha}.`,
    `Proyecto: ${c.proyecto}`,
    ...(c.porcentaje === undefined ? [] : [`Ocupación de aquella sesión al detectarlo: ${c.porcentaje} %`]),
    '',
    '## Qué pasa',
    '',
    `- Gravedad: ${h.gravedad}`,
    `- Tipo: ${h.tipo}`,
    `- Coste: ${peso}`,
    ...(h.ruta === undefined ? [] : [`- Fichero: ${h.ruta}`]),
    ...(h.herramienta === undefined ? [] : [`- Herramienta: ${h.herramienta}`]),
    '',
    '## Pruebas',
    '',
    ...h.pruebas.map(p => `- ${p}`),
  ]
  if (h.muestra !== undefined && h.muestra.trim() !== '') {
    lineas.push('', 'Comienzo del resultado:', '', '```', h.muestra.replace(/```/g, "'''"), '```')
  }
  lineas.push(
    '',
    '## Consejo del diagnóstico',
    '',
    h.consejo,
    '',
    '## Lo que te pido',
    '',
    ENCARGOS[h.tipo],
    '',
    'No continúes la tarea de aquella sesión: el objetivo es que este problema no vuelva a pasar. Mira los ficheros del proyecto que haga falta, explícame la causa en pocas líneas y, antes de cambiar ningún fichero, enséñame el cambio y espera a que lo apruebe.',
  )
  return lineas.join('\n')
}

// El primer mensaje de la sesión aparte. Sin comillas, `;`, `&`, `%` ni otros
// caracteres que Windows Terminal o cmd interpretan.
export function promptIA(ruta: string): string {
  return `Lee el informe ${ruta} y ayúdame a resolver el problema de contexto que describe, siguiendo lo que pide.`
}

// Nombre de la sesión aparte (claude -n), sin caracteres conflictivos.
export function tituloIA(h: Hallazgo): string {
  return `Contexto · ${h.texto}`.replace(/["&|<>^%!;`]/g, '').replace(/\s+/g, ' ').slice(0, 60).trim()
}

// Nombre del fichero del informe: fecha y clave saneadas.
export function ficheroIA(h: Hallazgo, fecha: string): string {
  const sello = fecha.replace(/[^0-9]/g, '').slice(0, 14)
  const clave = h.clave.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(-60)
  return `${sello}-${clave}.md`
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

// La cola de la línea de «auto mode on»: contexto, turnos, uso de las ventanas
// (con la cuenta atrás si falta menos de un día y ↗ si va por encima del
// ritmo) y avisos.
export function pie(t: Total | null, limites: Limite[], turnos: number | null, avisos: number, ahora: number): string {
  const alerta = avisos > 0 ? `  ·  ⚠ ${avisos}` : ''
  // Los límites van aunque la conversación aún no tenga cifra (recién abierta,
  // tras /clear): son de la cuenta, no de la conversación.
  const uso = ventanas(limites, ahora)
    .map(v => {
      const reinicio = v.falta !== null && v.falta < DIA ? ` ↻ ${duracionCorta(v.falta)}` : ''
      return `${sector(v.usado)} ${v.tipo} ${v.usado}%${reinicio}${v.agota === null ? '' : ' ↗'}`
    })
    .join(' · ')
  const conUso = uso === '' ? '' : `  ·  ${uso}`
  if (t === null) return `  ○ ctx —${conUso}${alerta}`
  const restantes = turnos === null ? '' : `  ·  ~${turnos} turno${turnos === 1 ? '' : 's'}`
  return `  ${sector(t.porcentaje)} ctx ${t.porcentaje}% ${segmentos(t.porcentaje)} ${k(t.tokens)}/${k(t.ventana)}${restantes}${conUso}${alerta}`
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
