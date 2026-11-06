import type { Config } from '../config'

// Colores del mod (0xRRGGBB): paleta de categorías y familias de herramienta,
// niveles de aviso, mezcla de colores y tinta legible sobre un fondo. Puro.

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
export const TONOS = [0x0a84ff, 0x30d158, 0xff9f0a, 0xbf5af2, 0xff453a, 0x64d2ff, 0xffd60a, 0xff6482, 0x66d4cf]

export function css(rgb: number): string {
  return `#${rgb.toString(16).padStart(6, '0')}`
}

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
