import type { EngineInterface } from 'claude-code'

import type { Nivel } from '../types'
import { css, encima, FONDO_ENCIMA, mezcla, sinInvertir, tinta } from './calculo'
import { cambiarAplicado, cambiarSelector, leerAplicado, leerSelector } from './estado'

// El selector de modelo y esfuerzo: una banda fija sobre el prompt, plegada en
// una línea y desplegada en chips, como el de la web.
//
// El modelo cambia por la fila `model` de /config, sin ruido. El esfuerzo no
// tiene fila en /config: al pulsar se ejecuta el `/effort` real, que cambia la
// sesión al momento (y refresca la pantalla con sus filas, que se dibujan
// vacías). A mitad de turno, los dos esperan al final del turno.

type Elemento = (props: Record<string, unknown>) => unknown
type Tabla = { Box: Elemento; Text: Elemento; Button: Elemento }

export type Modelo = { id: string; nombre: string; familia: string; nota: string; rgb: number; tecla: string }

export const MODELOS: Modelo[] = [
  { id: 'claude-fable-5-1', nombre: 'Fable 5.1', familia: 'fable', nota: 'el más capaz', rgb: 0xbf5af2, tecla: '1' },
  { id: 'claude-opus-5-5', nombre: 'Opus 5.5', familia: 'opus', nota: 'potente', rgb: 0xd97757, tecla: '2' },
  { id: 'claude-sonnet-5-5', nombre: 'Sonnet 5.5', familia: 'sonnet', nota: 'equilibrado', rgb: 0x0a84ff, tecla: '3' },
  { id: 'claude-haiku-5-5', nombre: 'Haiku 5.5', familia: 'haiku', nota: 'rápido', rgb: 0x30d158, tecla: '4' },
]

// De menos a más: el orden de los tramos de la barra del esfuerzo.
export const NIVELES: { id: Nivel }[] = [{ id: 'low' }, { id: 'medium' }, { id: 'high' }, { id: 'xhigh' }, { id: 'max' }]

const NEUTRO = 0x8e8e93
// El gris del que parte el degradado del esfuerzo, y cuánto color lleva cada
// nivel: low apenas tiñe, max es el color pleno del modelo.
const BASE_ESFUERZO = 0x48484a
const INTENSIDAD = [0.42, 0.58, 0.72, 0.86, 1]
// Ancho de cada tramo de la barra del esfuerzo: «medium» y un espacio a cada lado.
const TRAMO = 8

// El modelo conocido que nombra un id o alias (`claude-opus-5-5[1m]`, `opus`).
export function modeloDe(texto: string | null): Modelo | undefined {
  if (texto === null) return undefined
  const t = texto.toLowerCase()
  return MODELOS.find(m => t.includes(m.familia))
}

export function esNivel(x: unknown): x is Nivel {
  return NIVELES.some(n => n.id === x)
}

// El color de un tramo de la barra del esfuerzo: más intenso cuanto más alto.
export function colorEsfuerzo(i: number, rgb: number): number {
  return mezcla(BASE_ESFUERZO, rgb, INTENSIDAD[Math.max(0, Math.min(INTENSIDAD.length - 1, i))] ?? 1)
}

// Hasta qué tramo está llena la barra (-1: el esfuerzo por defecto).
export function posicionEsfuerzo(nivel: string | null): number {
  return NIVELES.findIndex(n => n.id === nivel)
}

// La etiqueta de un tramo, centrada en su ancho para que la barra no se mueva.
export function etiquetaTramo(nivel: Nivel): string {
  const hueco = TRAMO - nivel.length
  return ' '.repeat(Math.floor(hueco / 2)) + nivel + ' '.repeat(Math.ceil(hueco / 2))
}

// Si la conversación principal tiene un turno en marcha: lo pulsado entonces
// se guarda y se aplica al acabar, para no cambiar el modelo que está actuando.
const turno = { activo: false }

export function empiezaTurno(): void {
  turno.activo = true
}

