import type { EngineInterface } from 'claude-code'

import { consultarBusqueda, consultarComparacion, exportarConAviso } from '../../arbol/consultas'
import {
  ancestroComun,
  ancestros,
  borrables,
  buscarNodo,
  descendientes,
  etiquetaNodo,
  filasArbol,
  hijos,
  rewindDe,
  TODO_EL_ARBOL,
  turnos as nTurnos,
} from '../../arbol/modelo'
import {
  borrarAbandonados,
  borrarRama,
  checkpoint,
  conservarAbandonados,
  forkear,
  injertar,
  limpiarArbol,
  nombrar,
  restaurar,
} from '../../arbol/operaciones'
import { encima, FONDO_ENCIMA, sinInvertir } from '../../comun/estilo'
import { enLinea, k } from '../../comun/formato'
import {
  cambiarBorrando,
  cambiarConsulta,
  cambiarRestaurando,
  cambiarSeleccion,
  cambiarVerTodo,
  leerBorrando,
  leerConsulta,
  leerHead,
  leerOcupado,
  leerRestaurando,
  leerSeleccion,
  leerVerTodo,
} from '../../estado/arbol'
import { modeloDe } from '../../selector/modelos'
import type { Ctx } from '../tipos'

// Pestaña ⎇ Árbol del panel.

