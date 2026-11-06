import type { Foto, Total, Turno } from '../../types'

// Tendencia: crecimiento medio por turno y turnos que quedan hasta compactar. Puro.

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
