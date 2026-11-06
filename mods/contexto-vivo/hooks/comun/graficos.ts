import type { Quesito, Turno } from '../../types'

import type { Config } from '../config'
import { css, rgbNivel } from './colores'

// Gráficos del panel: el anillo del reparto y las columnas de la tendencia, en
// celdas de Raster (terminal) o en SVG (escritorio). Puro.

// Color «por defecto del terminal» de una celda de Raster.
const DEFECTO = 0x01000000
// Líneas de referencia del gráfico de tendencia: aviso y compactación.
const LINEA_AVISO = 0x6e5a2e
const LINEA_COMPACTA = 0x2f4f7a
// Las mismas líneas en SVG, discontinuas y más vivas.
const AMBAR_LINEA = 0xff9f0a
const AZUL_LINEA = 0x0a84ff

export type Celdas = { columnas: number; filas: number; celdas: string }

function base64(bytes: Uint8Array): string {
  const conMetodo = bytes as Uint8Array & { toBase64?: () => string }
  if (typeof conMetodo.toBase64 === 'function') return conMetodo.toBase64()
  let binario = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binario)
}

// Pasa una rejilla de píxeles a celdas: cada celda son dos píxeles (▀ con el
// color de letra arriba y el de fondo abajo), así los píxeles salen cuadrados.
function aCeldas(columnas: number, filas: number, pixel: (x: number, y: number) => number): Celdas {
  const palabras = new Uint32Array(columnas * filas * 3)
  for (let fila = 0; fila < filas; fila++) {
    for (let col = 0; col < columnas; col++) {
      const arriba = pixel(col, fila * 2)
      const abajo = pixel(col, fila * 2 + 1)
      const i = (fila * columnas + col) * 3
      if (arriba === DEFECTO && abajo === DEFECTO) palabras.set([0x20, DEFECTO, DEFECTO], i)
      else if (arriba === DEFECTO) palabras.set([0x2584, abajo, DEFECTO], i)
      else palabras.set([0x2580, arriba, abajo], i)
    }
  }
  return { columnas, filas, celdas: base64(new Uint8Array(palabras.buffer)) }
}

// Grosor del anillo: radio del hueco respecto al exterior.
const HUECO = 0.6
// Parte mínima de la vuelta que ocupa un quesito, para que no quede en un
// píxel suelto (la leyenda da la cifra exacta).
const QUESITO_MINIMO = 0.02
// Muestras por lado dentro de cada píxel: el píxel toma lo que cubre la mayoría.
// Impar, para que entre dos colores nunca haya empate (el anillo sale simétrico).
const MUESTRAS = 5

// Anillo de quesitos para el terminal, empezando arriba y en sentido horario,
// con `centro` escrito en el hueco. Cada píxel se muestrea MUESTRAS×MUESTRAS
// veces y se queda con el color mayoritario: bordes y cortes más limpios que
// mirando solo su centro.
export function anillo(qs: Quesito[], diametro: number, centro = ''): Celdas {
  const suma = qs.reduce((s, q) => s + q.tokens, 0)
  const partes = qs.map(q => Math.max(QUESITO_MINIMO, q.tokens / Math.max(1, suma)))
  const sumaPartes = partes.reduce((s, p) => s + p, 0)
  const cortes: { hasta: number; rgb: number }[] = []
  let acumulado = 0
  qs.forEach((q, i) => {
    acumulado += (partes[i] ?? 0) / sumaPartes
    cortes.push({ hasta: acumulado, rgb: q.rgb })
  })
  const radio = diametro / 2
  const colorEn = (px: number, py: number): number => {
    const dx = px - radio
    const dy = py - radio
    const r = Math.hypot(dx, dy) / radio
    if (r > 1 || r < HUECO) return DEFECTO
    let angulo = Math.atan2(dx, -dy) / (2 * Math.PI)
    if (angulo < 0) angulo += 1
    return (cortes.find(c => angulo <= c.hasta) ?? cortes.at(-1))?.rgb ?? DEFECTO
  }
  const filas = diametro / 2
  const resultado = aCeldas(diametro, filas, (x, y) => {
    if (suma <= 0) return DEFECTO
    const votos = new Map<number, number>()
    for (let i = 0; i < MUESTRAS; i++) {
      for (let j = 0; j < MUESTRAS; j++) {
        const c = colorEn(x + (i + 0.5) / MUESTRAS, y + (j + 0.5) / MUESTRAS)
        votos.set(c, (votos.get(c) ?? 0) + 1)
      }
    }
    let mejor = DEFECTO
    let maximo = -1
    for (const [c, n] of votos) {
      if (n > maximo) {
        mejor = c
        maximo = n
      }
    }
    return mejor
  })
  if (centro === '' || suma <= 0) return resultado
  return escribir(resultado, Math.floor(filas / 2), centro)
}

