import { atom, type EngineInterface, read, update } from 'claude-code'

import type { Aplicado, Selector } from '../../types'

// Estado del selector: lo pulsado a mitad de turno y el modelo y esfuerzo
// aplicados.
//
// Mismas reglas que estado/contexto.ts: cada átomo con sus `leer…`/`cambiar…`
// en este fichero (lo exige el validador) y una etiqueta `shape` nueva si cambian
// sus campos.

type $ = EngineInterface
type Cambio<T> = (valor: T) => T

const selector = atom(
  { plugin: 'contexto-vivo', key: 'selector' } as const,
  { desplegado: false, modelo: null, esfuerzo: null } as Selector,
  // -5: `esfuerzo` vuelve a ser solo lo pulsado a mitad de turno.
  { shape: 'selector-5' },
)
const aplicado = atom(
  { plugin: 'contexto-vivo', key: 'aplicado' } as const,
  { modelo: null, esfuerzo: null } as Aplicado,
  { shape: 'aplicado-1' },
)

export function leerSelector($: $) {
  return read($, selector)
}
export function cambiarSelector($: $, f: Cambio<Selector>) {
  return update($, selector, f)
}

export function leerAplicado($: $) {
  return read($, aplicado)
}
export function cambiarAplicado($: $, f: Cambio<Aplicado>) {
  return update($, aplicado, f)
}
