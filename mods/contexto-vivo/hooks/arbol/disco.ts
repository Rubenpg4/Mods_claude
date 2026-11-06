import type { EngineInterface } from 'claude-code'

import type { Arbol, Nodo } from '../../types'

import { carpetaDatos } from '../comun/entorno'
import { cambiarArbol } from '../estado/arbol'
import { type Guardado, soloRuido } from './mensajes'
import { fundirDuplicados, VACIO } from './modelo'

// El índice del árbol en disco (`indice.json`) y el ayudante de transcripts
// (`scripts/transcript.cjs`, con node). Lo que lee o escribe el índice pasa por
// `enCola`, de una operación en una.

type $ = EngineInterface

// Lo que el ayudante sabe de la sesión actual: el último mensaje, la cadena
// hasta él y sus cifras.
export type EstadoSesion = {
  uuid: string | null
  cadena: string[]
  mensajes: number
  turnos: number
  prompt: string
  ultimo: string
}

// Sesiones cuyo HEAD se recuerda (las más recientes).
const MAXIMO_HEADS = 40

// Las operaciones sobre disco, de una en una: un checkpoint que llega mientras
// se borra una rama no pisa el índice.
let cola: Promise<unknown> = Promise.resolve()
export function enCola<T>(f: () => Promise<T>): Promise<T> {
  const r = cola.then(f, f)
  cola = r.catch(() => undefined)
  return r
}

// Los checkpoints guardados antes podían apuntar a un registro de sistema, que
// cambia de uuid sin cambiar la conversación. Se llevan a su último mensaje y
// los que quedan iguales se funden.
export async function canonizar($: $, a: Arbol): Promise<Arbol> {
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

// ¿Lo que hay entre el checkpoint `origen` y el mensaje `hasta` es solo ruido?
export async function soloRuidoTras($: $, sesion: string, hasta: string, origen: string): Promise<boolean> {
  const ms = await ayudante<Guardado[]>($, ['mensajes', sesion, hasta])
  const i = ms.findIndex(m => m.uuid === origen)
  return i >= 0 && soloRuido(ms.slice(i + 1))
}

// `~/.claude/contexto-vivo/ramas/<proyecto>`: la carpeta `.claude` sobre la del
// mod; si el mod no está bajo una, la `.claude` del proyecto.
export function carpeta($: $): Promise<string> {
  return carpetaDatos($, 'ramas')
}

function esArbol(x: unknown): x is Arbol {
  const a = x as Partial<Arbol> | null
  return a !== null && typeof a === 'object' && a.version === 2 && Array.isArray(a.nodos) && typeof a.heads === 'object'
}

export async function leerDisco($: $): Promise<Arbol> {
  try {
    const leido: unknown = JSON.parse(await $.fs.read(`${await carpeta($)}/indice.json`))
    if (esArbol(leido)) return { ...leido, titulos: leido.titulos ?? {} }
  } catch {
    // Sin índice todavía, o ilegible: se empieza de cero.
  }
  return VACIO
}

export async function escribirDisco($: $, a: Arbol): Promise<void> {
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

export function mensajeDe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// Ejecuta `scripts/transcript.cjs` y devuelve lo que escribe (JSON).
export async function ayudante<T>($: $, args: readonly string[]): Promise<T> {
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

export function mensajesDe($: $, n: Nodo): Promise<Guardado[]> {
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
export async function estadoSesion($: $, sesion: string): Promise<EstadoSesion | null> {
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
