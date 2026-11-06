import type { EngineInterface } from 'claude-code'

import { cambiarIgnorados } from '../estado/contexto'

// Hallazgos del diagnóstico que la persona ignora: se guardan en `$.store` y
// sobreviven entre sesiones.

const CLAVE_IGNORADOS = 'ignorados'

// Los hallazgos ignorados se guardan entre sesiones.
export async function cargarIgnorados($: EngineInterface): Promise<void> {
  const guardados = await $.store.get(CLAVE_IGNORADOS)
  if (Array.isArray(guardados)) {
    const claves = guardados.filter((x): x is string => typeof x === 'string')
    await cambiarIgnorados($, () => claves)
  }
}

export async function ignorar($: EngineInterface, clave: string): Promise<void> {
  const claves = await cambiarIgnorados($, lista => (lista.includes(clave) ? lista : [...lista, clave].slice(-200)))
  await $.store.set(CLAVE_IGNORADOS, claves)
}

export async function restaurarIgnorados($: EngineInterface): Promise<void> {
  await cambiarIgnorados($, () => [])
  await $.store.delete(CLAVE_IGNORADOS)
}
