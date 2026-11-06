// Formato de texto y cifras: tokens estimados, `k`, rutas cortas, nombres de
// herramienta y texto en una línea. Puro: no usa `$`.

// Caracteres por token al estimar un resultado (texto en español y código).
export const CARACTERES_POR_TOKEN = 3.5

export function k(n: number): string {
  if (Math.abs(n) < 1000) return String(Math.round(n))
  return `${(n / 1000).toFixed(Math.abs(n) < 10000 ? 1 : 0)}k`
}

export function ordenar<T extends { tokens: number }>(filas: T[], cuantas: number): T[] {
  return [...filas].sort((a, b) => b.tokens - a.tokens).slice(0, cuantas)
}

// Texto de la conversación listo para dibujar en una línea: sin secuencias de
// escape ANSI (las trae la salida de algunos comandos) ni otros caracteres de
// control, que el panel no acepta, y con los espacios juntos.
export function enLinea(texto: string): string {
  return texto
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b[\]P^_][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g, '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function corta(ruta: string): string {
  return ruta.split(/[\\/]/).slice(-2).join('/')
}

export function nombreHerramienta(herramienta: string): string {
  if (!herramienta.startsWith('mcp__')) return herramienta
  return herramienta.slice(5).replace(/^claude_ai_/, '').replace('__', '·')
}

// «45m», «2h 14m», «3d 4h»: lo que falta, redondeado al minuto hacia arriba.
export function duracionCorta(ms: number): string {
  const minutos = Math.max(1, Math.ceil(ms / 60_000))
  if (minutos < 60) return `${minutos}m`
  const horas = Math.floor(minutos / 60)
  if (horas < 24) return `${horas}h ${String(minutos % 60).padStart(2, '0')}m`
  return `${Math.floor(horas / 24)}d ${horas % 24}h`
}

export function etiquetar(entrada: Record<string, unknown>): string {
  const texto = (clave: string) =>
    typeof entrada[clave] === 'string' ? (entrada[clave] as string) : undefined
  const ruta = texto('file_path') ?? texto('notebook_path')
  if (ruta !== undefined) return corta(ruta)
  const otra =
    texto('description') ??
    texto('pattern') ??
    texto('command') ??
    texto('query') ??
    texto('url') ??
    texto('skill') ??
    texto('path') ??
    ''
  return otra.replace(/\s+/g, ' ')
}
