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

// Lo que queda de una ventana de uso (`5h`, `7d`), en porcentaje, y cuándo se
// reinicia (milisegundos desde la época), si la API lo dice.
export type Limite = { tipo: string; libre: number; reinicio?: number }

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

export type Pestana = 'reparto' | 'diagnostico' | 'tendencia' | 'subagentes' | 'llamadas' | 'arbol'

// Un checkpoint del árbol de la conversación: un puntero a un mensaje del
// transcript del motor (`sesion` + `uuid`). Su conversación es la cadena que
// sube desde ese mensaje, como en rewind; el checkpoint no copia nada.
export type Nodo = {
  id: string
  padre: string | null
  // Nombre que le dio la persona (o el del fork); sin él es automático.
  nombre?: string
  creado: number
  // La sesión cuyo transcript tiene el mensaje, y el mensaje.
  sesion: string
  uuid: string
  // Mensajes y prompts de la conversación en este punto, ocupación y el
  // último prompt.
  mensajes: number
  turnos: number
  tokens: number
  prompt: string
}

// Un acierto de la búsqueda en el árbol: el checkpoint y el texto alrededor.
export type Hallado = { id: string; quien: string; extracto: string }

// Un turno de una rama, para comparar: el prompt, cómo acabó la respuesta y
// cuántas herramientas usó.
export type Paso = { prompt: string; respuesta: string; herramientas: number }

// Lo que la pestaña Árbol muestra bajo el detalle: una búsqueda o una
// comparación entre dos checkpoints.
export type Consulta =
  | { tipo: 'buscar'; texto: string; resultados: Hallado[]; total: number }
  | { tipo: 'comparar'; a: string; b: string; comun: string | null; deA: Paso[]; deB: Paso[] }

// El árbol de un proyecto: los nodos, en qué nodo está cada sesión (HEAD) y
// el nombre de cada sesión que es un fork con nombre.
export type Arbol = {
  version: 2
  siguiente: number
  nodos: Nodo[]
  heads: Record<string, string>
  titulos: Record<string, string>
}

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
      // La hora, refrescada cada minuto: mantiene viva la cuenta atrás de 5h/7d.
      ahora: Shaped<number>
      // El árbol de checkpoints del proyecto (copia de lo guardado en disco).
      arbol: Shaped<Arbol | null>
      // El HEAD de esta sesión: el nodo en que está la conversación.
      head: Shaped<string | null>
      // El nodo elegido en la pestaña Árbol.
      seleccion: Shaped<string | null>
      // Mostrar cada turno en lugar de plegar las cadenas automáticas.
      verTodo: Shaped<boolean>
      // El nodo cuyo borrado espera confirmación.
      borrando: Shaped<string | null>
      // Una operación del árbol en curso (restaurar, fork, injertar), para el panel.
      ocupado: Shaped<string | null>
      // La búsqueda o comparación abierta en la pestaña Árbol.
      consulta: Shaped<Consulta | null>
    }
  }
}
