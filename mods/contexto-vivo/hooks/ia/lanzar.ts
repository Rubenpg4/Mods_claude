import type { EngineInterface, RenderSurface, Timer } from 'claude-code'

import type { Hallazgo, Seguimiento } from '../../types'

import { carpetaDatos } from '../comun/entorno'
import { corta } from '../comun/formato'
import { cambiarSeguimiento, leerSeguimiento, leerTotal } from '../estado/contexto'
import { ESFUERZO_IA, ficheroIA, informeIA, MODELO_IA, promptIA, resolucionIA, tituloIA } from './informe'

// Resolver con IA, la parte que actúa: escribe el informe y abre la sesión aparte
// de `claude` en Windows Terminal o en una consola, con PowerShell 7; si no puede,
// copia la orden para pegarla a mano. Después sigue el hallazgo hasta que esa
// sesión lo marca como resuelto en el informe.

// Los argumentos de `claude` para la sesión aparte.
export function argumentosIA(titulo: string, prompt: string): string[] {
  return ['--model', MODELO_IA, '--effort', ESFUERZO_IA, '-n', titulo, prompt]
}

// La orden de PowerShell que arranca la sesión aparte, con cada argumento
// entre comillas simples (una comilla simple se dobla).
export function ordenPwsh(titulo: string, prompt: string): string {
  return ['claude', ...argumentosIA(titulo, prompt).map(a => (/^[A-Za-z0-9-]+$/.test(a) ? a : `'${a.replace(/'/g, "''")}'`))].join(' ')
}

// Una orden para `pwsh -EncodedCommand`: UTF-16LE en base64. Así ni Windows
// Terminal (que parte en `;`) ni cmd ni pwsh tocan comillas ni acentos.
export function codificarPwsh(orden: string): string {
  let binario = ''
  for (let i = 0; i < orden.length; i++) {
    const c = orden.charCodeAt(i)
    binario += String.fromCharCode(c & 0xff, c >> 8)
  }
  return btoa(binario)
}

// Las órdenes con que se intenta abrir la sesión aparte, por orden: una
// pestaña nueva en la ventana de Windows Terminal más reciente (con el perfil
// por defecto) y, si no está, una consola con `start`. En las dos corre
// PowerShell 7 con -NoExit: al salir de Claude queda la consola en el proyecto.
export function lanzadoresIA(directorio: string, titulo: string, prompt: string): string[][] {
  const pwsh = ['pwsh', '-NoLogo', '-NoExit', '-EncodedCommand', codificarPwsh(ordenPwsh(titulo, prompt))]
  return [
    ['wt.exe', '-w', '0', 'new-tab', '-d', directorio, ...pwsh],
    ['cmd', '/c', 'start', '', '/D', directorio, ...pwsh],
  ]
}