// ⎇ Árbol: los checkpoints de la conversación, el HEAD y lo que se puede
// hacer con el elegido (restaurar, fork, injertar, comparar, exportar,
// nombrar, borrar); debajo, una búsqueda o comparación abierta.
export async function vistaArbol($: EngineInterface, c: Ctx) {
  const { tabla, Box, Text, Button, arbol, interior, pasar, principal, tarjeta, dato } = c
  const head = await leerHead($)
  const elegido = buscarNodo(arbol, (await leerSeleccion($)) ?? head) ?? buscarNodo(arbol, head)
  const todo = await leerVerTodo($)
  const ocupado = await leerOcupado($)
  const borrando = await leerBorrando($)
  const restaurando = await leerRestaurando($)
  const consulta = await leerConsulta($)
  const Input = tabla.Input
  // Recién empezada la sesión (también tras restaurar) el índice aún no ha
  // llegado: no es un árbol vacío.
  if (arbol === null) {
    return tarjeta('Árbol de checkpoints', [<Text dimColor>Cargando el árbol…</Text>])
  }
  if (arbol.nodos.length === 0) {
    return tarjeta('Árbol de checkpoints', [
      <Text dimColor wrap="wrap">
        Aún no hay checkpoints. Se guarda uno al cerrar cada turno; con /cp nombre le pones nombre al punto actual.
      </Text>,
      <Button key="arbol-guardar" hover={pasar('arbol-guardar')} onPress={() => checkpoint($)}>
        ◆ Guardar aquí
      </Button>,
    ])
  }
  // La marca de rewind es de la conversación que lo hizo: en el camino de la
  // actual (y en el HEAD) no se muestra.
  const caminoActual = new Set(head === null ? [] : ancestros(arbol, head).map(n => n.id))
  const esAbandonado = (n: { id: string; abandonado?: true }) => n.abandonado === true && !caminoActual.has(n.id)
  const filaNodo = (guia: string, plegados: number, id: string) => {
    const n = buscarNodo(arbol, id)
    if (n === undefined) return null
    const esHead = n.id === head
    const esElegido = n.id === elegido?.id
    // La fila: marca, un hueco, la etiqueta (con un espacio a cada lado dentro
    // de su píldora o de su fondo al pasar), relleno liso hasta la columna de
    // las cifras y, tras otro hueco, el turno y los tokens alineados a la
    // derecha. Así el fondo nunca toca la marca ni las cifras.
    // Lo que un rewind dejó fuera de su conversación se ve apagado y con ◌.
    const fuera = esAbandonado(n)
    const marca = esHead ? '◉' : n.nombre !== undefined ? '◆' : fuera ? '◌' : n.padre === null ? '●' : '○'
    const pliegue = plegados > 0 ? `┄${plegados}┄ ` : ''
    const cifra = `${`t${n.turnos}`.padStart(4)} ${k(n.tokens).padStart(5)}`
    const aqui = esHead ? ' ← aquí' : ''
    // marca + hueco + 2 espacios de la píldora + hueco antes de la cifra.
    const sitio = Math.max(6, interior - guia.length - pliegue.length - marca.length - 4 - cifra.length - aqui.length)
    const texto = etiquetaNodo(n).slice(0, sitio)
    const relleno = ' '.repeat(Math.max(0, sitio - texto.length))
    const destacado = (n.nombre !== undefined && !fuera) || esHead
    return (
      <Button key={`nodo-${n.id}`} plain hover={sinInvertir(`panel-nodo-${n.id}`)} onPress={() => void cambiarSeleccion($, () => n.id)}>
        <Text wrap="truncate">
          <Text dimColor>{guia}</Text>
          <Text dimColor>{pliegue}</Text>
          <Text color={esHead ? 'claude' : n.nombre !== undefined && !fuera ? 'suggestion' : 'inactive'} weight="bold">
            {marca}
          </Text>
          <Text>{' '}</Text>
          {/* El elegido, una píldora del color de selección; los demás se
              iluminan con fondo suave al pasar. */}
          {esElegido ? (
            <Text backgroundColor="suggestion" color="inverseText" weight="bold">
              {` ${texto} `}
            </Text>
          ) : destacado ? (
            <Text weight="bold" hover={encima(`panel-nodo-${n.id}`, { backgroundColor: FONDO_ENCIMA })}>
              {` ${texto} `}
            </Text>
          ) : (
            <Text
              dimColor
              italic={fuera}
              hover={encima(`panel-nodo-${n.id}`, { dimColor: false, color: 'text', backgroundColor: FONDO_ENCIMA })}
            >
              {` ${texto} `}
            </Text>
          )}
          <Text>{`${relleno} `}</Text>
          <Text dimColor>{cifra}</Text>
          {esHead ? <Text color="claude">{aqui}</Text> : null}
        </Text>
      </Button>
    )
  }

  // El detalle del elegido y cómo se relaciona con la conversación actual.
  let detalle: unknown = null
  if (elegido !== undefined) {
    const n = elegido
    const fecha = new Date(n.creado)
    const dos = (x: number) => String(x).padStart(2, '0')
    const cuando = `${dos(fecha.getDate())}/${dos(fecha.getMonth() + 1)} ${dos(fecha.getHours())}:${dos(fecha.getMinutes())}`
    const comun = head === null ? undefined : ancestroComun(arbol, n.id, head)
    const actual = buscarNodo(arbol, head)
    const enLaActual = comun?.id === n.id
    let relacion = 'otra conversación'
    if (n.id === head) relacion = 'es la conversación actual'
    else if (enLaActual && actual !== undefined) relacion = `${nTurnos(actual.turnos - n.turnos)} por detrás de la actual`
    else if (comun !== undefined && actual !== undefined) {
      relacion = `se separa en ${etiquetaNodo(comun).slice(0, 24)} · +${n.turnos - comun.turnos} aquí / +${actual.turnos - comun.turnos} en la actual`
    }
    const ramas = hijos(arbol, n.id).length
    // Lo que se lleva «Borrar rama»: el nodo, lo que cuelga de él y, quizá,
    // el checkpoint de la conversación actual.
    const rama = descendientes(arbol, n.id)
    const caen = rama.size
    const conLaActual = head !== null && rama.has(head)
    const nivel = ancestros(arbol, n.id).length
    const fuera = esAbandonado(n)
    detalle = tarjeta(
      `${n.id === head ? '◉' : n.nombre !== undefined ? '◆' : fuera ? '◌' : '○'} ${etiquetaNodo(n)}`.slice(0, interior),
      [
        dato('Checkpoint', <Text>{`${n.id} · ${cuando} · nivel ${nivel}${ramas > 1 ? ` · ${ramas} ramas` : ''}`}</Text>),
        dato('Conversación', <Text weight="bold">{`${nTurnos(n.turnos)} · ${n.mensajes} mensajes · ≈${k(n.tokens)}`}</Text>),
        dato('Relación', <Text>{relacion}</Text>),
        n.modelo === undefined && n.esfuerzo === undefined
          ? null
          : dato(
              'Modo',
              <Text>
                {[n.modelo === undefined ? null : (modeloDe(n.modelo)?.nombre ?? n.modelo), n.esfuerzo ?? null]
                  .filter(x => x !== null)
                  .join(' · ')}
              </Text>,
            ),
        // Restaurar trae la conversación, no los ficheros: tras un rewind que
        // también restauró el código, lo que se hizo aquí ya no está en disco.
        fuera ? (
          <Text color="warning" wrap="wrap">
            ⤺ Un rewind lo dejó fuera de la conversación: si también restauró el código, los cambios de aquí ya no están en los ficheros.
          </Text>
        ) : null,
        n.prompt === '' || n.nombre === undefined ? null : dato('Último prompt', <Text dimColor>{`«${enLinea(n.prompt)}»`}</Text>),
        Input === undefined ? null : (
          <Input
            key={`nombre-${n.id}`}
            label="Nombre"
            placeholder="p. ej. «antes del refactor»"
            value={n.nombre ?? ''}
            submitLabel="Nombrar"
            onSubmit={(valor: string) => void nombrar($, n.id, valor)}
          />
        ),
        ocupado !== null || Input === undefined ? null : (
          <Input
            key={`fork-${n.id}`}
            label="Fork"
            placeholder="nombre de la rama nueva desde aquí"
            value=""
            submitLabel="⑂ Fork"
            onSubmit={(valor: string) => forkear($, n.id, valor)}
          />
        ),
        ocupado === null ? null : <Text color="warning">{`… ${ocupado}`}</Text>,
        borrando === n.id ? (
          <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
            <Text color="error" weight="bold">
              {caen === 1 ? '¿Borrar este checkpoint?' : `¿Borrar este checkpoint y los ${caen - 1} que cuelgan de él?`}
            </Text>
            {conLaActual ? (
              <Text color="warning">Incluye la conversación actual: sigue, pero sin checkpoint hasta el próximo turno.</Text>
            ) : null}
            <Button key="borrar-si" variant="primary" hover={principal('borrar-si', 'error')} onPress={() => borrarRama($, n.id)}>
              Sí, borrar
            </Button>
            <Button key="borrar-no" hover={pasar('borrar-no')} onPress={() => void cambiarBorrando($, () => null)}>
              Cancelar
            </Button>
          </Box>
        ) : restaurando === n.id && ocupado === null ? (
          // Restaurar un punto que un rewind dejó atrás trae su conversación,
          // no su código: se confirma, y Claude recibe una nota para releer.
          <Box flexDirection="column">
            <Text color="warning" weight="bold" wrap="wrap">
              ¿Restaurar un punto que un rewind dejó atrás?
            </Text>
            <Text dimColor wrap="wrap">
              Vuelve la conversación, no los ficheros: si el rewind restauró el código, lo que se hizo aquí ya no está en disco. Claude recibirá una nota para releer los ficheros antes de editar.
            </Text>
            <Box flexDirection="row" columnGap={1}>
              <Button key="ir-si" variant="primary" hover={principal('ir-si', 'warning')} onPress={() => restaurar($, n.id)}>
                Sí, restaurar
              </Button>
              <Button key="ir-no" hover={pasar('ir-no')} onPress={() => void cambiarRestaurando($, () => null)}>
                Cancelar
              </Button>
            </Box>
          </Box>
        ) : (
          <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
            {n.id === head || ocupado !== null ? null : (
              <Button
                key="ir"
                variant="primary"
                hover={principal('ir')}
                onPress={() => (fuera ? cambiarRestaurando($, () => n.id) : restaurar($, n.id))}
              >
                ⤺ Restaurar aquí
              </Button>
            )}
            {enLaActual || head === null ? null : (
              <Button key="injertar" hover={pasar('injertar')} onPress={() => injertar($, n.id)}>
                ⎇ Injertar en la actual
              </Button>
            )}
            {n.id === head || head === null ? null : (
              <Button key="comparar" hover={pasar('comparar')} onPress={() => consultarComparacion($, n.id, head)}>
                ⇄ Comparar con la actual
              </Button>
            )}
            <Button key="exportar" hover={pasar('exportar')} onPress={() => exportarConAviso($, n.id)}>
              ⇩ Exportar
            </Button>
            {ocupado !== null ? null : (
              <Button key="borrar" hover={pasar('borrar')} onPress={() => void cambiarBorrando($, () => n.id)}>
                ✕ Borrar rama
              </Button>
            )}
          </Box>
        ),
      ],
      n.id === head ? 'claude' : 'suggestion',
    )
  }

  // Lo abierto bajo el detalle: los aciertos de una búsqueda (cada uno lleva a
  // su checkpoint) o lo que cada lado de una comparación tiene de propio.
  const nombreDe = (id: string) => {
    const n = buscarNodo(arbol, id)
    return n === undefined ? id : `${id} ${etiquetaNodo(n)}`
  }
  const cerrar = (
    <Button key="consulta-cerrar" hover={pasar('consulta-cerrar')} onPress={() => void cambiarConsulta($, () => null)}>
      ✕ Cerrar
    </Button>
  )
  // El aviso de un rewind de esta sesión: lo que dejó fuera se ha marcado, y
  // la persona decide si se borra (el motor no dice si restauró el código).
  let avisoRewind: unknown = null
  const rewind = rewindDe(arbol, await $.session.id())
  if (rewind !== undefined) {
    const caen = borrables(arbol, rewind.ids).size
    const quedan = rewind.ids.length - caen
    const cuantos = rewind.ids.length === 1 ? '1 checkpoint quedó' : `${rewind.ids.length} checkpoints quedaron`
    avisoRewind = (
      <Box flexDirection="column">
        <Text color="warning" weight="bold" wrap="wrap">{`⤺ Rewind: ${cuantos} fuera de la conversación (◌)`}</Text>
        <Text dimColor wrap="wrap">
          {`Si también restauraste el código, sus cambios ya no están en los ficheros.${
            quedan > 0 ? ` ${quedan === 1 ? 'Se queda 1' : `Se quedan ${quedan}`} con nombre, con ramas o abiertos en otra sesión.` : ''
          }`}
        </Text>
        <Box flexDirection="row" columnGap={1}>
          {caen === 0 || ocupado !== null ? null : (
            <Button key="rewind-borrar" variant="primary" hover={principal('rewind-borrar', 'error')} onPress={() => borrarAbandonados($)}>
              {`✕ Borrar ${caen === 1 ? '1 checkpoint' : `${caen} checkpoints`}`}
            </Button>
          )}
          <Button key="rewind-conservar" hover={pasar('rewind-conservar')} onPress={() => conservarAbandonados($)}>
            Conservar
          </Button>
        </Box>
      </Box>
    )
  }
  const hayAbandonados = arbol.nodos.some(esAbandonado)

  let abierta: unknown = null
  if (consulta?.tipo === 'buscar') {
    abierta = tarjeta(`⌕ «${enLinea(consulta.texto)}» · ${consulta.total} ${consulta.total === 1 ? 'acierto' : 'aciertos'}`.slice(0, interior), [
      consulta.total === 0 ? <Text dimColor>Nada con ese texto en los checkpoints.</Text> : null,
      ...consulta.resultados.map((acierto, i) => (
        <Button key={`hallado-${i}`} plain hover={pasar(`hallado-${i}`)} onPress={() => void cambiarSeleccion($, () => acierto.id)}>
          <Text wrap="truncate">
            <Text color="suggestion" weight="bold">{`${acierto.id.padEnd(5)}`}</Text>
            <Text dimColor>{`${acierto.quien}: `}</Text>
            <Text>{enLinea(acierto.extracto)}</Text>
          </Text>
        </Button>
      )),
      consulta.total > consulta.resultados.length ? (
        <Text dimColor>{`… y ${consulta.total - consulta.resultados.length} más: afina la búsqueda`}</Text>
      ) : null,
      cerrar,
    ])
  } else if (consulta?.tipo === 'comparar') {
    const lado = (id: string, ps: typeof consulta.deA) => [
      <Text weight="bold" wrap="truncate">{`${nombreDe(id)} · +${nTurnos(ps.length)}`}</Text>,
      ps.length === 0 ? <Text dimColor>{'  nada propio: es un punto anterior de la otra rama'}</Text> : null,
      ...ps.map((p, i) => (
        <Box flexDirection="column">
          <Text wrap="truncate">
            <Text dimColor>{`${String(i + 1).padStart(3)}. `}</Text>
            <Text>{`«${enLinea(p.prompt)}»`}</Text>
          </Text>
          <Text dimColor wrap="truncate">
            {`     ${p.respuesta === '' ? '(sin texto)' : enLinea(p.respuesta)}${p.herramientas > 0 ? ` · ${p.herramientas} herr.` : ''}`}
          </Text>
        </Box>
      )),
    ]
    abierta = tarjeta('⇄ Comparación', [
      dato('Se separan en', <Text>{consulta.comun === null ? 'no tienen historia en común' : nombreDe(consulta.comun)}</Text>),
      ...lado(consulta.a, consulta.deA),
      ...lado(consulta.b, consulta.deB),
      cerrar,
    ])
  }

  return [
    tarjeta(`Árbol · ${arbol.nodos.length} checkpoints`, [
      <Box flexDirection="row" flexWrap="wrap" justifyContent="space-between" columnGap={1}>
        <Box flexDirection="row" columnGap={1}>
          <Button key="arbol-guardar" hover={pasar('arbol-guardar')} onPress={() => checkpoint($)}>
            ◆ Guardar aquí
          </Button>
          <Button key="arbol-todo" hover={pasar('arbol-todo')} onPress={() => void cambiarVerTodo($, v => !v)}>
            {todo ? '⇡ Plegar cadenas' : '⇣ Ver cada turno'}
          </Button>
        </Box>
        {ocupado !== null || borrando === TODO_EL_ARBOL ? null : (
          <Button key="arbol-limpiar" hover={principal('arbol-limpiar', 'error')} onPress={() => void cambiarBorrando($, () => TODO_EL_ARBOL)}>
            ✕ Limpiar árbol
          </Button>
        )}
      </Box>,
      borrando === TODO_EL_ARBOL ? (
        <Box flexDirection="column">
          <Text color="error" weight="bold" wrap="wrap">
            {`¿Borrar los ${arbol.nodos.length} checkpoints del árbol?`}
          </Text>
          <Text dimColor wrap="wrap">
            Las conversaciones no se borran: siguen en /resume. El próximo turno empieza un árbol nuevo.
          </Text>
          <Box flexDirection="row" columnGap={1}>
            <Button key="arbol-limpiar-si" variant="primary" hover={principal('arbol-limpiar-si', 'error')} onPress={() => limpiarArbol($)}>
              Sí, limpiar
            </Button>
            <Button key="arbol-limpiar-no" hover={pasar('arbol-limpiar-no')} onPress={() => void cambiarBorrando($, () => null)}>
              Cancelar
            </Button>
          </Box>
        </Box>
      ) : null,
      avisoRewind,
      ...filasArbol(arbol, head, elegido?.id ?? null, todo).map(f => filaNodo(f.guia, f.plegados, f.nodo.id)),
      // La leyenda va tras una raya y con las marcas en los colores del
      // árbol, para que no se lea como una fila más.
      <Text dimColor wrap="truncate">
        {'─'.repeat(Math.max(0, interior))}
      </Text>,
      <Text wrap="truncate">
        <Text color="claude" weight="bold">◉</Text>
        <Text dimColor>{' aquí · '}</Text>
        <Text color="suggestion" weight="bold">◆</Text>
        <Text dimColor>{' con nombre · '}</Text>
        <Text color="inactive" weight="bold">○</Text>
        <Text dimColor>{' turno · ┄n┄ plegados'}</Text>
        {hayAbandonados ? <Text dimColor>{' · ◌ rewind'}</Text> : null}
      </Text>,
      Input === undefined ? null : (
        <Input
          key="arbol-buscar"
          label="Buscar"
          placeholder="texto en todos los checkpoints"
          value={consulta?.tipo === 'buscar' ? consulta.texto : ''}
          submitLabel="Buscar"
          onSubmit={(valor: string) => consultarBusqueda($, valor)}
        />
      ),
    ]),
    detalle,
    abierta,
  ]
}
