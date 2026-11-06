import type { Entrada, Fila, Foto, Llamada, Quesito } from '../../types'

import { familia, GRIS, PALETA, TONOS } from '../comun/colores'
import { corta, nombreHerramienta } from '../comun/formato'

// El reparto de lo usado: las categorías de /context, «Mensajes» desglosado por
// familia de herramienta y cada nivel navegable del anillo del panel. Puro.

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

// Categorías que Claude Code no desglosa por elemento.
export const SIN_DETALLE = new Set(['Prompt de sistema', 'Herramientas'])

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
