import type { EngineInterface } from 'claude-code'

import type { Subagente } from '../../../types'

import { segmentos } from '../../comun/barras'
import { colorNivel, familia } from '../../comun/colores'
import { k } from '../../comun/formato'
import type { Ctx } from '../tipos'

// Pestaña ◆ Subagentes del panel.

// ◆ Subagentes: lo lleno que va la ventana de cada uno.
export function vistaSubagentes($: EngineInterface, c: Ctx) {
  const { cfg, Box, Text, lista, agentes, interior, ventana, activos, tarjeta } = c
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
  return tarjeta(
    activos > 0 ? `Subagentes · ${activos} en marcha` : 'Subagentes',
    agentes.length === 0
      ? <Text dimColor>Aún no se ha lanzado ningún subagente en esta sesión.</Text>
      : [...agentes].reverse().map(subagenteFila),
    activos > 0 ? 'success' : 'subtle',
  )
}