// Al acabar el turno: el modelo pendiente y luego el /effort, que así queda
// guardado para el modelo nuevo (el esfuerzo se guarda por modelo).
export async function acabaTurno($: EngineInterface): Promise<void> {
  turno.activo = false
  const s = await leerSelector($)
  if (s.modelo === null && s.esfuerzo === null) return
  await cambiarSelector($, x => ({ ...x, modelo: null, esfuerzo: null }))
  const m = MODELOS.find(x => x.id === s.modelo)
  if (m !== undefined) await aplicarModelo($, m)
  if (s.esfuerzo !== null) await aplicarEsfuerzo($, s.esfuerzo)
}

// Los comandos que lanza el propio mod: su eco y su salida son ruido en el
// transcript (y lo que hacía saltar la pantalla), así que se dibujan vacíos.
// El marcador vive hasta que el motor ha dibujado sus filas.
const propios = new Map<string, number>()

export function esPropio(command: string, args: string): boolean {
  return (propios.get(`${command} ${args.trim()}`) ?? 0) > 0
}

async function silencioso($: EngineInterface, command: string, args: string): Promise<string | undefined> {
  const marca = `${command} ${args}`
  propios.set(marca, (propios.get(marca) ?? 0) + 1)
  try {
    return (await $.command.run({ command, args })).text
  } finally {
    // Un respiro para que se dibujen las filas antes de soltar el marcador.
    $.clock.after(1500, () => {
      const n = (propios.get(marca) ?? 1) - 1
      if (n <= 0) propios.delete(marca)
      else propios.set(marca, n)
    })
  }
}

// Cambia una fila de /config como el menú: sin eco ni salida en el transcript.
// `false` si no hay fila o la rechaza.
async function porConfig(
  $: EngineInterface,
  esLaFila: (clave: string, etiqueta: string) => boolean,
  candidatos: string[],
): Promise<boolean> {
  try {
    const fila = (await $.config.list()).find(r => !r.isLocked && esLaFila(r.key.toLowerCase(), r.label.toLowerCase()))
    if (fila === undefined) return false
    const opciones = fila.options ?? []
    const valor =
      opciones.length === 0
        ? candidatos[0]
        : (candidatos.map(c => opciones.find(o => o.toLowerCase() === c)).find(o => o !== undefined) ??
          opciones.find(o => candidatos.some(c => o.toLowerCase().includes(c))))
    if (valor === undefined) return false
    const r = await $.config.set({ key: fila.key, value: valor })
    return !('deny' in r && r.deny !== undefined)
  } catch {
    return false
  }
}

async function aplicarModelo($: EngineInterface, m: Modelo): Promise<void> {
  const esModelo = (k: string, l: string) => k === 'model' || /^model\b/.test(l)
  try {
    let ahora: string | null = null
    if (await porConfig($, esModelo, [m.id, m.familia])) ahora = await $.session.model().catch(() => null)
    // Respaldo: el /model de verdad, con sus filas ocultas.
    if (modeloDe(ahora)?.id !== m.id) {
      await silencioso($, 'model', m.id)
      ahora = await $.session.model().catch(() => null)
    }
    if (ahora !== null && modeloDe(ahora)?.id !== m.id) $.ui.toast(`✕ El modelo no cambió a ${m.nombre}`)
    else await cambiarAplicado($, a => ({ ...a, modelo: ahora ?? m.id }))
  } catch (error) {
    $.ui.toast(`✕ No se pudo cambiar a ${m.nombre}: ${String(error).slice(0, 80)}`)
  }
}

// Una sola escritura por pulsación: la elección pendiente o el cambio aplicado.
export async function elegirModelo($: EngineInterface, m: Modelo): Promise<void> {
  if (turno.activo) await cambiarSelector($, s => ({ ...s, modelo: m.id }))
  else await aplicarModelo($, m)
}

// El /effort real: cambia el esfuerzo de la sesión al momento.
async function aplicarEsfuerzo($: EngineInterface, nivel: Nivel): Promise<void> {
  try {
    await silencioso($, 'effort', nivel)
    await cambiarAplicado($, a => ({ ...a, esfuerzo: nivel }))
  } catch (error) {
    $.ui.toast(`✕ No se pudo cambiar el esfuerzo a ${nivel}: ${String(error).slice(0, 80)}`)
  }
}

