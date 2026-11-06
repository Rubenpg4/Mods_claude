import type { EngineInterface } from 'claude-code'

import { css } from '../../comun/colores'
import { abrir } from '../../comun/entorno'
import { k } from '../../comun/formato'
import { anillo, anilloSvg } from '../../comun/graficos'
import { cargarMensajes, fotografiar } from '../../contexto/medicion'
import { entradas, SIN_DETALLE } from '../../contexto/reparto'
import { cambiarNavegacion, leerMensajes, leerNavegacion } from '../../estado/panel'
import type { Ctx } from '../tipos'

// Pestaña ◐ Reparto del panel.

// El anillo del reparto: diámetro máximo en columnas y lo que necesita como
// mínimo la leyenda para ir a su lado.
const DIAMETRO_MAXIMO = 26
const LEYENDA_MINIMA = 28

// ◐ Reparto: anillo navegable con migas, Atrás y «exacto».
export async function vistaReparto($: EngineInterface, c: Ctx) {
  const { e, tabla, Box, Text, Button, f, lista, interior, pasar } = c
  const nav = await leerNavegacion($)
  const items = entradas(nav, f, lista, await leerMensajes($))
  const sumaItems = items.reduce((s, q) => s + q.tokens, 0)
  const ir = (destino: string[]) => () => {
    void cambiarNavegacion($, () => destino)
  }
  const entrarEn = (destino: string[]) => async () => {
    if (destino[0] === 'Conversación') await cargarMensajes($)
    await cambiarNavegacion($, () => destino)
  }
  const tramos = ['Reparto', ...nav]
  const migas = tramos.flatMap((tramo, i) => {
    const separador = i === 0 ? [] : [<Text dimColor> › </Text>]
    if (i === tramos.length - 1) {
      return [...separador, <Text color="claude" weight="bold">{tramo.slice(0, 28)}</Text>]
    }
    return [
      ...separador,
      <Button key={`miga-${i}`} plain hover={pasar(`miga-${i}`)} onPress={ir(nav.slice(0, i))}>
        <Text color="suggestion" underline>
          {tramo.slice(0, 20)}
        </Text>
      </Button>,
    ]
  })
  // El anillo crece con el panel. Diámetros de la forma 4n+2: un número impar
  // de filas, para que la cifra del hueco quede justo en el centro.
  const formaAnillo = (n: number) => Math.max(10, n - ((n - 2) % 4 + 4) % 4)
  // A su lado solo si cabe un anillo de 22 o más; si no, encima de la leyenda.
  const aLaPar = interior - LEYENDA_MINIMA - 2 >= 22
  const diametro = aLaPar
    ? formaAnillo(Math.min(DIAMETRO_MAXIMO, interior - LEYENDA_MINIMA - 2))
    : formaAnillo(Math.min(DIAMETRO_MAXIMO - 4, interior))
  const nombreLeyenda = Math.max(6, (aLaPar ? interior - diametro - 2 : interior) - 15)
  const leyenda = items.slice(0, 10).map(q => {
    const contenido = [
      <Text color={css(q.rgb)}>■ </Text>,
      `${q.nombre}${q.nota === undefined ? '' : ` ${q.nota}`}`.slice(0, nombreLeyenda).padEnd(nombreLeyenda),
      <Text weight="bold">{k(q.tokens).padStart(5)}</Text>,
      <Text dimColor>{`${String(Math.round((q.tokens / Math.max(1, sumaItems)) * 100)).padStart(4)}%`}</Text>,
      <Text color="suggestion" weight="bold">
        {q.entrar !== undefined ? ' ›' : q.ruta !== undefined ? ' ↗' : '  '}
      </Text>,
    ]
    if (q.entrar !== undefined) {
      const destino = [...nav, q.entrar]
      return (
        <Button
          key={`entrar-${destino.join('/')}`}
          plain
          hover={pasar(`entrar-${destino.join('/')}`)}
          onPress={entrarEn(destino)}
        >
          {contenido}
        </Button>
      )
    }
    if (q.ruta !== undefined) {
      const ruta = q.ruta
      return (
        <Button key={`abrir-${ruta}`} plain hover={pasar(`abrir-${ruta}`)} onPress={() => void abrir($, ruta)}>
          {contenido}
        </Button>
      )
    }
    return <Text wrap="truncate">{contenido}</Text>
  })
  let grafico: unknown = null
  if (items.length > 0 && e.surface === 'terminal' && tabla.Raster !== undefined) {
    const Raster = tabla.Raster
    const a = anillo(items, diametro, k(sumaItems))
    grafico = <Raster key="anillo" columns={a.columnas} rows={a.filas} cells={a.celdas} />
  } else if (items.length > 0 && tabla.Svg !== undefined) {
    const Svg = tabla.Svg
    grafico = (
      <Svg
        source={anilloSvg(items)}
        alt={items.map(q => `${q.nombre} ${k(q.tokens)}`).join(', ')}
        width={128}
        height={128}
      />
    )
  }
  const vacio = SIN_DETALLE.has(nav[0] ?? '')
    ? 'Claude Code no desglosa esta categoría.'
    : 'Nada que mostrar aquí todavía.'
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1}>
      <Box flexDirection="row" justifyContent="space-between" flexWrap="wrap">
        <Box flexDirection="row">{migas}</Box>
        <Box flexDirection="row" columnGap={1}>
          {nav.length === 0 ? null : (
            <Button key="atras" hover={pasar('atras')} onPress={ir(nav.slice(0, -1))}>
              ← Atrás
            </Button>
          )}
          <Button key="exacto" hover={pasar('exacto')} onPress={() => void fotografiar($, 'full')}>
            ⟳ exacto
          </Button>
        </Box>
      </Box>
      <Text dimColor>{`${k(sumaItems)} · ${f?.exacto === true ? 'contado con la API' : 'estimado'}`}</Text>
      {items.length === 0 ? (
        <Text dimColor>{vacio}</Text>
      ) : (
        <Box flexDirection={aLaPar ? 'row' : 'column'} columnGap={2} alignItems="center">
          {grafico}
          <Box flexDirection="column">{leyenda}</Box>
        </Box>
      )}
    </Box>
  )
}
