import type { Arbol, Nodo, Rewind } from '../../types'

import { enLinea } from '../comun/formato'

// La forma del árbol: buscar, recorrer, fundir, marcar lo que un rewind deja
// atrás, recortar, plegar en filas y resolver un nombre. Puro: recibe un
// `Arbol` y devuelve otro; quien lo guarda es disco.ts.

// Por encima de tantos nodos se quitan los automáticos más antiguos de una
// cadena recta (su hijo pasa a colgar de su padre).
export const MAXIMO_NODOS = 400

export const VACIO: Arbol = { version: 2, siguiente: 1, nodos: [], heads: {}, titulos: {} }

// Aplica los uuid nuevos y funde los nodos que quedan en el mismo mensaje de la
// misma sesión: se queda el más antiguo; los hijos y el HEAD del fundido pasan a él.
export function fundirDuplicados(a: Arbol, cambios: Map<string, string>): Arbol {
  const conUuid = a.nodos.map(n => (cambios.has(n.id) ? { ...n, uuid: cambios.get(n.id) as string } : n))
  const porClave = new Map<string, Nodo>()
  const fundido = new Map<string, string>()
  for (const n of [...conUuid].sort((x, y) => x.creado - y.creado)) {
    const clave = `${n.sesion}\n${n.uuid}`
    const previo = porClave.get(clave)
    if (previo === undefined) porClave.set(clave, n)
    else fundido.set(n.id, previo.id)
  }
  if (fundido.size === 0) return { ...a, nodos: conUuid }
  const nodos = conUuid
    .filter(n => !fundido.has(n.id))
    .map(n => (n.padre !== null && fundido.has(n.padre) ? { ...n, padre: fundido.get(n.padre) as string } : n))
  const heads = Object.fromEntries(Object.entries(a.heads).map(([s, h]) => [s, fundido.get(h) ?? h]))
  return { ...a, nodos, heads }
}

export function buscarNodo(a: Arbol | null, id: string | null | undefined): Nodo | undefined {
  if (a === null || id == null) return undefined
  return a.nodos.find(n => n.id === id)
}

export function hijos(a: Arbol, id: string): Nodo[] {
  return a.nodos.filter(n => n.padre === id).sort((x, y) => x.creado - y.creado)
}

// Del nodo a la raíz, el propio nodo primero.
export function ancestros(a: Arbol, id: string): Nodo[] {
  const camino: Nodo[] = []
  const vistos = new Set<string>()
  let actual = buscarNodo(a, id)
  while (actual !== undefined && !vistos.has(actual.id)) {
    vistos.add(actual.id)
    camino.push(actual)
    actual = buscarNodo(a, actual.padre)
  }
  return camino
}

export function ancestroComun(a: Arbol, x: string, y: string): Nodo | undefined {
  const deY = new Set(ancestros(a, y).map(n => n.id))
  return ancestros(a, x).find(n => deY.has(n.id))
}

export function descendientes(a: Arbol, id: string): Set<string> {
  const todos = new Set([id])
  let frontera = [id]
  while (frontera.length > 0) {
    const siguiente = a.nodos.filter(n => n.padre !== null && frontera.includes(n.padre) && !todos.has(n.id))
    for (const n of siguiente) todos.add(n.id)
    frontera = siguiente.map(n => n.id)
  }
  return todos
}

// El checkpoint de que desciende una conversación: el más profundo cuya
// posición está en su cadena. Si varios apuntan al mismo mensaje, el HEAD de
// la sesión y, si no, el más reciente.
export function origenEnCadena(a: Arbol, cadena: readonly string[], head: string | null): Nodo | undefined {
  const posicion = new Map(cadena.map((u, i) => [u, i]))
  let mejor: Nodo | undefined
  let profundidad = -1
  for (const n of a.nodos) {
    const i = posicion.get(n.uuid)
    if (i === undefined) continue
    const empate = i === profundidad && mejor !== undefined
    const gana =
      i > profundidad || (empate && mejor?.id !== head && (n.id === head || n.creado > (mejor?.creado ?? 0)))
    if (gana) {
      mejor = n
      profundidad = i
    }
  }
  return mejor
}

