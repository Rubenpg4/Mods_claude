import type { EngineInterface } from 'claude-code'

import { corta } from './formato'

// Lo que el mod toca fuera de sí: abrir un fichero en VS Code y la carpeta de
// datos del mod (`<.claude>/contexto-vivo/<sub>/<proyecto>`).

// Abre un fichero en VS Code. En Windows `code` es un .cmd que solo arranca a
// través de cmd, así que la ruta no puede llevar caracteres que cmd interprete.
export async function abrir($: EngineInterface, ruta: string): Promise<void> {
  try {
    await $.process.run(['code', ruta])
    return
  } catch {
    // Sigue con cmd.
  }
  if (/[&|<>^"%!]/.test(ruta)) {
    $.ui.toast(`No se abre ${corta(ruta)}: la ruta tiene caracteres especiales`)
    return
  }
  try {
    await $.process.run(['cmd', '/c', 'code', ruta])
  } catch {
    $.ui.toast('No se encontró el comando code de VS Code')
  }
}

// La carpeta de datos del mod: `contexto-vivo/<sub>` en la `.claude` sobre la
// del mod; si el mod no está bajo una, en la `.claude` del proyecto.
export async function carpetaDatos($: EngineInterface, sub: string): Promise<string> {
  const raiz = (await $.session.root()).replace(/\\/g, '/')
  const proyecto = raiz.replace(/[^A-Za-z0-9]/g, '-')
  const mod = $.plugin.root.replace(/\\/g, '/')
  const i = mod.lastIndexOf('/.claude/')
  const claude = i >= 0 ? mod.slice(0, i + 8) : `${raiz}/.claude`
  return `${claude}/contexto-vivo/${sub}/${proyecto}`
}
