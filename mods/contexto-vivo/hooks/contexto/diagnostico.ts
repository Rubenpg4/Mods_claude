import type { Foto, Hallazgo, Llamada, Rotura, Subagente, Total, TipoHallazgo, Turno } from '../../types'

import { familia } from '../comun/colores'
import { corta, k, nombreHerramienta } from '../comun/formato'
import type { Config } from '../config'
import { tendencia } from './tendencia'

// Diagnóstico de malos usos del contexto, cada uno con sus pruebas. Puro: los
// umbrales llegan en `Config` (de /config) y el resto de lo medido, en `Entorno`.
//
// Las claves van por patrón (fichero, comando, herramienta, tipo de agente),
// no por llamada: el mismo mal uso repetido es un solo hallazgo con `veces`, y
// si vuelve tras resolverse se reconoce como el mismo.

// Lo que se mide aparte de las llamadas: turnos, subagentes, cifra y cachés rotas.
export type Entorno = {
  turnos?: Turno[]
  subagentes?: Subagente[]
  total?: Total | null
  roturas?: Rotura[]
}

// Lo que tienen que sobrar las llamadas repetidas con el mismo resultado.
export const MINIMO_REPETIDA = 1000
// Una exploración: en un mismo turno, al menos tantas lecturas y búsquedas
// sobre tantos ficheros distintos, y el doble del umbral de `lectura`.
export const EXPLORACION = { llamadas: 10, ficheros: 6 }
// Un subagente cuyo pico pasa de esta parte de la ventana.
export const SUBAGENTE_LLENO = 0.7
// Un turno que por sí solo añade esta parte de la ventana.
export const TURNO_GRANDE = 0.15
// Una pausa tras la que la caché puede haber caducado (dura 5 min o 1 h).
const PAUSA_CACHE = 5 * 60_000

const EDICIONES = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

// Lo que se sabe de una llamada, para las pruebas de un hallazgo.
function pruebasDe(l: Llamada): string[] {
  const turno = l.turno === undefined ? '' : ` (turno ${l.turno})`
  const p = [`Llamada #${l.orden}${turno} a ${l.herramienta}: ≈${k(l.tokens)} tokens de resultado en la conversación`]
  if (l.entrada !== undefined) p.push(`Argumentos: ${l.entrada}`)
  return p
}