// Un rewind nativo vuelve a un mensaje anterior de la sesión: el HEAD que
// tenía (`previo`, el del índice para esa sesión) deja de estar en su cadena.
// El camino de ese HEAD hacia atrás, hasta lo que la cadena aún tiene, queda
// fuera de la conversación: se marca `abandonado` y se apunta en `rewind`
// para avisar.
//
// Solo cuenta la cadena, no la sesión de cada checkpoint: una sesión abierta
// desde el árbol (restaurar, fork) copia los mensajes con sus uuid, y sus
// checkpoints anteriores son los de la sesión de la que salió.
//
// El motor no dice si el rewind restauró también los ficheros, así que no se
// borra nada: solo se marca. La marca es de la conversación que hizo el
// rewind: el panel no la muestra en el camino de la conversación actual, y se
// quita del camino de cualquier checkpoint al que se vuelva (`vivificar`).
export function abandonarTrasRewind(
  a: Arbol,
  sesion: string,
  previo: string | null,
  cadena: readonly string[],
): { arbol: Arbol; ids: string[] } {
  const p = buscarNodo(a, previo)
  const enCadena = new Set(cadena)
  if (p === undefined || enCadena.has(p.uuid)) return { arbol: a, ids: [] }
  const ids: string[] = []
  for (const n of ancestros(a, p.id)) {
    if (enCadena.has(n.uuid)) break
    ids.push(n.id)
  }
  if (ids.length === 0) return { arbol: a, ids }
  const fuera = new Set(ids)
  // Dos rewinds seguidos en la misma sesión sin responder al aviso: se suman.
  const antes = a.rewind?.sesion === sesion ? a.rewind.ids.filter(id => !fuera.has(id) && buscarNodo(a, id) !== undefined) : []
  return {
    arbol: {
      ...a,
      nodos: a.nodos.map(n => (fuera.has(n.id) ? { ...n, abandonado: true } : n)),
      rewind: { sesion, ids: [...antes, ...ids] },
    },
    ids,
  }
}

// Quita la marca de abandonado del camino de `id`: se ha vuelto a él.
export function vivificar(a: Arbol, id: string | null | undefined): Arbol {
  if (id == null) return a
  const camino = new Set(ancestros(a, id).filter(n => n.abandonado === true).map(n => n.id))
  if (camino.size === 0) return a
  return {
    ...a,
    nodos: a.nodos.map(n => {
      if (!camino.has(n.id)) return n
      const { abandonado: _fuera, ...resto } = n
      return resto
    }),
  }
}

// Lo que «Borrar» del aviso de rewind se lleva de `ids`: los checkpoints
// automáticos que no son el HEAD de ninguna sesión y de los que no cuelga nada
// que se quede (un nombrado, otra rama). Así ningún checkpoint que siga en el
// árbol pierde a su padre.
export function borrables(a: Arbol, ids: readonly string[]): Set<string> {
  const fijos = new Set(Object.values(a.heads))
  const fuera = new Set(
    ids.filter(id => {
      const n = buscarNodo(a, id)
      return n !== undefined && n.nombre === undefined && !fijos.has(id)
    }),
  )
  for (let cambio = true; cambio; ) {
    cambio = false
    for (const id of [...fuera]) {
      if (hijos(a, id).some(h => !fuera.has(h.id))) {
        fuera.delete(id)
        cambio = true
      }
    }
  }
  return fuera
}

// El aviso de rewind de `sesion`, sin los checkpoints que ya no existen o a los
// que se ha vuelto.
export function rewindDe(a: Arbol | null, sesion: string): Rewind | undefined {
  if (a?.rewind === undefined || a.rewind.sesion !== sesion) return undefined
  const ids = a.rewind.ids.filter(id => buscarNodo(a, id)?.abandonado === true)
  return ids.length === 0 ? undefined : { sesion, ids }
}

export function turnos(n: number): string {
  return `${n} turno${n === 1 ? '' : 's'}`
}

// Limpia también lo guardado por versiones anteriores, que no lo hacían.
export function etiquetaNodo(n: Pick<Nodo, 'nombre' | 'prompt' | 'turnos'>): string {
  if (n.nombre !== undefined) return enLinea(n.nombre)
  const prompt = enLinea(n.prompt)
  return prompt === '' ? `turno ${n.turnos}` : `«${prompt}»`
}

// Una fila del árbol dibujado: el nodo, las guías a su izquierda y cuántos
// checkpoints automáticos de una cadena recta se pliegan justo antes de él.
export type FilaArbol = { nodo: Nodo; guia: string; plegados: number }

