import type { EngineInterface } from 'claude-code'

import type { Llamada } from '../../types'

import { barraFina } from '../comun/barras'
import { css, familia } from '../comun/colores'
import { encima, FONDO_ENCIMA, sinInvertir } from '../comun/estilo'
import { k, nombreHerramienta } from '../comun/formato'
import { compactar } from '../contexto/medicion'
import { cambiarConfirmar } from '../estado/panel'
import type { Base } from './tipos'

// Las piezas que comparten las pestañas: estados de los controles (hover,
// acción principal, texto que se aviva), tarjeta, dato, los controles de
// compactar y la fila de una llamada.
export function crearPiezas($: EngineInterface, c: Base) {
  const { Box, Text, Button, confirmando, interior } = c
  // ── Estados de los controles (ver «Estilo de los controles» en comun/estilo) ────
  // Un botón, una fila o un enlace: fondo suave al pasar, sin invertirse.
  const pasar = (id: string) => ({ ...sinInvertir(`panel-${id}`), backgroundColor: FONDO_ENCIMA })
  // La acción principal: en su color en reposo y rellena de él al pasar.
  const principal = (id: string, fondo = 'suggestion') => ({
    ...sinInvertir(`panel-${id}`),
    backgroundColor: fondo,
    color: 'inverseText',
  })
  // Un texto atenuado dentro de un control: a plena intensidad al pasar.
  const avivar = (id: string, color = 'text') => encima(`panel-${id}`, { dimColor: false, color })

  // ── Piezas comunes ─────────────────────────────────────────────────────────
  const tarjeta =(titulo: string, hijos: unknown, borde = 'subtle') => (
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
        <Button key="compactar-si" variant="primary" hover={principal('compactar-si')} onPress={() => void compactar($)}>
          Sí, compactar
        </Button>
        <Button key="compactar-no" hover={pasar('compactar-no')} onPress={() => void cambiarConfirmar($, () => false)}>
          Cancelar
        </Button>
      </Box>
    ) : (
      <Button key="compactar" hover={pasar('compactar')} onPress={() => void cambiarConfirmar($, () => true)}>
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

  return { pasar, principal, avivar, tarjeta, dato, controlesCompactar, llamada }
}