export async function elegirEsfuerzo($: EngineInterface, nivel: Nivel): Promise<void> {
  if (turno.activo) await cambiarSelector($, s => ({ ...s, esfuerzo: nivel }))
  else await aplicarEsfuerzo($, nivel)
}

// Vuelve al modelo y al esfuerzo guardados en un checkpoint, si no son ya los
// de la sesión. El esfuerzo va después del modelo: se guarda por modelo, así
// que tras cambiar de modelo se aplica siempre. Devuelve lo que cambió.
export async function restaurarModo($: EngineInterface, modelo?: string, esfuerzo?: string): Promise<string[]> {
  const cambios: string[] = []
  const m = modeloDe(modelo ?? null)
  if (m !== undefined && modeloDe(await $.session.model().catch(() => null))?.id !== m.id) {
    await aplicarModelo($, m)
    cambios.push(m.nombre)
  }
  if (esNivel(esfuerzo) && (cambios.length > 0 || (await leerAplicado($)).esfuerzo !== esfuerzo)) {
    await aplicarEsfuerzo($, esfuerzo)
    cambios.push(esfuerzo)
  }
  return cambios
}

// Un /effort escrito a mano manda sobre lo que esperaba al final del turno.
export async function soltarEsfuerzo($: EngineInterface): Promise<void> {
  const s = await leerSelector($)
  if (s.esfuerzo !== null) await cambiarSelector($, x => ({ ...x, esfuerzo: null }))
}

export async function desplegar($: EngineInterface, abierto: boolean): Promise<void> {
  await cambiarSelector($, s => ({ ...s, desplegado: abierto }))
}

// `/modelo [modelo] [esfuerzo]`: con argumentos los aplica; sin ellos despliega
// la banda. Va fuera del hook del comando: `$.command.run` no puede ejecutarse
// mientras el turno espera a ese hook.
export async function comandoModelo($: EngineInterface, args: string): Promise<string | undefined> {
  const partes = args.toLowerCase().split(/\s+/).filter(p => p !== '')
  if (partes.length === 0) {
    await desplegar($, true)
    return undefined
  }
  const modelo = partes.map(p => MODELOS.find(m => m.familia === p || m.id === p)).find(m => m !== undefined)
  const nivel = partes.find(esNivel)
  const raros = partes.filter(p => !esNivel(p) && !MODELOS.some(m => m.familia === p || m.id === p))
  if (raros.length > 0) {
    return `No reconozco «${raros.join(' ')}». Uso: /modelo [${MODELOS.map(m => m.familia).join('|')}] [${NIVELES.map(n => n.id).join('|')}]`
  }
  $.clock.after(10, () => {
    void (async () => {
      if (modelo !== undefined) await elegirModelo($, modelo)
      if (nivel !== undefined) await elegirEsfuerzo($, nivel)
    })()
  })
  return undefined
}

// Lo que se muestra: el modelo de la sesión tal como lo da /model (se lee en
// cada dibujo) y el esfuerzo de la última petición o del último cambio.
async function situacion($: EngineInterface) {
  const sel = await leerSelector($)
  const apl = await leerAplicado($)
  const crudo = (await $.session.model().catch(() => null)) ?? apl.modelo
  const actual = modeloDe(crudo)
  return {
    sel,
    crudo,
    actual,
    nombre: actual?.nombre ?? crudo ?? 'modelo por defecto',
    rgb: actual?.rgb ?? NEUTRO,
    nivel: apl.esfuerzo,
  }
}

type Situacion = Awaited<ReturnType<typeof situacion>>
// Dónde se dibuja el selector: cada sitio tiene sus propios grupos de hover,
// para que pasar por la banda no ilumine el panel ni al revés.
type Sitio = 'banda' | 'panel'

