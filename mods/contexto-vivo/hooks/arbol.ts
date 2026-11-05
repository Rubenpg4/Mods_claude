import type { EngineInterface } from 'claude-code'

import type { Arbol, Hallado, Nodo, Paso } from '../types'
import { fotografiar, marcarCompactado, olvidarConversacion } from './acciones'
import { CARACTERES_POR_TOKEN, enLinea, k } from './calculo'

export { enLinea }
import {
  cambiarArbol,
  cambiarBorrando,
  cambiarConsulta,
  cambiarHead,
  cambiarOcupado,
  cambiarPestana,
  cambiarSeleccion,
  leerHead,
  leerTotal,
  PANEL,
} from './estado'

// El árbol de checkpoints de la conversación, con la lógica de rewind.
//
// El motor guarda cada sesión en un transcript (`<sesión>.jsonl`) donde cada
// mensaje apunta a su anterior: la conversación es la cadena que sube desde el
// último. Un checkpoint es solo un puntero a un mensaje de esa cadena
// (`sesion` + `uuid`); no copia nada.
//
// Restaurar un checkpoint, o hacerle un fork, es lo que hace /branch: escribir
// una sesión nueva con la cadena hasta ese mensaje y abrirla con /resume. El
// modelo ve los mensajes de verdad, como tras un rewind: sin /clear, sin una
// transcripción pegada y sin compactar. La sesión de la que se viene no se
// toca y sigue en el árbol.
//
// Como las ramas comparten los uuid de sus mensajes comunes, el padre de un
// checkpoint nuevo es el checkpoint más profundo que está en su cadena: el
// árbol sale de la historia real, también tras un rewind nativo.
//
// Leer y bifurcar transcripts lo hace `scripts/transcript.cjs` con node: pasan
// con facilidad de los 4 MiB que `$.fs.read` deja leer. El índice vive en
// `~/.claude/contexto-vivo/ramas/<proyecto>/indice.json`.

type $ = EngineInterface

// Un mensaje de la conversación de un checkpoint, como lo da el ayudante.
export type Guardado = {
  role: 'user' | 'assistant'
  text: string
  toolUses: { tool_use_id: string; tool: string; input: Record<string, unknown>; text?: string; isError?: true }[]
  toolResults?: { tool_use_id: string; text: string; isError: boolean }[]
  uuid?: string
}

// Lo que el ayudante sabe de la sesión actual: el último mensaje, la cadena
// hasta él y sus cifras.
type EstadoSesion = {
  uuid: string | null
  cadena: string[]
  mensajes: number
  turnos: number
  prompt: string
  ultimo: string
}

// Por encima de tantos nodos se quitan los automáticos más antiguos de una
// cadena recta (su hijo pasa a colgar de su padre).
export const MAXIMO_NODOS = 400
// Sesiones cuyo HEAD se recuerda (las más recientes).
const MAXIMO_HEADS = 40

const VACIO: Arbol = { version: 2, siguiente: 1, nodos: [], heads: {}, titulos: {} }

// Las operaciones sobre disco, de una en una: un checkpoint que llega mientras
// se borra una rama no pisa el índice.
let cola: Promise<unknown> = Promise.resolve()
function enCola<T>(f: () => Promise<T>): Promise<T> {
  const r = cola.then(f, f)
  cola = r.catch(() => undefined)
  return r
}

// ── Pura: mensajes y forma del árbol ────────────────────────────────────────

const INJERTO = '[Contexto injertado'

// Lo que escribió la persona: ni resultados de herramientas, ni el resumen
// injertado por el mod, ni las filas que pone el motor al ejecutar un comando.
function esPrompt(m: Guardado): boolean {
  const texto = m.text.trimStart()
  return (
    m.role === 'user' &&
    texto !== '' &&
    (m.toolResults?.length ?? 0) === 0 &&
    !texto.startsWith(INJERTO) &&
    !/^<(command-|local-command-|system-reminder)/.test(texto)
  )
}

// Los resultados de cada herramienta, por id: el mensaje del modelo los lleva
// en su `toolUses` y el siguiente de la persona en `toolResults`.
function resultados(ms: readonly Guardado[]): Map<string, { text: string; isError: boolean }> {
  const mapa = new Map<string, { text: string; isError: boolean }>()
  for (const m of ms) for (const r of m.toolResults ?? []) mapa.set(r.tool_use_id, r)
  return mapa
}

