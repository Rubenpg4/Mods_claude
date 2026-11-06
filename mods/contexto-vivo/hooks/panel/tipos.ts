import type { Config } from '../config'
import type { diagnosticar } from '../contexto/diagnostico'
import type { horaVisible } from '../contexto/limites'
import type { quesitos } from '../contexto/reparto'
import type { tendencia } from '../contexto/tendencia'
import type { leerArbol } from '../estado/arbol'
import type {
  leerFoto,
  leerHistorial,
  leerIgnorados,
  leerLlamadas,
  leerSeguimiento,
  leerSubagentes,
  leerTotal,
} from '../estado/contexto'
import type { leerConfirmar, leerPestana } from '../estado/panel'
import type { crearPiezas } from './piezas'

// Los tipos que comparten las piezas del panel.

export type Elemento = (props: Record<string, unknown>) => unknown
// Lo que el panel necesita del evento `ui.render` del Pane.
export type RenderPanel = {
  surface: 'terminal' | 'desktop' | 'vscode' | 'mobile'
  // `placement`: `dock` al lado (pantalla completa) o `inline` encima del
  // prompt (renderizador clásico, sin clics). `isFocused`: tiene el teclado.
  props: { bodyColumns: number; placement?: 'dock' | 'inline'; isFocused?: boolean }
}

// Los elementos que da `$.ui.resolve` en el panel.
export type Tabla = {
  Box: Elemento
  Text: Elemento
  Button: Elemento
  Input?: Elemento
  Raster?: Elemento
  Svg?: Elemento
}

type Leido<F extends (...a: never[]) => unknown> = Awaited<ReturnType<F>>

// Lo que necesitan las piezas comunes. `$` no va aquí: el motor solo admite
// `$` como argumento propio de cada función, nunca dentro de un objeto.
export type Base = {
  Box: Elemento
  Text: Elemento
  Button: Elemento
  confirmando: boolean
  interior: number
}

// Todo lo que lee y calcula `dibujarPanel` una vez por dibujo, y las piezas
// comunes: lo que recibe cada pestaña.
export type Ctx = Base &
  ReturnType<typeof crearPiezas> & {
    e: RenderPanel
    cfg: Config
    tabla: Tabla
    t: Leido<typeof leerTotal>
    f: Leido<typeof leerFoto>
    lista: Leido<typeof leerLlamadas>
    turnos: Leido<typeof leerHistorial>
    agentes: Leido<typeof leerSubagentes>
    omitidos: Leido<typeof leerIgnorados>
    seguimiento: Leido<typeof leerSeguimiento>
    activa: Leido<typeof leerPestana>
    arbol: Leido<typeof leerArbol>
    confirmando: Leido<typeof leerConfirmar>
    ahora: Leido<typeof horaVisible>
    ancho: number
    porcentaje: number | undefined
    tokens: number | undefined
    ventana: number | undefined
    color: string
    qs: ReturnType<typeof quesitos>
    sumaQs: number
    hallazgos: ReturnType<typeof diagnosticar>
    ritmo: ReturnType<typeof tendencia>
    compactaPct: number | null
    cercaDeCompactar: boolean
    activos: number
  }
