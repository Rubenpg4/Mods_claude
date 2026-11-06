import { atom, type EngineInterface, read, update } from 'claude-code'

import type { Fila, Pestana } from '../../types'

// Estado de la interfaz del panel: pestaña activa, navegación del reparto,
// mensajes más largos y la confirmación de compactar.
//
// Mismas reglas que estado/contexto.ts: cada átomo con sus `leer…`/`cambiar…`
// en este fichero (lo exige el validador) y una etiqueta `shape` nueva si cambian
// sus campos.

type $ = EngineInterface
type Cambio<T> = (valor: T) => T

const navegacion = atom({ plugin: 'contexto-vivo', key: 'navegacion' } as const, [], {
  shape: 'navegacion-1',
})
const mensajes = atom({ plugin: 'contexto-vivo', key: 'mensajes' } as const, [], {
  shape: 'mensajes-1',
})
const pestana = atom({ plugin: 'contexto-vivo', key: 'pestana' } as const, 'reparto', {
  shape: 'pestana-1',
})

const confirmar = atom({ plugin: 'contexto-vivo', key: 'confirmar' } as const, false, {
  shape: 'confirmar-1',
})
const conservar = atom({ plugin: 'contexto-vivo', key: 'conservar' } as const, '', {
  shape: 'conservar-1',
})

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

// El id del panel del mod.
export const PANEL = 'contexto-vivo'

export function leerPestana($: $) {
  return read($, pestana)
}
export function cambiarPestana($: $, f: Cambio<Pestana>) {
  return update($, pestana, f)
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