// Una valla de código que no choque con lo que encierra.
function valla(texto: string): string {
  let v = '```'
  while (texto.includes(v)) v += '`'
  return v
}

// La conversación en Markdown, para exportarla.
export function transcripcion(ms: readonly Guardado[]): string {
  const porId = resultados(ms)
  const bloques: string[] = []
  for (const m of ms) {
    if (m.role === 'user') {
      // Los resultados ya salen junto a su llamada; aquí solo lo escrito.
      if (m.text.trim() === '') continue
      bloques.push(`## 🧑 Persona\n\n${m.text}`)
      continue
    }
    const partes: string[] = []
    if (m.text.trim() !== '') partes.push(m.text)
    for (const u of m.toolUses) {
      const r = porId.get(u.tool_use_id)
      const texto = u.text ?? r?.text ?? ''
      const error = u.isError === true || r?.isError === true
      const entrada = JSON.stringify(u.input)
      const v = valla(texto)
      partes.push(
        `<details><summary>→ ${u.tool}${error ? ' ✗' : ''} <code>${entrada.slice(0, 120).replace(/</g, '&lt;')}</code></summary>\n\n${v}\n${texto}\n${v}\n</details>`,
      )
    }
    if (partes.length === 0) continue
    bloques.push(`## Claude\n\n${partes.join('\n\n')}`)
  }
  return bloques.join('\n\n')
}

export function estimar(ms: readonly Guardado[]): number {
  let caracteres = 0
  for (const m of ms) {
    caracteres += m.text.length
    for (const u of m.toolUses) caracteres += (u.text?.length ?? 0) + JSON.stringify(u.input).length
    for (const r of m.toolResults ?? []) caracteres += r.text.length
  }
  return Math.ceil(caracteres / CARACTERES_POR_TOKEN)
}

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

// Los checkpoints guardados antes podían apuntar a un registro de sistema, que
// cambia de uuid sin cambiar la conversación. Se llevan a su último mensaje y
// los que quedan iguales se funden.
async function canonizar($: $, a: Arbol): Promise<Arbol> {
  const porSesion = new Map<string, Nodo[]>()
  for (const n of a.nodos) porSesion.set(n.sesion, [...(porSesion.get(n.sesion) ?? []), n])
  const cambios = new Map<string, string>()
  for (const [sesion, nodos] of porSesion) {
    let mapa: Record<string, string>
    try {
      mapa = await ayudante<Record<string, string>>($, ['anclas', sesion, ...nodos.map(n => n.uuid)])
    } catch {
      // Sin transcript legible el nodo se queda como está.
      continue
    }
    for (const n of nodos) {
      const ancla = mapa[n.uuid]
      if (ancla !== undefined && ancla !== n.uuid) cambios.set(n.id, ancla)
    }
  }
  return cambios.size === 0 ? a : fundirDuplicados(a, cambios)
}

// Lo que el motor escribe al reanudar tras una interrupción, sin que nadie
// haya hablado: un «No response requested.» de Claude. No es un punto nuevo.
const RUIDO = /^No response requested\.?$/i

export function soloRuido(ms: readonly Guardado[]): boolean {
  return ms.length > 0 && ms.every(m => m.role === 'assistant' && m.toolUses.length === 0 && RUIDO.test(m.text.trim()))
}

// ¿Lo que hay entre el checkpoint `origen` y el mensaje `hasta` es solo ruido?
async function soloRuidoTras($: $, sesion: string, hasta: string, origen: string): Promise<boolean> {
  const ms = await ayudante<Guardado[]>($, ['mensajes', sesion, hasta])
  const i = ms.findIndex(m => m.uuid === origen)
  return i >= 0 && soloRuido(ms.slice(i + 1))
}

