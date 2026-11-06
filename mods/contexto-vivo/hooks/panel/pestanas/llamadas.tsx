import type { EngineInterface } from 'claude-code'

import { barraFina } from '../../comun/barras'
import { css, GRIS, PALETA } from '../../comun/colores'
import { k, ordenar } from '../../comun/formato'
import type { Ctx } from '../tipos'

// Pestaña ≡ Llamadas del panel.

// ≡ Llamadas: lo que más pesa, lo último y la memoria fija.
export function vistaLlamadas($: EngineInterface, c: Ctx) {
  const { Text, f, lista, interior, tarjeta, llamada } = c
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
