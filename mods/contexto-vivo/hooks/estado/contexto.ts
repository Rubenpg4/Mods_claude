import { atom, type EngineInterface, read, update } from 'claude-code'

import type { Aviso, Foto, Limite, Llamada, Rotura, Seguimiento, Subagente, Total, Turno } from '../../types'

// Estado de la medición: llamadas, cifra total, límites de uso, foto de
// /context, aviso de umbral, turnos, subagentes, hallazgos ignorados, último
// prompt y hora del tic.

type $ = EngineInterface
type Cambio<T> = (valor: T) => T

// El estado que el panel y la fila de «auto mode on» leen. Cambiar la etiqueta
// `shape` de un valor si cambian sus campos: lo guardado sobrevive a la recarga.
// Todo el acceso pasa por las funciones de abajo: el validador exige que cada
// lectura y escritura esté en el mismo fichero que su átomo.
const llamadas = atom({ plugin: 'contexto-vivo', key: 'llamadas' } as const, [], {
  // -3: turno, hora y líneas pedidas (desde/cuantas) de cada llamada.
  shape: 'llamadas-3',
})
const total = atom({ plugin: 'contexto-vivo', key: 'total' } as const, null, {
  // -5: los límites de uso pasan a su propio valor.
  shape: 'total-5',
})
const limites = atom({ plugin: 'contexto-vivo', key: 'limites' } as const, [], {
  shape: 'limites-1',
})
const foto = atom({ plugin: 'contexto-vivo', key: 'foto' } as const, null, {
  shape: 'foto-3',
})
const aviso = atom(
  { plugin: 'contexto-vivo', key: 'aviso' } as const,
  { nivel: 0, desde: 0 },
  { shape: 'aviso-1' },
)

const historial = atom({ plugin: 'contexto-vivo', key: 'historial' } as const, [], {
  shape: 'historial-1',
})
const subagentes = atom({ plugin: 'contexto-vivo', key: 'subagentes' } as const, [], {
  shape: 'subagentes-1',
})
const roturas = atom({ plugin: 'contexto-vivo', key: 'roturas' } as const, [], {
  shape: 'roturas-1',
})
const ignorados = atom({ plugin: 'contexto-vivo', key: 'ignorados' } as const, [], {
  shape: 'ignorados-1',
})
const seguimiento = atom({ plugin: 'contexto-vivo', key: 'seguimiento' } as const, [], {
  shape: 'seguimiento-1',
})

const ultimoPrompt = atom({ plugin: 'contexto-vivo', key: 'ultimoPrompt' } as const, '', {
  shape: 'prompt-1',
})
const ahora = atom({ plugin: 'contexto-vivo', key: 'ahora' } as const, 0, {
  shape: 'ahora-1',
})

// `leer…` suscribe al dibujo que lo llama; `cambiar…` lee, aplica y escribe con
// control de versión (dos cambios seguidos no se pisan). Son funciones con
// nombre porque el validador solo sigue `$` hasta funciones así.
export function leerLlamadas($: $) {
  return read($, llamadas)
}
export function cambiarLlamadas($: $, f: Cambio<Llamada[]>) {
  return update($, llamadas, f)
}

export function leerTotal($: $) {
  return read($, total)
}

export function leerLimites($: $) {
  return read($, limites)
}
export function cambiarLimites($: $, f: Cambio<Limite[]>) {
  return update($, limites, f)
}

export function leerAhora($: $) {
  return read($, ahora)
}
export function cambiarAhora($: $, f: Cambio<number>) {
  return update($, ahora, f)
}
export function cambiarTotal($: $, f: Cambio<Total | null>) {
  return update($, total, f)
}

export function leerFoto($: $) {
  return read($, foto)
}
export function cambiarFoto($: $, f: Cambio<Foto | null>) {
  return update($, foto, f)
}

export function leerAviso($: $) {
  return read($, aviso)
}
export function cambiarAviso($: $, f: Cambio<Aviso>) {
  return update($, aviso, f)
}

export function leerHistorial($: $) {
  return read($, historial)
}
export function cambiarHistorial($: $, f: Cambio<Turno[]>) {
  return update($, historial, f)
}

export function leerSubagentes($: $) {
  return read($, subagentes)
}
export function cambiarSubagentes($: $, f: Cambio<Subagente[]>) {
  return update($, subagentes, f)
}

export function leerRoturas($: $) {
  return read($, roturas)
}
export function cambiarRoturas($: $, f: Cambio<Rotura[]>) {
  return update($, roturas, f)
}

export function leerIgnorados($: $) {
  return read($, ignorados)
}
export function cambiarIgnorados($: $, f: Cambio<string[]>) {
  return update($, ignorados, f)
}

export function leerSeguimiento($: $) {
  return read($, seguimiento)
}
export function cambiarSeguimiento($: $, f: Cambio<Seguimiento[]>) {
  return update($, seguimiento, f)
}

export function leerUltimoPrompt($: $) {
  return read($, ultimoPrompt)
}
export function cambiarUltimoPrompt($: $, f: Cambio<string>) {
  return update($, ultimoPrompt, f)
}
