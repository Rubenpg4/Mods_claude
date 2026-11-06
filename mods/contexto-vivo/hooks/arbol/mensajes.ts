import type { Paso } from '../../types'

import { CARACTERES_POR_TOKEN, enLinea } from '../comun/formato'

// Mensajes de la conversación de un checkpoint, como los da
// `scripts/transcript.cjs`: qué es un prompt, la transcripción en Markdown, los
// pasos para comparar y dónde cortó un rewind. Puro.

// Un mensaje de la conversación de un checkpoint, como lo da el ayudante.
export type Guardado = {
  role: 'user' | 'assistant'
  text: string
  toolUses: { tool_use_id: string; tool: string; input: Record<string, unknown>; text?: string; isError?: true }[]
  toolResults?: { tool_use_id: string; text: string; isError: boolean }[]
  uuid?: string
}

export const INJERTO = '[Contexto injertado'
// La nota que se deja al restaurar un punto que un rewind dejó atrás.
const AVISO_FICHEROS = '[Aviso de contexto-vivo'

export const NOTA_FICHEROS =
  `${AVISO_FICHEROS}: esta conversación se ha restaurado desde un punto que un rewind dejó atrás.] ` +
  'Los ficheros del disco pueden no coincidir con lo que se hizo en ella: ese rewind pudo restaurar el código, y desde ' +
  'entonces otra rama pudo cambiarlo. No des por hecho que los cambios de esta conversación siguen en disco: antes de ' +
  'editar o de afirmar que algo está hecho, vuelve a leer los ficheros que vayas a tocar y mira git status y git diff.'

// Un mensaje, del ayudante o de `$.session.messages()`: lo justo para saber si
// es un prompt.
export type ConTexto = { role: string; text: string; toolResults?: readonly unknown[] }

// Lo que escribió la persona: ni resultados de herramientas, ni el resumen
// injertado por el mod, ni las filas que pone el motor al ejecutar un comando.
function esPrompt(m: ConTexto): boolean {
  const texto = m.text.trimStart()
  return (
    m.role === 'user' &&
    texto !== '' &&
    (m.toolResults?.length ?? 0) === 0 &&
    !texto.startsWith(INJERTO) &&
    !texto.startsWith(AVISO_FICHEROS) &&
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

// Lo que el motor escribe al reanudar tras una interrupción, sin que nadie
// haya hablado: un «No response requested.» de Claude. No es un punto nuevo.
const RUIDO = /^No response requested\.?$/i

export function soloRuido(ms: readonly Guardado[]): boolean {
  return ms.length > 0 && ms.every(m => m.role === 'assistant' && m.toolUses.length === 0 && RUIDO.test(m.text.trim()))
}

// Cuántos mensajes tienen en común dos conversaciones desde el principio.
export function prefijoComun(x: readonly Guardado[], y: readonly Guardado[]): number {
  let i = 0
  while (i < x.length && i < y.length && x[i]?.uuid !== undefined && x[i]?.uuid === y[i]?.uuid) i++
  return i
}

// Dónde cortó un rewind nativo: `escritos` es la conversación del transcript,
// que hasta el siguiente mensaje sigue teniendo lo de después del rewind, y
// `memoria` la que el motor tiene ya. Devuelve el uuid del primer prompt que
// el rewind quitó; null si no quitó ninguno o si las dos no casan (una
// compactación, por ejemplo), y entonces no se toca nada.
//
// En memoria el motor puede tener mensajes que el transcript no guarda como
// prompts (avisos, notificaciones): lo que no es ningún prompt del transcript
// se ignora. Un prompt que llega fuera de orden (salta alguno) no es un
// rewind, y tampoco lo es quedarse sin ninguno con texto propio en memoria
// (el resumen de una compactación).
export function corteDeRewind(escritos: readonly Guardado[], memoria: readonly ConTexto[]): string | null {
  const clave = (m: ConTexto) => enLinea(m.text).slice(0, 200)
  const prompts = escritos.filter(esPrompt)
  const claves = prompts.map(clave)
  let casados = 0
  let ajenos = 0
  for (const m of memoria.filter(esPrompt)) {
    const c = clave(m)
    if (claves[casados] === c) casados++
    else if (claves.indexOf(c, casados) >= 0) return null
    else ajenos++
  }
  if (casados >= prompts.length || (casados === 0 && ajenos > 0)) return null
  return prompts[casados]?.uuid ?? null
}

// La conversación como texto, para resumirla.
export function transcribir(ms: readonly Guardado[], maximo: number): string {
  const lineas = ms.map(m => {
    if (m.role === 'user' && !esPrompt(m)) return ''
    const herramientas = m.toolUses.map(u => `  → ${u.tool} ${JSON.stringify(u.input).slice(0, 200)}\n    ${(u.text ?? '').slice(0, 600)}`)
    return [`${m.role === 'user' ? 'PERSONA' : 'CLAUDE'}: ${m.text}`, ...herramientas].join('\n')
  })
  const texto = lineas.filter(l => l !== '').join('\n\n')
  return texto.length <= maximo ? texto : `[…]\n${texto.slice(-maximo)}`
}

// El texto alrededor de un acierto, en una línea.
export function extracto(texto: string, i: number, largo: number): string {
  const desde = Math.max(0, i - 40)
  const hasta = Math.min(texto.length, i + largo + 60)
  const trozo = enLinea(texto.slice(desde, hasta))
  return `${desde > 0 ? '…' : ''}${trozo}${hasta < texto.length ? '…' : ''}`
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
