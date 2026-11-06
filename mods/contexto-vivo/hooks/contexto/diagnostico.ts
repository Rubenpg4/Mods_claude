import type { Foto, Hallazgo, Llamada } from '../../types'

import { familia } from '../comun/colores'
import { corta, k, nombreHerramienta } from '../comun/formato'
import type { Config } from '../config'

// Diagnóstico de malos usos del contexto, cada uno con sus pruebas. Puro: los
// umbrales llegan en `Config` (de /config).

// Lo que se sabe de una llamada, para las pruebas de un hallazgo.
function pruebasDe(l: Llamada): string[] {
  const p = [`Llamada #${l.orden} a ${l.herramienta}: ≈${k(l.tokens)} tokens de resultado en la conversación`]
  if (l.entrada !== undefined) p.push(`Argumentos: ${l.entrada}`)
  return p
}

// Malos usos del contexto: relecturas, lecturas enteras grandes, salidas y
// respuestas desmesuradas, y memoria o MCP que se pagan en cada turno. Cada
// hallazgo lleva sus pruebas, con las que `informeIA` arma el encargo.
// Los hallazgos cuya clave está en `ignorados` no se devuelven.
export function diagnosticar(f: Foto | null, lista: Llamada[], cfg: Config, ignorados: string[]): Hallazgo[] {
  const hallazgos: Hallazgo[] = []
  const lecturas = new Map<string, Llamada[]>()
  for (const l of lista) {
    if (l.herramienta === 'Read' && l.ruta !== undefined) {
      lecturas.set(l.ruta, [...(lecturas.get(l.ruta) ?? []), l])
    }
  }
  const repetidas = new Set<string>()
  for (const [ruta, veces] of lecturas) {
    if (veces.length < 2) continue
    repetidas.add(ruta)
    const suma = veces.reduce((s, l) => s + l.tokens, 0)
    const sobra = suma - Math.max(...veces.map(l => l.tokens))
    hallazgos.push({
      clave: `relectura:${ruta}`,
      tipo: 'relectura',
      gravedad: veces.length >= 3 ? 'alta' : 'media',
      texto: `${corta(ruta)} leído ${veces.length} veces`,
      consejo: 'reutiliza lo ya leído o lee solo la parte que cambió',
      tokens: sobra,
      ruta,
      herramienta: 'Read',
      pruebas: [
        `Fichero: ${ruta}`,
        `${veces.length} lecturas que suman ≈${k(suma)} tokens; ≈${k(sobra)} repiten lo ya leído`,
        ...veces.map(
          l => `Lectura #${l.orden}: ${l.parcial === true ? `parcial ${l.entrada ?? ''}`.trim() : 'entera'} · ≈${k(l.tokens)}`,
        ),
      ],
    })
  }
  for (const l of lista) {
    const fa = familia(l.herramienta).nombre
    const gravedad = l.tokens >= cfg.golpe ? 'alta' : 'media'
    const comun = { gravedad, tokens: l.tokens, herramienta: l.herramienta, pruebas: pruebasDe(l), muestra: l.muestra } as const
    if (l.herramienta === 'Read') {
      if (l.parcial === true || (l.ruta !== undefined && repetidas.has(l.ruta)) || l.tokens < cfg.lectura) continue
      hallazgos.push({
        ...comun,
        clave: `lectura:${l.id}`,
        tipo: 'lectura',
        texto: `${l.etiqueta} leído entero`,
        consejo: l.ruta?.endsWith('.md') === true ? 'lee por secciones (offset/limit) o busca con Grep' : 'usa offset/limit o Grep',
        ruta: l.ruta,
        pruebas: [...(l.ruta === undefined ? [] : [`Fichero: ${l.ruta}`]), ...comun.pruebas, 'Leído sin offset ni limit'],
      })
    } else if (fa === 'Bash' && l.tokens >= cfg.bash) {
      hallazgos.push({
        ...comun,
        clave: `bash:${l.id}`,
        tipo: 'bash',
        texto: `Salida de ${l.herramienta}: ${l.etiqueta}`,
        consejo: 'filtra la salida (head, grep, --query)',
      })
    } else if (fa === 'Respuestas MCP' && l.tokens >= cfg.mcp) {
      hallazgos.push({
        ...comun,
        clave: `mcp:${l.id}`,
        tipo: 'mcp',
        texto: `Respuesta de ${nombreHerramienta(l.herramienta)}`,
        consejo: 'pide menos resultados o solo los campos necesarios',
      })
    } else if (fa === 'Subagentes' && l.tokens >= cfg.subagente) {
      hallazgos.push({
        ...comun,
        clave: `subagente:${l.id}`,
        tipo: 'subagente',
        texto: `Informe del subagente «${l.etiqueta}»`,
        consejo: 'pídele solo la conclusión',
      })
    } else if (fa !== 'Bash' && fa !== 'Respuestas MCP' && fa !== 'Subagentes' && l.tokens >= cfg.otra) {
      hallazgos.push({
        ...comun,
        clave: `otra:${l.id}`,
        tipo: 'otra',
        texto: `${nombreHerramienta(l.herramienta)} ${l.etiqueta}`.trim(),
        consejo: 'acota la búsqueda o la consulta',
      })
    }
  }
  if (f !== null) {
    for (const m of f.memoria) {
      if (m.tokens < cfg.memoria) continue
      hallazgos.push({
        clave: `memoria:${m.ruta ?? m.nombre}`,
        tipo: 'memoria',
        gravedad: m.tokens >= cfg.memoria * 2 ? 'alta' : 'media',
        texto: `${m.nombre} en memoria`,
        consejo: 'se carga en cada turno: recórtalo o pásalo a reglas por carpeta',
        tokens: m.tokens,
        ruta: m.ruta,
        pruebas: [
          `Fichero: ${m.ruta ?? m.nombre}`,
          `≈${k(m.tokens)} tokens que viajan en cada petición (umbral del diagnóstico: ${k(cfg.memoria)})`,
          `Toda la memoria cargada: ${f.memoria.map(x => `${x.nombre} ≈${k(x.tokens)}`).join(', ')}`,
        ],
      })
    }
    const mcp = f.mcp.reduce((s, m) => s + m.tokens, 0)
    if (mcp >= cfg.mcpCargado) {
      const pesadas = [...f.mcpHerramientas].sort((a, b) => b.tokens - a.tokens).slice(0, 8)
      hallazgos.push({
        clave: 'mcp-cargado',
        tipo: 'mcp-cargado',
        gravedad: 'media',
        texto: 'Herramientas MCP cargadas',
        consejo: 'desconecta los servidores que no uses aquí',
        tokens: mcp,
        pruebas: [
          `≈${k(mcp)} tokens de esquemas MCP cargados en cada petición (umbral: ${k(cfg.mcpCargado)})`,
          ...[...f.mcp]
            .sort((a, b) => b.tokens - a.tokens)
            .map(m => `Servidor ${m.nombre}: ≈${k(m.tokens)} (${f.mcpHerramientas.filter(x => x.grupo === m.nombre).length} herramientas)`),
          ...(pesadas.length === 0 ? [] : [`Las más pesadas: ${pesadas.map(x => `${x.grupo}·${x.nombre} ≈${k(x.tokens)}`).join(', ')}`]),
        ],
      })
    }
  }
  return hallazgos
    .filter(x => !ignorados.includes(x.clave))
    .sort((a, b) => (a.gravedad === b.gravedad ? b.tokens - a.tokens : a.gravedad === 'alta' ? -1 : 1))
}
