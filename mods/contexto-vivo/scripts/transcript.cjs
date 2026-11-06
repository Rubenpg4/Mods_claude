#!/usr/bin/env node
// Ayudante del árbol de contexto-vivo: lee y bifurca los transcripts del motor.
//
// Cada sesión de Claude Code es un `<sesión>.jsonl` en `~/.claude/projects/<proyecto>/`:
// un registro por línea, y cada mensaje enlazado con su anterior por
// `parentUuid` (o `logicalParentUuid` tras una compactación). Un checkpoint es
// un registro de ese fichero; su conversación, la cadena que sube desde él.
// Rewind y /branch funcionan igual: este script solo sigue esa cadena.
//
// Lo hace un proceso aparte porque los transcripts pasan con facilidad de los
// 4 MiB que `$.fs.read` deja leer al módulo del mod.
//
//   estado  <sesión>                     la hoja actual y su cadena
//   fork    <sesión> <uuid> [título]     una sesión nueva con la cadena hasta uuid
//   mensajes <sesión> <uuid>             la conversación hasta uuid, simplificada
//   buscar  <texto> <puntos.json>        busca en las conversaciones de los checkpoints
//   anclas  <sesión> <uuid…>             cada uuid llevado a su último mensaje
//
// Escribe JSON en stdout; ante un error, `{ "error": "…" }` y código 1.

'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')

const MAXIMO_TEXTO = 20000

function proyectos() {
  const base = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
  return path.join(base, 'projects')
}

// El fichero de una sesión: los ids son únicos, así que se busca en todos los
// proyectos en vez de rehacer cómo el motor nombra la carpeta.
function localizar(sesion) {
  if (!/^[A-Za-z0-9-]+$/.test(sesion)) throw new Error(`id de sesión no válido: ${sesion}`)
  const raiz = proyectos()
  for (const dir of fs.readdirSync(raiz)) {
    const ruta = path.join(raiz, dir, `${sesion}.jsonl`)
    if (fs.existsSync(ruta)) return ruta
  }
  throw new Error(`no se encuentra el transcript de la sesión ${sesion}`)
}

function leer(ruta) {
  const registros = []
  for (const linea of fs.readFileSync(ruta, 'utf8').split('\n')) {
    if (linea.trim() === '') continue
    try {
      registros.push(JSON.parse(linea))
    } catch {
      // Una línea a medio escribir (la sesión sigue viva): se ignora.
    }
  }
  return registros
}

const enCadena = r => typeof r.uuid === 'string' && r.isSidechain !== true

// Los registros de la conversación principal por uuid, y la hoja: el último
// escrito, que es donde está la conversación ahora.
function indexar(registros) {
  const porUuid = new Map()
  let hoja
  for (const r of registros) {
    if (!enCadena(r)) continue
    porUuid.set(r.uuid, r)
    // La punta es el último mensaje de la persona o de Claude. El motor añade
    // registros de sistema tras cada turno con su propio uuid: si fueran la
    // punta, la misma conversación tendría uuid distinto según cuándo se mire.
    if (r.type === 'user' || r.type === 'assistant') hoja = r
  }
  return { porUuid, hoja }
}

// Para cada uuid, el último mensaje de la persona o de Claude de su cadena.
function anclas(sesion, uuids) {
  const { porUuid } = indexar(leer(localizar(sesion)))
  const mapa = {}
  for (const u of uuids) {
    let r = porUuid.get(u)
    const vistos = new Set()
    while (r !== undefined && r.type !== 'user' && r.type !== 'assistant' && !vistos.has(r.uuid)) {
      vistos.add(r.uuid)
      r = porUuid.get(r.parentUuid ?? r.logicalParentUuid)
    }
    if (r !== undefined) mapa[u] = r.uuid
  }
  return mapa
}

