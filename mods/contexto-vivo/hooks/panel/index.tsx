import type { EngineInterface } from 'claude-code'

import type { Pestana } from '../../types'

import { colorNivel } from '../comun/colores'
import { encima, FONDO_ENCIMA, sinInvertir } from '../comun/estilo'
import type { Config } from '../config'
import { diagnosticar } from '../contexto/diagnostico'
import { horaVisible } from '../contexto/limites'
import { quesitos } from '../contexto/reparto'
import { tendencia } from '../contexto/tendencia'
import { leerArbol } from '../estado/arbol'
import {
  leerFoto,
  leerHistorial,
  leerIgnorados,
  leerLlamadas,
  leerRoturas,
  leerSeguimiento,
  leerSubagentes,
  leerTotal,
} from '../estado/contexto'
import { cambiarPestana, leerConfirmar, leerPestana, PANEL } from '../estado/panel'
import { sinResolver } from '../ia/informe'
import { selectorEnPanel } from '../selector/banda'
import { cabecera as dibujarCabecera, limitesUso as dibujarLimites } from './cabecera'
import { vistaArbol } from './pestanas/arbol'
import { vistaDiagnostico } from './pestanas/diagnostico'
import { vistaLlamadas } from './pestanas/llamadas'
import { vistaReparto } from './pestanas/reparto'
import { vistaSubagentes } from './pestanas/subagentes'
import { vistaTendencia } from './pestanas/tendencia'
import { crearPiezas } from './piezas'
import type { Ctx, RenderPanel, Tabla } from './tipos'

// El panel /ctx: lee el estado una vez por dibujo, monta la cabecera, los
// límites de uso, la barra de pestañas y la pestaña activa (pestanas/).

export type { RenderPanel } from './tipos'

const PESTANAS: [Pestana, string][] = [
  ['reparto', '◐ Reparto'],
  ['diagnostico', '▲ Diagnóstico'],
  ['tendencia', '∿ Tendencia'],
  ['subagentes', '◆ Subagentes'],
  ['llamadas', '≡ Llamadas'],
  ['arbol', '⎇ Árbol'],
]
// Abre el panel. Con el renderizador clásico (sin pantalla completa) el motor
// lo pone encima del prompt y el terminal no manda clics: se abre con el
// teclado para que Tab, Enter y las flechas funcionen desde el principio.
// `pantallaCompleta` es `presentation.isFullscreen` del `command.run`.
export async function abrirPanel($: EngineInterface, pantallaCompleta: boolean | undefined): Promise<boolean> {
  const { isPlaced } =
    pantallaCompleta === false
      ? await $.ui.open({ id: PANEL, title: 'Contexto', focus: true })
      : await $.ui.open({ id: PANEL, title: 'Contexto' })

  return isPlaced
}

