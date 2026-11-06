import type { EngineInterface } from 'claude-code'

import { css, tinta } from '../comun/colores'
import { encima, FONDO_ENCIMA, sinInvertir } from '../comun/estilo'
import { leerAplicado, leerSelector } from '../estado/selector'
import { desplegar, elegirEsfuerzo, elegirModelo } from './aplicar'
import { colorEsfuerzo, etiquetaTramo, modeloDe, MODELOS, NEUTRO, NIVELES, posicionEsfuerzo } from './modelos'

// El dibujo del selector: la banda sobre el prompt y su versión dentro del panel.

type Elemento = (props: Record<string, unknown>) => unknown
type Tabla = { Box: Elemento; Text: Elemento; Button: Elemento }

// Lo que se muestra: el modelo de la sesión tal como lo da /model (se lee en
// cada dibujo) y el esfuerzo de la última petición o del último cambio.
async function situacion($: EngineInterface) {
  const sel = await leerSelector($)
  const apl = await leerAplicado($)
  const crudo = (await $.session.model().catch(() => null)) ?? apl.modelo
  const actual = modeloDe(crudo)
  return {
    sel,
    crudo,
    actual,
    nombre: actual?.nombre ?? crudo ?? 'modelo por defecto',
    rgb: actual?.rgb ?? NEUTRO,
    nivel: apl.esfuerzo,
  }
}

type Situacion = Awaited<ReturnType<typeof situacion>>
// Dónde se dibuja el selector: cada sitio tiene sus propios grupos de hover,
// para que pasar por la banda no ilumine el panel ni al revés.
type Sitio = 'banda' | 'panel'

// La barra del esfuerzo en pequeño, para la línea plegada: los cinco tramos
// en su degradado; los de encima del nivel actual, punteados.
function barraMini(t: Tabla, s: Situacion): unknown[] {
  const { Text } = t
  const hasta = posicionEsfuerzo(s.nivel)
  return NIVELES.map((n, i) => (
    <Text key={`mini-${n.id}`} color={css(colorEsfuerzo(i, s.rgb))} dimColor={i > hasta}>
      {i <= hasta ? '━━' : '╌╌'}
    </Text>
  ))
}

// La línea plegada: un solo botón que despliega. Al pasar por encima, la pista
// se enciende como un enlace en lugar de invertirse la línea entera.
function lineaPlegada(t: Tabla, s: Situacion, alPulsar: () => void, pista: string, sitio: Sitio) {
  const { Button, Text } = t
  const id = `${sitio}-desplegar`
  const pendiente = s.sel.modelo !== null || s.sel.esfuerzo !== null
  return (
    <Button key="selector-desplegar" plain hover={sinInvertir(id)} onPress={alPulsar}>
      <Text color={css(s.rgb)} weight="bold">{`◆ ${s.nombre}`}</Text>
      <Text dimColor>{'   esfuerzo '}</Text>
      {barraMini(t, s)}
      <Text color={s.nivel === null ? undefined : css(colorEsfuerzo(posicionEsfuerzo(s.nivel), s.rgb))} weight="bold">
        {` ${s.nivel ?? 'por defecto'}`}
      </Text>
      {pendiente ? <Text color="warning">{'   ⧗ al acabar el turno'}</Text> : null}
      <Text>{'   '}</Text>
      <Text dimColor hover={encima(id, { dimColor: false, color: 'suggestion', underline: true })}>
        {pista}
      </Text>
    </Button>
  )
}

// Las píldoras de los modelos: ● la del modelo actual, rellena de su color;
// ○ las demás, en su color y con fondo suave al pasar; ⧗ la que espera turno.
function filaModelos($: EngineInterface, t: Tabla, s: Situacion, conTeclas: boolean, sitio: Sitio) {
  const { Box, Button, Text } = t
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={conTeclas ? 2 : 1}>
      <Text dimColor>{'modelo   '}</Text>
      {MODELOS.map(m => {
        const id = `${sitio}-modelo-${m.familia}`
        const activo = s.actual?.id === m.id
        const esperando = s.sel.modelo === m.id
        return (
          <Button
            key={`selector-modelo-${m.familia}`}
            plain
            hover={sinInvertir(id)}
            {...(conTeclas ? { hotkey: m.tecla } : {})}
            onPress={() => void elegirModelo($, m)}
          >
            {/* Mismo ancho en todos los estados: la fila no se recoloca. */}
            {activo ? (
              <Text backgroundColor={css(m.rgb)} color={tinta(m.rgb)} weight="bold">{` ● ${m.nombre} `}</Text>
            ) : esperando ? (
              <Text color="warning" weight="bold" hover={encima(id, { backgroundColor: FONDO_ENCIMA })}>
                {` ⧗ ${m.nombre} `}
              </Text>
            ) : (
              <Text color={css(m.rgb)} hover={encima(id, { backgroundColor: FONDO_ENCIMA, bold: true })}>
                {` ○ ${m.nombre} `}
              </Text>
            )}
          </Button>
        )
      })}
    </Box>
  )
}

