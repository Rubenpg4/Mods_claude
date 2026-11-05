import type { PluginOptions } from 'claude-code'

// Los umbrales del mod, de las opciones de /config (`userConfig` del manifiesto).
// Un cambio allí recarga el módulo con los valores nuevos.
export type Config = {
  // Porcentajes de la ventana a los que avisa (ámbar) y alerta (rojo).
  aviso: number
  critico: number
  // Avisos emergentes: umbrales, relecturas, golpes y caché invalidada.
  emergentes: boolean
  // Tokens a partir de los que el diagnóstico señala cada caso.
  lectura: number
  bash: number
  mcp: number
  subagente: number
  otra: number
  memoria: number
  mcpCargado: number
  golpe: number
}

function numero(valor: unknown, porDefecto: number): number {
  return typeof valor === 'number' && Number.isFinite(valor) && valor > 0 ? valor : porDefecto
}

export function leerConfig(opciones: PluginOptions): Config {
  const aviso = Math.min(99, numero(opciones.avisoPorcentaje, 70))
  return {
    aviso,
    critico: Math.max(aviso + 1, Math.min(100, numero(opciones.criticoPorcentaje, 85))),
    emergentes: typeof opciones.avisosEmergentes === 'boolean' ? opciones.avisosEmergentes : true,
    lectura: numero(opciones.limiteLectura, 6000),
    bash: numero(opciones.limiteBash, 5000),
    mcp: numero(opciones.limiteMcp, 8000),
    subagente: numero(opciones.limiteSubagente, 6000),
    otra: numero(opciones.limiteOtra, 8000),
    memoria: numero(opciones.limiteMemoria, 4000),
    mcpCargado: numero(opciones.limiteMcpCargado, 20000),
    golpe: numero(opciones.limiteGolpe, 15000),
  }
}
