import type { EngineInterface } from 'claude-code'

import type { Hallazgo } from '../../../types'

import { abrir } from '../../comun/entorno'
import { enLinea, k } from '../../comun/formato'
import { ignorar, restaurarIgnorados } from '../../contexto/ignorados'
import { resolverConIA } from '../../ia/lanzar'
import type { Ctx } from '../tipos'

// Pestaña ▲ Diagnóstico del panel.

// ▲ Diagnóstico: cada mal uso con su consejo, sus pruebas, abrir, resolver
// con IA (una sesión aparte en Sonnet) e ignorar.
export function vistaDiagnostico($: EngineInterface, c: Ctx) {
  const { Box, Text, Button, omitidos, interior, hallazgos, pasar, avivar, tarjeta } = c
  const hallazgoFila = (x: Hallazgo) => {
    const ancho = Math.max(6, interior - 9)
    const ruta = x.ruta
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
        <Box flexDirection="row" columnGap={2} paddingLeft={4}>
          {ruta === undefined ? null : (
            <Button key={`diag-abrir-${x.clave}`} plain hover={pasar(`diag-abrir-${x.clave}`)} onPress={() => void abrir($, ruta)}>
              <Text color="suggestion">{' ↗ abrir '}</Text>
            </Button>
          )}
          <Button
            key={`diag-ia-${x.clave}`}
            plain
            hover={pasar(`diag-ia-${x.clave}`)}
            onPress={press => resolverConIA($, x, press.surface)}
          >
            <Text color="claude">{' ✦ resolver con IA '}</Text>
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
  return tarjeta(
    hallazgos.length === 0 ? 'Diagnóstico' : `Diagnóstico · ${hallazgos.length} aviso${hallazgos.length === 1 ? '' : 's'}`,
    [
      hallazgos.length === 0 ? <Text color="success">✓ Sin malos usos detectados.</Text> : null,
      ...hallazgos.slice(0, 8).map(hallazgoFila),
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
    hallazgos.some(x => x.gravedad === 'alta') ? 'error' : hallazgos.length > 0 ? 'warning' : 'success',
  )
}