export async function dibujarPanel($: EngineInterface, e: RenderPanel, cfg: Config): Promise<unknown> {
  const tabla = $.ui.resolve(e as never) as unknown as Tabla
  const { Box, Text, Button } = tabla

  const t = await leerTotal($)
  const f = await leerFoto($)
  const lista = await leerLlamadas($)
  const turnos = await leerHistorial($)
  const agentes = await leerSubagentes($)
  const omitidos = await leerIgnorados($)
  const seguimiento = await leerSeguimiento($)
  const activa = await leerPestana($)
  const arbol = await leerArbol($)
  const confirmando = await leerConfirmar($)
  const ahora = await horaVisible($)

  const ancho = Math.max(24, e.props.bodyColumns)
  const interior = ancho - 4
  const porcentaje = t?.porcentaje ?? f?.porcentaje
  const tokens = t?.tokens ?? f?.tokens
  const ventana = t?.ventana ?? f?.ventana
  const color = colorNivel(porcentaje, cfg)
  const qs = quesitos(f, lista)
  const sumaQs = qs.reduce((s, q) => s + q.tokens, 0)
  const hallazgos = diagnosticar(f, lista, cfg, omitidos, { turnos, subagentes: agentes, total: t, roturas: await leerRoturas($) })
  // Los resueltos con IA (o a mano) no cuentan como avisos.
  const pendientes = sinResolver(hallazgos, seguimiento).length
  const ritmo = tendencia(turnos, f, t)
  const compactaPct = f?.compacta == null || ventana === undefined ? null : Math.round((f.compacta / ventana) * 100)
  const cercaDeCompactar = porcentaje !== undefined && porcentaje >= cfg.aviso - 10
  const activos = agentes.filter(a => a.activo).length

  const piezas = crearPiezas($, { Box, Text, Button, confirmando, interior })
  const c: Ctx = {
    e, cfg, tabla, Box, Text, Button,
    t, f, lista, turnos, agentes, omitidos, seguimiento, activa, arbol, confirmando, ahora,
    ancho, interior, porcentaje, tokens, ventana, color, qs, sumaQs, hallazgos, ritmo, compactaPct,
    cercaDeCompactar, activos,
    ...piezas,
  }
  const cabecera = dibujarCabecera($, c)
  const limitesUso = await dibujarLimites($, c)
  const { tarjeta } = piezas

  // ── Pestañas ───────────────────────────────────────────────────────────────
  const contador: Partial<Record<Pestana, string>> = {
    diagnostico: pendientes > 0 ? ` ${pendientes}` : '',
    subagentes: activos > 0 ? ` ${activos}` : '',
    arbol: arbol === null || arbol.nodos.length === 0 ? '' : ` ${arbol.nodos.length}`,
  }
  // La activa, una píldora rellena del color de Claude; las demás, atenuadas y
  // con fondo suave al pasar. Pasar por la activa no la cambia.
  const barraPestanas = (
    <Box flexDirection="row" flexWrap="wrap" columnGap={1} marginTop={1}>
      {PESTANAS.map(([id, nombre]) => (
        <Button key={`pestana-${id}`} plain hover={sinInvertir(`panel-pestana-${id}`)} onPress={() => void cambiarPestana($, () => id)}>
          {id === activa ? (
            <Text backgroundColor="claude" color="inverseText" weight="bold">{` ${nombre}${contador[id] ?? ''} `}</Text>
          ) : (
            <Text
              dimColor
              hover={encima(`panel-pestana-${id}`, { dimColor: false, color: 'text', backgroundColor: FONDO_ENCIMA })}
            >
              {` ${nombre}${contador[id] ?? ''} `}
            </Text>
          )}
        </Button>
      ))}
    </Box>
  )

  const cuerpo =
    activa === 'arbol'
      ? await vistaArbol($, c)
      : activa === 'diagnostico'
      ? vistaDiagnostico($, c)
      : activa === 'tendencia'
        ? await vistaTendencia($, c)
        : activa === 'subagentes'
          ? vistaSubagentes($, c)
          : activa === 'llamadas'
            ? vistaLlamadas($, c)
            : qs.length === 0
              ? tarjeta('Reparto', <Text dimColor>El reparto aparece al cerrar el primer turno.</Text>)
              : await vistaReparto($, c)

  // Encima del prompt (sin pantalla completa) no hay clics: arriba, para que no
  // lo corte la altura, cómo usarlo con el teclado y cómo llevarlo al lado.
  const enLinea = e.surface === 'terminal' && e.props.placement === 'inline'
  const avisoEnLinea = !enLinea ? null : (
    <Box flexDirection="column" marginBottom={1}>
      <Text color="warning" wrap="wrap">
        {'▲ Sin pantalla completa: el panel va encima del prompt y aquí no funcionan los clics.'}
      </Text>
      <Text dimColor wrap="wrap">
        {e.props.isFocused === true
          ? '  Tab y ⇧Tab recorren los botones · Enter pulsa · flechas desplazan · Esc vuelve al prompt'
          : '  ctrl+x tab para usarlo con el teclado (Tab, Enter, flechas; Esc vuelve al prompt)'}
      </Text>
      <Text dimColor wrap="wrap">
        {'  Para tenerlo al lado y con clics: /tui fullscreen (reinicia y retoma la sesión)'}
      </Text>
    </Box>
  )

  return (
    <Box flexDirection="column">
      {avisoEnLinea}
      {cabecera}
      {await selectorEnPanel($, tabla, e.surface)}
      {limitesUso}
      {barraPestanas}
      {cuerpo}
      <Text dimColor wrap="truncate">
        {' ⚙ umbrales en /config · ≈ estimado por longitud'}
      </Text>
    </Box>
  )
}
