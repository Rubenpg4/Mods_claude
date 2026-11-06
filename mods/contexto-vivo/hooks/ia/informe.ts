import type { Hallazgo, Seguimiento, TipoHallazgo } from '../../types'

import { k } from '../comun/formato'

// Resolver con IA, la parte pura: el informe en Markdown de un hallazgo, el
// encargo según su tipo y los nombres de la sesión y del fichero.
//
// Un hallazgo se lleva a una sesión aparte de Claude Code (Sonnet, esfuerzo
// alto): el informe en Markdown con lo detectado y las pruebas, y un encargo
// según el tipo. La sesión arranca en el proyecto y lee el informe.

export const MODELO_IA = 'sonnet'
export const ESFUERZO_IA = 'high'

const ENCARGOS: Record<TipoHallazgo, string> = {
  relectura:
    'El mismo fichero se ha leído varias veces en la misma conversación. Averigua por qué hace falta releerlo (¿es muy largo?, ¿cambia a menudo?, ¿falta un índice?) y propón cómo evitarlo: dividirlo, añadirle un índice o resumen al principio, o una instrucción en CLAUDE.md para leerlo por secciones.',
  lectura:
    'Un fichero grande se ha leído entero de una vez. Revísalo y propón cómo hacer que se lea por partes: dividirlo, añadir un índice con las secciones y sus líneas, o una regla en CLAUDE.md para usar offset/limit o Grep con él.',
  bash:
    'Un comando ha volcado una salida enorme en la conversación. Propón la versión filtrada del mismo comando (flags de salida breve, head/tail, grep, --quiet, formatos compactos) y, si se usa a menudo, una regla en CLAUDE.md o un script del proyecto que lo deje en una salida corta.',
  mcp:
    'Una herramienta MCP ha devuelto una respuesta muy grande. Según sus argumentos y el comienzo de la respuesta, propón cómo pedir menos: paginación, límites, filtros o solo los campos necesarios. Si conviene, redacta una regla para CLAUDE.md con la forma correcta de llamarla.',
  subagente:
    'Un subagente ha devuelto un informe muy largo que entra entero en la conversación principal. Reescribe el encargo para que devuelva solo la conclusión (con un formato y una extensión máximos) y, si es un tipo de agente propio, propón el cambio en su definición.',
  busqueda:
    'Una búsqueda (Grep o Glob) ha devuelto un resultado enorme. Propón la forma acotada de la misma búsqueda (files_with_matches o count, head_limit, path, glob o type) y, si se repite, una regla en CLAUDE.md para buscar así.',
  repetida:
    'La misma llamada, con los mismos argumentos, se ha hecho varias veces y ha devuelto lo mismo. Averigua por qué se repitió (¿se perdió el resultado?, ¿una instrucción la pide en cada paso?) y propón cómo evitarlo.',
  exploracion:
    'La conversación principal ha leído y buscado en muchos ficheros en un mismo turno. Propón cómo delegar esa exploración en un subagente que devuelva solo la conclusión, o qué índice o documentación evitaría tener que explorar.',
  cache:
    'La caché de la conversación se ha invalidado y se reescribieron muchos tokens. Según las pruebas (pausas, cambios de modelo), explica la causa más probable y propón cómo evitarla.',
  'subagente-lleno':
    'Un subagente ha llenado buena parte de su propia ventana. Revisa su encargo o su definición y propón cómo dividir el trabajo o hacer que lea menos.',
  ritmo:
    'Un turno ha hecho crecer el contexto de golpe. Según su prompt y las llamadas que más pesaron, propón cómo partir ese tipo de tarea o acotarla.',
  otra:
    'Una herramienta ha devuelto un resultado muy grande. Propón cómo acotar la llamada (rutas, patrones, límites de resultados) y, si se repite, una regla en CLAUDE.md para hacerlo así siempre.',
  memoria:
    'Un fichero de memoria se carga entero en cada petición. Léelo y propón cómo recortarlo sin perder lo importante: qué sobra, qué se puede condensar y qué conviene mover a reglas por carpeta (.claude/rules), a skills o a documentación que se lea solo cuando haga falta.',
  'mcp-cargado':
    'Los esquemas de las herramientas MCP ocupan mucho en cada petición. Ayúdame a decidir qué servidores no hacen falta en este proyecto y cómo desactivarlos solo aquí (settings del proyecto, .mcp.json, permisos), sin perder los que sí uso.',
}

export type ContextoIA = {
  fecha: string
  proyecto: string
  sesion: string
  // Ocupación de la sesión cuando se detectó, si se conoce.
  ventana?: number
  porcentaje?: number
}

