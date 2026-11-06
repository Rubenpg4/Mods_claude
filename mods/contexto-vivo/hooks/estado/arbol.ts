import { atom, type EngineInterface, read, update } from 'claude-code'

import type { Arbol, Consulta } from '../../types'

// Estado del árbol de checkpoints en la interfaz: el índice, el HEAD, la
// selección, «ver todo» y las operaciones en curso (borrar, restaurar, consulta).
//
// Mismas reglas que estado/contexto.ts: cada átomo con sus `leer…`/`cambiar…`
// en este fichero (lo exige el validador) y una etiqueta `shape` nueva si cambian
// sus campos.

type $ = EngineInterface
type Cambio<T> = (valor: T) => T

const arbol = atom({ plugin: 'contexto-vivo', key: 'arbol' } as const, null, {
  // -3: los nodos abandonados por un rewind y el aviso pendiente.
  shape: 'arbol-3',
})
const head = atom({ plugin: 'contexto-vivo', key: 'head' } as const, null, {
  shape: 'head-2',
})
const seleccion = atom({ plugin: 'contexto-vivo', key: 'seleccion' } as const, null, {
  shape: 'seleccion-1',
})
const verTodo = atom({ plugin: 'contexto-vivo', key: 'verTodo' } as const, false, {
  shape: 'verTodo-1',
})
const borrando = atom({ plugin: 'contexto-vivo', key: 'borrando' } as const, null, {
  shape: 'borrando-1',
})
const restaurando = atom({ plugin: 'contexto-vivo', key: 'restaurando' } as const, null, {
  shape: 'restaurando-1',
})
const ocupado = atom({ plugin: 'contexto-vivo', key: 'ocupado' } as const, null, {
  shape: 'ocupado-1',
})
const consulta = atom({ plugin: 'contexto-vivo', key: 'consulta' } as const, null, {
  // -2: la -1 podía guardar texto con secuencias de escape que el panel rechaza.
  shape: 'consulta-2',
})

export function leerArbol($: $) {
  return read($, arbol)
}
export function cambiarArbol($: $, f: Cambio<Arbol | null>) {
  return update($, arbol, f)
}

export function leerHead($: $) {
  return read($, head)
}
export function cambiarHead($: $, f: Cambio<string | null>) {
  return update($, head, f)
}

export function leerSeleccion($: $) {
  return read($, seleccion)
}
export function cambiarSeleccion($: $, f: Cambio<string | null>) {
  return update($, seleccion, f)
}

export function leerVerTodo($: $) {
  return read($, verTodo)
}
export function cambiarVerTodo($: $, f: Cambio<boolean>) {
  return update($, verTodo, f)
}

export function leerBorrando($: $) {
  return read($, borrando)
}
export function cambiarBorrando($: $, f: Cambio<string | null>) {
  return update($, borrando, f)
}

export function leerRestaurando($: $) {
  return read($, restaurando)
}
export function cambiarRestaurando($: $, f: Cambio<string | null>) {
  return update($, restaurando, f)
}

export function leerOcupado($: $) {
  return read($, ocupado)
}
export function cambiarOcupado($: $, f: Cambio<string | null>) {
  return update($, ocupado, f)
}

export function leerConsulta($: $) {
  return read($, consulta)
}
export function cambiarConsulta($: $, f: Cambio<Consulta | null>) {
  return update($, consulta, f)
}