// Cuántos mensajes tienen en común dos conversaciones desde el principio.
export function prefijoComun(x: readonly Guardado[], y: readonly Guardado[]): number {
  let i = 0
  while (i < x.length && i < y.length && x[i]?.uuid !== undefined && x[i]?.uuid === y[i]?.uuid) i++
  return i
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

// ── Disco y transcripts ─────────────────────────────────────────────────────

// `~/.claude/contexto-vivo/ramas/<proyecto>`: la carpeta `.claude` sobre la del
// mod; si el mod no está bajo una, la `.claude` del proyecto.
async function carpeta($: $): Promise<string> {
  const raiz = (await $.session.root()).replace(/\\/g, '/')
  const proyecto = raiz.replace(/[^A-Za-z0-9]/g, '-')
  const mod = $.plugin.root.replace(/\\/g, '/')
  const i = mod.lastIndexOf('/.claude/')
  const claude = i >= 0 ? mod.slice(0, i + 8) : `${raiz}/.claude`
  return `${claude}/contexto-vivo/ramas/${proyecto}`
}

function esArbol(x: unknown): x is Arbol {
  const a = x as Partial<Arbol> | null
  return a !== null && typeof a === 'object' && a.version === 2 && Array.isArray(a.nodos) && typeof a.heads === 'object'
}

async function leerDisco($: $): Promise<Arbol> {
  try {
    const leido: unknown = JSON.parse(await $.fs.read(`${await carpeta($)}/indice.json`))
    if (esArbol(leido)) return { ...leido, titulos: leido.titulos ?? {} }
  } catch {
    // Sin índice todavía, o ilegible: se empieza de cero.
  }
  return VACIO
}

async function escribirDisco($: $, a: Arbol): Promise<void> {
  const sesiones = Object.keys(a.heads)
  const heads =
    sesiones.length <= MAXIMO_HEADS
      ? a.heads
      : Object.fromEntries(sesiones.slice(-MAXIMO_HEADS).map(s => [s, a.heads[s] as string]))
  const titulos = Object.fromEntries(Object.entries(a.titulos).filter(([s]) => s in heads || a.nodos.some(n => n.sesion === s)))
  const limpio = { ...a, heads, titulos }
  await $.fs.write(`${await carpeta($)}/indice.json`, JSON.stringify(limpio))
  await cambiarArbol($, () => limpio)
}

function mensajeDe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// Ejecuta `scripts/transcript.cjs` y devuelve lo que escribe (JSON).
async function ayudante<T>($: $, args: readonly string[]): Promise<T> {
  const script = `${$.plugin.root.replace(/\\/g, '/')}/scripts/transcript.cjs`
  let r: { exitCode: number | null; stdout: string; stderr: string }
  try {
    r = await $.process.run(['node', script, ...args], { timeoutMs: 60_000 })
  } catch (error) {
    throw new Error(`no se pudo ejecutar node para leer el transcript (${mensajeDe(error)})`)
  }
  let salida: unknown
  try {
    salida = JSON.parse(r.stdout)
  } catch {
    throw new Error(r.stderr.trim().split('\n')[0] || `el lector de transcripts terminó con ${String(r.exitCode)}`)
  }
  if (salida !== null && typeof salida === 'object' && 'error' in salida) {
    throw new Error(String((salida as { error: unknown }).error))
  }
  return salida as T
}

function mensajesDe($: $, n: Nodo): Promise<Guardado[]> {
  return ayudante<Guardado[]>($, ['mensajes', n.sesion, n.uuid])
}

function esperar($: $, ms: number): Promise<void> {
  return new Promise(listo => {
    $.clock.after(ms, () => listo())
  })
}

// El estado de la sesión en su transcript. El motor puede ir un paso por
// delante del fichero: si el último mensaje no coincide con el que el motor
// tiene, se espera un poco y se vuelve a leer.
async function estadoSesion($: $, sesion: string): Promise<EstadoSesion | null> {
  const actuales = await $.session.messages()
  // Sin conversación no hay nada que leer (ni node que lanzar).
  if (actuales.length === 0) return null
  const ultimo = actuales.filter(m => m.role === 'user' || m.text !== '').at(-1)
  const esperado = ultimo === undefined ? '' : `${ultimo.role}:${ultimo.text.slice(0, 60)}`
  let e = await ayudante<EstadoSesion>($, ['estado', sesion])
  for (let intento = 0; intento < 3 && esperado !== '' && !e.ultimo.startsWith(esperado); intento++) {
    await esperar($, 300)
    e = await ayudante<EstadoSesion>($, ['estado', sesion])
  }
  return e
}

// Quita los checkpoints automáticos más antiguos de una cadena recta hasta
// volver a `MAXIMO_NODOS`: su hijo pasa a colgar de su padre. Los nombrados,
// las bifurcaciones y los HEAD no se tocan. Nada que borrar en disco: un
// checkpoint es solo un puntero.
function recortar(a: Arbol): Arbol {
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

// ── Operaciones ─────────────────────────────────────────────────────────────

// Al empezar la sesión (también al llegar a ella con /resume): el árbol del
// proyecto y el HEAD que esta sesión tenga en él.
//
// El índice se pone en el panel al momento; corregir los checkpoints antiguos
// lee los transcripts (node, una vez por sesión) y llega después.
export async function cargarArbol($: $): Promise<void> {
  const sesion = await $.session.id()
  await enCola(async () => {
    const leido = await leerDisco($)
    await cambiarArbol($, () => leido)
    await cambiarHead($, h => leido.heads[sesion] ?? h)
  })
  // En la cola, pero sin esperarla: quien carga no se queda parado.
  void enCola(async () => {
    const leido = await leerDisco($)
    const a = await canonizar($, leido)
    if (a === leido) return
    await escribirDisco($, a)
    await cambiarHead($, h => a.heads[sesion] ?? h)
  }).catch(error => $.ui.log(`árbol: ${mensajeDe(error)}`, { to: 'debug' }))
}

// La sesión a la que se acaba de restaurar o hacer fork, en `$.store` para que
// sobreviva al reinicio del mod con el /resume.
const CLAVE_ABRIR = 'arbol-abrir'

// Si esta sesión viene de restaurar o de un fork, abre el panel en la pestaña
// Árbol (una sola vez).
export async function abrirArbolSiToca($: $): Promise<void> {
  const pendiente = await $.store.get(CLAVE_ABRIR)
  if (pendiente === undefined || pendiente !== (await $.session.id())) return
  await $.store.delete(CLAVE_ABRIR)
  await cambiarPestana($, () => 'arbol')
  await $.ui.open({ id: PANEL, title: 'Contexto' })
}

// Tras /clear la conversación vuelve a estar vacía: el siguiente checkpoint
// empieza una raíz nueva.
export async function soltarHead($: $): Promise<void> {
  await cambiarHead($, () => null)
}

async function crearCheckpoint($: $, nombre?: string): Promise<Nodo | null> {
  const sesion = await $.session.id()
  const e = await estadoSesion($, sesion)
  if (e === null || e.uuid === null || e.mensajes === 0) return null
  const a = await canonizar($, await leerDisco($))
  const origen = origenEnCadena(a, e.cadena, a.heads[sesion] ?? (await leerHead($)))

  // Nada nuevo desde el checkpoint más cercano: la sesión está en él, y como
  // mucho se le pone nombre. Lo mismo si lo único que se ha añadido es lo que
  // el motor escribe al reanudar tras una interrupción.
  const enOrigen =
    origen !== undefined &&
    (origen.uuid === e.uuid || (await soloRuidoTras($, sesion, e.uuid, origen.uuid)))
  if (origen !== undefined && enOrigen) {
    const actual = nombre === undefined || nombre === origen.nombre ? origen : { ...origen, nombre }
    await escribirDisco($, {
      ...a,
      nodos: a.nodos.map(n => (n.id === origen.id ? actual : n)),
      heads: { ...a.heads, [sesion]: origen.id },
    })
    await cambiarHead($, () => origen.id)
    return actual
  }

  // El primer checkpoint de un fork con nombre se llama como el fork.
  const titulo = a.titulos[sesion]
  const primero = !a.nodos.some(n => n.sesion === sesion)
  const nombreFinal = nombre ?? (titulo !== undefined && primero ? titulo : undefined)
  const id = `n${a.siguiente}`
  const nodo: Nodo = {
    id,
    padre: origen?.id ?? null,
    ...(nombreFinal === undefined ? {} : { nombre: nombreFinal }),
    creado: await $.clock.now(),
    sesion,
    uuid: e.uuid,
    mensajes: e.mensajes,
    turnos: e.turnos,
    tokens: (await leerTotal($))?.tokens ?? 0,
    prompt: enLinea(e.prompt).slice(0, 80),
  }
  await escribirDisco(
    $,
    recortar({ ...a, siguiente: a.siguiente + 1, nodos: [...a.nodos, nodo], heads: { ...a.heads, [sesion]: id } }),
  )
  await cambiarHead($, () => id)
  return nodo
}

// Guarda la conversación tal como está. Sin cambios desde el último checkpoint
// no crea nada; con `nombre`, se lo pone al checkpoint (nuevo o ese).
export function checkpoint($: $, nombre?: string): Promise<Nodo | null> {
  return enCola(() => crearCheckpoint($, nombre))
}

export function nombrar($: $, id: string, nombre: string): Promise<void> {
  return enCola(async () => {
    const a = await leerDisco($)
    const limpio = enLinea(nombre).slice(0, 60)
    await escribirDisco($, {
      ...a,
      nodos: a.nodos.map(n => {
        if (n.id !== id) return n
        const { nombre: _anterior, ...resto } = n
        return limpio === '' ? resto : { ...resto, nombre: limpio }
      }),
    })
  })
}

// Llevar la conversación a un checkpoint: guardar lo que haya de nuevo,
// escribir una sesión con la conversación hasta él (como /branch) y abrirla
// con /resume. `nombre` la convierte en un fork con nombre: se ve así en
// /resume y su primer checkpoint lo lleva.
//
// La sesión de la que se viene no se toca. Si el motor no cambiara de sesión,
// la rama ya está escrita: se dice cómo abrirla.
async function irA($: $, id: string, nombre?: string): Promise<void> {
  const fork = nombre !== undefined
  await cambiarOcupado($, () => (fork ? `Creando el fork «${nombre}»…` : `Restaurando ${id}…`))
  try {
    await checkpoint($).catch(error => $.ui.log(`árbol: ${mensajeDe(error)}`, { to: 'debug' }))
    const nodo = buscarNodo(await enCola(() => leerDisco($)), id)
    if (nodo === undefined) {
      $.ui.toast(`No existe el checkpoint ${id}`)
      return
    }
    const etiqueta = etiquetaNodo(nodo)
    const rama = await ayudante<{ id: string }>($, ['fork', nodo.sesion, nodo.uuid, ...(fork ? [nombre] : [])])
    await enCola(async () => {
      const a = await leerDisco($)
      await escribirDisco($, {
        ...a,
        heads: { ...a.heads, [rama.id]: nodo.id },
        titulos: fork ? { ...a.titulos, [rama.id]: nombre } : a.titulos,
      })
    })

    // La sesión nueva abre el panel en el árbol al empezar, aunque el mod se
    // reinicie con el /resume (lo hace `abrirArbolSiToca`).
    await $.store.set(CLAVE_ABRIR, rama.id)
    await $.command.run({ command: 'resume', args: rama.id })
    if ((await $.session.id()) !== rama.id) {
      $.ui.log(`⑂ La rama está lista en la sesión ${rama.id}: ábrela con /resume ${rama.id} o claude --resume ${rama.id}`)
      $.ui.toast(`⑂ Rama creada, pero no se abrió sola: /resume ${rama.id.slice(0, 8)}…`)
      return
    }
    // Una conversación nueva: lo medido en la anterior no vale, y la caché se
    // reescribe en la próxima petición por fuerza (no avisar de ello).
    await olvidarConversacion($)
    marcarCompactado()
    await cambiarArbol($, () => null)
    await cargarArbol($)
    await cambiarHead($, () => nodo.id)
    await cambiarSeleccion($, () => nodo.id)
    await abrirArbolSiToca($)
    await fotografiar($)
    $.ui.toast(fork ? `⑂ Fork «${nombre}» desde ${etiqueta}` : `⤺ En ${etiqueta} · ${turnos(nodo.turnos)}`)
  } catch (error) {
    $.ui.toast(`No se pudo ${fork ? 'crear el fork' : 'restaurar'}: ${mensajeDe(error)}`)
  } finally {
    await cambiarOcupado($, () => null)
  }
}

// Volver a un checkpoint, como rewind: la conversación sigue desde ahí.
export function restaurar($: $, id: string): Promise<void> {
  return irA($, id)
}

// Una rama nueva con nombre desde un checkpoint, como /branch.
export function forkear($: $, id: string, nombre: string): Promise<void> {
  const limpio = enLinea(nombre).slice(0, 60)
  return irA($, id, limpio === '' ? `fork de ${id}` : limpio)
}

// Quita del árbol el nodo y todo lo que cuelga de él. Las sesiones siguen en
// disco (en /resume); solo dejan de verse aquí. No quita la rama en que está
// la conversación.
export function borrarRama($: $, id: string): Promise<void> {
  return enCola(async () => {
    await cambiarBorrando($, () => null)
    const a = await leerDisco($)
    const fuera = descendientes(a, id)
    const head = await leerHead($)
    if (head !== null && fuera.has(head)) {
      $.ui.toast('No se borra la rama en la que estás: ve antes a otro checkpoint')
      return
    }
    const heads = Object.fromEntries(Object.entries(a.heads).filter(([, h]) => !fuera.has(h)))
    await escribirDisco($, { ...a, nodos: a.nodos.filter(n => !fuera.has(n.id)), heads })
    await cambiarSeleccion($, s => (s !== null && fuera.has(s) ? head : s))
    $.ui.toast(`✕ Borrado${fuera.size === 1 ? ' 1 checkpoint' : `s ${fuera.size} checkpoints`}`)
  })
}

// La conversación como texto, para resumirla.
function transcribir(ms: readonly Guardado[], maximo: number): string {
  const lineas = ms.map(m => {
    if (m.role === 'user' && !esPrompt(m)) return ''
    const herramientas = m.toolUses.map(u => `  → ${u.tool} ${JSON.stringify(u.input).slice(0, 200)}\n    ${(u.text ?? '').slice(0, 600)}`)
    return [`${m.role === 'user' ? 'PERSONA' : 'CLAUDE'}: ${m.text}`, ...herramientas].join('\n')
  })
  const texto = lineas.filter(l => l !== '').join('\n\n')
  return texto.length <= maximo ? texto : `[…]\n${texto.slice(-maximo)}`
}

// Trae a la conversación actual lo que se concluyó en otra rama: un resumen de
// lo que esa rama hizo desde que se separó, como un mensaje que el modelo lee.
export function injertar($: $, id: string): Promise<void> {
  return enCola(async () => {
    await cambiarOcupado($, () => `Resumiendo la rama de ${id}…`)
    try {
      const a = await leerDisco($)
      const nodo = buscarNodo(a, id)
      if (nodo === undefined) return
      const actual = await ayudante<EstadoSesion>($, ['estado', await $.session.id()])
      const comun = new Set(actual.cadena)
      // Lo propio de la rama: los mensajes que la conversación actual no tiene.
      const propio = (await mensajesDe($, nodo)).filter(m => m.uuid === undefined || !comun.has(m.uuid))
      if (propio.length === 0) {
        $.ui.toast('Ese checkpoint ya forma parte de la conversación actual')
        return
      }
      const r = await $.model.complete({
        model: 'sonnet',
        effort: 'low',
        maxTokens: 1500,
        system:
          'Resumes una rama alternativa de una conversación de programación para incorporarla a otra rama. ' +
          'Escribe en español, en viñetas breves: objetivo de la rama, decisiones y conclusiones, ficheros y cambios ' +
          'relevantes, y lo que quedó pendiente o descartado y por qué. Sin preámbulo.',
        prompt: transcribir(propio, 60_000),
      })
      if (!r.isAnswered) {
        $.ui.toast(`No se pudo resumir la rama: ${r.reason}`)
        return
      }
      const titulo = etiquetaNodo(nodo)
      const hecho = await $.session.append({
        message: {
          type: 'user',
          content: [
            {
              type: 'text',
              text: `${INJERTO} desde otra rama del árbol de checkpoints: ${titulo} (${id}). Es lo que se hizo allí; tenlo en cuenta en esta rama.]\n\n${r.text}`,
            },
          ],
        },
      })
      if ('deny' in hecho && hecho.deny !== undefined) {
        $.ui.toast(`No se pudo injertar: ${String(hecho.deny)}`)
        return
      }
      $.ui.toast(`⎇ Injertado el resumen de ${titulo} (≈${k(Math.ceil(r.text.length / CARACTERES_POR_TOKEN))})`)
    } catch (error) {
      $.ui.toast(`No se pudo injertar: ${mensajeDe(error)}`)
    } finally {
      await cambiarOcupado($, () => null)
    }
  })
}

// ── Buscar, comparar y exportar ─────────────────────────────────────────────

// El texto alrededor de un acierto, en una línea.
export function extracto(texto: string, i: number, largo: number): string {
  const desde = Math.max(0, i - 40)
  const hasta = Math.min(texto.length, i + largo + 60)
  const trozo = enLinea(texto.slice(desde, hasta))
  return `${desde > 0 ? '…' : ''}${trozo}${hasta < texto.length ? '…' : ''}`
}

// Busca `texto` (sin distinguir mayúsculas) en las conversaciones de los
// checkpoints. Cada mensaje cuenta una vez, en el primer checkpoint que lo
// tiene: las ramas comparten sus mensajes comunes.
export function buscar($: $, texto: string): Promise<{ resultados: Hallado[]; total: number }> {
  return enCola(async () => {
    const t = texto.trim()
    if (t === '') return { resultados: [], total: 0 }
    const a = await leerDisco($)
    const puntos = [...a.nodos].sort((x, y) => x.creado - y.creado).map(n => ({ id: n.id, sesion: n.sesion, uuid: n.uuid }))
    const ruta = `${await carpeta($)}/busqueda.json`
    await $.fs.write(ruta, JSON.stringify(puntos))
    const r = await ayudante<{ resultados: { id: string; quien: string; texto: string; i: number }[]; total: number }>($, [
      'buscar',
      t,
      ruta,
    ])
    return {
      resultados: r.resultados.map(h => ({ id: h.id, quien: h.quien, extracto: extracto(h.texto, h.i, t.length) })),
      total: r.total,
    }
  })
}

// Los turnos de un trozo de conversación: cada prompt, cómo acabó la respuesta
// y cuántas herramientas usó por el camino.
export function pasos(ms: readonly Guardado[]): Paso[] {
  const lista: Paso[] = []
  for (const m of ms) {
    if (esPrompt(m)) {
      lista.push({ prompt: enLinea(m.text).slice(0, 120), respuesta: '', herramientas: 0 })
      continue
    }
    const ultimo = lista.at(-1)
    if (ultimo === undefined || m.role !== 'assistant') continue
    ultimo.herramientas += m.toolUses.length
    const texto = enLinea(m.text)
    if (texto !== '') ultimo.respuesta = texto.slice(0, 160)
  }
  return lista
}

// Lo que cada uno de dos checkpoints tiene desde que sus conversaciones se
// separan (el primer mensaje que no comparten).
export function comparar($: $, x: string, y: string): Promise<{ comun: Nodo | undefined; deA: Paso[]; deB: Paso[] }> {
  return enCola(async () => {
    const a = await leerDisco($)
    const nx = buscarNodo(a, x)
    const ny = buscarNodo(a, y)
    if (nx === undefined || ny === undefined) throw new Error('no existe uno de los checkpoints')
    const [mx, my] = await Promise.all([mensajesDe($, nx), mensajesDe($, ny)])
    const corte = prefijoComun(mx, my)
    return { comun: ancestroComun(a, x, y), deA: pasos(mx.slice(corte)), deB: pasos(my.slice(corte)) }
  })
}

// La comparación en texto, para /cp-diff.
export function informeComparacion(a: Arbol, x: string, y: string, r: { comun: Nodo | undefined; deA: Paso[]; deB: Paso[] }): string {
  const nombre = (id: string) => {
    const n = buscarNodo(a, id)
    return n === undefined ? id : `${id} ${etiquetaNodo(n)}`
  }
  const lado = (id: string, ps: Paso[]) => [
    `── ${nombre(id)} · +${turnos(ps.length)}`,
    ...(ps.length === 0
      ? ['   (nada propio: es un punto anterior de la otra rama)']
      : ps.flatMap((p, i) => [
          `${String(i + 1).padStart(2)}. «${p.prompt}»`,
          `    ${p.respuesta === '' ? '(sin texto)' : p.respuesta}${p.herramientas > 0 ? ` · ${p.herramientas} herramientas` : ''}`,
        ])),
  ]
  return [
    `Comparación ${nombre(x)} ⇄ ${nombre(y)}`,
    r.comun === undefined
      ? 'No tienen historia en común.'
      : `Se separan en ${nombre(r.comun.id)} (${turnos(r.comun.turnos)} en común)`,
    '',
    ...lado(x, r.deA),
    '',
    ...lado(y, r.deB),
  ].join('\n')
}

// Escribe la conversación de un checkpoint en Markdown y devuelve la ruta.
export function exportar($: $, id: string): Promise<string> {
  return enCola(async () => {
    const a = await leerDisco($)
    const nodo = buscarNodo(a, id)
    if (nodo === undefined) throw new Error(`no existe el checkpoint ${id}`)
    const ms = await mensajesDe($, nodo)
    const fecha = new Date(nodo.creado).toISOString().slice(0, 16).replace('T', ' ')
    const camino = ancestros(a, id)
      .reverse()
      .filter(n => n.nombre !== undefined || n.padre === null || n.id === id || hijos(a, n.id).length > 1)
      .map(n => `${n.id} ${etiquetaNodo(n)}`)
      .join(' → ')
    const md = [
      `# ${etiquetaNodo(nodo)}`,
      '',
      `Checkpoint **${id}** del árbol de contexto-vivo · ${fecha} · ${turnos(nodo.turnos)} · ${ms.length} mensajes · ≈${k(estimar(ms))} tokens`,
      '',
      `Camino: ${camino}`,
      '',
      transcripcion(ms),
      '',
    ].join('\n')
    const nombre = etiquetaNodo(nodo)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40)
      .toLowerCase()
    const ruta = `${await carpeta($)}/exportes/${id}${nombre === '' ? '' : `-${nombre}`}.md`
    await $.fs.write(ruta, md)
    return ruta
  })
}

// Pone una búsqueda o comparación en la pestaña Árbol.
export async function consultarBusqueda($: $, texto: string): Promise<void> {
  const limpio = texto.trim()
  if (limpio === '') {
    await cambiarConsulta($, () => null)
    return
  }
  try {
    const { resultados, total } = await buscar($, limpio)
    await cambiarConsulta($, () => ({ tipo: 'buscar', texto: limpio, resultados, total }))
  } catch (error) {
    $.ui.toast(`No se pudo buscar: ${mensajeDe(error)}`)
  }
}

export async function consultarComparacion($: $, x: string, y: string): Promise<void> {
  try {
    const r = await comparar($, x, y)
    await cambiarConsulta($, () => ({ tipo: 'comparar', a: x, b: y, comun: r.comun?.id ?? null, deA: r.deA, deB: r.deB }))
  } catch (error) {
    $.ui.toast(`No se pudo comparar: ${mensajeDe(error)}`)
  }
}

export async function exportarConAviso($: $, id: string): Promise<void> {
  try {
    $.ui.toast(`⇩ Exportado a ${await exportar($, id)}`)
  } catch (error) {
    $.ui.toast(`No se pudo exportar: ${mensajeDe(error)}`)
  }
}

// Un resumen del árbol en texto, para /cp-arbol.
export function informeArbol(a: Arbol | null, head: string | null): string {
  if (a === null || a.nodos.length === 0) return 'Aún no hay checkpoints: se crea uno al cerrar cada turno, o con /cp <nombre>.'
  const filas = filasArbol(a, head, null, false)
  const lineas = filas.map(f => {
    const n = f.nodo
    const marca = n.id === head ? '◉' : n.nombre !== undefined ? '◆' : '○'
    const plegados = f.plegados > 0 ? `┄ ${f.plegados} ┄ ` : ''
    return `${f.guia}${plegados}${marca} ${n.id} ${etiquetaNodo(n)} · t${n.turnos} · ${k(n.tokens)}${n.id === head ? '  ← aquí' : ''}`
  })
  return [
    `Árbol de checkpoints · ${a.nodos.length} nodos`,
    ...lineas,
    '',
    '/cp <nombre> · /cp-ir <id|nombre> · /cp-fork <id|nombre> [nombre] · /cp-diff · /cp-buscar · /cp-exportar · /contexto → ⎇ Árbol',
  ].join('\n')
}

// Los aciertos de una búsqueda en texto, para /cp-buscar.
export function informeBusqueda(a: Arbol | null, texto: string, r: { resultados: Hallado[]; total: number }): string {
  if (r.total === 0) return `Nada con «${texto}» en los checkpoints.`
  const lineas = r.resultados.map(h => {
    const n = buscarNodo(a, h.id)
    return `${h.id} ${n === undefined ? '' : etiquetaNodo(n).slice(0, 30)} · ${h.quien}: ${h.extracto}`
  })
  const mas = r.total > r.resultados.length ? [`… y ${r.total - r.resultados.length} más`] : []
  return [`«${texto}» · ${r.total} ${r.total === 1 ? 'acierto' : 'aciertos'}`, ...lineas, ...mas, '', '/cp-ir <id> para volver a uno'].join('\n')
}