// El informe que lee la sesión aparte: qué pasa, pruebas, consejo y encargo.
export function informeIA(h: Hallazgo, c: ContextoIA): string {
  const peso =
    c.ventana === undefined || c.ventana <= 0
      ? `≈${k(h.tokens)} tokens`
      : `≈${k(h.tokens)} tokens (${((h.tokens / c.ventana) * 100).toFixed(1)} % de una ventana de ${k(c.ventana)})`
  const lineas = [
    `# Problema de contexto: ${h.texto}`,
    '',
    `Detectado por el diagnóstico del mod contexto-vivo en otra sesión de Claude Code (${c.sesion}) el ${c.fecha}.`,
    `Proyecto: ${c.proyecto}`,
    ...(c.porcentaje === undefined ? [] : [`Ocupación de aquella sesión al detectarlo: ${c.porcentaje} %`]),
    '',
    '## Qué pasa',
    '',
    `- Gravedad: ${h.gravedad}`,
    `- Tipo: ${h.tipo}`,
    `- Coste: ${peso}`,
    ...(h.ruta === undefined ? [] : [`- Fichero: ${h.ruta}`]),
    ...(h.herramienta === undefined ? [] : [`- Herramienta: ${h.herramienta}`]),
    '',
    '## Pruebas',
    '',
    ...h.pruebas.map(p => `- ${p}`),
  ]
  if (h.muestra !== undefined && h.muestra.trim() !== '') {
    lineas.push('', 'Comienzo del resultado:', '', '```', h.muestra.replace(/```/g, "'''"), '```')
  }
  lineas.push(
    '',
    '## Consejo del diagnóstico',
    '',
    h.consejo,
    '',
    '## Lo que te pido',
    '',
    ENCARGOS[h.tipo],
    '',
    'No continúes la tarea de aquella sesión: el objetivo es que este problema no vuelva a pasar. Mira los ficheros del proyecto que haga falta, explícame la causa en pocas líneas y, antes de cambiar ningún fichero, enséñame el cambio y espera a que lo apruebe.',
    '',
    '## Al terminar',
    '',
    `Cuando el cambio esté aplicado y yo lo haya aprobado, márcalo como resuelto: añade al final de este mismo informe una línea que sea solo \`${MARCA_RESUELTO}\` y, debajo, una o dos frases con lo que se cambió. El diagnóstico del mod lo detecta y pone el problema como solucionado. Si al final no se cambia nada, no la añadas.`,
  )
  return lineas.join('\n')
}

// La línea con que la sesión aparte da el problema por resuelto, al final
// del informe; debajo, lo que se cambió.
export const MARCA_RESUELTO = '## Resuelto'

// Lo que la sesión aparte escribió bajo «## Resuelto» (hasta el siguiente
// título), en una línea; '' si no escribió nada y null si aún no está.
export function resolucionIA(texto: string): string | null {
  const lineas = texto.split(/\r?\n/)
  const i = lineas.findIndex(l => /^##\s+resuelto\s*:?\s*$/i.test(l.trim()))
  if (i < 0) return null
  const resto = lineas.slice(i + 1)
  const fin = resto.findIndex(l => /^#{1,6}\s/.test(l.trim()))
  return (fin < 0 ? resto : resto.slice(0, fin))
    .map(l => l.trim())
    .filter(l => l !== '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .slice(0, 240)
}

// Los hallazgos que siguen pendientes: los no resueltos (en curso o no).
export function sinResolver(hallazgos: Hallazgo[], lista: Seguimiento[]): Hallazgo[] {
  return hallazgos.filter(h => lista.find(s => s.clave === h.clave)?.resuelto === undefined)
}

// El primer mensaje de la sesión aparte. Sin comillas, `;`, `&`, `%` ni otros
// caracteres que Windows Terminal o cmd interpretan.
export function promptIA(ruta: string): string {
  return `Lee el informe ${ruta} y ayúdame a resolver el problema de contexto que describe, siguiendo lo que pide. Al terminar, márcalo como resuelto en el mismo informe.`
}

// Nombre de la sesión aparte (claude -n), sin caracteres conflictivos.
export function tituloIA(h: Hallazgo): string {
  return `Contexto · ${h.texto}`.replace(/["&|<>^%!;`]/g, '').replace(/\s+/g, ' ').slice(0, 60).trim()
}

// Nombre del fichero del informe: fecha y clave saneadas.
export function ficheroIA(h: Hallazgo, fecha: string): string {
  const sello = fecha.replace(/[^0-9]/g, '').slice(0, 14)
  const clave = h.clave.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(-60)
  return `${sello}-${clave}.md`
}