// De la raíz a `desde`, siguiendo los padres (también a través de una
// compactación).
function cadena(porUuid, desde) {
  const lista = []
  const vistos = new Set()
  for (let r = desde; r !== undefined && !vistos.has(r.uuid); ) {
    vistos.add(r.uuid)
    lista.push(r)
    r = porUuid.get(r.parentUuid ?? r.logicalParentUuid)
  }
  return lista.reverse()
}

function textoDe(contenido) {
  if (typeof contenido === 'string') return contenido
  if (!Array.isArray(contenido)) return ''
  return contenido
    .filter(b => b && b.type === 'text' && typeof b.text === 'string')
    .map(b => b.text)
    .join('\n')
}

const cortar = t => (t.length > MAXIMO_TEXTO ? `${t.slice(0, MAXIMO_TEXTO)}\n[… ${t.length - MAXIMO_TEXTO} caracteres más]` : t)

// Lo que escribió la persona: ni resultados de herramientas, ni lo que inyecta
// el motor (meta, comandos, recordatorios).
function esPrompt(r) {
  if (r.type !== 'user' || r.isMeta === true || r.isCompactSummary === true) return false
  const c = r.message?.content
  if (Array.isArray(c) && c.some(b => b && b.type === 'tool_result')) return false
  const t = textoDe(c).trimStart()
  // La nota del mod al restaurar un punto abandonado tampoco es un prompt.
  return t !== '' && !/^<(command-|local-command-|system-reminder)/.test(t) && !t.startsWith('[Aviso de contexto-vivo')
}

// La cadena como la conversación que ve el modelo: un mensaje por turno de
// cada parte, los bloques del mismo mensaje del modelo juntos y cada
// herramienta con su resultado.
function simplificar(lista) {
  const mensajes = []
  const usos = new Map()
  for (const r of lista) {
    if ((r.type !== 'user' && r.type !== 'assistant') || r.isMeta === true) continue
    const c = r.message?.content
    if (r.type === 'assistant') {
      const previo = mensajes.at(-1)
      const mismo = previo !== undefined && previo.role === 'assistant' && previo.id !== undefined && previo.id === r.message?.id
      const m = mismo ? previo : { role: 'assistant', text: '', toolUses: [], uuid: r.uuid, id: r.message?.id }
      if (!mismo) mensajes.push(m)
      m.uuid = r.uuid
      const texto = textoDe(c)
      if (texto !== '') m.text = m.text === '' ? texto : `${m.text}\n${texto}`
      for (const b of Array.isArray(c) ? c : []) {
        if (b?.type !== 'tool_use') continue
        const u = { tool_use_id: b.id, tool: b.name, input: b.input ?? {} }
        usos.set(b.id, u)
        m.toolUses.push(u)
      }
      continue
    }
    const resultados = []
    for (const b of Array.isArray(c) ? c : []) {
      if (b?.type !== 'tool_result') continue
      const texto = cortar(typeof b.content === 'string' ? b.content : textoDe(b.content))
      resultados.push({ tool_use_id: b.tool_use_id, text: texto, isError: b.is_error === true })
      const u = usos.get(b.tool_use_id)
      if (u !== undefined) {
        u.text = texto
        if (b.is_error === true) u.isError = true
      }
    }
    const texto = resultados.length > 0 ? '' : cortar(textoDe(c))
    if (texto === '' && resultados.length === 0) continue
    mensajes.push({ role: 'user', text: texto, toolUses: [], uuid: r.uuid, ...(resultados.length > 0 ? { toolResults: resultados } : {}) })
  }
  for (const m of mensajes) delete m.id
  return mensajes
}

