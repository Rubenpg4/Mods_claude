import type { Fila, Foto, Limite, Llamada, Rotura, Subagente, Total, Turno } from '../../types'

import { barraFina, chispa, sector, segmentos } from '../comun/barras'
import { duracionCorta, k, nombreHerramienta, ordenar } from '../comun/formato'
import type { Config } from '../config'
import { diagnosticar } from './diagnostico'
import { DIA, ventanas } from './limites'
import { quesitos } from './reparto'
import { tendencia } from './tendencia'

// Textos para fuera del panel: la cola de la fila de «auto mode on» (`pie`) y
// el informe de /contexto-top (`informe`). Puro.

// La cola de la línea de «auto mode on»: contexto, turnos, uso de las ventanas
// (con la cuenta atrás si falta menos de un día y ↗ si va por encima del
// ritmo) y avisos.
export function pie(t: Total | null, limites: Limite[], turnos: number | null, avisos: number, ahora: number): string {
  const alerta = avisos > 0 ? `  ·  ⚠ ${avisos}` : ''
  // Los límites van aunque la conversación aún no tenga cifra (recién abierta,
  // tras /clear): son de la cuenta, no de la conversación.
  const uso = ventanas(limites, ahora)
    .map(v => {
      const reinicio = v.falta !== null && v.falta < DIA ? ` ↻ ${duracionCorta(v.falta)}` : ''
      return `${sector(v.usado)} ${v.tipo} ${v.usado}%${reinicio}${v.agota === null ? '' : ' ↗'}`
    })
    .join(' · ')
  const conUso = uso === '' ? '' : `  ·  ${uso}`
  if (t === null) return `  ○ ctx —${conUso}${alerta}`
  const restantes = turnos === null ? '' : `  ·  ~${turnos} turno${turnos === 1 ? '' : 's'}`
  return `  ${sector(t.porcentaje)} ctx ${t.porcentaje}% ${segmentos(t.porcentaje)} ${k(t.tokens)}/${k(t.ventana)}${restantes}${conUso}${alerta}`
}

// El texto de /contexto-top.
export function informe(
  f: Foto | null,
  lista: Llamada[],
  turnos: Turno[],
  agentes: Subagente[],
  cfg: Config,
  ignorados: string[],
  t: Total | null,
  roturas: Rotura[] = [],
): string {
  const lineas: string[] = []
  const filas = (titulo: string, datos: Fila[]) => {
    if (datos.length === 0) return
    const maximo = datos[0]?.tokens ?? 0
    lineas.push('', titulo)
    for (const d of datos) {
      lineas.push(`  ${k(d.tokens).padStart(6)}  ${barraFina(d.tokens, maximo, 12).padEnd(12)}  ${d.nombre}`)
    }
  }
  if (f !== null) {
    lineas.push(`${sector(f.porcentaje)} Contexto ${f.porcentaje} % · ${k(f.tokens)} / ${k(f.ventana)} (${f.exacto ? 'exacto' : 'estimado'})`)
    const ritmo = tendencia(turnos, f, t)
    if (ritmo.media !== null) {
      const resto = ritmo.turnosRestantes === null ? '' : ` · compacta en ~${ritmo.turnosRestantes} turnos`
      lineas.push(`  +${k(ritmo.media)}/turno${resto} · ${chispa(turnos.slice(-24).map(x => x.porcentaje))}`)
    }
    filas('Reparto de lo usado', ordenar(quesitos(f, lista), 12))
    filas('Memoria', ordenar(f.memoria, 5))
    filas('MCP cargado', ordenar(f.mcp, 5))
  }
  filas(
    'Lo que más pesa (≈)',
    ordenar(
      lista.map(l => ({ nombre: `${nombreHerramienta(l.herramienta)} ${l.etiqueta}`.slice(0, 90), tokens: l.tokens })),
      10,
    ),
  )
  if (agentes.length > 0) {
    lineas.push('', 'Subagentes')
    for (const a of agentes.slice(-6)) {
      lineas.push(`  ${a.activo ? '●' : '○'} ${a.tipo.padEnd(18)} ${k(a.tokens).padStart(6)}  ${a.descripcion.slice(0, 50)}`)
    }
  }
  const hallazgos = diagnosticar(f, lista, cfg, ignorados, { turnos, subagentes: agentes, total: t, roturas })
  if (hallazgos.length > 0) {
    lineas.push('', 'Diagnóstico')
    for (const hallazgo of hallazgos.slice(0, 8)) {
      lineas.push(
        `  ${hallazgo.gravedad === 'alta' ? '▲' : '△'} ${hallazgo.texto} (≈${k(hallazgo.tokens)})`,
        `      ↳ ${hallazgo.consejo}`,
      )
    }
  }
  return lineas.length === 0 ? 'Aún no hay datos de contexto.' : lineas.join('\n').trim()
}
