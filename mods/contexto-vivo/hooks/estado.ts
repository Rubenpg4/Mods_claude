import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Aviso, Fila, Foto, Llamada, Pestana, Subagente, Total, Turno } from '../types'

// El estado que el panel y la fila de «auto mode on» leen. Cambiar la etiqueta
// `shape` de un valor si cambian sus campos: lo guardado sobrevive a la recarga.
// Todo el acceso pasa por las funciones de abajo: el validador exige que cada
// lectura y escritura esté en el mismo fichero que su átomo.
const llamadas = atom({ plugin: 'contexto-vivo', key: 'llamadas' } as const, [], {
  shape: 'llamadas-2',
})
const total = atom({ plugin: 'contexto-vivo', key: 'total' } as const, null, {
  shape: 'total-3',
})
const foto = atom({ plugin: 'contexto-vivo', key: 'foto' } as const, null, {
  shape: 'foto-3',
})
const aviso = atom(
  { plugin: 'contexto-vivo', key: 'aviso' } as const,
  { nivel: 0, desde: 0 },
  { shape: 'aviso-1' },
)
const navegacion = atom({ plugin: 'contexto-vivo', key: 'navegacion' } as const, [], {
  shape: 'navegacion-1',
})
const mensajes = atom({ plugin: 'contexto-vivo', key: 'mensajes' } as const, [], {
  shape: 'mensajes-1',
})
const pestana = atom({ plugin: 'contexto-vivo', key: 'pestana' } as const, 'reparto', {
  shape: 'pestana-1',
})
const historial = atom({ plugin: 'contexto-vivo', key: 'historial' } as const, [], {
  shape: 'historial-1',
})
const subagentes = atom({ plugin: 'contexto-vivo', key: 'subagentes' } as const, [], {
  shape: 'subagentes-1',
})
const ignorados = atom({ plugin: 'contexto-vivo', key: 'ignorados' } as const, [], {
  shape: 'ignorados-1',
})
const confirmar = atom({ plugin: 'contexto-vivo', key: 'confirmar' } as const, false, {
  shape: 'confirmar-1',
})
const conservar = atom({ plugin: 'contexto-vivo', key: 'conservar' } as const, '', {
  shape: 'conservar-1',
})
const ultimoPrompt = atom({ plugin: 'contexto-vivo', key: 'ultimoPrompt' } as const, '', {
  shape: 'prompt-1',
})

type $ = EngineInterface
type Cambio<T> = (valor: T) => T

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

export function leerNavegacion($: $) {
  return read($, navegacion)
}
export function cambiarNavegacion($: $, f: Cambio<string[]>) {
  return update($, navegacion, f)
}

export function leerMensajes($: $) {
  return read($, mensajes)
}
export function cambiarMensajes($: $, f: Cambio<Fila[]>) {
  return update($, mensajes, f)
}

export function leerPestana($: $) {
  return read($, pestana)
}
export function cambiarPestana($: $, f: Cambio<Pestana>) {
  return update($, pestana, f)
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

export function leerIgnorados($: $) {
  return read($, ignorados)
}
export function cambiarIgnorados($: $, f: Cambio<string[]>) {
  return update($, ignorados, f)
}

export function leerConfirmar($: $) {
  return read($, confirmar)
}
export function cambiarConfirmar($: $, f: Cambio<boolean>) {
  return update($, confirmar, f)
}

export function leerConservar($: $) {
  return read($, conservar)
}
export function cambiarConservar($: $, f: Cambio<string>) {
  return update($, conservar, f)
}

export function leerUltimoPrompt($: $) {
  return read($, ultimoPrompt)
}
export function cambiarUltimoPrompt($: $, f: Cambio<string>) {
  return update($, ultimoPrompt, f)
}
