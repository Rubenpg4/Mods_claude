# Arquitectura de contexto-vivo

Cómo está hecho el mod por dentro. El uso y las opciones están en el [README](README.md).

1. [Visión general](#1-visión-general)
2. [Mapa de carpetas](#2-mapa-de-carpetas)
3. [Estado](#3-estado)
4. [Eventos y comandos](#4-eventos-y-comandos)
5. [Árbol de checkpoints](#5-árbol-de-checkpoints)
6. [Diagnóstico y resolución con IA](#6-diagnóstico-y-resolución-con-ia)
7. [Opciones de /config](#7-opciones-de-config)
8. [Tests](#8-tests)
9. [Reglas del motor, problemas conocidos y decisiones](#9-reglas-del-motor-problemas-conocidos-y-decisiones)

---

## 1. Visión general

Un mod de Claude Code es una carpeta con un manifiesto (`.claude-plugin/plugin.json`) y un módulo de hooks (`hooks/hooks.json` → `hooks/register.tsx`). El módulo corre en un entorno propio del motor: sin Node, sin DOM y sin `require`. Todo lo que toca el exterior pasa por `$` (`$.session`, `$.ui`, `$.fs`, `$.process`, `$.store`…).

El flujo es siempre el mismo:

```
evento del motor ──► register.tsx ──► acción (contexto/, arbol/, selector/, ia/)
                                         │
                                         ▼
                                   estado/ (átomos)  ◄── leer… suscribe el dibujo
                                         │
                                         ▼
                     dibujo: fila (PromptHint), banda (AbovePrompt), panel (Pane)
```

- **`register.tsx`** es la tabla de eventos: cada `on(...)` llama a funciones de los dominios. Apenas tiene lógica propia.
- Las **acciones** miden, guardan y modifican. Escriben en los **átomos** de `estado/` con `cambiar…`.
- Los **dibujos** leen los átomos con `leer…`, y eso los suscribe: cuando un átomo cambia, el motor vuelve a dibujar.
- Los cálculos **puros** (sin `$`) están separados de los que actúan, para poder probarlos sin motor.

### Capas

Cada carpeta solo importa de las que están a su izquierda (sin ciclos entre carpetas):

```
comun ─┐
       ├─► contexto ─┐
estado ┤             ├─► arbol ─► panel ─► register.tsx
       ├─► selector ─┘
       └─► ia ───────────────────► panel
```

`config.ts` y `types/index.d.ts` los usa cualquiera.

## 2. Mapa de carpetas

```
mods/contexto-vivo/
├── .claude-plugin/plugin.json   manifiesto: nombre, versión, opciones de /config, contrato de tipos
├── hooks/
│   ├── hooks.json               { "modules": ["./register.tsx"] }
│   ├── register.tsx             tabla de eventos y comandos (entrada del mod)
│   ├── config.ts                opciones de /config → Config
│   ├── comun/                   utilidades compartidas
│   ├── estado/                  átomos del estado y sus leer…/cambiar…
│   ├── contexto/                medición del contexto y cálculos sobre ella
│   ├── ia/                      «resolver con IA»
│   ├── selector/                selector de modelo y esfuerzo
│   ├── arbol/                   árbol de checkpoints
│   └── panel/                   panel /ctx
├── scripts/transcript.cjs       ayudante en Node: lee y bifurca transcripts
├── types/index.d.ts             tipos compartidos y forma del estado (PluginState)
└── tests/contexto.test.tsx      tests (claude plugin test)
```

`Puro` significa que el fichero no usa `$`: recibe datos y devuelve datos.

| Fichero | Qué hay | Puro |
|---------|---------|:----:|
| `comun/formato.ts` | `k` (1.2k), `enLinea` (texto en una línea, sin ANSI), `corta` (ruta corta), `nombreHerramienta`, `duracionCorta`, `etiquetar`, `ordenar`, `CARACTERES_POR_TOKEN` | ✔ |
| `comun/colores.ts` | Paleta de categorías, `familia` de herramienta, colores de nivel, `mezcla`, `tinta`, `css` | ✔ |
| `comun/estilo.ts` | Estilo de los controles: grupos de hover (`grupo`, `sinInvertir`, `encima`), `FONDO_ENCIMA`, `CARRIL` | ✔ |
| `comun/barras.ts` | Barras de texto: `sector`, `barraFina`, `segmentos`, `chispa`, `barraRitmo` | ✔ |
| `comun/graficos.ts` | Anillo del reparto y columnas de la tendencia, en Raster (terminal) o SVG | ✔ |
| `comun/entorno.ts` | `abrir` (VS Code) y `carpetaDatos` (dónde guarda el mod) | |
| `estado/contexto.ts` | Átomos de la medición (sección 3) | |
| `estado/panel.ts` | Átomos de la interfaz del panel y `PANEL` (id del panel) | |
| `estado/arbol.ts` | Átomos del árbol en la interfaz | |
| `estado/selector.ts` | Átomos del selector | |
| `contexto/medicion.ts` | `refrescar` (cifra, caché y avisos tras cada respuesta), `fotografiar` (desglose de `/context`), `registrarLlamada`, `registrarTurno`, `registrarPaso` y `terminarSubagente` (subagentes), `compactar`, `olvidarConversacion` | |
| `contexto/limites.ts` | Ventanas de uso 5h/7d: lectura del motor, copia en `$.store`, ritmo y cuenta atrás | parte |
| `contexto/reparto.ts` | `quesitos` (porciones) y `entradas` (cada nivel del anillo) | ✔ |
| `contexto/diagnostico.ts` | `diagnosticar`: los malos usos con sus pruebas, agrupados por patrón; `patronComando`, `argumento` | ✔ |
| `contexto/tendencia.ts` | Crecimiento por turno y turnos hasta compactar | ✔ |
| `contexto/informes.ts` | `pie` (cola de la fila) e `informe` (`/contexto-top`) | ✔ |
| `contexto/ignorados.ts` | Hallazgos ignorados, guardados en `$.store` | |
| `ia/informe.ts` | Informe Markdown de un hallazgo (front-matter y bloques XML), guía por tipo (`GUIAS`), título y nombre de fichero; `resolucionIA` (lee «## Resuelto») y `sinResolver` | ✔ |
| `ia/lanzar.ts` | Escribe el informe, abre `claude` aparte (Windows Terminal o consola, PowerShell 7) y sigue el hallazgo hasta que se resuelve | |
| `selector/modelos.ts` | Modelos y niveles ofrecidos y sus colores | ✔ |
| `selector/aplicar.ts` | Aplicar al momento o al final del turno; ocultar el eco de los comandos propios | |
| `selector/banda.tsx` | Dibujo de la banda y de su versión en el panel | |
| `arbol/modelo.ts` | Forma del árbol: buscar, recorrer, fundir, marcar tras rewind, recortar, plegar en filas, resolver nombres | ✔ |
| `arbol/mensajes.ts` | Mensajes de un checkpoint: qué es un prompt, transcripción en Markdown, pasos, corte de un rewind | ✔ |
| `arbol/disco.ts` | Índice en disco, cola de operaciones (`enCola`), ayudante `transcript.cjs` | |
| `arbol/operaciones.ts` | Cargar, checkpoint, nombrar, restaurar, fork, borrar, limpiar, injertar | |
| `arbol/rewind.ts` | Vigía del rewind nativo | |
| `arbol/consultas.ts` | Buscar, comparar, exportar y sus textos para los comandos | |
| `panel/index.tsx` | `dibujarPanel`: lee el estado, calcula y monta cabecera, límites, pestañas y la vista activa | |
| `panel/tipos.ts` | `Ctx` (lo que recibe cada pestaña), `Tabla`, `RenderPanel` | ✔ |
| `panel/piezas.tsx` | Piezas comunes: `pasar`, `principal`, `avivar`, `tarjeta`, `dato`, `controlesCompactar`, `llamada` | |
| `panel/cabecera.tsx` | Tarjeta de ocupación y tarjeta de límites de uso | |
| `panel/pestanas/*.tsx` | Una pestaña por fichero: `vistaX($, c)` | |

### Cómo se dibuja el panel

`panel/index.tsx` hace todas las lecturas (`leer…`) y cálculos del dibujo una sola vez y los reúne en un `Ctx`. Cada pestaña es `vistaX($, c)` y empieza con `const { … } = c`. `$` va siempre como argumento propio, nunca dentro de `c` (sección 9).

## 3. Estado

Cada átomo está en el mismo fichero que sus `leer…`/`cambiar…`. `leer…` suscribe el dibujo que lo llama. `cambiar…` lee, aplica y escribe con control de versión, así que dos cambios seguidos no se pisan. La forma de cada átomo está declarada en `types/index.d.ts` (`PluginState`).

**Si cambian los campos de un átomo, hay que cambiar su `shape`**: lo guardado sobrevive a la recarga del mod, y con el mismo `shape` se leería con la forma vieja.

| Átomo | `shape` | Fichero | Contiene | Lo escribe | Lo lee |
|-------|---------|---------|----------|------------|--------|
| `llamadas` | llamadas-3 | estado/contexto | Últimas 300 llamadas a herramientas, con turno, hora y líneas pedidas (`desde`/`cuantas`) | `registrarLlamada`, `reiniciar` | fila, panel, `/contexto-top` |
| `total` | total-5 | estado/contexto | Ocupación y caché de la última respuesta | `refrescar`, `reiniciar` | fila, panel, checkpoints |
| `limites` | limites-1 | estado/contexto | Ventanas de uso (también en `$.store`) | `apuntarLimites`, `cargarLimites` | fila, panel |
| `foto` | foto-3 | estado/contexto | Desglose de `/context` | `fotografiar`, `olvidarConversacion` | fila, panel |
| `aviso` | aviso-1 | estado/contexto | Último umbral avisado | `refrescar`, `reiniciar` | `refrescar` |
| `historial` | historial-1 | estado/contexto | Últimos 120 turnos | `registrarTurno` | panel, fila |
| `subagentes` | subagentes-1 | estado/contexto | Últimos 12 subagentes | `registrarPaso`, `terminarSubagente` | panel |
| `roturas` | roturas-1 | estado/contexto | Últimas 20 cachés invalidadas: turno, tokens reescritos, pausa y modelo antes y después | `refrescar`, `reiniciar` | diagnóstico |
| `ignorados` | ignorados-1 | estado/contexto | Claves ignoradas (copia de `$.store`) | `ignorar`, `cargarIgnorados` | diagnóstico |
| `seguimiento` | seguimiento-1 | estado/contexto | Hallazgos de este proyecto llevados a la IA, en curso o resueltos (copia de `$.store`) | `resolverConIA`, `comprobarResueltos`, `marcarResuelto`, `reabrir`, `cargarSeguimiento` | diagnóstico, fila, `/contexto-top` |
| `ultimoPrompt` | prompt-1 | estado/contexto | Texto del último prompt | `prompt.submit` | `registrarTurno` |
| `ahora` | ahora-1 | estado/contexto | Hora del tic de cada minuto | `marcarHora` | cuenta atrás |
| `pestana` | pestana-1 | estado/panel | Pestaña activa | barra de pestañas, `/cp-arbol` | panel |
| `navegacion` | navegacion-1 | estado/panel | Nivel del reparto (`[]`, `['Memoria']`…) | Reparto | Reparto |
| `mensajes` | mensajes-1 | estado/panel | Los 20 mensajes más largos | `cargarMensajes` | Reparto |
| `confirmar` | confirmar-1 | estado/panel | Compactar espera confirmación | botones | panel |
| `conservar` | conservar-1 | estado/panel | Qué conservar al compactar | Tendencia | `compactar` |
| `arbol` | arbol-3 | estado/arbol | Copia del índice en disco | `escribirDisco` y cargas | panel, comandos |
| `head` | head-2 | estado/arbol | Checkpoint actual de la sesión | operaciones, vigía | panel, comandos |
| `seleccion` | seleccion-1 | estado/arbol | Nodo elegido en el panel | panel, operaciones | panel |
| `verTodo` | verTodo-1 | estado/arbol | Ver cada turno o plegar cadenas | panel | panel |
| `borrando` | borrando-1 | estado/arbol | Nodo (o `*`) cuyo borrado espera confirmación | panel | panel |
| `restaurando` | restaurando-1 | estado/arbol | Restaurar un punto abandonado espera confirmación | panel | panel |
| `ocupado` | ocupado-1 | estado/arbol | Operación larga en curso | `irA`, `injertar` | panel |
| `consulta` | consulta-2 | estado/arbol | Búsqueda o comparación abierta | consultas | panel |
| `selector` | selector-5 | estado/selector | Banda desplegada y lo pulsado a mitad de turno | selector | banda |
| `aplicado` | aplicado-1 | estado/selector | Modelo y esfuerzo de la última petición | `turn.step`, `/model`, `/effort` | banda, fila, checkpoints |

**Otros sitios donde se guarda algo**

- En `$.store`: `ignorados`, `seguimiento` (los hallazgos llevados a la IA, de todos los proyectos, hasta 100), `limites` (última lectura, para mostrarla nada más abrir) y `arbol-abrir` (la sesión que debe abrir la pestaña Árbol tras un `/resume`).
- En disco, bajo `carpetaDatos`: `ramas/<proyecto>/indice.json`, `ramas/<proyecto>/busqueda.json`, `ramas/<proyecto>/exportes/*.md` e `informes/<proyecto>/*.md`.
- En variables del propio módulo, que solo pueden modificarse dentro de su fichero:

| Variable | Fichero | Para qué |
|----------|---------|----------|
| `cola` | arbol/disco.ts | Serializa las operaciones sobre el índice |
| `vigia`, `visto`, `mirando` | arbol/rewind.ts | Temporizador del vigía y lo último que vio |
| `marcas` | contexto/medicion.ts | Tras compactar no se avisa de que la caché se invalidó; hora y modelo de la última respuesta, para explicar una caché rota |
| `turno`, `propios` | selector/aplicar.ts | Si hay turno en marcha; comandos lanzados por el mod |
| `tic` | register.tsx | Temporizador de cada minuto |
| `sondeo` | ia/lanzar.ts | Lee cada 10 s los informes en curso, solo mientras haya alguno |

## 4. Eventos y comandos

| Evento | Qué hace |
|--------|----------|
| `session.start` | Registra los comandos. Después carga el árbol, lo abre si se viene de restaurar y lo muestra entero si la conversación está vacía. Arranca el vigía del rewind, carga ignorados y límites, marca la hora, mide, y arranca el tic de cada minuto. |
| `prompt.submit` | Guarda el texto del prompt para nombrar el turno. |
| `tool.call` | Solo en la conversación principal: `registrarLlamada` (tamaño, pruebas y avisos de relectura y golpe). |
| `turn.start` | Marca que hay turno en marcha, para que el selector espere. |
| `turn.step` | Apunta modelo y esfuerzo. Después de la respuesta: `refrescar` en la conversación principal o `registrarPaso` en un subagente. |
| `turn.complete` | En un subagente, lo da por terminado. En la conversación principal aplica lo pendiente del selector, registra el turno, mide y guarda un checkpoint si está activado. |
| `session.compact` | `trasCompactar`: olvida las llamadas y la cifra y vuelve a medir. |
| `session.measure` | Apunta los límites cuando el motor dice que se han movido. |
| `session.end` (`clear`) | Suelta el HEAD, olvida la conversación y, 50 ms después, recarga lo que haría `session.start`. |
| `command.run` `model` / `effort` / `classic.PostModelSwitch` | Reflejan en la banda un cambio hecho a mano. |
| `ui.render` `PromptHint` | Añade la cola de la fila (`pie`) y el modelo y el esfuerzo. |
| `ui.render` `AbovePrompt` | La banda del selector. |
| `ui.render` `Pane` (`contexto-vivo`) | El panel. |
| `ui.render` `CommandOutput` / `UserMessage` | Dibuja vacíos el eco y la salida de los `/model` y `/effort` que lanza el propio selector. |

| Comando | Qué hace |
|---------|----------|
| `/ctx` | Mide y abre el panel. |
| `/contexto-top` | Resumen en texto con `$.ui.log`, que el modelo no lee. |
| `/cp [nombre]` | Guarda un checkpoint o nombra el actual. |
| `/cp-ir <id o nombre>` | Restaura, en el siguiente tic del reloj (`$.clock.after(10)`). |
| `/cp-fork [id] [-- nombre]` | Fork con nombre. |
| `/cp-diff <a> [b]` | Compara dos checkpoints. |
| `/cp-buscar <texto>` | Busca en las conversaciones del árbol. |
| `/cp-exportar [id]` | Exporta a Markdown. |
| `/cp-arbol` | Abre la pestaña Árbol, o la imprime si no hay panel. |
| `/modelo [modelo] [esfuerzo]` | Sin argumentos despliega la banda; con ellos, aplica. |

## 5. Árbol de checkpoints

### Modelo

El motor guarda cada sesión en `~/.claude/projects/<proyecto>/<sesión>.jsonl`, y cada mensaje apunta a su anterior (`parentUuid`, o `logicalParentUuid` tras compactar). Un **checkpoint** (`Nodo`) es solo un puntero: `sesion` + `uuid`. Su conversación es la cadena que sube desde ese mensaje.

- El **padre** de un checkpoint nuevo es el checkpoint más profundo que está en su cadena (`origenEnCadena`). Así el árbol sale de la historia real, también tras un rewind nativo.
- **Restaurar** y **fork** hacen lo que `/branch`: el ayudante escribe una sesión nueva con la cadena hasta ese mensaje y el mod la abre con `/resume`. La sesión de origen no se toca.
- Si dos checkpoints apuntan al mismo mensaje, se **funden** y queda el más antiguo (`fundirDuplicados`). Los checkpoints antiguos que apuntaban a registros de sistema se **canonizan**: se llevan a su último mensaje real.
- Por encima de 400 nodos se quitan los automáticos más antiguos de las cadenas rectas (`recortar`). Se recuerdan los HEAD de las 40 sesiones más recientes.
- Los checkpoints de turno 0 sin nombre se quitan al cargar (`sinVacios`).

### Índice en disco

`ramas/<proyecto>/indice.json` guarda un `Arbol` (`version: 2`, `siguiente`, `nodos`, `heads` por sesión, `titulos` de los forks y `rewind` pendiente). Toda lectura y escritura del índice pasa por `enCola`, de una en una. `escribirDisco` actualiza también el átomo `arbol`.

### Rewind nativo

El motor no avisa de los rewinds, y el transcript no cambia hasta el siguiente mensaje. El vigía (`arbol/rewind.ts`) mira cada segundo cuántos mensajes tiene el motor en memoria. Si son menos que la vez anterior:

1. Compara la memoria con el transcript (`corteDeRewind`) para saber a qué prompt se volvió.
2. Marca como `abandonado` lo que queda fuera (`abandonarTrasRewind`) y mueve el HEAD.
3. Avisa. La persona decide **Borrar** o **Conservar**. `borrables` solo se lleva los automáticos que no dejan huérfano a nadie.

Si no consigue casar la memoria con el transcript, no toca nada: lo detecta el siguiente checkpoint. Al restaurar un punto abandonado se deja a Claude la nota `NOTA_FICHEROS`, porque los ficheros pueden no coincidir.

### Protocolo de `scripts/transcript.cjs`

Va en un proceso aparte con `node` porque `$.fs.read` no lee más de 4 MiB y los transcripts los superan. Se llama a través de `ayudante()` (arbol/disco.ts). Escribe JSON en stdout; si falla, `{ "error": "…" }` y código 1.

| Orden | Devuelve |
|-------|----------|
| `estado <sesión>` | Último mensaje, cadena, número de mensajes, turnos, prompt y último texto |
| `fork <sesión> <uuid> [título]` | `{ id }` de la sesión nueva con la cadena hasta `uuid` |
| `mensajes <sesión> <uuid>` | La conversación hasta `uuid`, simplificada (`Guardado[]`) |
| `buscar <texto> <puntos.json>` | Aciertos por checkpoint; cada mensaje cuenta una vez |
| `anclas <sesión> <uuid…>` | Cada uuid llevado a su último mensaje |

## 6. Diagnóstico y resolución con IA

`diagnosticar(foto, llamadas, cfg, ignorados, entorno)` es puro; `entorno` trae turnos, subagentes, la cifra total y las cachés rotas (`roturas`). Los tokens se estiman a 3,5 caracteres por token.

Las claves van **por patrón**, no por llamada (`bash:git log`, `lectura:<ruta>`, `mcp:<herramienta>`, `subagente-lleno:<tipo>`): el mismo mal uso repetido es un solo hallazgo con `veces` y la suma de tokens, y si vuelve después de resolverse se reconoce como el mismo.

| Tipo | Cuándo | Gravedad alta |
|------|--------|---------------|
| `relectura` | Una lectura trae líneas que ya trajo otra del mismo fichero **sin edición entre medias** (rangos de `offset`/`limit` que se solapan; entera = todo) | 2 o más lecturas que sobran, o ≥ `golpe` |
| `repetida` | La misma llamada (no `Read`) con los mismos argumentos y el mismo resultado (tamaño y comienzo), si lo repetido suma ≥ `MINIMO_REPETIDA` (1 000) | 3 o más veces, o ≥ `golpe` |
| `lectura` | `Read` entero ≥ `lectura`, si no es una relectura; agrupado por fichero | ≥ `golpe` o 3 o más |
| `bash` | Salida de Bash, PowerShell o Monitor ≥ `bash`; agrupado por programa y subcomando (`patronComando`) | ≥ `golpe` o 3 o más |
| `mcp` | Respuesta MCP ≥ `mcp`; agrupado por herramienta | ≥ `golpe` o 3 o más |
| `subagente` | Informe de subagente ≥ `subagente`; agrupado por `subagent_type` | ≥ `golpe` o 3 o más |
| `busqueda` | Grep o Glob ≥ `otra` (un Grep `content` sin `head_limit`, ya desde `otra` / 2) | ≥ `golpe` o 3 o más |
| `otra` | Cualquier otra herramienta ≥ `otra` | ≥ `golpe` o 3 o más |
| `exploracion` | En un turno, ≥ 10 lecturas y búsquedas sobre ≥ 6 ficheros y ≥ 2 × `lectura` (`EXPLORACION`) | un turno ≥ `golpe` |
| `cache` | La caché se invalidó (`roturas`); da la causa probable: cambio de modelo, pausa ≥ 5 min u otra | 2 o más, o ≥ 2 × `golpe` |
| `subagente-lleno` | Pico de un subagente ≥ 70 % de la ventana principal (`SUBAGENTE_LLENO`) | ≥ `critico` % |
| `ritmo` | Un turno añade ≥ 15 % de la ventana (`TURNO_GRANDE`); lleva su prompt y sus llamadas más pesadas | quedan ≤ 3 turnos o un turno ≥ 25 % |
| `memoria` | Fichero de memoria ≥ `memoria` | ≥ 2 × `memoria` |
| `mcp-cargado` | Esquemas MCP cargados ≥ `mcpCargado` | nunca |

Una llamada que repite otra con el mismo resultado no cuenta además en su grupo de resultados grandes, y un fichero con relectura no sale además como `lectura`.

`refrescar` apunta cada caché rota en `roturas` (también sin avisos emergentes), con la pausa desde la respuesta anterior y el modelo antes y después (`marcas.hora`, `marcas.modelo`). `registrarLlamada` apunta el turno en curso (el último del historial + 1), la hora y las líneas pedidas.

Cada hallazgo lleva `pruebas` (llamadas, argumentos, tamaños) y, si hay, `muestra` (comienzo del resultado). **Resolver con IA** (`ia/lanzar.ts`):

1. Escribe el informe (`informeIA`) en `informes/<proyecto>/<fecha>-<clave>.md`, con los antecedentes de la misma clave en `seguimiento`.
2. Abre `claude --model sonnet --effort high -n <título> <prompt>`: primero en una pestaña de Windows Terminal (`wt.exe`) y, si no hay, con `cmd /c start`. En los dos casos con PowerShell 7 `-NoExit` y la orden en `-EncodedCommand`, para que no se rompan comillas ni acentos.
3. Si no puede abrir ninguna terminal, copia la orden al portapapeles.
4. Apunta el hallazgo **en curso** en `seguimiento` (`$.store` y átomo) y arranca el `sondeo`.

**El informe** sigue las pautas de Anthropic para prompts: datos primero, cada bloque en su etiqueta XML, y el encargo al final.

| Parte | Contenido |
|-------|-----------|
| Front-matter YAML | `clave`, `tipo`, `gravedad`, `tokens`, `veces`, `ventana_pct`, `proyecto`, `sesion`, `detectado` y, si toca, `recaida: true` |
| `<contexto>` | Sesión, fecha, proyecto, ocupación y por qué importa el contexto (`POR_QUE_IMPORTA`) |
| `<hallazgo>` | Qué, tipo con su definición, por qué cuesta, gravedad explicada, coste, veces, fichero, herramienta y consejo rápido |
| `<pruebas>`, `<muestra>` | Lo medido y el comienzo del resultado |
| `<antecedentes>` | Las veces anteriores con la misma clave en el proyecto; si alguna se resolvió, es una **recaída** y pide averiguar por qué no bastó |
| `<encargo>` | Atacar la causa para que no vuelva a pasar, sin continuar la tarea de aquella sesión |
| `<guia>` | Del tipo (`GUIAS`): causas a comprobar y soluciones, por orden, y un ejemplo para calibrar |
| `<criterios_de_exito>` | Del tipo, verificables |
| `<restricciones>` | Citar pruebas y decir si no basta, aprobación antes de cambiar, cambio mínimo, comprobar opciones de Claude Code, estilo del proyecto |
| `<formato_de_respuesta>` | Causa, de 1 a 3 opciones con recomendación y, tras aprobarla, el cambio y su verificación |
| `## Al terminar` | Pide `## Resuelto` con `Cambio:`, `Ficheros:` y `Verificación:` |

Un texto medido que cierre una de esas etiquetas se neutraliza (`&lt;/…>`). `resolucionIA` lee hasta 400 caracteres bajo `## Resuelto`.

**Seguimiento hasta resolverlo.** El informe termina pidiendo a la sesión aparte que, cuando el cambio esté aplicado y aprobado, añada al final una línea `## Resuelto` y debajo lo que se cambió (`MARCA_RESUELTO`). Mientras haya hallazgos en curso, `comprobarResueltos` lee cada `SONDEO_MS` (10 s) sus informes; `resolucionIA` devuelve el texto bajo esa línea (hasta el siguiente título) y el hallazgo pasa a resuelto con la hora y ese resumen, con un aviso emergente. Se compara con lo guardado en `$.store`, así que si otra sesión con el mod (la propia sesión aparte también lo carga) lo marca antes, el cambio se ve igual. La persona puede marcarlo a mano (`marcarResuelto`) o devolverlo a los avisos (`reabrir`).

Los resueltos no cuentan como avisos (`sinResolver`): ni en la pestaña ni en la fila ni en `/contexto-top`. La pestaña los lista aparte, en **✓ Resueltos**, tachados y con el resumen. El seguimiento va por clave y proyecto: la misma clave en otro proyecto es otro hallazgo.

**Avisos emergentes** (`refrescar` y `registrarLlamada`): al cruzar el aviso o la alerta, a la tercera lectura del mismo fichero, cuando una llamada añade ≥ `golpe` y cuando la caché se invalida (antes ≥ 80 %, ahora < 50 % y ≥ 20 000 tokens reescritos, salvo justo después de compactar).

## 7. Opciones de /config

Se declaran en `plugin.json` (`userConfig`) y se leen en `config.ts` (`leerConfig`). Un número no válido o ≤ 0 toma el valor por defecto. `critico` es siempre mayor que `aviso`. Un cambio en `/config` recarga el módulo.

| Clave en `plugin.json` | Campo de `Config` | Por defecto |
|------------------------|-------------------|-------------|
| `avisoPorcentaje` | `aviso` | 70 |
| `criticoPorcentaje` | `critico` | 85 |
| `avisosEmergentes` | `emergentes` | true |
| `limiteLectura` | `lectura` | 6000 |
| `limiteBash` | `bash` | 5000 |
| `limiteMcp` | `mcp` | 8000 |
| `limiteSubagente` | `subagente` | 6000 |
| `limiteOtra` | `otra` | 8000 |
| `limiteMemoria` | `memoria` | 4000 |
| `limiteMcpCargado` | `mcpCargado` | 20000 |
| `limiteGolpe` | `golpe` | 15000 |
| `checkpointsAutomaticos` | `autoCheckpoint` | true |

Para añadir una opción: declárala en `userConfig`, añádela a `Config` y a `leerConfig`, y documéntala aquí y en el README.

## 8. Tests

`claude plugin test mods/contexto-vivo` ejecuta `tests/contexto.test.tsx` con el kit `claude-code/testing`: el mod se carga de verdad, con el reloj, el almacén y el entorno simulados. Los tests dibujan la fila, la banda y el panel en terminal y escritorio.

| Test | Cubre |
|------|-------|
| el mod entero | Llamadas, turnos, subagentes, todas las pestañas, diagnóstico, ignorar, compactar, `/contexto-top`, fila |
| los límites 5h/7d… | Límites desde el primer minuto, tic, `/clear` |
| con el estado vacío… | La fila con los límites guardados |
| los umbrales salen de /config | `leerConfig` y umbrales |
| el selector ejecuta /model y /effort… | Banda, comandos reales y su eco oculto |
| el selector cambia el modelo por /config… | Cambio por `/config` y espera al final del turno |
| árbol de checkpoints | Guardar, nombrar, restaurar, fork, rewind, comparar, exportar, buscar, borrar y `/clear` |
| el camino de la conversación actual… | `filasArbol` no pliega el camino actual |
| un rewind marca lo que deja atrás… | `abandonarTrasRewind`, `borrables` |
| el corte de un rewind… | `corteDeRewind` |
| dos checkpoints en el mismo mensaje… | `fundirDuplicados` |
| el padre de un checkpoint… | `origenEnCadena` |
| los checkpoints de turno 0… | `sinVacios` |
| el texto de la conversación… | `enLinea` |
| la respuesta del motor a una interrupción… | `soloRuido` |
| el informe para la IA… | `informeIA` (front-matter, orden de las etiquetas, guía del tipo, etiquetas neutralizadas, recaída), `resolucionIA`, `sinResolver`, `tituloIA`, `ficheroIA`, `resumirEntrada` |
| el diagnóstico distingue… | Relecturas justificadas y solapes, `repetida`, agrupación por patrón (`patronComando`), `busqueda`, `exploracion`, `cache`, `subagente-lleno`, `ritmo` |
| la sesión aparte se abre en PowerShell 7… | `lanzadoresIA`, `ordenPwsh`, `codificarPwsh` |

## 9. Reglas del motor, problemas conocidos y decisiones

### Reglas del motor (si no se cumplen, el mod no carga o el validador lo rechaza)

- **`$` nunca va dentro de un objeto.** Ni en un objeto literal, ni con spread, ni devuelto, ni guardado. Se pasa como argumento propio llamado `$`: `vistaArbol($, c)`, no `vistaArbol({ $, … })`. Si no, el motor no carga el módulo («$ itself is put in an object»).
- **Cada átomo, en el mismo fichero que sus `leer…`/`cambiar…`**, y estos han de ser funciones con nombre: el validador solo sigue `$` hasta funciones así.
- **Sin Node, sin `require`, sin `import()` dinámico** en `hooks/`. Lo que necesite Node va en `scripts/` y se ejecuta con `$.process.run`.
- **Los elementos JSX** (`Box`, `Text`, `Button`, `Input`, `Raster`, `Svg`) no son globales: salen de `$.ui.resolve(e)`.
- **`$.command.run` no puede ejecutarse** mientras el turno espera al hook que lo lanza. Por eso `/cp-ir`, `/cp-fork`, `/modelo` y lo pendiente del selector van en `$.clock.after(10, …)`.
- **Los grupos de hover** han de ser únicos en el mod y de 64 caracteres como máximo (`grupo()` acorta los largos).

### Problemas conocidos

- **El comprobador de tipos ya da avisos sin que se toque nada.** `Elemento` devuelve `unknown`, así que cada uso de JSX da TS2786 («cannot be used as a JSX component», unos 244). Además hay un TS7006 (`press`) en `pestanas/diagnostico.tsx`, dos TS2322 en `register.tsx` y varios en los tests. El motor los acepta. Lo que importa es que una modificación no añada avisos **nuevos**.
- **Los tests no deben correr desde una copia que esté bajo una carpeta `.claude`**: `carpetaDatos` busca `/.claude/` en la ruta del mod y el test del árbol espera `C:/repo/.claude/…`.
- **Restaurar trae la conversación, no los ficheros.** La primera petición en la rama nueva reescribe la caché.

### Decisiones de diseño

- **Un checkpoint no copia nada**: es un puntero a un mensaje del transcript. El árbol se reconstruye a partir de la historia real.
- **Nada se borra solo tras un rewind**, porque el motor no dice si también restauró el código.
- **Lo puro va separado de lo que usa `$`**, para probarlo sin motor y poder razonar sobre ello.
- **`panel/index.tsx` lee todo una vez por dibujo** y las pestañas reciben un `Ctx`: así las pestañas no repiten lecturas y el orden de las suscripciones es el mismo de siempre.