// La barra del esfuerzo en pequeño, para la línea plegada: los cinco tramos
// en su degradado; los de encima del nivel actual, punteados.
function barraMini(t: Tabla, s: Situacion): unknown[] {
  const { Text } = t
  const hasta = posicionEsfuerzo(s.nivel)
  return NIVELES.map((n, i) => (
    <Text key={`mini-${n.id}`} color={css(colorEsfuerzo(i, s.rgb))} dimColor={i > hasta}>
      {i <= hasta ? '━━' : '╌╌'}
    </Text>
  ))
}

// La línea plegada: un solo botón que despliega. Al pasar por encima, la pista
// se enciende como un enlace en lugar de invertirse la línea entera.
function lineaPlegada(t: Tabla, s: Situacion, alPulsar: () => void, pista: string, sitio: Sitio) {
  const { Button, Text } = t
  const id = `${sitio}-desplegar`
  const pendiente = s.sel.modelo !== null || s.sel.esfuerzo !== null
  return (
    <Button key="selector-desplegar" plain hover={sinInvertir(id)} onPress={alPulsar}>
      <Text color={css(s.rgb)} weight="bold">{`◆ ${s.nombre}`}</Text>
      <Text dimColor>{'   esfuerzo '}</Text>
      {barraMini(t, s)}
      <Text color={s.nivel === null ? undefined : css(colorEsfuerzo(posicionEsfuerzo(s.nivel), s.rgb))} weight="bold">
        {` ${s.nivel ?? 'por defecto'}`}
      </Text>
      {pendiente ? <Text color="warning">{'   ⧗ al acabar el turno'}</Text> : null}
      <Text>{'   '}</Text>
      <Text dimColor hover={encima(id, { dimColor: false, color: 'suggestion', underline: true })}>
        {pista}
      </Text>
    </Button>
  )
}

// Las píldoras de los modelos: ● la del modelo actual, rellena de su color;
// ○ las demás, en su color y con fondo suave al pasar; ⧗ la que espera turno.
function filaModelos($: EngineInterface, t: Tabla, s: Situacion, conTeclas: boolean, sitio: Sitio) {
  const { Box, Button, Text } = t
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={conTeclas ? 2 : 1}>
      <Text dimColor>{'modelo   '}</Text>
      {MODELOS.map(m => {
        const id = `${sitio}-modelo-${m.familia}`
        const activo = s.actual?.id === m.id
        const esperando = s.sel.modelo === m.id
        return (
          <Button
            key={`selector-modelo-${m.familia}`}
            plain
            hover={sinInvertir(id)}
            {...(conTeclas ? { hotkey: m.tecla } : {})}
            onPress={() => void elegirModelo($, m)}
          >
            {/* Mismo ancho en todos los estados: la fila no se recoloca. */}
            {activo ? (
              <Text backgroundColor={css(m.rgb)} color={tinta(m.rgb)} weight="bold">{` ● ${m.nombre} `}</Text>
            ) : esperando ? (
              <Text color="warning" weight="bold" hover={encima(id, { backgroundColor: FONDO_ENCIMA })}>
                {` ⧗ ${m.nombre} `}
              </Text>
            ) : (
              <Text color={css(m.rgb)} hover={encima(id, { backgroundColor: FONDO_ENCIMA, bold: true })}>
                {` ○ ${m.nombre} `}
              </Text>
            )}
          </Button>
        )
      })}
    </Box>
  )
}