// La barra del esfuerzo: cinco tramos seguidos, cada uno un botón con su nivel
// dentro y su color del degradado (low apenas tiñe, max es el color pleno del
// modelo). El nivel actual va en negrita con la tinta plena; los demás, con la
// tinta atenuada. Al pasar por un tramo se enciende con el color pleno, como
// anticipo de elegirlo; el que espera al final del turno va en ámbar.
//
// Sin teclas: la tecla de un botón se dibuja delante («q: ») y partiría la
// barra en trozos. Se elige con el ratón, o con `/modelo <nivel>` desde el prompt.
function filaEsfuerzo($: EngineInterface, t: Tabla, s: Situacion, sitio: Sitio) {
  const { Box, Button, Text } = t
  const actual = posicionEsfuerzo(s.nivel)
  return (
    <Box flexDirection="row" flexWrap="wrap">
      <Text dimColor>{'esfuerzo '}</Text>
      {NIVELES.map((n, i) => {
        const id = `${sitio}-esfuerzo-${n.id}`
        const esperando = s.sel.esfuerzo === n.id
        const color = colorEsfuerzo(i, s.rgb)
        const destacado = i === actual || esperando
        return (
          <Button key={`selector-esfuerzo-${n.id}`} plain hover={sinInvertir(id)} onPress={() => void elegirEsfuerzo($, n.id)}>
            <Text
              backgroundColor={esperando ? 'warning' : css(color)}
              color={esperando ? '#000000' : tinta(color)}
              dimColor={!destacado}
              weight={destacado ? 'bold' : undefined}
              hover={encima(id, { backgroundColor: css(s.rgb), color: tinta(s.rgb), dimColor: false, bold: true })}
            >
              {etiquetaTramo(n.id)}
            </Text>
          </Button>
        )
      })}
      {actual < 0 && s.sel.esfuerzo === null ? <Text dimColor>{'  por defecto'}</Text> : null}
    </Box>
  )
}

export type RenderBanda = { surface: string; props: { hasSurvey: boolean; bodyColumns: number } }

// La banda sobre el prompt: plegada, una línea; desplegada, una tarjeta con
// el color del modelo actual. Lo que otros plugins dibujen ahí va debajo.
export async function dibujarBanda($: EngineInterface, e: RenderBanda, debajo: unknown): Promise<unknown> {
  if (e.props.hasSurvey) return debajo
  const t = $.ui.resolve(e as never) as unknown as Tabla
  const { Box, Button, Text } = t
  const s = await situacion($)

  const propio = !s.sel.desplegado ? (
    lineaPlegada(t, s, () => void desplegar($, true), '▾ cambiar', 'banda')
  ) : (
    <Box flexDirection="column" borderStyle="round" borderColor={css(s.rgb)} paddingX={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text wrap="truncate">
          <Text color={css(s.rgb)} weight="bold">{`◆ ${s.nombre}`}</Text>
          <Text dimColor>{s.actual === undefined ? '' : `  ${s.actual.nota}`}</Text>
        </Text>
        <Button
          key="selector-plegar"
          plain
          hotkey="x"
          hover={sinInvertir('banda-plegar')}
          onPress={() => void desplegar($, false)}
        >
          <Text dimColor hover={encima('banda-plegar', { dimColor: false, color: 'suggestion', underline: true })}>
            ▴ plegar
          </Text>
        </Button>
      </Box>
      {filaModelos($, t, s, true, 'banda')}
      {filaEsfuerzo($, t, s, 'banda')}
      <Text dimColor wrap="truncate">
        {s.sel.modelo !== null || s.sel.esfuerzo !== null
          ? '⧗ se aplicará en cuanto acabe el turno en curso'
          : 'cambia el /model y el /effort de la sesión · teclas 1-4 y x con la banda enfocada (ctrl+x tab)'}
      </Text>
    </Box>
  )
  return debajo === undefined || debajo === null ? (
    propio
  ) : (
    <Box flexDirection="column">
      {propio}
      {debajo}
    </Box>
  )
}

// En el panel /ctx: donde hay banda (terminal y escritorio), una línea que
// la despliega; donde no (VS Code, móvil), las píldoras y la barra completas.
export async function selectorEnPanel($: EngineInterface, t: Tabla, surface: string): Promise<unknown> {
  const s = await situacion($)
  if (surface === 'terminal' || surface === 'desktop') {
    return lineaPlegada(
      t,
      s,
      () => void desplegar($, !s.sel.desplegado),
      s.sel.desplegado ? '▴ plegar banda' : '▾ cambiar',
      'panel',
    )
  }
  const { Box } = t
  return (
    <Box flexDirection="column">
      {filaModelos($, t, s, false, 'panel')}
      {filaEsfuerzo($, t, s, 'panel')}
    </Box>
  )
}
