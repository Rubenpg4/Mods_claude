import type { EngineInterface } from 'claude-code'

import { segmentos } from '../../comun/barras'
import { colorCache, css } from '../../comun/colores'
import { k } from '../../comun/formato'
import { columnas, columnasSvg } from '../../comun/graficos'
import { cambiarConservar, leerConservar } from '../../estado/panel'
import type { Ctx } from '../tipos'

// Pestaña ∿ Tendencia del panel.

// ∿ Tendencia: ocupación por turno, ritmo, picos y compactar.
export async function vistaTendencia($: EngineInterface, c: Ctx) {
  const { e, cfg, tabla, Text, t, turnos, interior, ritmo, compactaPct, cercaDeCompactar, tarjeta, dato, controlesCompactar } = c
  const texto = await leerConservar($)
  let grafico: unknown = <Text dimColor>Se dibuja a partir del segundo turno.</Text>
  if (turnos.length >= 2 && e.surface === 'terminal' && tabla.Raster !== undefined) {
    const Raster = tabla.Raster
    const c = columnas(turnos, interior, 5, cfg, compactaPct)
    grafico = <Raster key="tendencia" columns={c.columnas} rows={c.filas} cells={c.celdas} />
  } else if (turnos.length >= 2 && tabla.Svg !== undefined) {
    const Svg = tabla.Svg
    grafico = (
      <Svg
        source={columnasSvg(turnos, cfg, compactaPct)}
        alt={`Ocupación de los últimos ${turnos.length} turnos`}
        width={Math.min(480, interior * 8)}
        height={96}
      />
    )
  }
  const Input = tabla.Input
  return [
    tarjeta('Ocupación por turno', [
      grafico,
      <Text wrap="truncate">
        <Text color={css(0xff9f0a)}>┄ </Text>
        <Text dimColor>{`aviso ${cfg.aviso} %   `}</Text>
        {compactaPct === null ? null : <Text color={css(0x0a84ff)}>┄ </Text>}
        {compactaPct === null ? null : <Text dimColor>{`compacta ${compactaPct} %   `}</Text>}
        <Text dimColor>{`${turnos.length} turnos`}</Text>
      </Text>,
    ]),
    tarjeta('Ritmo', [
      dato('Crecimiento', <Text weight="bold">{ritmo.media === null ? '—' : `+${k(ritmo.media)} por turno`}</Text>),
      dato(
        'Compactación',
        <Text weight="bold" color={ritmo.turnosRestantes !== null && ritmo.turnosRestantes <= 3 ? 'warning' : undefined}>
          {ritmo.turnosRestantes === null
            ? '—'
            : `~${ritmo.turnosRestantes} turnos${ritmo.objetivo === null ? '' : ` · a ${k(ritmo.objetivo)}`}`}
        </Text>,
      ),
      dato(
        'Caché',
        <Text>
          <Text color={colorCache(t?.cache ?? null)} weight="bold">
            {t?.cache == null ? '—' : `${t.cache} % `}
          </Text>
          <Text color={colorCache(t?.cache ?? null)}>{t?.cache == null ? '' : segmentos(t.cache)}</Text>
          <Text dimColor>{t?.cache == null ? '' : ` · ${k(t.cacheEscrito)} reescritos`}</Text>
        </Text>,
      ),
    ]),
    ritmo.mayores.length === 0
      ? null
      : tarjeta(
          'Turnos que más crecieron',
          ritmo.mayores.map(x => (
            <Text wrap="truncate">
              <Text dimColor>{`#${x.n}`.padEnd(5)}</Text>
              <Text color="warning" weight="bold">
                {`+${k(x.delta)}`.padEnd(7)}
              </Text>
              <Text>{x.prompt === '' ? '(sin texto)' : `«${x.prompt}»`}</Text>
            </Text>
          )),
        ),
    tarjeta(
      'Compactar',
      [
        Input === undefined ? null : (
          <Input
            key="conservar"
            label="Qué conservar"
            placeholder="opcional: la tarea actual y sus pendientes"
            value={texto}
            submitLabel="Guardar"
            onSubmit={(valor: string) => void cambiarConservar($, () => valor)}
          />
        ),
        texto === '' ? null : <Text dimColor wrap="truncate">{`Se conservará: «${texto}»`}</Text>,
        controlesCompactar(),
      ],
      cercaDeCompactar ? 'warning' : 'subtle',
    ),
  ]
}
