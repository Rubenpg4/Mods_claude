import type { EngineInterface, SessionRateLimit } from 'claude-code'

import type { Limite } from '../../types'

import { cambiarAhora, cambiarLimites, leerAhora, leerLimites } from '../estado/contexto'

// Ventanas de uso de la cuenta (5h, 7d, gasto): lo que informa el motor, la
// última lectura guardada y el cálculo del ritmo y la cuenta atrás.
//
// El motor solo las conoce tras una respuesta de la API: al abrir claude no hay
// ninguna. La última lectura se guarda en `$.store` y se carga al empezar, así
// la fila y el panel las muestran desde el primer minuto; la primera respuesta
// las renueva. Una ventana cuyo reinicio ya pasó se ve vacía (`ventanas`).

export const VENTANAS: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'gasto' }

const HORA = 3_600_000
export const DIA = 24 * HORA
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

const CLAVE_LIMITES = 'limites'

// La hora que leen el panel y la fila para la cuenta atrás de 5h/7d.
export async function marcarHora($: EngineInterface): Promise<void> {
  const ahora = await $.clock.now()
  await cambiarAhora($, () => ahora)
}

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