// Escribe el informe del hallazgo y abre una sesión de Claude Code aparte
// (Sonnet, esfuerzo alto) en el proyecto que empieza leyéndolo. Si no se puede
// abrir una terminal, copia la orden para pegarla a mano.
export async function resolverConIA($: EngineInterface, h: Hallazgo, superficie?: RenderSurface): Promise<void> {
  const [raiz, sesion, ahora, total] = await Promise.all([
    $.session.root(),
    $.session.id(),
    $.clock.now(),
    leerTotal($),
  ])
  const fecha = new Date(ahora).toISOString().slice(0, 19).replace('T', ' ')
  const ruta = `${await carpetaDatos($, 'informes')}/${ficheroIA(h, fecha)}`
  const informe = informeIA(h, {
    fecha,
    proyecto: raiz,
    sesion,
    ventana: total?.ventana,
    porcentaje: total?.porcentaje,
  })
  try {
    await $.fs.write(ruta, informe)
  } catch (error) {
    $.ui.toast(`✦ No se pudo escribir el informe: ${error instanceof Error ? error.message : String(error)}`)
    return
  }
  // En curso desde ahora: uno nuevo para la misma clave sustituye al anterior.
  await cambiarGuardados($, lista => [
    ...lista.filter(s => !(s.clave === h.clave && s.proyecto === raiz)),
    { clave: h.clave, proyecto: raiz, texto: h.texto, informe: ruta, abierto: ahora },
  ])
  const titulo = tituloIA(h)
  const prompt = promptIA(ruta)
  const seguro = !/[&|<>^"%!]/.test(raiz)
  for (const orden of lanzadoresIA(raiz, titulo, prompt)) {
    if (orden[0] === 'cmd' && !seguro) continue
    try {
      const r = await $.process.run(orden, { timeoutMs: 15_000 })
      if (r.exitCode === 0) {
        $.ui.toast(`✦ Chat con ${MODELO_IA} (${ESFUERZO_IA}) abierto para «${h.texto.slice(0, 50)}» · informe en ${corta(ruta)}`)
        return
      }
    } catch {
      // Sigue con la siguiente.
    }
  }
  const manual = ordenPwsh(titulo, prompt)
  const copia = await $.ui.copy({ text: manual, ...(superficie === undefined ? {} : { surface: superficie }) })
  $.ui.toast(
    copia.isCopied
      ? `✦ No se pudo abrir una terminal: orden copiada, pégala en una terminal en ${raiz}`
      : `✦ No se pudo abrir una terminal. Informe en ${ruta}; ábrelo con: ${manual}`,
  )
}

// ── Seguimiento ─────────────────────────────────────────────────────────────
//
// Cada hallazgo llevado a la IA se guarda en `$.store` (todos los proyectos) y
// el átomo tiene los de este proyecto. Mientras haya alguno en curso, cada
// `SONDEO_MS` se leen sus informes: si la sesión aparte añadió «## Resuelto»,
// queda resuelto, con lo que escribió debajo. Otra sesión con el mod puede
// marcarlo antes: el cambio se ve igual, porque se compara con lo guardado.

const CLAVE_SEGUIMIENTO = 'seguimiento'
const MAXIMO_SEGUIMIENTO = 100
export const SONDEO_MS = 10_000

let sondeo: Timer | null = null

function esSeguimiento(x: unknown): x is Seguimiento {
  const s = x as Partial<Seguimiento> | null
  return (
    s !== null &&
    typeof s === 'object' &&
    typeof s.clave === 'string' &&
    typeof s.proyecto === 'string' &&
    typeof s.texto === 'string' &&
    typeof s.informe === 'string' &&
    typeof s.abierto === 'number' &&
    (s.resuelto === undefined || typeof s.resuelto === 'number') &&
    (s.resumen === undefined || typeof s.resumen === 'string')
  )
}

async function guardados($: EngineInterface): Promise<Seguimiento[]> {
  const g = await $.store.get(CLAVE_SEGUIMIENTO)
  return Array.isArray(g) ? g.filter(esSeguimiento) : []
}

// Deja en el átomo lo de este proyecto, sin redibujar si no cambió nada.
async function reflejar($: EngineInterface, lista: Seguimiento[]): Promise<Seguimiento[]> {
  const raiz = await $.session.root()
  const propios = lista.filter(s => s.proyecto === raiz)
  await cambiarSeguimiento($, antes => (JSON.stringify(antes) === JSON.stringify(propios) ? antes : propios))
  return propios
}

// Aplica `f` a lo guardado (que otra sesión puede haber cambiado), lo guarda y
// lo refleja; sigue o deja de sondear según quede algo en curso.
async function cambiarGuardados($: EngineInterface, f: (lista: Seguimiento[]) => Seguimiento[]): Promise<Seguimiento[]> {
  const nuevos = f(await guardados($)).slice(-MAXIMO_SEGUIMIENTO)
  await $.store.set(CLAVE_SEGUIMIENTO, nuevos)
  const propios = await reflejar($, nuevos)
  sondear($, propios.some(s => s.resuelto === undefined))
  return propios
}

function sondear($: EngineInterface, hayPendientes: boolean): void {
  if (!hayPendientes) {
    sondeo?.cancel()
    sondeo = null
    return
  }
  sondeo ??= $.clock.every(SONDEO_MS, () => {
    void comprobarResueltos($).catch(error => $.ui.log(`seguimiento: ${String(error)}`, { to: 'debug' }))
  })
}

// Al empezar la sesión (y tras /clear): lo guardado, y el sondeo si hace falta.
export async function cargarSeguimiento($: EngineInterface): Promise<void> {
  const propios = await reflejar($, await guardados($))
  sondear($, propios.some(s => s.resuelto === undefined))
}

// Lee los informes en curso de este proyecto y da por resueltos los que ya
// llevan «## Resuelto»; avisa de cada uno que esta sesión tenía en curso.
export async function comprobarResueltos($: EngineInterface): Promise<void> {
  const antes = await leerSeguimiento($)
  const raiz = await $.session.root()
  const encontrados = new Map<string, string>()
  for (const s of await guardados($)) {
    if (s.proyecto !== raiz || s.resuelto !== undefined) continue
    let texto: string
    try {
      texto = await $.fs.read(s.informe)
    } catch {
      continue
    }
    const resumen = resolucionIA(texto)
    if (resumen !== null) encontrados.set(s.clave, resumen)
  }
  const ahora = await $.clock.now()
  const despues = await cambiarGuardados($, lista =>
    lista.map(s =>
      s.proyecto === raiz && s.resuelto === undefined && encontrados.has(s.clave)
        ? { ...s, resuelto: ahora, resumen: encontrados.get(s.clave) ?? '' }
        : s,
    ),
  )
  for (const s of despues) {
    if (s.resuelto === undefined || antes.find(a => a.clave === s.clave)?.resuelto !== undefined) continue
    if (!antes.some(a => a.clave === s.clave)) continue
    $.ui.toast(`✓ Resuelto: ${s.texto.slice(0, 60)}${s.resumen ? ` · ${s.resumen.slice(0, 80)}` : ''}`)
  }
}

// La persona lo da por resuelto (lo arregló a mano o la IA no lo marcó).
export async function marcarResuelto($: EngineInterface, h: Hallazgo): Promise<void> {
  const raiz = await $.session.root()
  const ahora = await $.clock.now()
  await cambiarGuardados($, lista => {
    const previo = lista.find(s => s.clave === h.clave && s.proyecto === raiz)
    const base = previo ?? { clave: h.clave, proyecto: raiz, texto: h.texto, informe: '', abierto: ahora }
    return [
      ...lista.filter(s => s !== previo),
      { ...base, resuelto: ahora, resumen: previo?.resumen ?? 'Marcado como resuelto a mano' },
    ]
  })
}

// Vuelve a dejarlo como un hallazgo más (sin seguimiento).
export async function reabrir($: EngineInterface, clave: string): Promise<void> {
  const raiz = await $.session.root()
  await cambiarGuardados($, lista => lista.filter(s => !(s.clave === clave && s.proyecto === raiz)))
}