// Escribe `texto` centrado en una fila de celdas, en el color del terminal.
function escribir(c: Celdas, fila: number, texto: string): Celdas {
  const binario = atob(c.celdas)
  const bytes = new Uint8Array(binario.length)
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i)
  const palabras = new Uint32Array(bytes.buffer)
  const letras = [...texto].slice(0, c.columnas)
  const desde = Math.floor((c.columnas - letras.length) / 2)
  letras.forEach((letra, i) => {
    palabras.set([letra.codePointAt(0) ?? 0x20, DEFECTO, DEFECTO], ((fila * c.columnas) + desde + i) * 3)
  })
  return { ...c, celdas: base64(new Uint8Array(palabras.buffer)) }
}

// El mismo anillo en SVG para las superficies que no son el terminal.
export function anilloSvg(qs: Quesito[]): string {
  const suma = qs.reduce((s, q) => s + q.tokens, 0)
  let acumulado = 0
  const arcos = qs.map(q => {
    const p = (q.tokens / Math.max(1, suma)) * 100
    const arco = `<circle r="15.9155" cx="21" cy="21" fill="none" stroke="${css(q.rgb)}" stroke-width="7" stroke-dasharray="${p.toFixed(3)} ${(100 - p).toFixed(3)}" stroke-dashoffset="${(25 - acumulado).toFixed(3)}"/>`
    acumulado += p
    return arco
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 42 42">${arcos.join('')}</svg>`
}

// Gráfico de barras de la ocupación por turno, con las líneas del aviso y de
// la compactación; las barras toman el color de su nivel.
export function columnas(turnos: Turno[], ancho: number, filas: number, cfg: Config, compactaPct: number | null): Celdas {
  const alto = filas * 2
  const grueso = Math.max(1, Math.min(3, Math.floor(ancho / Math.max(1, turnos.length))))
  const visibles = turnos.slice(-Math.floor(ancho / grueso))
  const filaDe = (pct: number) => alto - Math.round((pct / 100) * alto)
  const filaAviso = filaDe(cfg.aviso)
  const filaCompacta = compactaPct === null ? -1 : filaDe(compactaPct)
  return aCeldas(ancho, filas, (x, y) => {
    const turno = visibles[Math.floor(x / grueso)]
    // Un hueco de un píxel entre barras gruesas para que se distingan.
    const hueco = grueso > 1 && x % grueso === grueso - 1
    if (turno !== undefined && !hueco) {
      const altura = Math.max(1, Math.round((turno.porcentaje / 100) * alto))
      if (y >= alto - altura) return rgbNivel(turno.porcentaje, cfg)
    }
    if (y === filaCompacta && x % 2 === 0) return LINEA_COMPACTA
    if (y === filaAviso && x % 2 === 0) return LINEA_AVISO
    return DEFECTO
  })
}

// El mismo gráfico en SVG.
export function columnasSvg(turnos: Turno[], cfg: Config, compactaPct: number | null): string {
  const visibles = turnos.slice(-60)
  const ancho = Math.max(1, visibles.length) * 4
  const barras = visibles.map((t, i) => {
    const alto = Math.max(1, (t.porcentaje / 100) * 48)
    return `<rect x="${i * 4}" y="${(48 - alto).toFixed(2)}" width="3" height="${alto.toFixed(2)}" rx="0.6" fill="${css(rgbNivel(t.porcentaje, cfg))}"/>`
  })
  const linea = (pct: number, color: number) =>
    `<line x1="0" x2="${ancho}" y1="${(48 - (pct / 100) * 48).toFixed(2)}" y2="${(48 - (pct / 100) * 48).toFixed(2)}" stroke="${css(color)}" stroke-width="0.6" stroke-dasharray="2 2"/>`
  const lineas = [linea(cfg.aviso, AMBAR_LINEA)]
  if (compactaPct !== null) lineas.push(linea(compactaPct, AZUL_LINEA))
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ancho} 48" preserveAspectRatio="none">${lineas.join('')}${barras.join('')}</svg>`
}
