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
  // Los argumentos de la llamada (JSON recortado) y el comienzo de lo que
  // devolvió: las pruebas que lleva el informe de un hallazgo.
  entrada?: string
  muestra?: string
  // Turno de la conversación en que llegó (el que cerrará como `n`) y hora.
  turno?: number
  hora?: number
  // Las líneas pedidas de una lectura parcial (offset/limit del Read).
  desde?: number
  cuantas?: number
}

// Una petición que tuvo que reescribir la caché que antes servía: hora, turno,
// tokens reescritos, caché antes y después, la pausa desde la respuesta
// anterior y el modelo antes y ahora (si cambió, la caché no sirve).
export type Rotura = {
  hora: number
  turno: number
  reescritos: number
  antes: number
  despues: number
  pausa?: number
  modeloAntes?: string
  modelo?: string
}

// Una porción del gráfico de quesitos; `rgb` es 0xRRGGBB.
export type Quesito = { nombre: string; tokens: number; rgb: number }

// Un hallazgo llevado a una sesión aparte con IA. Está en curso hasta que esa
// sesión añade «## Resuelto» al informe (o la persona lo marca a mano);
// entonces lleva la hora (`resuelto`) y lo que se cambió (`resumen`). Se guarda
// en `$.store` para todos los proyectos; el estado tiene solo los de este.
export type Seguimiento = {
  clave: string
  proyecto: string
  texto: string
  informe: string
  abierto: number
  resuelto?: number
  resumen?: string
}

// Las clases de mal uso que detecta el diagnóstico.
export type TipoHallazgo =
  | 'relectura'
  | 'lectura'
  | 'bash'
  | 'mcp'
  | 'subagente'
  | 'busqueda'
  | 'otra'
  | 'repetida'
  | 'exploracion'
  | 'memoria'
  | 'mcp-cargado'
  | 'cache'
  | 'subagente-lleno'
  | 'ritmo'

// Un mal uso del contexto detectado, con lo que cuesta y cómo evitarlo.
// `clave` lo identifica para ignorarlo; `ruta`, el fichero que se puede abrir;
// `pruebas`, lo observado (llamadas, argumentos, resultado) que va en el
// informe para resolverlo con IA.
export type Hallazgo = {
  clave: string
  tipo: TipoHallazgo
  gravedad: 'alta' | 'media'
  texto: string
  consejo: string
  tokens: number
  ruta?: string
  herramienta?: string
  pruebas: string[]
  // El comienzo de lo que devolvió la llamada, tal cual.
  muestra?: string
  // Cuántas veces se ha dado el mismo patrón (llamadas, lecturas, turnos…).
  veces?: number
  // La hora de la prueba más reciente: si es posterior a cuando se dio por
  // resuelto, el problema ha vuelto (recaída).
  ultima?: number
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
  // El modelo y el esfuerzo con que se trabajaba en este punto (los de la
  // última petición): volver aquí los vuelve a poner. Los checkpoints de
  // antes de guardarlos no los tienen.
  modelo?: string
  esfuerzo?: string
  // Un rewind nativo dejó este punto fuera de la conversación de su sesión
  // (y quizá también restauró los ficheros): se sigue pudiendo volver a él,
  // pero puede que el código ya no esté así.
  abandonado?: true
}

// Un rewind detectado cuyo aviso espera respuesta: la sesión en que pasó y los
// checkpoints que dejó fuera.
export type Rewind = { sesion: string; ids: string[] }

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
  // El último rewind cuyo aviso espera «Borrar» o «Conservar».
  rewind?: Rewind
}

// El último umbral avisado y el `orden` de la última llamada de entonces.
export type Aviso = { nivel: number; desde: number }

// Un nivel de esfuerzo de `/effort`.
export type Nivel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

// El selector de modelo y esfuerzo de la banda: si está desplegado y lo pulsado
// a mitad de turno, que espera al final del turno para aplicarse (`null`: nada
// pendiente).
export type Selector = { desplegado: boolean; modelo: string | null; esfuerzo: Nivel | null }

// El modelo y el esfuerzo con que se envió la última petición del turno
// principal; `null` si aún no ha habido ninguna o el modelo no toma esfuerzo.
export type Aplicado = { modelo: string | null; esfuerzo: string | null }

declare module 'claude-code' {
  interface PluginState {
    'contexto-vivo': {
      llamadas: Shaped<Llamada[]>
      total: Shaped<Total | null>
      // Las ventanas de uso (5h, 7d) de la última lectura: no se borran con
      // /clear ni al compactar, y se guardan en $.store para tenerlas al abrir.
      limites: Shaped<Limite[]>
      foto: Shaped<Foto | null>
      aviso: Shaped<Aviso>
      // Dónde está el reparto: [] la raíz, ['Memoria'], ['Herramientas MCP', 'Notion'].
      navegacion: Shaped<string[]>
      // Los mensajes más largos de la conversación, al entrar en «Conversación».
      mensajes: Shaped<Fila[]>
      pestana: Shaped<Pestana>
      historial: Shaped<Turno[]>
      subagentes: Shaped<Subagente[]>
      // Las veces que la caché se invalidó en esta conversación.
      roturas: Shaped<Rotura[]>
      // Claves de los hallazgos ignorados (copia de lo guardado en $.store).
      ignorados: Shaped<string[]>
      // Hallazgos de este proyecto llevados a la IA, en curso o resueltos
      // (copia de lo guardado en $.store).
      seguimiento: Shaped<Seguimiento[]>
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
      // El nodo abandonado por un rewind cuya restauración espera confirmación.
      restaurando: Shaped<string | null>
      // Una operación del árbol en curso (restaurar, fork, injertar), para el panel.
      ocupado: Shaped<string | null>
      // La búsqueda o comparación abierta en la pestaña Árbol.
      consulta: Shaped<Consulta | null>
      // El selector de modelo y esfuerzo de la banda sobre el prompt.
      selector: Shaped<Selector>
      // Lo último enviado al modelo en la conversación principal (fila del modo).
      aplicado: Shaped<Aplicado>
    }
  }
}
