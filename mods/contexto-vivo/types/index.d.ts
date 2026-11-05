// Lo que el resultado de una llamada a herramienta añadió a la conversación
// principal, estimado por su longitud.
export type Llamada = {
  id: string
  orden: number
  herramienta: string
  etiqueta: string
  tokens: number
  // Ruta completa del fichero leído y si se leyó solo una parte (offset/limit).
  ruta?: string
  parcial?: boolean
}

// Una porción del gráfico de quesitos; `rgb` es 0xRRGGBB.
export type Quesito = { nombre: string; tokens: number; rgb: number }

// Un mal uso del contexto detectado, con lo que cuesta y cómo evitarlo.
// `clave` lo identifica para ignorarlo; `ruta`, el fichero que se puede abrir.
export type Hallazgo = {
  clave: string
  gravedad: 'alta' | 'media'
  texto: string
  consejo: string
  tokens: number
  ruta?: string
}

// Una fila del desglose (categoría, fichero de memoria, servidor MCP, skill);
// `color` es la clave del tema con que /context la pinta, `ruta` el fichero
// que se puede abrir, `grupo` el servidor de una herramienta MCP y `nota` un
// apunte breve (origen de una skill).
export type Fila = {
  nombre: string
  tokens: number
  color?: string
  tipo?: string
  ruta?: string
  grupo?: string
  nota?: string
}

// Una entrada de la leyenda: entra en otro nivel (`entrar`) o abre un fichero.
export type Entrada = {
  nombre: string
  tokens: number
  rgb: number
  entrar?: string
  ruta?: string
  nota?: string
}

// Lo que queda de una ventana de uso (`5h`, `7d`), en porcentaje.
export type Limite = { tipo: string; libre: number }

// La ocupación tras la última respuesta de la API, como la línea de estado, y
// cómo le fue a la caché en esa petición.
export type Total = {
  tokens: number
  ventana: number
  porcentaje: number
  limites: Limite[]
  // Parte de la entrada servida desde la caché, 0–100; null sin dato.
  cache: number | null
  // Tokens que esa petición tuvo que escribir de nuevo en la caché.
  cacheEscrito: number
}

// El desglose de /context: estimado en local o, con `exacto`, contado con la API.
export type Foto = {
  tokens: number
  ventana: number
  porcentaje: number
  compacta: number | null
  exacto: boolean
  categorias: Fila[]
  memoria: Fila[]
  mcp: Fila[]
  mcpHerramientas: Fila[]
  skills: Fila[]
  agentes: Fila[]
}

// Un turno de la conversación principal al cerrarse.
export type Turno = {
  n: number
  tokens: number
  porcentaje: number
  // Lo que creció respecto al turno anterior; negativo tras compactar.
  delta: number
  prompt: string
  cache: number | null
}

// Un subagente de la sesión y lo lleno que va su propia ventana.
export type Subagente = {
  id: string
  tipo: string
  descripcion: string
  tokens: number
  pico: number
  pasos: number
  activo: boolean
}

export type Pestana = 'reparto' | 'diagnostico' | 'tendencia' | 'subagentes' | 'llamadas'

// El último umbral avisado y el `orden` de la última llamada de entonces.
export type Aviso = { nivel: number; desde: number }

declare module 'claude-code' {
  interface PluginState {
    'contexto-vivo': {
      llamadas: Shaped<Llamada[]>
      total: Shaped<Total | null>
      foto: Shaped<Foto | null>
      aviso: Shaped<Aviso>
      // Dónde está el reparto: [] la raíz, ['Memoria'], ['Herramientas MCP', 'Notion'].
      navegacion: Shaped<string[]>
      // Los mensajes más largos de la conversación, al entrar en «Conversación».
      mensajes: Shaped<Fila[]>
      pestana: Shaped<Pestana>
      historial: Shaped<Turno[]>
      subagentes: Shaped<Subagente[]>
      // Claves de los hallazgos ignorados (copia de lo guardado en $.store).
      ignorados: Shaped<string[]>
      // El botón de compactar espera confirmación.
      confirmar: Shaped<boolean>
      // Lo que la compactación debe conservar, escrito por la persona.
      conservar: Shaped<string>
      // El último prompt enviado, para nombrar cada turno.
      ultimoPrompt: Shaped<string>
    }
  }
}