// El árbol en filas, raíces por orden de creación. Sin `todo`, una cadena de
// checkpoints automáticos sin ramas se pliega en su último nodo: solo se ven
// las raíces, los nombrados, las bifurcaciones, las hojas, el HEAD y la
// selección.
export function filasArbol(a: Arbol, head: string | null, seleccion: string | null, todo: boolean): FilaArbol[] {
  const ids = new Set(a.nodos.map(n => n.id))
  const porPadre = new Map<string, Nodo[]>()
  for (const n of a.nodos) {
    if (n.padre === null || !ids.has(n.padre)) continue
    porPadre.set(n.padre, [...(porPadre.get(n.padre) ?? []), n])
  }
  for (const lista of porPadre.values()) lista.sort((x, y) => x.creado - y.creado)
  const deNodo = (id: string) => porPadre.get(id) ?? []
  // El camino de la conversación actual (y de la selección) se ve entero: si
  // un turno atrás quedara plegado, no habría forma de elegirlo ni volver a él.
  const camino = new Set(
    [...(head === null ? [] : ancestros(a, head)), ...(seleccion === null ? [] : ancestros(a, seleccion))].map(n => n.id),
  )
  const visible = (n: Nodo) =>
    todo || camino.has(n.id) || n.nombre !== undefined || n.id === head || n.id === seleccion || deNodo(n.id).length !== 1

  const filas: FilaArbol[] = []
  const recorrer = (n: Nodo, plegados: number, guia: string, rama: string) => {
    filas.push({ nodo: n, guia: guia + rama, plegados })
    const resto = guia + (rama === '├─ ' ? '│  ' : rama === '└─ ' ? '   ' : '')
    const visibles = deNodo(n.id).map(h => {
      let actual = h
      let saltados = 0
      while (!visible(actual)) {
        saltados++
        actual = deNodo(actual.id)[0] as Nodo
      }
      return { nodo: actual, saltados }
    })
    // Una sola continuación sigue en la misma columna; varias se abren en rama.
    if (visibles.length === 1) {
      const [unico] = visibles
      if (unico !== undefined) recorrer(unico.nodo, unico.saltados, resto, '')
      return
    }
    visibles.forEach((v, i) => recorrer(v.nodo, v.saltados, resto, i === visibles.length - 1 ? '└─ ' : '├─ '))
  }
  const raices = a.nodos.filter(n => n.padre === null || !ids.has(n.padre)).sort((x, y) => x.creado - y.creado)
  for (const r of raices) recorrer(r, 0, '', '')
  return filas
}

// El nodo que nombra lo escrito tras /cp-ir: su id, su nombre exacto o el
// comienzo de un nombre o prompt (el más reciente).
export function resolver(a: Arbol, texto: string): Nodo | undefined {
  const t = texto.trim().toLowerCase()
  if (t === '') return undefined
  const recientes = [...a.nodos].sort((x, y) => y.creado - x.creado)
  return (
    recientes.find(n => n.id.toLowerCase() === t) ??
    recientes.find(n => n.nombre?.toLowerCase() === t) ??
    recientes.find(n => n.nombre?.toLowerCase().startsWith(t) === true) ??
    recientes.find(n => n.prompt.toLowerCase().includes(t))
  )
}

// Quita los checkpoints automáticos más antiguos de una cadena recta hasta
// volver a `MAXIMO_NODOS`: su hijo pasa a colgar de su padre. Los nombrados,
// las bifurcaciones y los HEAD no se tocan. Nada que borrar en disco: un
// checkpoint es solo un puntero.
export function recortar(a: Arbol): Arbol {
  let arbol = a
  const fijos = new Set(Object.values(a.heads))
  while (arbol.nodos.length > MAXIMO_NODOS) {
    const candidato = [...arbol.nodos]
      .sort((x, y) => x.creado - y.creado)
      .find(n => n.nombre === undefined && !fijos.has(n.id) && hijos(arbol, n.id).length === 1)
    if (candidato === undefined) break
    arbol = {
      ...arbol,
      nodos: arbol.nodos
        .filter(n => n.id !== candidato.id)
        .map(n => (n.padre === candidato.id ? { ...n, padre: candidato.padre } : n)),
    }
  }
  return arbol
}

// Lo que `borrando` guarda mientras se confirma limpiar el árbol entero (los
// ids de los nodos son `n<número>`, así que no choca con ninguno).
export const TODO_EL_ARBOL = '*'

// Un checkpoint de turno 0 sin nombre: una conversación sin ningún prompt.
// Las versiones anteriores los guardaban (al restaurar o hacer fork desde una
// conversación recién limpiada); al cargar el árbol se quitan: sus hijos pasan
// a su padre y la sesión que estaba en él se queda sin HEAD.
export function sinVacios(a: Arbol): Arbol {
  const vacios = new Map(a.nodos.filter(n => n.turnos === 0 && n.nombre === undefined).map(n => [n.id, n.padre]))
  if (vacios.size === 0) return a
  const subir = (id: string | null): string | null => {
    let actual = id
    while (actual !== null && vacios.has(actual)) actual = vacios.get(actual) ?? null
    return actual
  }
  const nodos = a.nodos.filter(n => !vacios.has(n.id)).map(n => (n.padre !== null && vacios.has(n.padre) ? { ...n, padre: subir(n.padre) } : n))
  const heads = Object.fromEntries(Object.entries(a.heads).filter(([, h]) => !vacios.has(h)))
  return sinRewindVacio({ ...a, nodos, heads })
}

// Quita el aviso de rewind si ya no le queda ningún checkpoint.
export function sinRewindVacio(a: Arbol): Arbol {
  if (a.rewind === undefined) return a
  const ids = a.rewind.ids.filter(id => buscarNodo(a, id) !== undefined)
  if (ids.length > 0) return { ...a, rewind: { ...a.rewind, ids } }
  const { rewind: _fuera, ...resto } = a
  return resto
}
