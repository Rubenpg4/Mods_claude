import type { EngineInterface } from 'claude-code'

import { barraRitmo, chispa, sector } from '../comun/barras'
import { colorCache, css } from '../comun/colores'
import { CARRIL } from '../comun/estilo'
import { duracionCorta, k } from '../comun/formato'
import { colorVentana, limitesVisibles, peorColor, ventanas } from '../contexto/limites'
import type { Ctx } from './tipos'

// Lo que el panel muestra sobre las pestañas: la tarjeta de ocupación y la de
// límites de uso.

export function cabecera($: EngineInterface, c: Ctx) {
  const { Box, Text, t, f, turnos, activa, interior, porcentaje, tokens, ventana, color, qs, sumaQs, ritmo, cercaDeCompactar, controlesCompactar } = c
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

  return (
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
}

export async function limitesUso($: EngineInterface, c: Ctx) {
  const { Box, Text, ahora, interior, tarjeta } = c
  // ── Límites de uso: barra, % usado, marca del ritmo y cuenta atrás ─────────
  const vs = ventanas(await limitesVisibles($), ahora)
  const anchoTipo = Math.max(0, ...vs.map(v => v.tipo.length)) + 2
  const reinicios = vs.map(v => (v.falta === null ? '' : `  ↻ ${duracionCorta(v.falta)}`))
  const anchoReinicio = Math.max(0, ...reinicios.map(r => r.length))
  const anchoBarraUso = Math.max(6, interior - anchoTipo - 7 - anchoReinicio)
  const hayRitmo = vs.some(v => v.ritmo !== null)
  const agotan = vs.filter(v => v.agota !== null)
  return (
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
  )
}
