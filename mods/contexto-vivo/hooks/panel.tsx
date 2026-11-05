import type { EngineInterface } from 'claude-code'

import type { Hallazgo, Llamada, Pestana, Subagente } from '../types'
import { abrir, cargarMensajes, compactar, fotografiar, ignorar, restaurarIgnorados } from './acciones'
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
  cambiarConfirmar,
  cambiarConservar,
  cambiarNavegacion,
  cambiarPestana,
  leerAhora,
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
]
const DIAMETRO = 16

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
        <Text dimColor>{'░'.repeat(libres)}</Text>
        <Text color="warning" dimColor>
          {'▒'.repeat(celdasReserva)}
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
                  ) : tr.clase === 'marca' ? (
                    <Text weight="bold">{tr.texto}</Text>
                  ) : (
                    <Text dimColor>{tr.texto}</Text>
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
    const aLaPar = interior >= DIAMETRO + 30
    const nombreLeyenda = Math.max(6, (aLaPar ? interior - DIAMETRO - 2 : interior) - 15)
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
      const a = anillo(items, DIAMETRO)
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

  const cuerpo =
    activa === 'diagnostico'
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
      {limitesUso}
      {barraPestanas}
      {cuerpo}
      <Text dimColor wrap="truncate">
        {' ⚙ umbrales en /config · ≈ estimado por longitud'}
      </Text>
    </Box>
  )
}
