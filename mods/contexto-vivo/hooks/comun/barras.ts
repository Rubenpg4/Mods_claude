// Barras y minigráficas de texto: sectores ○◔◑◕●, barras finas por octavos,
// segmentos ▰▱, chispas ▁▂▃ y la barra de uso con la marca del ritmo. Puro.

const SECTORES = ['○', '◔', '◑', '◕', '●']
const OCTAVOS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']
const ESCALONES = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']

export function sector(porcentaje: number): string {
  return SECTORES[Math.min(4, Math.max(0, Math.round(porcentaje / 25)))] ?? '○'
}

// Barra de ancho fijo con resolución de octavos de celda.
export function barraFina(valor: number, maximo: number, ancho: number): string {
  const octavos = Math.round((maximo <= 0 ? 0 : Math.min(1, valor / maximo)) * ancho * 8)
  return '█'.repeat(Math.floor(octavos / 8)) + (OCTAVOS[octavos % 8] ?? '')
}

// Barra de diez segmentos ▰▱ para un porcentaje.
export function segmentos(porcentaje: number, ancho = 10): string {
  const llenos = Math.min(ancho, Math.max(0, Math.round((porcentaje / 100) * ancho)))
  return '▰'.repeat(llenos) + '▱'.repeat(ancho - llenos)
}

// Minigráfica de una línea: un escalón por valor (0–100).
export function chispa(valores: number[]): string {
  return valores.map(v => ESCALONES[Math.min(7, Math.max(0, Math.round((v / 100) * 7)))] ?? '▁').join('')
}

// Un tramo de la barra de uso, que se dibuja sobre un carril de color liso:
// `usado`, bloques llenos; `parcial`, la celda del borde (un octavo de bloque
// del color de lo usado sobre el carril); `libre`, carril vacío; la marca del
// ritmo, una raya fina sobre lo usado o sobre el carril.
export type Tramo = { clase: 'usado' | 'parcial' | 'libre' | 'marcaUsado' | 'marcaLibre'; texto: string }

// Barra de uso con resolución de octavos y, si hay ritmo, una marca donde
// irías al paso del tiempo.
export function barraRitmo(usado: number, ritmo: number | null, ancho: number): Tramo[] {
  const octavos = Math.round((Math.min(100, Math.max(0, usado)) / 100) * ancho * 8)
  const llenas = Math.floor(octavos / 8)
  const resto = octavos % 8
  const marca = ritmo === null ? -1 : Math.min(ancho - 1, Math.floor((ritmo / 100) * ancho))
  const tramos: Tramo[] = []
  for (let i = 0; i < ancho; i++) {
    const celda: Tramo =
      i === marca
        ? { clase: i < llenas ? 'marcaUsado' : 'marcaLibre', texto: '▕' }
        : i < llenas
          ? { clase: 'usado', texto: '█' }
          : i === llenas && resto > 0
            ? { clase: 'parcial', texto: OCTAVOS[resto] ?? '' }
            : { clase: 'libre', texto: ' ' }
    const ultimo = tramos.at(-1)
    if (ultimo !== undefined && ultimo.clase === celda.clase) ultimo.texto += celda.texto
    else tramos.push(celda)
  }
  return tramos
}