// Los argumentos de una llamada, si su JSON llegó entero.
function argumentos(l: Llamada): Record<string, unknown> | null {
  if (l.entrada === undefined) return null
  try {
    const v: unknown = JSON.parse(l.entrada)
    return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

// Un argumento de texto de una llamada, aunque su JSON llegara recortado.
export function argumento(l: Llamada, nombre: string): string | undefined {
  const v = argumentos(l)?.[nombre]
  if (typeof v === 'string') return v
  const m = l.entrada?.match(new RegExp(`"${nombre}":"((?:[^"\\\\]|\\\\.)*)`))
  if (m?.[1] === undefined) return undefined
  try {
    return JSON.parse(`"${m[1]}"`) as string
  } catch {
    return m[1]
  }
}

// El patrón de una orden de consola: el programa y, si lo hay, su subcomando
// (`git log`, `npm test`, `ls`), sin `cd …` delante, variables ni tuberías.
export function patronComando(orden: string): string {
  const tramos = orden
    .split(/&&|\|\||;|\n/)
    .map(t => t.trim())
    .filter(t => t !== '' && !/^(cd|pushd|set-location)\s/i.test(t))
  const primero = (tramos[0] ?? orden).split('|')[0]?.trim() ?? ''
  const [programa, sub] = primero.split(/\s+/).filter(p => !/^\w+=/.test(p))
  if (programa === undefined || programa === '') return orden.trim().slice(0, 40)
  const base = programa.replace(/^.*[\\/]/, '').replace(/\.exe$/i, '')
  return sub !== undefined && /^[a-z][\w:-]*$/i.test(sub) ? `${base} ${sub}` : base
}

// Las líneas que pidió una lectura, [desde, hasta); null si no se sabe.
function rango(l: Llamada): [number, number] | null {
  if (l.parcial !== true) return [1, Infinity]
  if (l.desde === undefined && l.cuantas === undefined) return null
  const desde = l.desde ?? 1
  return [desde, l.cuantas === undefined ? Infinity : desde + l.cuantas]
}

// Si una lectura vuelve a traer líneas de otra.
function solapan(a: Llamada, b: Llamada): boolean {
  const ra = rango(a)
  const rb = rango(b)
  if (ra === null || rb === null) return a.entrada === b.entrada
  return ra[0] < rb[1] && rb[0] < ra[1]
}

function lineas(l: Llamada): string {
  const r = rango(l)
  if (l.parcial !== true) return 'entera'
  if (r === null) return `parcial ${l.entrada ?? ''}`.trim()
  return r[1] === Infinity ? `desde la línea ${r[0]}` : `líneas ${r[0]}–${r[1] - 1}`
}

function pct(tokens: number, ventana: number): string {
  return `${Math.round((tokens / ventana) * 100)} %`
}

function minutos(ms: number): string {
  return ms >= 3_600_000 ? `${(ms / 3_600_000).toFixed(1)} h` : `${Math.round(ms / 60_000)} min`
}

// ── Relecturas ───────────────────────────────────────────────────────────────
//
// Una lectura sobra si trae líneas que ya trajo otra anterior del mismo fichero
// y entre las dos no se editó. Releer tras editar, o leer otra parte, no sobra.

function relecturas(lista: Llamada[], cfg: Config): { hallazgos: Hallazgo[]; rutas: Set<string> } {
  const porRuta = new Map<string, Llamada[]>()
  const ediciones = new Map<string, number[]>()
  for (const l of lista) {
    if (l.ruta === undefined) continue
    if (l.herramienta === 'Read') porRuta.set(l.ruta, [...(porRuta.get(l.ruta) ?? []), l])
    else if (EDICIONES.has(l.herramienta)) ediciones.set(l.ruta, [...(ediciones.get(l.ruta) ?? []), l.orden])
  }
  const hallazgos: Hallazgo[] = []
  const rutas = new Set<string>()
  for (const [ruta, veces] of porRuta) {
    if (veces.length < 2) continue
    const editado = ediciones.get(ruta) ?? []
    const sobran = new Set<Llamada>()
    const traseEdicion = new Set<Llamada>()
    veces.forEach((actual, i) => {
      const previas = veces.slice(0, i)
      const vigentes = previas.filter(p => !editado.some(o => o > p.orden && o < actual.orden))
      if (vigentes.length < previas.length) traseEdicion.add(actual)
      if (vigentes.some(p => solapan(p, actual))) sobran.add(actual)
    })
    if (sobran.size === 0) continue
    rutas.add(ruta)
    const suma = veces.reduce((s, l) => s + l.tokens, 0)
    const sobra = [...sobran].reduce((s, l) => s + l.tokens, 0)
    hallazgos.push({
      clave: `relectura:${ruta}`,
      tipo: 'relectura',
      gravedad: sobran.size >= 2 || sobra >= cfg.golpe ? 'alta' : 'media',
      texto: `${corta(ruta)} leído ${veces.length} veces`,
      consejo: 'reutiliza lo ya leído o lee solo la parte que cambió',
      tokens: sobra,
      veces: veces.length,
      ruta,
      herramienta: 'Read',
      pruebas: [
        `Fichero: ${ruta}`,
        `${veces.length} lecturas que suman ≈${k(suma)} tokens; ${sobran.size} ${sobran.size === 1 ? 'repite' : 'repiten'} líneas ya leídas sin editarlo entre medias (≈${k(sobra)})`,
        ...veces.map(l => {
          const turno = l.turno === undefined ? '' : ` (turno ${l.turno})`
          const nota = sobran.has(l) ? 'repite lo ya leído' : traseEdicion.has(l) ? 'tras editarlo' : 'primera de este tramo'
          return `Lectura #${l.orden}${turno}: ${lineas(l)} · ≈${k(l.tokens)} · ${nota}`
        }),
        ...(editado.length === 0 ? ['No se editó entre lecturas'] : [`Ediciones del fichero: ${editado.map(o => `#${o}`).join(', ')}`]),
      ],
    })
  }
  return { hallazgos, rutas }
}

// ── Llamadas repetidas con el mismo resultado ───────────────────────────────

function repetidas(lista: Llamada[], cfg: Config): { hallazgos: Hallazgo[]; ids: Set<string> } {
  const grupos = new Map<string, Llamada[]>()
  for (const l of lista) {
    if (l.herramienta === 'Read' || EDICIONES.has(l.herramienta) || l.entrada === undefined) continue
    const clave = [l.herramienta, l.entrada, l.muestra ?? '', l.tokens].join('\u0000')
    grupos.set(clave, [...(grupos.get(clave) ?? []), l])
  }
  const hallazgos: Hallazgo[] = []
  const ids = new Set<string>()
  for (const ls of grupos.values()) {
    if (ls.length < 2) continue
    const [primera] = ls
    if (primera === undefined) continue
    const sobra = ls.slice(1).reduce((s, l) => s + l.tokens, 0)
    if (sobra < MINIMO_REPETIDA) continue
    for (const l of ls.slice(1)) ids.add(l.id)
    const orden = argumento(primera, 'command')
    hallazgos.push({
      clave: `repetida:${primera.herramienta}:${(orden ?? primera.entrada ?? '').slice(0, 80)}`,
      tipo: 'repetida',
      gravedad: ls.length >= 3 || sobra >= cfg.golpe ? 'alta' : 'media',
      texto: `${nombreHerramienta(primera.herramienta)} ${primera.etiqueta}`.trim().slice(0, 70) + ` repetido ${ls.length} veces`,
      consejo: 'reutiliza el resultado anterior; si hará falta otra vez, guárdalo en un fichero y lee solo lo necesario',
      tokens: sobra,
      veces: ls.length,
      herramienta: primera.herramienta,
      muestra: primera.muestra,
      pruebas: [
        ...(primera.entrada === undefined ? [] : [`Argumentos: ${primera.entrada}`]),
        `${ls.length} llamadas con los mismos argumentos y el mismo resultado (tamaño y comienzo); ≈${k(sobra)} repiten lo ya recibido`,
        ...ls.map(l => `Llamada #${l.orden}${l.turno === undefined ? '' : ` (turno ${l.turno})`} · ≈${k(l.tokens)}`),
      ],
    })
  }
  return { hallazgos, ids }
}

// ── Resultados grandes, agrupados por patrón ────────────────────────────────

type Grupo = { tipo: TipoHallazgo; patron: string; ls: Llamada[] }

// El tipo y el patrón de una llamada con un resultado grande; null si no lo es.
function clasificar(l: Llamada, cfg: Config, releidas: Set<string>): { tipo: TipoHallazgo; patron: string } | null {
  const fa = familia(l.herramienta).nombre
  if (l.herramienta === 'Read') {
    if (l.parcial === true || (l.ruta !== undefined && releidas.has(l.ruta)) || l.tokens < cfg.lectura) return null
    return { tipo: 'lectura', patron: l.ruta ?? l.id }
  }
  if (fa === 'Bash') {
    return l.tokens >= cfg.bash ? { tipo: 'bash', patron: patronComando(argumento(l, 'command') ?? l.etiqueta) } : null
  }
  if (fa === 'Respuestas MCP') return l.tokens >= cfg.mcp ? { tipo: 'mcp', patron: l.herramienta } : null
  if (fa === 'Subagentes') {
    return l.tokens >= cfg.subagente ? { tipo: 'subagente', patron: argumento(l, 'subagent_type') ?? l.herramienta } : null
  }
  if (l.herramienta === 'Grep' || l.herramienta === 'Glob') {
    const a = argumentos(l)
    // Un Grep que vuelca contenido sin límite se señala antes.
    const sinLimite = l.herramienta === 'Grep' && a?.output_mode === 'content' && a.head_limit === undefined
    return l.tokens >= (sinLimite ? cfg.otra / 2 : cfg.otra) ? { tipo: 'busqueda', patron: l.herramienta } : null
  }
  return EDICIONES.has(l.herramienta) || l.tokens < cfg.otra ? null : { tipo: 'otra', patron: l.herramienta }
}

function textoUno(tipo: TipoHallazgo, l: Llamada): string {
  if (tipo === 'lectura') return `${l.etiqueta} leído entero`
  if (tipo === 'bash') return `Salida de ${l.herramienta}: ${l.etiqueta}`
  if (tipo === 'mcp') return `Respuesta de ${nombreHerramienta(l.herramienta)}`
  if (tipo === 'subagente') return `Informe del subagente «${l.etiqueta}»`
  if (tipo === 'busqueda') return `Búsqueda con ${l.herramienta}: ${l.etiqueta}`
  return `${nombreHerramienta(l.herramienta)} ${l.etiqueta}`.trim()
}

function textoVarios(tipo: TipoHallazgo, patron: string, veces: number): string {
  if (tipo === 'lectura') return `${corta(patron)} leído entero ${veces} veces`
  if (tipo === 'bash') return `${veces} salidas grandes de «${patron}»`
  if (tipo === 'mcp') return `${veces} respuestas grandes de ${nombreHerramienta(patron)}`
  if (tipo === 'subagente') return `${veces} informes largos de subagentes «${patron}»`
  if (tipo === 'busqueda') return `${veces} búsquedas grandes con ${patron}`
  return `${veces} resultados grandes de ${nombreHerramienta(patron)}`
}

function consejoDe(tipo: TipoHallazgo, ls: Llamada[]): string {
  const varias = ls.length > 1
  if (tipo === 'lectura') {
    const md = ls[0]?.ruta?.endsWith('.md') === true
    return varias
      ? 'tras editarlo no hace falta releerlo entero: lee solo el tramo que cambió'
      : md
        ? 'lee por secciones (offset/limit) o busca con Grep'
        : 'usa offset/limit o Grep'
  }
  if (tipo === 'bash') return `filtra la salida (head, grep, --quiet, formatos cortos)${varias ? ' y deja la forma corta en CLAUDE.md' : ''}`
  if (tipo === 'mcp') return 'pide menos resultados o solo los campos necesarios'
  if (tipo === 'subagente') return `pídele solo la conclusión, con una extensión máxima${varias ? ', en la definición del agente' : ''}`
  if (tipo === 'busqueda') {
    const a = ls.map(argumentos)
    if (ls.some((l, i) => l.herramienta === 'Grep' && a[i]?.output_mode === 'content' && a[i]?.head_limit === undefined)) {
      return 'usa files_with_matches o count, o pon head_limit; el contenido solo de lo que vayas a leer'
    }
    if (ls.every(l => l.herramienta === 'Glob')) return 'acota el patrón o la carpeta del Glob'
    return 'acota path, glob o type de la búsqueda'
  }
  return 'acota la búsqueda o la consulta'
}

function agrupados(lista: Llamada[], cfg: Config, releidas: Set<string>, repetidos: Set<string>): Hallazgo[] {
  const grupos = new Map<string, Grupo>()
  for (const l of lista) {
    if (repetidos.has(l.id)) continue
    const c = clasificar(l, cfg, releidas)
    if (c === null) continue
    const clave = `${c.tipo}:${c.patron}`
    const g: Grupo = grupos.get(clave) ?? { ...c, ls: [] }
    g.ls.push(l)
    grupos.set(clave, g)
  }
  return [...grupos.entries()].map(([clave, { tipo, patron, ls }]) => {
    const mayor = ls.reduce((a, b) => (b.tokens > a.tokens ? b : a))
    const suma = ls.reduce((s, l) => s + l.tokens, 0)
    const varias = ls.length > 1
    const ruta = tipo === 'lectura' ? mayor.ruta : undefined
    return {
      clave,
      tipo,
      gravedad: mayor.tokens >= cfg.golpe || ls.length >= 3 ? 'alta' : 'media',
      texto: varias ? textoVarios(tipo, patron, ls.length) : textoUno(tipo, mayor),
      consejo: consejoDe(tipo, ls),
      tokens: suma,
      veces: ls.length,
      ruta,
      herramienta: mayor.herramienta,
      muestra: mayor.muestra,
      pruebas: [
        ...(ruta === undefined ? [] : [`Fichero: ${ruta}`]),
        ...(varias ? [`${ls.length} llamadas con el mismo patrón («${patron}») que suman ≈${k(suma)} tokens`] : []),
        ...ls.slice(-6).flatMap(pruebasDe),
        ...(tipo === 'lectura' ? ['Leído sin offset ni limit'] : []),
      ],
    } satisfies Hallazgo
  })
}

// ── Exploración en la conversación principal ────────────────────────────────

function exploracion(lista: Llamada[], cfg: Config, turnos: Turno[]): Hallazgo | null {
  const porTurno = new Map<number, Llamada[]>()
  for (const l of lista) {
    if (l.turno === undefined || familia(l.herramienta).nombre !== 'Lecturas') continue
    porTurno.set(l.turno, [...(porTurno.get(l.turno) ?? []), l])
  }
  const casos = [...porTurno.entries()]
    .map(([turno, ls]) => ({
      turno,
      ls,
      ficheros: new Set(ls.filter(l => l.ruta !== undefined).map(l => l.ruta)).size,
      suma: ls.reduce((s, l) => s + l.tokens, 0),
    }))
    .filter(c => c.ls.length >= EXPLORACION.llamadas && c.ficheros >= EXPLORACION.ficheros && c.suma >= cfg.lectura * 2)
  if (casos.length === 0) return null
  const pesados = new Map<string, number>()
  for (const l of casos.flatMap(c => c.ls)) {
    const nombre = l.ruta === undefined ? `${l.herramienta} ${l.etiqueta}` : corta(l.ruta)
    pesados.set(nombre, (pesados.get(nombre) ?? 0) + l.tokens)
  }
  const [uno] = casos
  return {
    clave: 'exploracion',
    tipo: 'exploracion',
    gravedad: casos.some(c => c.suma >= cfg.golpe) ? 'alta' : 'media',
    texto:
      casos.length === 1 && uno !== undefined
        ? `Exploración de ${uno.ficheros} ficheros en el turno ${uno.turno}`
        : `${casos.length} turnos de exploración en la conversación principal`,
    consejo: 'delega la exploración en un subagente (Explore) que devuelva solo la conclusión',
    tokens: casos.reduce((s, c) => s + c.suma, 0),
    veces: casos.length,
    pruebas: [
      ...casos.map(c => {
        const prompt = turnos.find(t => t.n === c.turno)?.prompt
        const de = prompt === undefined || prompt === '' ? '' : ` («${prompt.slice(0, 80)}»)`
        return `Turno ${c.turno}${de}: ${c.ls.length} lecturas y búsquedas sobre ${c.ficheros} ficheros, ≈${k(c.suma)} tokens`
      }),
      `Lo que más pesó: ${[...pesados.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([n, t]) => `${n} ≈${k(t)}`)
        .join(', ')}`,
    ],
  }
}

// ── Caché invalidada ─────────────────────────────────────────────────────────

function cache(roturas: Rotura[], cfg: Config): Hallazgo | null {
  if (roturas.length === 0) return null
  const modelo = roturas.filter(r => r.modeloAntes !== undefined && r.modelo !== undefined && r.modeloAntes !== r.modelo)
  const pausa = roturas.filter(r => (r.pausa ?? 0) >= PAUSA_CACHE)
  const suma = roturas.reduce((s, r) => s + r.reescritos, 0)
  const consejo =
    modelo.length > 0
      ? 'no cambies de modelo a mitad de la conversación: cada modelo tiene su propia caché'
      : pausa.length > 0
        ? 'la caché caduca tras una pausa: retoma antes o compacta al volver'
        : 'no cambies CLAUDE.md, servidores MCP ni ajustes a mitad de la conversación'
  return {
    clave: 'cache',
    tipo: 'cache',
    gravedad: roturas.length >= 2 || suma >= cfg.golpe * 2 ? 'alta' : 'media',
    texto: roturas.length === 1 ? 'La caché se invalidó' : `La caché se invalidó ${roturas.length} veces`,
    consejo,
    tokens: suma,
    veces: roturas.length,
    pruebas: [
      ...roturas.map(r => {
        const motivos = [
          ...(r.pausa === undefined ? [] : [`${minutos(r.pausa)} desde la respuesta anterior`]),
          ...(r.modeloAntes !== undefined && r.modelo !== undefined && r.modeloAntes !== r.modelo
            ? [`cambio de modelo ${r.modeloAntes} → ${r.modelo}`]
            : r.modelo === undefined
              ? []
              : [`mismo modelo (${r.modelo})`]),
        ]
        return `Turno ${r.turno}: caché del ${r.antes} % al ${r.despues} %, ≈${k(r.reescritos)} tokens reescritos${motivos.length === 0 ? '' : ` · ${motivos.join(' · ')}`}`
      }),
      `Causa probable: ${
        modelo.length > 0
          ? 'cambio de modelo'
          : pausa.length > 0
            ? `pausa de ${PAUSA_CACHE / 60_000} min o más (la caché dura 5 min, o 1 h según la cuenta)`
            : 'cambió el principio de la petición (instrucciones, memoria, herramientas o MCP)'
      }`,
    ],
  }
}

// ── Subagentes que llenan su ventana ────────────────────────────────────────

function subagentesLlenos(agentes: Subagente[], ventana: number | undefined, cfg: Config): Hallazgo[] {
  if (ventana === undefined || ventana <= 0) return []
  const porTipo = new Map<string, Subagente[]>()
  for (const a of agentes) {
    if (a.pico < ventana * SUBAGENTE_LLENO) continue
    porTipo.set(a.tipo, [...(porTipo.get(a.tipo) ?? []), a])
  }
  return [...porTipo.entries()].map(([tipo, as]) => {
    const pico = Math.max(...as.map(a => a.pico))
    return {
      clave: `subagente-lleno:${tipo}`,
      tipo: 'subagente-lleno',
      gravedad: pico >= ventana * (cfg.critico / 100) ? 'alta' : 'media',
      texto: `Subagente «${tipo}» al ${pct(pico, ventana)} de su ventana`,
      consejo: 'divide su encargo o pídele que lea menos (Grep, offset/limit) y devuelva solo la conclusión',
      tokens: pico,
      veces: as.length,
      pruebas: [
        ...as.map(
          a => `«${a.descripcion}»: pico ≈${k(a.pico)} (${pct(a.pico, ventana)}) en ${a.pasos} peticiones${a.activo ? ' · sigue activo' : ''}`,
        ),
        `Ventana supuesta: la de la conversación principal (≈${k(ventana)})`,
      ],
    } satisfies Hallazgo
  })
}

// ── Turnos que disparan el contexto ─────────────────────────────────────────

function ritmo(turnos: Turno[], lista: Llamada[], f: Foto | null, t: Total | null, ventana: number | undefined): Hallazgo | null {
  if (ventana === undefined || ventana <= 0) return null
  const grandes = turnos.filter(x => x.delta >= ventana * TURNO_GRANDE).sort((a, b) => b.delta - a.delta)
  if (grandes.length === 0) return null
  const { media, turnosRestantes } = tendencia(turnos, f, t)
  const [uno] = grandes
  return {
    clave: 'ritmo',
    tipo: 'ritmo',
    gravedad: (turnosRestantes !== null && turnosRestantes <= 3) || grandes.some(x => x.delta >= ventana * 0.25) ? 'alta' : 'media',
    texto:
      grandes.length === 1 && uno !== undefined
        ? `El turno ${uno.n} añadió ≈${k(uno.delta)} (${pct(uno.delta, ventana)})`
        : `${grandes.length} turnos añadieron más del ${TURNO_GRANDE * 100} % de la ventana`,
    consejo: 'parte la tarea en turnos más pequeños o compacta antes de empezar algo grande',
    tokens: grandes.reduce((s, x) => s + x.delta, 0),
    veces: grandes.length,
    pruebas: [
      ...grandes.slice(0, 5).flatMap(x => {
        const de = x.prompt === '' ? '' : ` («${x.prompt.slice(0, 80)}»)`
        const pesadas = lista
          .filter(l => l.turno === x.n)
          .sort((a, b) => b.tokens - a.tokens)
          .slice(0, 3)
          .map(l => `${nombreHerramienta(l.herramienta)} ${l.etiqueta}`.trim().slice(0, 60) + ` ≈${k(l.tokens)}`)
        return [
          `Turno ${x.n}${de}: +≈${k(x.delta)} (${pct(x.delta, ventana)}), hasta el ${x.porcentaje} %`,
          ...(pesadas.length === 0 ? [] : [`  Lo que más pesó en él: ${pesadas.join(', ')}`]),
        ]
      }),
      ...(media === null
        ? []
        : [`Crecimiento medio ≈${k(media)} por turno${turnosRestantes === null ? '' : `; compacta en ~${turnosRestantes} turnos`}`]),
    ],
  }
}

// ── Memoria y MCP que se pagan en cada petición ─────────────────────────────

function fijos(f: Foto, cfg: Config): Hallazgo[] {
  const hallazgos: Hallazgo[] = []
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
  return hallazgos
}

// Malos usos del contexto: relecturas sin edición entre medias, llamadas
// repetidas con el mismo resultado, resultados desmesurados (agrupados por
// patrón), exploraciones en la conversación principal, cachés rotas,
// subagentes que llenan su ventana, turnos que la disparan, y memoria o MCP
// que se pagan en cada turno. Cada hallazgo lleva sus pruebas, con las que
// `informeIA` arma el encargo. Los de clave en `ignorados` no se devuelven.
export function diagnosticar(f: Foto | null, lista: Llamada[], cfg: Config, ignorados: string[], entorno: Entorno = {}): Hallazgo[] {
  const turnos = entorno.turnos ?? []
  const t = entorno.total ?? null
  const ventana = t?.ventana ?? f?.ventana
  const releidas = relecturas(lista, cfg)
  const repes = repetidas(lista, cfg)
  const hallazgos = [
    ...releidas.hallazgos,
    ...repes.hallazgos,
    ...agrupados(lista, cfg, releidas.rutas, repes.ids),
    exploracion(lista, cfg, turnos),
    cache(entorno.roturas ?? [], cfg),
    ...subagentesLlenos(entorno.subagentes ?? [], ventana, cfg),
    ritmo(turnos, lista, f, t, ventana),
    ...(f === null ? [] : fijos(f, cfg)),
  ].filter((h): h is Hallazgo => h !== null)
  return hallazgos
    .filter(x => !ignorados.includes(x.clave))
    .sort((a, b) => (a.gravedad === b.gravedad ? b.tokens - a.tokens : a.gravedad === 'alta' ? -1 : 1))
}
