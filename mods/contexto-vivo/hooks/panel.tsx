import type { EngineInterface } from 'claude-code'

import type { Hallazgo, Llamada, Pestana, Subagente } from '../types'
import {
  abrir,
  cargarMensajes,
  compactar,
  fotografiar,
  ignorar,
  restaurarIgnorados,
} from './acciones'
import {
  ancestroComun,
  ancestros,
  borrarRama,
  buscarNodo,
  checkpoint,
  consultarBusqueda,
  consultarComparacion,
  enLinea,
  etiquetaNodo,
  exportarConAviso,
  filasArbol,
  forkear,
  hijos,
  injertar,
  nombrar,
  restaurar,
  turnos as nTurnos,
} from './arbol'
import {
  barraFina,
  barraRitmo,
  chispa,
  colorCache,
  colorNivel,
  colorVentana,
  css,
  diagnosticar,
  duracionCorta,
  entradas,
  familia,
  GRIS,
  k,
  nombreHerramienta,
  ordenar,
  PALETA,
  peorColor,
  quesitos,
  sector,
  segmentos,
  SIN_DETALLE,
  tendencia,
  ventanas,
} from './calculo'
import type { Config } from './config'
import {
  cambiarBorrando,
  cambiarConfirmar,
  cambiarConsulta,
  leerConsulta,
  cambiarConservar,
  cambiarNavegacion,
  cambiarPestana,
  cambiarSeleccion,
  cambiarVerTodo,
  leerAhora,
  leerArbol,
  leerBorrando,
  leerHead,
  leerOcupado,
  leerSeleccion,
  leerVerTodo,
  leerConfirmar,
  leerConservar,
  leerFoto,
  leerHistorial,
  leerIgnorados,
  leerLlamadas,
  leerMensajes,
  leerNavegacion,
  leerPestana,
  leerSubagentes,
  leerTotal,
} from './estado'
import { anillo, anilloSvg, columnas, columnasSvg } from './graficos'
import { selectorEnPanel } from './selector'

type Elemento = (props: Record<string, unknown>) => unknown
// Lo que el panel necesita del evento `ui.render` del Pane.
export type RenderPanel = {
  surface: 'terminal' | 'desktop' | 'vscode' | 'mobile'
  props: { bodyColumns: number }
}

const PESTANAS: [Pestana, string][] = [
  ['reparto', '◐ Reparto'],
  ['diagnostico', '▲ Diagnóstico'],
  ['tendencia', '∿ Tendencia'],
  ['subagentes', '◆ Subagentes'],
  ['llamadas', '≡ Llamadas'],
  ['arbol', '⎇ Árbol'],
]
// El anillo del reparto: diámetro máximo en columnas y lo que necesita como
// mínimo la leyenda para ir a su lado.
const DIAMETRO_MAXIMO = 26
const LEYENDA_MINIMA = 28
// Fondo liso de las barras: el gris de los bordes del tema, claro u oscuro.
const CARRIL = 'subtle'

