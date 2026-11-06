import type { EngineInterface } from 'claude-code'

import type { Nivel } from '../../types'

import { cambiarAplicado, cambiarSelector, leerAplicado, leerSelector } from '../estado/selector'
import { esNivel, type Modelo, modeloDe, MODELOS, NIVELES } from './modelos'

// Aplicar lo que se pulsa en el selector: al momento o al acabar el turno, y sin
// el eco de los comandos que lanza el propio mod.
//
// El selector de modelo y esfuerzo: una banda fija sobre el prompt, plegada en
// una línea y desplegada en chips, como el de la web.
//
// El modelo cambia por la fila `model` de /config, sin ruido. El esfuerzo no
// tiene fila en /config: al pulsar se ejecuta el `/effort` real, que cambia la
// sesión al momento (y refresca la pantalla con sus filas, que se dibujan
// vacías). A mitad de turno, los dos esperan al final del turno.

// Si la conversación principal tiene un turno en marcha: lo pulsado entonces
// se guarda y se aplica al acabar, para no cambiar el modelo que está actuando.
const turno = { activo: false }

export function empiezaTurno(): void {
  turno.activo = true
}

// Al acabar el turno: el modelo pendiente y luego el /effort, que así queda
// guardado para el modelo nuevo (el esfuerzo se guarda por modelo).
export async function acabaTurno($: EngineInterface): Promise<void> {
  turno.activo = false
  const s = await leerSelector($)
  if (s.modelo === null && s.esfuerzo === null) return
  await cambiarSelector($, x => ({ ...x, modelo: null, esfuerzo: null }))
  const m = MODELOS.find(x => x.id === s.modelo)
  if (m !== undefined) await aplicarModelo($, m)
  if (s.esfuerzo !== null) await aplicarEsfuerzo($, s.esfuerzo)
}

// Los comandos que lanza el propio mod: su eco y su salida son ruido en el
// transcript (y lo que hacía saltar la pantalla), así que se dibujan vacíos.
// El marcador vive hasta que el motor ha dibujado sus filas.
const propios = new Map<string, number>()

export function esPropio(command: string, args: string): boolean {
  return (propios.get(`${command} ${args.trim()}`) ?? 0) > 0
}

async function silencioso($: EngineInterface, command: string, args: string): Promise<string | undefined> {
  const marca = `${command} ${args}`
  propios.set(marca, (propios.get(marca) ?? 0) + 1)
  try {
    return (await $.command.run({ command, args })).text
  } finally {
    // Un respiro para que se dibujen las filas antes de soltar el marcador.
    $.clock.after(1500, () => {
      const n = (propios.get(marca) ?? 1) - 1
      if (n <= 0) propios.delete(marca)
      else propios.set(marca, n)
    })
  }
}

// Cambia una fila de /config como el menú: sin eco ni salida en el transcript.
// `false` si no hay fila o la rechaza.
async function porConfig(
  $: EngineInterface,
  esLaFila: (clave: string, etiqueta: string) => boolean,
  candidatos: string[],
): Promise<boolean> {
  try {
    const fila = (await $.config.list()).find(r => !r.isLocked && esLaFila(r.key.toLowerCase(), r.label.toLowerCase()))
    if (fila === undefined) return false
    const opciones = fila.options ?? []
    const valor =
      opciones.length === 0
        ? candidatos[0]
        : (candidatos.map(c => opciones.find(o => o.toLowerCase() === c)).find(o => o !== undefined) ??
          opciones.find(o => candidatos.some(c => o.toLowerCase().includes(c))))
    if (valor === undefined) return false
    const r = await $.config.set({ key: fila.key, value: valor })
    return !('deny' in r && r.deny !== undefined)
  } catch {
    return false
  }
}

