import type { EngineInterface, RenderSurface } from 'claude-code'

import type { Hallazgo } from '../../types'

import { carpetaDatos } from '../comun/entorno'
import { corta } from '../comun/formato'
import { leerTotal } from '../estado/contexto'
import { ESFUERZO_IA, ficheroIA, informeIA, MODELO_IA, promptIA, tituloIA } from './informe'

// Resolver con IA, la parte que actúa: escribe el informe y abre la sesión aparte
// de `claude` en Windows Terminal o en una consola, con PowerShell 7; si no puede,
// copia la orden para pegarla a mano.

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