function estado(sesion) {
  const { porUuid, hoja } = indexar(leer(localizar(sesion)))
  if (hoja === undefined) return { uuid: null, cadena: [], mensajes: 0, turnos: 0, prompt: '', ultimo: '' }
  const lista = cadena(porUuid, hoja)
  const prompts = lista.filter(esPrompt)
  const mensajes = simplificar(lista)
  const ultimo = mensajes.at(-1)
  return {
    uuid: hoja.uuid,
    cadena: lista.map(r => r.uuid),
    mensajes: mensajes.length,
    turnos: prompts.length,
    prompt: prompts.length === 0 ? '' : textoDe(prompts.at(-1).message?.content).slice(0, 300),
    // Para comprobar que el fichero ya tiene lo último que ve el motor.
    ultimo: ultimo === undefined ? '' : `${ultimo.role}:${ultimo.text.slice(0, 200)}`,
  }
}

function fork(sesion, uuid, titulo) {
  const origen = localizar(sesion)
  const { porUuid } = indexar(leer(origen))
  const hoja = porUuid.get(uuid)
  if (hoja === undefined) throw new Error(`el checkpoint ya no está en el transcript de ${sesion}`)
  const id = crypto.randomUUID()
  const lineas = cadena(porUuid, hoja).map(r => JSON.stringify({ ...r, sessionId: id }))
  if (titulo) lineas.push(JSON.stringify({ type: 'custom-title', customTitle: titulo, sessionId: id }))
  const destino = path.join(path.dirname(origen), `${id}.jsonl`)
  fs.writeFileSync(destino, `${lineas.join('\n')}\n`, { flag: 'wx' })
  return { id, ruta: destino }
}

function mensajes(sesion, uuid) {
  const { porUuid } = indexar(leer(localizar(sesion)))
  const hoja = porUuid.get(uuid)
  if (hoja === undefined) throw new Error(`el checkpoint ya no está en el transcript de ${sesion}`)
  return simplificar(cadena(porUuid, hoja))
}

// Cada mensaje cuenta una vez, en el primer checkpoint (por creación) que lo
// tiene: las ramas comparten sus mensajes comunes con el mismo uuid.
function buscar(texto, rutaPuntos) {
  const t = texto.trim().toLowerCase()
  const puntos = JSON.parse(fs.readFileSync(rutaPuntos, 'utf8'))
  const ficheros = new Map()
  const vistos = new Set()
  const resultados = []
  let total = 0
  for (const p of puntos) {
    let indice = ficheros.get(p.sesion)
    if (indice === undefined) {
      try {
        indice = indexar(leer(localizar(p.sesion))).porUuid
      } catch {
        indice = new Map()
      }
      ficheros.set(p.sesion, indice)
    }
    const hoja = indice.get(p.uuid)
    if (hoja === undefined) continue
    for (const m of simplificar(cadena(indice, hoja))) {
      if (vistos.has(m.uuid)) continue
      vistos.add(m.uuid)
      const piezas =
        m.role === 'user'
          ? m.toolResults === undefined ? [{ quien: 'tú', texto: m.text }] : []
          : [
              { quien: 'Claude', texto: m.text },
              ...m.toolUses.flatMap(u => [
                { quien: `→ ${u.tool}`, texto: JSON.stringify(u.input) },
                { quien: `⟵ ${u.tool}`, texto: u.text ?? '' },
              ]),
            ]
      for (const pieza of piezas) {
        const i = pieza.texto.toLowerCase().indexOf(t)
        if (i < 0) continue
        total++
        if (resultados.length < 30) resultados.push({ id: p.id, quien: pieza.quien, texto: pieza.texto, i })
      }
    }
  }
  return { resultados, total }
}

function main() {
  const [orden, ...args] = process.argv.slice(2)
  switch (orden) {
    case 'estado':
      return estado(args[0])
    case 'fork':
      return fork(args[0], args[1], args[2])
    case 'mensajes':
      return mensajes(args[0], args[1])
    case 'buscar':
      return buscar(args[0], args[1])
    case 'anclas':
      return anclas(args[0], args.slice(1))
    default:
      throw new Error(`orden desconocida: ${orden}`)
  }
}

try {
  process.stdout.write(JSON.stringify(main()))
} catch (error) {
  process.stdout.write(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
  process.exitCode = 1
}
