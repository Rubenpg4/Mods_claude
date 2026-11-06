import type { Nivel } from '../../types'

import { mezcla } from '../comun/colores'

// Los modelos y niveles de esfuerzo que ofrece el selector, y sus colores. Puro.

export type Modelo = { id: string; nombre: string; familia: string; nota: string; rgb: number; tecla: string }

export const MODELOS: Modelo[] = [
  { id: 'claude-fable-5-1', nombre: 'Fable 5.1', familia: 'fable', nota: 'el más capaz', rgb: 0xbf5af2, tecla: '1' },
  { id: 'claude-opus-5-5', nombre: 'Opus 5.5', familia: 'opus', nota: 'potente', rgb: 0xd97757, tecla: '2' },
  { id: 'claude-sonnet-5-5', nombre: 'Sonnet 5.5', familia: 'sonnet', nota: 'equilibrado', rgb: 0x0a84ff, tecla: '3' },
  { id: 'claude-haiku-5-5', nombre: 'Haiku 5.5', familia: 'haiku', nota: 'rápido', rgb: 0x30d158, tecla: '4' },
]

// De menos a más: el orden de los tramos de la barra del esfuerzo.
export const NIVELES: { id: Nivel }[] = [{ id: 'low' }, { id: 'medium' }, { id: 'high' }, { id: 'xhigh' }, { id: 'max' }]

export const NEUTRO = 0x8e8e93
// El gris del que parte el degradado del esfuerzo, y cuánto color lleva cada
// nivel: low apenas tiñe, max es el color pleno del modelo.
const BASE_ESFUERZO = 0x48484a
const INTENSIDAD = [0.42, 0.58, 0.72, 0.86, 1]
// Ancho de cada tramo de la barra del esfuerzo: «medium» y un espacio a cada lado.
const TRAMO = 8

// El modelo conocido que nombra un id o alias (`claude-opus-5-5[1m]`, `opus`).
export function modeloDe(texto: string | null): Modelo | undefined {
  if (texto === null) return undefined
  const t = texto.toLowerCase()
  return MODELOS.find(m => t.includes(m.familia))
}

export function esNivel(x: unknown): x is Nivel {
  return NIVELES.some(n => n.id === x)
}

// El color de un tramo de la barra del esfuerzo: más intenso cuanto más alto.
export function colorEsfuerzo(i: number, rgb: number): number {
  return mezcla(BASE_ESFUERZO, rgb, INTENSIDAD[Math.max(0, Math.min(INTENSIDAD.length - 1, i))] ?? 1)
}

// Hasta qué tramo está llena la barra (-1: el esfuerzo por defecto).
export function posicionEsfuerzo(nivel: string | null): number {
  return NIVELES.findIndex(n => n.id === nivel)
}

// La etiqueta de un tramo, centrada en su ancho para que la barra no se mueva.
export function etiquetaTramo(nivel: Nivel): string {
  const hueco = TRAMO - nivel.length
  return ' '.repeat(Math.floor(hueco / 2)) + nivel + ' '.repeat(Math.ceil(hueco / 2))
}