async function aplicarModelo($: EngineInterface, m: Modelo): Promise<void> {
  const esModelo = (k: string, l: string) => k === 'model' || /^model\b/.test(l)
  try {
    let ahora: string | null = null
    if (await porConfig($, esModelo, [m.id, m.familia])) ahora = await $.session.model().catch(() => null)
    // Respaldo: el /model de verdad, con sus filas ocultas.
    if (modeloDe(ahora)?.id !== m.id) {
      await silencioso($, 'model', m.id)
      ahora = await $.session.model().catch(() => null)
    }
    if (ahora !== null && modeloDe(ahora)?.id !== m.id) $.ui.toast(`✕ El modelo no cambió a ${m.nombre}`)
    else await cambiarAplicado($, a => ({ ...a, modelo: ahora ?? m.id }))
  } catch (error) {
    $.ui.toast(`✕ No se pudo cambiar a ${m.nombre}: ${String(error).slice(0, 80)}`)
  }
}

// Una sola escritura por pulsación: la elección pendiente o el cambio aplicado.
export async function elegirModelo($: EngineInterface, m: Modelo): Promise<void> {
  if (turno.activo) await cambiarSelector($, s => ({ ...s, modelo: m.id }))
  else await aplicarModelo($, m)
}

// El /effort real: cambia el esfuerzo de la sesión al momento.
async function aplicarEsfuerzo($: EngineInterface, nivel: Nivel): Promise<void> {
  try {
    await silencioso($, 'effort', nivel)
    await cambiarAplicado($, a => ({ ...a, esfuerzo: nivel }))
  } catch (error) {
    $.ui.toast(`✕ No se pudo cambiar el esfuerzo a ${nivel}: ${String(error).slice(0, 80)}`)
  }
}

export async function elegirEsfuerzo($: EngineInterface, nivel: Nivel): Promise<void> {
  if (turno.activo) await cambiarSelector($, s => ({ ...s, esfuerzo: nivel }))
  else await aplicarEsfuerzo($, nivel)
}

// Vuelve al modelo y al esfuerzo guardados en un checkpoint, si no son ya los
// de la sesión. El esfuerzo va después del modelo: se guarda por modelo, así
// que tras cambiar de modelo se aplica siempre. Devuelve lo que cambió.
export async function restaurarModo($: EngineInterface, modelo?: string, esfuerzo?: string): Promise<string[]> {
  const cambios: string[] = []
  const m = modeloDe(modelo ?? null)
  if (m !== undefined && modeloDe(await $.session.model().catch(() => null))?.id !== m.id) {
    await aplicarModelo($, m)
    cambios.push(m.nombre)
  }
  if (esNivel(esfuerzo) && (cambios.length > 0 || (await leerAplicado($)).esfuerzo !== esfuerzo)) {
    await aplicarEsfuerzo($, esfuerzo)
    cambios.push(esfuerzo)
  }
  return cambios
}

// Un /effort escrito a mano manda sobre lo que esperaba al final del turno.
export async function soltarEsfuerzo($: EngineInterface): Promise<void> {
  const s = await leerSelector($)
  if (s.esfuerzo !== null) await cambiarSelector($, x => ({ ...x, esfuerzo: null }))
}

export async function desplegar($: EngineInterface, abierto: boolean): Promise<void> {
  await cambiarSelector($, s => ({ ...s, desplegado: abierto }))
}

// `/modelo [modelo] [esfuerzo]`: con argumentos los aplica; sin ellos despliega
// la banda. Va fuera del hook del comando: `$.command.run` no puede ejecutarse
// mientras el turno espera a ese hook.
export async function comandoModelo($: EngineInterface, args: string): Promise<string | undefined> {
  const partes = args.toLowerCase().split(/\s+/).filter(p => p !== '')
  if (partes.length === 0) {
    await desplegar($, true)
    return undefined
  }
  const modelo = partes.map(p => MODELOS.find(m => m.familia === p || m.id === p)).find(m => m !== undefined)
  const nivel = partes.find(esNivel)
  const raros = partes.filter(p => !esNivel(p) && !MODELOS.some(m => m.familia === p || m.id === p))
  if (raros.length > 0) {
    return `No reconozco «${raros.join(' ')}». Uso: /modelo [${MODELOS.map(m => m.familia).join('|')}] [${NIVELES.map(n => n.id).join('|')}]`
  }
  $.clock.after(10, () => {
    void (async () => {
      if (modelo !== undefined) await elegirModelo($, modelo)
      if (nivel !== undefined) await elegirEsfuerzo($, nivel)
    })()
  })
  return undefined
}