// La barra del esfuerzo: cinco tramos seguidos, cada uno un botón con su nivel
// dentro y su color del degradado (low apenas tiñe, max es el color pleno del
// modelo). El nivel actual va en negrita con la tinta plena; los demás, con la
// tinta atenuada. Al pasar por un tramo se enciende con el color pleno, como
// anticipo de elegirlo; el que espera al final del turno va en ámbar.
//
// Sin teclas: la tecla de un botón se dibuja delante («q: ») y partiría la
// barra en trozos. Se elige con el ratón, o con `/modelo <nivel>` desde el prompt.
function filaEsfuerzo($: EngineInterface, t: Tabla, s: Situacion, sitio: Sitio) {
  const { Box, Button, Text } = t
  const actual = posicionEsfuerzo(s.nivel)
  return (
    <Box flexDirection="row" flexWrap="wrap">
      <Text dimColor>{'esfuerzo '}</Text>
      {NIVELES.map((n, i) => {
        const id = `${sitio}-esfuerzo-${n.id}`
        const esperando = s.sel.esfuerzo === n.id
        const color = colorEsfuerzo(i, s.rgb)
        const destacado = i === actual || esperando
        return (
          <Button key={`selector-esfuerzo-${n.id}`} plain hover={sinInvertir(id)} onPress={() => void elegirEsfuerzo($, n.id)}>
            <Text
              backgroundColor={esperando ? 'warning' : css(color)}
              color={esperando ? '#000000' : tinta(color)}
              dimColor={!destacado}
              weight={destacado ? 'bold' : undefined}
              hover={encima(id, { backgroundColor: css(s.rgb), color: tinta(s.rgb), dimColor: false, bold: true })}
            >
              {etiquetaTramo(n.id)}
            </Text>
          </Button>
        )
      })}
      {actual < 0 && s.sel.esfuerzo === null ? <Text dimColor>{'  por defecto'}</Text> : null}
    </Box>
  )
}

export type RenderBanda = { surface: string; props: { hasSurvey: boolean; bodyColumns: number } }

// La banda sobre el prompt: plegada, una línea; desplegada, una tarjeta con
// el color del modelo actual. Lo que otros plugins dibujen ahí va debajo.
export async function dibujarBanda($: EngineInterface, e: RenderBanda, debajo: unknown): Promise<unknown> {
  if (e.props.hasSurvey) return debajo
  const t = $.ui.resolve(e as never) as unknown as Tabla
  const { Box, Button, Text } = t
  const s = await situacion($)

  const propio = !s.sel.desplegado ? (
    lineaPlegada(t, s, () => void desplegar($, true), '▾ cambiar', 'banda')
  ) : (
    <Box flexDirection="column" borderStyle="round" borderColor={css(s.rgb)} paddingX={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text wrap="truncate">
          <Text color={css(s.rgb)} weight="bold">{`◆ ${s.nombre}`}</Text>
          <Text dimColor>{s.actual === undefined ? '' : `  ${s.actual.nota}`}</Text>
        </Text>
        <Button
          key="selector-plegar"
          plain
          hotkey="x"
          hover={sinInvertir('banda-plegar')}
          onPress={() => void desplegar($, false)}
        >
          <Text dimColor hover={encima('banda-plegar', { dimColor: false, color: 'suggestion', underline: true })}>
            ▴ plegar
          </Text>
        </Button>
      </Box>
      {filaModelos($, t, s, true, 'banda')}
      {filaEsfuerzo($, t, s, 'banda')}
      <Text dimColor wrap="truncate">
        {s.sel.modelo !== null || s.sel.esfuerzo !== null
          ? '⧗ se aplicará en cuanto acabe el turno en curso'
          : 'cambia el /model y el /effort de la sesión · teclas 1-4 y x con la banda enfocada (ctrl+x tab)'}
      </Text>
    </Box>
  )
  return debajo === undefined || debajo === null ? (
    propio
  ) : (
    <Box flexDirection="column">
      {propio}
      {debajo}
    </Box>
  )
}

// En el panel /ctx: donde hay banda (terminal y escritorio), una línea que
// la despliega; donde no (VS Code, móvil), las píldoras y la barra completas.
export async function selectorEnPanel($: EngineInterface, t: Tabla, surface: string): Promise<unknown> {
  const s = await situacion($)
  if (surface === 'terminal' || surface === 'desktop') {
    return lineaPlegada(
      t,
      s,
      () => void desplegar($, !s.sel.desplegado),
      s.sel.desplegado ? '▴ plegar banda' : '▾ cambiar',
      'panel',
    )
  }
  const { Box } = t
  return (
    <Box flexDirection="column">
      {filaModelos($, t, s, false, 'panel')}
      {filaEsfuerzo($, t, s, 'panel')}
    </Box>
  )
}