export async function dibujarPanel($: EngineInterface, e: RenderPanel, cfg: Config): Promise<unknown> {
  const tabla = $.ui.resolve(e as never) as unknown as {
    Box: Elemento
    Text: Elemento
    Button: Elemento
    Input?: Elemento
    Raster?: Elemento
    Svg?: Elemento
  }
  const { Box, Text, Button } = tabla

  const t = await leerTotal($)
  const f = await leerFoto($)
  const lista = await leerLlamadas($)
  const turnos = await leerHistorial($)
  const agentes = await leerSubagentes($)
  const omitidos = await leerIgnorados($)
  const activa = await leerPestana($)
  const arbol = await leerArbol($)
  const confirmando = await leerConfirmar($)
  const ahora = await leerAhora($)

  const ancho = Math.max(24, e.props.bodyColumns)
  const interior = ancho - 4
  const porcentaje = t?.porcentaje ?? f?.porcentaje
  const tokens = t?.tokens ?? f?.tokens
  const ventana = t?.ventana ?? f?.ventana
  const color = colorNivel(porcentaje, cfg)
  const qs = quesitos(f, lista)
  const sumaQs = qs.reduce((s, q) => s + q.tokens, 0)
  const hallazgos = diagnosticar(f, lista, cfg, omitidos)
  const ritmo = tendencia(turnos, f, t)
  const compactaPct = f?.compacta == null || ventana === undefined ? null : Math.round((f.compacta / ventana) * 100)

  // ── Piezas comunes ─────────────────────────────────────────────────────────
  const tarjeta = (titulo: string, hijos: unknown, borde = 'subtle') => (
    <Box flexDirection="column" borderStyle="round" borderColor={borde} paddingX={1}>
      <Text color={borde} weight="bold">
        {titulo}
      </Text>
      {hijos}
    </Box>
  )
  const dato = (etiqueta: string, valor: unknown) => (
    <Text wrap="truncate">
      <Text dimColor>{etiqueta.padEnd(14)}</Text>
      {valor}
    </Text>
  )
  const controlesCompactar = () =>
    confirmando ? (
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        <Text color="warning" weight="bold">
          ¿Compactar ahora?
        </Text>
        <Button key="compactar-si" variant="primary" onPress={() => void compactar($)}>
          Sí, compactar
        </Button>
        <Button key="compactar-no" onPress={() => void cambiarConfirmar($, () => false)}>
          Cancelar
        </Button>
      </Box>
    ) : (
      <Button key="compactar" onPress={() => void cambiarConfirmar($, () => true)}>
        ⇣ Compactar ahora
      </Button>
    )
  const llamada = (l: Llamada, maximo: number) => {
    const fa = familia(l.herramienta)
    const herramienta = nombreHerramienta(l.herramienta).slice(0, 14)
    const resto = Math.max(4, interior - herramienta.length - 17)
    return (
      <Text wrap="truncate">
        <Text color={css(fa.rgb)}>● </Text>
        <Text color={css(fa.rgb)} weight="bold">
          {herramienta}
        </Text>{' '}
        <Text dimColor>{l.etiqueta.slice(0, resto).padEnd(resto)}</Text>
        <Text weight="bold">{`≈${k(l.tokens)}`.padStart(6)}</Text>{' '}
        <Text color={css(fa.rgb)}>{barraFina(l.tokens, maximo, 6)}</Text>
      </Text>
    )
  }

  // ── Cabecera: ocupación, barra apilada, ritmo, uso y caché ─────────────────
  const reserva = f?.categorias.find(c => c.tipo === 'buffer')
  const celdasUsadas = Math.min(interior, Math.round(((porcentaje ?? 0) / 100) * interior))
  const celdasReserva =
    reserva === undefined || ventana === undefined
      ? 0
      : Math.min(interior - celdasUsadas, Math.round((reserva.tokens / ventana) * interior))
  let repartidas = 0
  const tramosBarra = qs.map((q, i) => {
    const celdas =
      i === qs.length - 1 ? celdasUsadas - repartidas : Math.round((q.tokens / Math.max(1, sumaQs)) * celdasUsadas)
    const propias = Math.max(0, Math.min(celdas, celdasUsadas - repartidas))
    repartidas += propias
    return { color: css(q.rgb), celdas: propias }
  })
  if (tramosBarra.length === 0) tramosBarra.push({ color, celdas: celdasUsadas })
  const libres = Math.max(0, interior - celdasUsadas - celdasReserva)
  const cercaDeCompactar = porcentaje !== undefined && porcentaje >= cfg.aviso - 10

  const cabecera = (
    <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1}>
      <Box justifyContent="space-between">
        <Text color={color} weight="bold">
          {porcentaje === undefined ? '○ —' : `${sector(porcentaje)} ${porcentaje} %`}
        </Text>
        <Text dimColor>
          {tokens === undefined || ventana === undefined ? 'esperando respuesta' : `${k(tokens)} / ${k(ventana)}`}
        </Text>
      </Box>
      <Text>
        {tramosBarra.map(s => (
          <Text color={s.color}>{'█'.repeat(s.celdas)}</Text>
        ))}
        <Text backgroundColor={CARRIL}>{' '.repeat(libres)}</Text>
        <Text color="warning" dimColor>
          {'█'.repeat(celdasReserva)}
        </Text>
      </Text>
      <Text dimColor wrap="truncate">
        {tokens === undefined || ventana === undefined
          ? ' '
          : [
              `${k(Math.max(0, ventana - tokens))} libres`,
              f?.compacta == null ? null : `compacta a ${k(f.compacta)}`,
              ritmo.turnosRestantes === null ? null : `~${ritmo.turnosRestantes} turnos`,
            ]
              .filter(x => x !== null)
              .join(' · ')}
      </Text>
      {turnos.length < 2 ? null : (
        <Text wrap="truncate">
          <Text dimColor>∿ </Text>
          <Text color={color}>{chispa(turnos.slice(-Math.max(8, interior - 18)).map(x => x.porcentaje))}</Text>
          <Text dimColor>{ritmo.media === null ? '' : `  +${k(ritmo.media)}/turno`}</Text>
        </Text>
      )}
      <Text wrap="truncate">
        <Text dimColor>⟲ caché </Text>
        <Text color={colorCache(t?.cache ?? null)} weight="bold">
          {t?.cache == null ? '—' : `${t.cache}%`}
        </Text>
      </Text>
      {cercaDeCompactar && activa !== 'tendencia' ? controlesCompactar() : null}
    </Box>
  )

  // ── Límites de uso: barra, % usado, marca del ritmo y cuenta atrás ─────────
  const vs = ventanas(t?.limites ?? [], ahora)
  const anchoTipo = Math.max(0, ...vs.map(v => v.tipo.length)) + 2
  const reinicios = vs.map(v => (v.falta === null ? '' : `  ↻ ${duracionCorta(v.falta)}`))
  const anchoReinicio = Math.max(0, ...reinicios.map(r => r.length))
  const anchoBarraUso = Math.max(6, interior - anchoTipo - 7 - anchoReinicio)
  const hayRitmo = vs.some(v => v.ritmo !== null)
  const agotan = vs.filter(v => v.agota !== null)
  const limitesUso =
    vs.length === 0
      ? null
      : tarjeta(
          'Límites de uso',
          <Box flexDirection="column">
            {vs.map((v, i) => (
              <Text key={`limite-${v.tipo}`} wrap="truncate">
                <Text weight="bold">{v.tipo.padEnd(anchoTipo)}</Text>
                {barraRitmo(v.usado, v.ritmo, anchoBarraUso).map(tr =>
                  tr.clase === 'usado' ? (
                    <Text color={colorVentana(v)}>{tr.texto}</Text>
                  ) : tr.clase === 'parcial' ? (
                    <Text color={colorVentana(v)} backgroundColor={CARRIL}>
                      {tr.texto}
                    </Text>
                  ) : tr.clase === 'marcaUsado' ? (
                    <Text color="text" backgroundColor={colorVentana(v)}>
                      {tr.texto}
                    </Text>
                  ) : tr.clase === 'marcaLibre' ? (
                    <Text color="text" backgroundColor={CARRIL}>
                      {tr.texto}
                    </Text>
                  ) : (
                    <Text backgroundColor={CARRIL}>{tr.texto}</Text>
                  ),
                )}
                <Text color={colorVentana(v)} weight="bold">
                  {`${v.usado} %`.padStart(7)}
                </Text>
                <Text dimColor>{(reinicios[i] ?? '').padEnd(anchoReinicio)}</Text>
              </Text>
            ))}
            {agotan.map(v => (
              <Text key={`agota-${v.tipo}`} color="warning" wrap="truncate">
                {`⚠ ${v.tipo}: a este ritmo se agota en ~${duracionCorta(v.agota ?? 0)}`}
              </Text>
            ))}
            {agotan.length === 0 && hayRitmo ? (
              <Text wrap="truncate">
                <Text color="success">✓ a este ritmo no llegas al límite</Text>
                <Text dimColor>{'  ·  │ ritmo'}</Text>
              </Text>
            ) : null}
          </Box>,
          peorColor(vs),
        )

  // ── Pestañas ───────────────────────────────────────────────────────────────
  const activos = agentes.filter(a => a.activo).length
  const contador: Partial<Record<Pestana, string>> = {
    diagnostico: hallazgos.length > 0 ? ` ${hallazgos.length}` : '',
    subagentes: activos > 0 ? ` ${activos}` : '',
    arbol: arbol === null || arbol.nodos.length === 0 ? '' : ` ${arbol.nodos.length}`,
  }
  const barraPestanas = (
    <Box flexDirection="row" flexWrap="wrap" columnGap={1} marginTop={1}>
      {PESTANAS.map(([id, nombre]) => (
        <Button key={`pestana-${id}`} plain onPress={() => void cambiarPestana($, () => id)}>
          {id === activa ? (
            <Text inverse weight="bold">{` ${nombre}${contador[id] ?? ''} `}</Text>
          ) : (
            <Text dimColor>{` ${nombre}${contador[id] ?? ''} `}</Text>
          )}
        </Button>
      ))}
    </Box>
  )

  // ◐ Reparto: anillo navegable con migas, Atrás y «exacto».
  const vistaReparto = async () => {
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
        <Button key={`miga-${i}`} plain onPress={ir(nav.slice(0, i))}>
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
          <Button key={`entrar-${destino.join('/')}`} plain onPress={entrarEn(destino)}>
            {contenido}
          </Button>
        )
      }
      if (q.ruta !== undefined) {
        const ruta = q.ruta
        return (
          <Button key={`abrir-${ruta}`} plain onPress={() => void abrir($, ruta)}>
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
              <Button key="atras" onPress={ir(nav.slice(0, -1))}>
                ← Atrás
              </Button>
            )}
            <Button key="exacto" onPress={() => void fotografiar($, 'full')}>
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

  // ▲ Diagnóstico: cada mal uso con su consejo, abrir e ignorar.
  const hallazgoFila = (x: Hallazgo) => {
    const ancho = Math.max(6, interior - 9)
    const ruta = x.ruta
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text wrap="truncate">
          <Text color={x.gravedad === 'alta' ? 'error' : 'warning'}>{x.gravedad === 'alta' ? '▲ ' : '△ '}</Text>
          <Text weight="bold">{x.texto.slice(0, ancho).padEnd(ancho)}</Text>
          <Text weight="bold">{`≈${k(x.tokens)}`.padStart(7)}</Text>
        </Text>
        <Text dimColor wrap="wrap">{`  ↳ ${x.consejo}`}</Text>
        <Box flexDirection="row" columnGap={2} paddingLeft={4}>
          {ruta === undefined ? null : (
            <Button key={`diag-abrir-${x.clave}`} plain onPress={() => void abrir($, ruta)}>
              <Text color="suggestion">↗ abrir</Text>
            </Button>
          )}
          <Button key={`diag-ignorar-${x.clave}`} plain onPress={() => void ignorar($, x.clave)}>
            <Text dimColor>✕ ignorar</Text>
          </Button>
        </Box>
      </Box>
    )
  }
  const vistaDiagnostico = () =>
    tarjeta(
      hallazgos.length === 0 ? 'Diagnóstico' : `Diagnóstico · ${hallazgos.length} aviso${hallazgos.length === 1 ? '' : 's'}`,
      [
        hallazgos.length === 0 ? <Text color="success">✓ Sin malos usos detectados.</Text> : null,
        ...hallazgos.slice(0, 8).map(hallazgoFila),
        omitidos.length === 0 ? null : (
          <Box flexDirection="row" columnGap={2}>
            <Text dimColor>{`${omitidos.length} ignorado${omitidos.length === 1 ? '' : 's'}`}</Text>
            <Button key="restaurar" plain onPress={() => void restaurarIgnorados($)}>
              <Text color="suggestion" underline>
                restaurar
              </Text>
            </Button>
          </Box>
        ),
      ],
      hallazgos.some(x => x.gravedad === 'alta') ? 'error' : hallazgos.length > 0 ? 'warning' : 'success',
    )

  // ∿ Tendencia: ocupación por turno, ritmo, picos y compactar.
  const vistaTendencia = async () => {
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

  // ◆ Subagentes: lo lleno que va la ventana de cada uno.
  const subagenteFila = (a: Subagente) => {
    const pct = ventana === undefined ? 0 : Math.round((a.tokens / ventana) * 100)
    const informe = lista.find(l => familia(l.herramienta).nombre === 'Subagentes' && l.etiqueta === a.descripcion)
    const tipo = a.tipo.slice(0, Math.max(6, interior - 16))
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Box justifyContent="space-between">
          <Text>
            <Text color={a.activo ? 'success' : 'inactive'}>{a.activo ? '● ' : '○ '}</Text>
            <Text weight="bold">{tipo}</Text>
          </Text>
          <Text dimColor>{ventana === undefined ? k(a.tokens) : `${k(a.tokens)} / ${k(ventana)}`}</Text>
        </Box>
        <Text dimColor wrap="truncate">{`  ${a.descripcion}`}</Text>
        <Text wrap="truncate">
          {'  '}
          <Text color={colorNivel(pct, cfg)}>{segmentos(pct)}</Text>
          <Text dimColor>
            {` ${pct} % · pico ${k(a.pico)} · ${a.pasos} petición${a.pasos === 1 ? '' : 'es'}${informe === undefined ? '' : ` · informe ≈${k(informe.tokens)}`}`}
          </Text>
        </Text>
      </Box>
    )
  }
  const vistaSubagentes = () =>
    tarjeta(
      activos > 0 ? `Subagentes · ${activos} en marcha` : 'Subagentes',
      agentes.length === 0
        ? <Text dimColor>Aún no se ha lanzado ningún subagente en esta sesión.</Text>
        : [...agentes].reverse().map(subagenteFila),
      activos > 0 ? 'success' : 'subtle',
    )

  // ≡ Llamadas: lo que más pesa, lo último y la memoria fija.
  const vistaLlamadas = () => {
    const pesadas = ordenar(lista, 8)
    const maximo = pesadas[0]?.tokens ?? 0
    const fila = (nombre: string, cifra: number, rgb: number, tope: number) => {
      const anchoNombre = Math.max(6, interior - 16)
      return (
        <Text wrap="truncate">
          <Text color={css(rgb)}>■ </Text>
          {nombre.slice(0, anchoNombre).padEnd(anchoNombre)}
          <Text weight="bold">{k(cifra).padStart(6)}</Text>{' '}
          <Text color={css(rgb)}>{barraFina(cifra, tope, 6)}</Text>
        </Text>
      )
    }
    return [
      tarjeta(
        'Lo que más pesa',
        pesadas.length === 0 ? <Text dimColor>Aún no hay llamadas.</Text> : pesadas.map(l => llamada(l, maximo)),
        'claude',
      ),
      lista.length === 0 ? null : tarjeta('Recientes', lista.slice(-6).reverse().map(l => llamada(l, maximo))),
      f === null || f.memoria.length === 0
        ? null
        : tarjeta('Memoria y MCP fijos', [
            ...ordenar(f.memoria, 5).map(d =>
              fila(d.nombre, d.tokens, PALETA['Memoria'] ?? GRIS, f.memoria.reduce((m, c) => Math.max(m, c.tokens), 0)),
            ),
            ...ordenar(f.mcp, 4).map(d =>
              fila(d.nombre, d.tokens, PALETA['Herramientas MCP'] ?? GRIS, f.mcp.reduce((m, c) => Math.max(m, c.tokens), 0)),
            ),
          ]),
    ]
  }

  // ⎇ Árbol: los checkpoints de la conversación, el HEAD y lo que se puede
  // hacer con el elegido (restaurar, fork, injertar, comparar, exportar,
  // nombrar, borrar); debajo, una búsqueda o comparación abierta.
  const vistaArbol = async () => {
    const head = await leerHead($)
    const elegido = buscarNodo(arbol, (await leerSeleccion($)) ?? head) ?? buscarNodo(arbol, head)
    const todo = await leerVerTodo($)
    const ocupado = await leerOcupado($)
    const borrando = await leerBorrando($)
    const consulta = await leerConsulta($)
    const Input = tabla.Input
    // Recién empezada la sesión (también tras restaurar) el índice aún no ha
    // llegado: no es un árbol vacío.
    if (arbol === null) {
      return tarjeta('Árbol de checkpoints', [<Text dimColor>Cargando el árbol…</Text>])
    }
    if (arbol.nodos.length === 0) {
      return tarjeta('Árbol de checkpoints', [
        <Text dimColor wrap="wrap">
          Aún no hay checkpoints. Se guarda uno al cerrar cada turno; con /cp nombre le pones nombre al punto actual.
        </Text>,
        <Button key="arbol-guardar" onPress={() => checkpoint($)}>
          ◆ Guardar aquí
        </Button>,
      ])
    }
    const filaNodo = (guia: string, plegados: number, id: string) => {
      const n = buscarNodo(arbol, id)
      if (n === undefined) return null
      const esHead = n.id === head
      const esElegido = n.id === elegido?.id
      const marca = esHead ? '◉ ' : n.nombre !== undefined ? '◆ ' : n.padre === null ? '● ' : '○ '
      const pliegue = plegados > 0 ? `┄${plegados}┄ ` : ''
      const cifra = ` t${n.turnos} ${k(n.tokens).padStart(5)}`
      const sitio = Math.max(6, interior - guia.length - pliegue.length - marca.length - cifra.length - (esHead ? 7 : 0))
      const texto = etiquetaNodo(n).slice(0, sitio)
      const destacado = n.nombre !== undefined || esHead
      return (
        <Button key={`nodo-${n.id}`} plain onPress={() => void cambiarSeleccion($, () => n.id)}>
          <Text wrap="truncate">
            <Text dimColor>{guia}</Text>
            <Text dimColor>{pliegue}</Text>
            <Text color={esHead ? 'claude' : n.nombre !== undefined ? 'suggestion' : 'inactive'} weight="bold">
              {marca}
            </Text>
            {esElegido ? (
              <Text inverse weight="bold">
                {texto}
              </Text>
            ) : destacado ? (
              <Text weight="bold">{texto}</Text>
            ) : (
              <Text dimColor>{texto}</Text>
            )}
            <Text dimColor>{cifra}</Text>
            {esHead ? <Text color="claude">{' ← aquí'}</Text> : null}
          </Text>
        </Button>
      )
    }

    // El detalle del elegido y cómo se relaciona con la conversación actual.
    let detalle: unknown = null
    if (elegido !== undefined) {
      const n = elegido
      const fecha = new Date(n.creado)
      const dos = (x: number) => String(x).padStart(2, '0')
      const cuando = `${dos(fecha.getDate())}/${dos(fecha.getMonth() + 1)} ${dos(fecha.getHours())}:${dos(fecha.getMinutes())}`
      const comun = head === null ? undefined : ancestroComun(arbol, n.id, head)
      const actual = buscarNodo(arbol, head)
      const enLaActual = comun?.id === n.id
      let relacion = 'otra conversación'
      if (n.id === head) relacion = 'es la conversación actual'
      else if (enLaActual && actual !== undefined) relacion = `${nTurnos(actual.turnos - n.turnos)} por detrás de la actual`
      else if (comun !== undefined && actual !== undefined) {
        relacion = `se separa en ${etiquetaNodo(comun).slice(0, 24)} · +${n.turnos - comun.turnos} aquí / +${actual.turnos - comun.turnos} en la actual`
      }
      const ramas = hijos(arbol, n.id).length
      const nivel = ancestros(arbol, n.id).length
      detalle = tarjeta(
        `${n.id === head ? '◉' : n.nombre !== undefined ? '◆' : '○'} ${etiquetaNodo(n)}`.slice(0, interior),
        [
          dato('Checkpoint', <Text>{`${n.id} · ${cuando} · nivel ${nivel}${ramas > 1 ? ` · ${ramas} ramas` : ''}`}</Text>),
          dato('Conversación', <Text weight="bold">{`${nTurnos(n.turnos)} · ${n.mensajes} mensajes · ≈${k(n.tokens)}`}</Text>),
          dato('Relación', <Text>{relacion}</Text>),
          n.prompt === '' || n.nombre === undefined ? null : dato('Último prompt', <Text dimColor>{`«${enLinea(n.prompt)}»`}</Text>),
          Input === undefined ? null : (
            <Input
              key={`nombre-${n.id}`}
              label="Nombre"
              placeholder="p. ej. «antes del refactor»"
              value={n.nombre ?? ''}
              submitLabel="Nombrar"
              onSubmit={(valor: string) => void nombrar($, n.id, valor)}
            />
          ),
          ocupado !== null || Input === undefined ? null : (
            <Input
              key={`fork-${n.id}`}
              label="Fork"
              placeholder="nombre de la rama nueva desde aquí"
              value=""
              submitLabel="⑂ Fork"
              onSubmit={(valor: string) => forkear($, n.id, valor)}
            />
          ),
          ocupado === null ? null : <Text color="warning">{`… ${ocupado}`}</Text>,
          borrando === n.id ? (
            <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
              <Text color="error" weight="bold">
                ¿Borrar este checkpoint y todo lo que cuelga de él?
              </Text>
              <Button key="borrar-si" variant="primary" onPress={() => borrarRama($, n.id)}>
                Sí, borrar
              </Button>
              <Button key="borrar-no" onPress={() => void cambiarBorrando($, () => null)}>
                Cancelar
              </Button>
            </Box>
          ) : (
            <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
              {n.id === head || ocupado !== null ? null : (
                <Button key="ir" variant="primary" onPress={() => restaurar($, n.id)}>
                  ⤺ Restaurar aquí
                </Button>
              )}
              {enLaActual || head === null ? null : (
                <Button key="injertar" onPress={() => injertar($, n.id)}>
                  ⎇ Injertar en la actual
                </Button>
              )}
              {n.id === head || head === null ? null : (
                <Button key="comparar" onPress={() => consultarComparacion($, n.id, head)}>
                  ⇄ Comparar con la actual
                </Button>
              )}
              <Button key="exportar" onPress={() => exportarConAviso($, n.id)}>
                ⇩ Exportar
              </Button>
              {n.id === head || enLaActual ? null : (
                <Button key="borrar" onPress={() => void cambiarBorrando($, () => n.id)}>
                  ✕ Borrar rama
                </Button>
              )}
            </Box>
          ),
        ],
        n.id === head ? 'claude' : 'suggestion',
      )
    }

    // Lo abierto bajo el detalle: los aciertos de una búsqueda (cada uno lleva a
    // su checkpoint) o lo que cada lado de una comparación tiene de propio.
    const nombreDe = (id: string) => {
      const n = buscarNodo(arbol, id)
      return n === undefined ? id : `${id} ${etiquetaNodo(n)}`
    }
    const cerrar = (
      <Button key="consulta-cerrar" onPress={() => void cambiarConsulta($, () => null)}>
        ✕ Cerrar
      </Button>
    )
    let abierta: unknown = null
    if (consulta?.tipo === 'buscar') {
      abierta = tarjeta(`⌕ «${enLinea(consulta.texto)}» · ${consulta.total} ${consulta.total === 1 ? 'acierto' : 'aciertos'}`.slice(0, interior), [
        consulta.total === 0 ? <Text dimColor>Nada con ese texto en los checkpoints.</Text> : null,
        ...consulta.resultados.map((acierto, i) => (
          <Button key={`hallado-${i}`} plain onPress={() => void cambiarSeleccion($, () => acierto.id)}>
            <Text wrap="truncate">
              <Text color="suggestion" weight="bold">{`${acierto.id.padEnd(5)}`}</Text>
              <Text dimColor>{`${acierto.quien}: `}</Text>
              <Text>{enLinea(acierto.extracto)}</Text>
            </Text>
          </Button>
        )),
        consulta.total > consulta.resultados.length ? (
          <Text dimColor>{`… y ${consulta.total - consulta.resultados.length} más: afina la búsqueda`}</Text>
        ) : null,
        cerrar,
      ])
    } else if (consulta?.tipo === 'comparar') {
      const lado = (id: string, ps: typeof consulta.deA) => [
        <Text weight="bold" wrap="truncate">{`${nombreDe(id)} · +${nTurnos(ps.length)}`}</Text>,
        ps.length === 0 ? <Text dimColor>{'  nada propio: es un punto anterior de la otra rama'}</Text> : null,
        ...ps.map((p, i) => (
          <Box flexDirection="column">
            <Text wrap="truncate">
              <Text dimColor>{`${String(i + 1).padStart(3)}. `}</Text>
              <Text>{`«${enLinea(p.prompt)}»`}</Text>
            </Text>
            <Text dimColor wrap="truncate">
              {`     ${p.respuesta === '' ? '(sin texto)' : enLinea(p.respuesta)}${p.herramientas > 0 ? ` · ${p.herramientas} herr.` : ''}`}
            </Text>
          </Box>
        )),
      ]
      abierta = tarjeta('⇄ Comparación', [
        dato('Se separan en', <Text>{consulta.comun === null ? 'no tienen historia en común' : nombreDe(consulta.comun)}</Text>),
        ...lado(consulta.a, consulta.deA),
        ...lado(consulta.b, consulta.deB),
        cerrar,
      ])
    }

    return [
      tarjeta(`Árbol · ${arbol.nodos.length} checkpoints`, [
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          <Button key="arbol-guardar" onPress={() => checkpoint($)}>
            ◆ Guardar aquí
          </Button>
          <Button key="arbol-todo" onPress={() => void cambiarVerTodo($, v => !v)}>
            {todo ? '⇡ Plegar cadenas' : '⇣ Ver cada turno'}
          </Button>
        </Box>,
        ...filasArbol(arbol, head, elegido?.id ?? null, todo).map(f => filaNodo(f.guia, f.plegados, f.nodo.id)),
        <Text dimColor wrap="truncate">
          {'◉ aquí  ◆ con nombre  ○ turno  ┄n┄ plegados'}
        </Text>,
        Input === undefined ? null : (
          <Input
            key="arbol-buscar"
            label="Buscar"
            placeholder="texto en todos los checkpoints"
            value={consulta?.tipo === 'buscar' ? consulta.texto : ''}
            submitLabel="Buscar"
            onSubmit={(valor: string) => consultarBusqueda($, valor)}
          />
        ),
      ]),
      detalle,
      abierta,
    ]
  }

  const cuerpo =
    activa === 'arbol'
      ? await vistaArbol()
      : activa === 'diagnostico'
      ? vistaDiagnostico()
      : activa === 'tendencia'
        ? await vistaTendencia()
        : activa === 'subagentes'
          ? vistaSubagentes()
          : activa === 'llamadas'
            ? vistaLlamadas()
            : qs.length === 0
              ? tarjeta('Reparto', <Text dimColor>El reparto aparece al cerrar el primer turno.</Text>)
              : await vistaReparto()

  return (
    <Box flexDirection="column">
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
