import type { EngineInterface } from 'claude-code'

import type { Arbol, Hallado, Nodo, Paso } from '../../types'

import { k } from '../comun/formato'
import { cambiarConsulta } from '../estado/arbol'
import { ayudante, carpeta, enCola, leerDisco, mensajeDe, mensajesDe } from './disco'
import { estimar, extracto, pasos, prefijoComun, transcripcion } from './mensajes'
import { ancestroComun, ancestros, buscarNodo, etiquetaNodo, filasArbol, hijos, turnos } from './modelo'

// Buscar, comparar y exportar checkpoints, y los textos de /cp-buscar, /cp-diff,
// /cp-exportar y /cp-arbol.

type $ = EngineInterface

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
    const marca = n.id === head ? '◉' : n.nombre !== undefined ? '◆' : n.abandonado === true ? '◌' : '○'
    const plegados = f.plegados > 0 ? `┄ ${f.plegados} ┄ ` : ''
    return `${f.guia}${plegados}${marca} ${n.id} ${etiquetaNodo(n)} · t${n.turnos} · ${k(n.tokens)}${n.id === head ? '  ← aquí' : ''}`
  })
  return [
    `Árbol de checkpoints · ${a.nodos.length} nodos`,
    ...lineas,
    '',
    '/cp <nombre> · /cp-ir <id|nombre> · /cp-fork <id|nombre> [nombre] · /cp-diff · /cp-buscar · /cp-exportar · /ctx → ⎇ Árbol',
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
