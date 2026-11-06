import type { EngineInterface } from 'claude-code'

import type { Hallazgo, Seguimiento } from '../../../types'

import { abrir } from '../../comun/entorno'
import { duracionCorta, enLinea, k } from '../../comun/formato'
import { ignorar, restaurarIgnorados } from '../../contexto/ignorados'
import { esRecaida, ESFUERZO_IA, modeloIA, sinResolver } from '../../ia/informe'
import { marcarResuelto, reabrir, resolverConIA } from '../../ia/lanzar'
import type { Ctx } from '../tipos'

// Pestaña ▲ Diagnóstico del panel.

// Los resueltos que se listan, los más recientes primero.
const MAXIMO_RESUELTOS = 5

// ▲ Diagnóstico: cada mal uso con su consejo, sus pruebas, abrir, resolver
// con IA (una sesión aparte, en modo plan, con el modelo según el tipo) e
// ignorar. Mientras la IA trabaja, el hallazgo sigue aquí «en curso»; cuando
// esa sesión lo marca como resuelto (o la persona), pasa con ✓ a la tarjeta de
// resueltos y deja de contar. Si después vuelve a haber pruebas, es una
// recaída: vuelve a los avisos con lo que se hizo la vez anterior.
export function vistaDiagnostico($: EngineInterface, c: Ctx) {
  const { Box, Text, Button, omitidos, seguimiento, ahora, interior, hallazgos, pasar, avivar, tarjeta } = c
  const de = (clave: string) => seguimiento.find(s => s.clave === clave)
  const pendientes = sinResolver(hallazgos, seguimiento)
  const recaidas = new Set(pendientes.filter(h => esRecaida(h, de(h.clave))).map(h => h.clave))
  const resueltos = seguimiento
    .filter((s): s is Seguimiento & { resuelto: number } => s.resuelto !== undefined && !recaidas.has(s.clave))
    .sort((a, b) => b.resuelto - a.resuelto)

  const verInforme = (s: Seguimiento) =>
    s.informe === '' ? null : (
      <Button key={`diag-informe-${s.clave}`} plain hover={pasar(`diag-informe-${s.clave}`)} onPress={() => void abrir($, s.informe)}>
        <Text color="suggestion">{' ↗ informe '}</Text>
      </Button>
    )

  const hallazgoFila = (x: Hallazgo) => {
    const ancho = Math.max(6, interior - 9)
    const ruta = x.ruta
    const seguido = de(x.clave)
    const enCurso = seguido?.resuelto === undefined ? seguido : undefined
    const recaida = recaidas.has(x.clave) ? seguido : undefined
    // Las pruebas que caben en una línea; el informe lleva todas.
    const pruebas = x.pruebas.filter(p => !p.startsWith('Fichero: ')).slice(0, 2)
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text wrap="truncate">
          <Text color={x.gravedad === 'alta' ? 'error' : 'warning'}>{x.gravedad === 'alta' ? '▲ ' : '△ '}</Text>
          <Text weight="bold">{x.texto.slice(0, ancho).padEnd(ancho)}</Text>
          <Text weight="bold">{`≈${k(x.tokens)}`.padStart(7)}</Text>
        </Text>
        <Text dimColor wrap="wrap">{`  ↳ ${x.consejo}`}</Text>
        {pruebas.map(p => (
          <Text dimColor wrap="truncate">{`    · ${enLinea(p)}`}</Text>
        ))}
        {enCurso === undefined ? null : (
          <Text color="claude" wrap="truncate">
            {`  ✦ en curso con ${modeloIA(x.tipo)} (${ESFUERZO_IA}) desde hace ${duracionCorta(Math.max(0, ahora - enCurso.abierto))} · se marca solo al terminar`}
          </Text>
        )}
        {recaida?.resuelto === undefined ? null : (
          <Text color="error" wrap="truncate">
            {`  ↺ recaída: se resolvió hace ${duracionCorta(Math.max(0, ahora - recaida.resuelto))}${recaida.resumen ? ` (${recaida.resumen})` : ''} y ha vuelto`}
          </Text>
        )}
        <Box flexDirection="row" flexWrap="wrap" columnGap={2} paddingLeft={4}>
          {ruta === undefined ? null : (
            <Button key={`diag-abrir-${x.clave}`} plain hover={pasar(`diag-abrir-${x.clave}`)} onPress={() => void abrir($, ruta)}>
              <Text color="suggestion">{' ↗ abrir '}</Text>
            </Button>
          )}
          <Button
            key={`diag-ia-${x.clave}`}
            plain
            hover={pasar(`diag-ia-${x.clave}`)}
            onPress={(press: { surface: Parameters<typeof resolverConIA>[2] }) => resolverConIA($, x, press.surface)}
          >
            <Text color="claude">{enCurso === undefined ? ' ✦ resolver con IA ' : ' ✦ otro chat '}</Text>
          </Button>
          {seguido === undefined ? null : verInforme(seguido)}
          <Button key={`diag-resuelto-${x.clave}`} plain hover={pasar(`diag-resuelto-${x.clave}`)} onPress={() => marcarResuelto($, x)}>
            <Text color="success">{' ✓ resuelto '}</Text>
          </Button>
          <Button key={`diag-ignorar-${x.clave}`} plain hover={pasar(`diag-ignorar-${x.clave}`)} onPress={() => void ignorar($, x.clave)}>
            <Text dimColor hover={avivar(`diag-ignorar-${x.clave}`, 'error')}>
              {' ✕ ignorar '}
            </Text>
          </Button>
        </Box>
      </Box>
    )
  }

  const resueltoFila = (s: Seguimiento & { resuelto: number }) => (
    <Box flexDirection="column" marginBottom={1}>
      <Text wrap="truncate">
        <Text color="success" weight="bold">
          {'✓ '}
        </Text>
        <Text dimColor strikethrough>
          {s.texto}
        </Text>
        <Text dimColor>{`  · hace ${duracionCorta(Math.max(0, ahora - s.resuelto))}`}</Text>
      </Text>
      {s.resumen === undefined || s.resumen === '' ? null : <Text dimColor wrap="wrap">{`  ↳ ${s.resumen}`}</Text>}
      <Box flexDirection="row" columnGap={2} paddingLeft={4}>
        {verInforme(s)}
        <Button key={`diag-reabrir-${s.clave}`} plain hover={pasar(`diag-reabrir-${s.clave}`)} onPress={() => reabrir($, s.clave)}>
          <Text dimColor>{' ↺ reabrir '}</Text>
        </Button>
      </Box>
    </Box>
  )

  const principal = tarjeta(
    pendientes.length === 0 ? 'Diagnóstico' : `Diagnóstico · ${pendientes.length} aviso${pendientes.length === 1 ? '' : 's'}`,
    [
      pendientes.length > 0 ? null : (
        <Text color="success">{resueltos.length > 0 ? '✓ Sin malos usos pendientes.' : '✓ Sin malos usos detectados.'}</Text>
      ),
      ...pendientes.slice(0, 8).map(hallazgoFila),
      omitidos.length === 0 ? null : (
        <Box flexDirection="row" columnGap={2}>
          <Text dimColor>{`${omitidos.length} ignorado${omitidos.length === 1 ? '' : 's'}`}</Text>
          <Button key="restaurar" plain hover={pasar('restaurar')} onPress={() => void restaurarIgnorados($)}>
            <Text color="suggestion" underline>
              restaurar
            </Text>
          </Button>
        </Box>
      ),
    ],
    pendientes.some(x => x.gravedad === 'alta') ? 'error' : pendientes.length > 0 ? 'warning' : 'success',
  )
  if (resueltos.length === 0) return principal
  return [principal, tarjeta(`✓ Resueltos · ${resueltos.length}`, resueltos.slice(0, MAXIMO_RESUELTOS).map(resueltoFila), 'success')]
}
