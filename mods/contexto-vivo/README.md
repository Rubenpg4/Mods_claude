# contexto-vivo

Mod de [Claude Code](https://claude.com/claude-code) que enseña la ventana de contexto en directo, señala lo que la está gastando de más y permite volver a cualquier punto de la conversación con un árbol de checkpoints.

> Cómo está hecho por dentro: [ARQUITECTURA.md](ARQUITECTURA.md).

## Qué añade

- **La fila de «auto mode on»**: ocupación del contexto (`◕ ctx 75% ▰▰▰▰▰▰▰▰▱▱ 150k/200k`), turnos que quedan hasta compactar, uso de las ventanas de 5 h y 7 días (con la cuenta atrás cuando falta menos de un día y `↗` si vas por encima del ritmo), número de avisos del diagnóstico, y el modelo y el esfuerzo.
- **El panel `/ctx`**, con la ocupación, los límites de uso y seis pestañas:

  | Pestaña | Qué muestra |
  |---------|-------------|
  | ◐ Reparto | Anillo de lo usado por categoría de `/context`, con «Mensajes» desglosado por familia de herramienta. Se navega por niveles (memoria, servidores MCP, familias, conversación), abre ficheros y tiene «⟳ exacto», que cuenta con la API. |
  | ▲ Diagnóstico | Malos usos del contexto, cada uno con su consejo y sus pruebas: relecturas (sin contar las que siguen a una edición ni las de otra parte del fichero), llamadas repetidas con el mismo resultado, lecturas enteras grandes, salidas de Bash, búsquedas, respuestas MCP o informes de subagente desmesurados (agrupados por patrón: «3 salidas grandes de `git log`»), exploraciones de muchos ficheros en la conversación principal, cachés invalidadas con su causa probable, subagentes que llenan su ventana, turnos que disparan el contexto, y memoria o esquemas MCP que pesan en cada turno. Cada aviso se puede abrir, ignorar o **resolver con IA**: una pestaña nueva de PowerShell 7 en Windows Terminal con un chat en modo plan (Sonnet para lo mecánico, Opus para lo que pide criterio; esfuerzo alto) que trabaja en tres fases (investiga, te propone opciones y, cuando apruebas, aplica y mide el resultado). Recibe un informe con las pruebas y una guía del tipo de problema (causas que comprobar, soluciones por orden de preferencia, un ejemplo y cómo saber que está resuelto). Si un problema resuelto vuelve a darse, regresa a los avisos como «↺ recaída», con lo que se hizo, y el informe nuevo lo tiene en cuenta. Mientras trabaja, el aviso sale «✦ en curso»; cuando ese chat lo da por resuelto (escribe `## Resuelto` al final del informe), pasa con ✓ a la tarjeta **Resueltos**, con lo que se cambió, y deja de contar como aviso. También se puede marcar **✓ resuelto** a mano y **↺ reabrir**. |
  | ∿ Tendencia | Ocupación por turno, crecimiento medio, turnos hasta compactar, caché, los turnos que más crecieron y un botón para compactar indicando qué conservar. |
  | ◆ Subagentes | Lo lleno que va la ventana de cada subagente, su pico y lo que pesa su informe. |
  | ≡ Llamadas | Lo que más pesa, lo más reciente y la memoria y MCP fijos. |
  | ⎇ Árbol | El árbol de checkpoints (abajo). |

- **Avisos emergentes**: al cruzar los umbrales, al leer un fichero por tercera vez, cuando una sola llamada añade mucho de golpe y cuando la caché se invalida.
- **Un selector de modelo y esfuerzo** en una banda sobre el prompt (`/modelo`). Si lo usas a mitad de turno, el cambio espera a que termine.
- **Comandos**: `/ctx`, `/contexto-top` (resumen en texto que el modelo no lee), `/modelo [modelo] [esfuerzo]` y los del árbol.

## Árbol de checkpoints

Cada turno deja un checkpoint de la conversación, y `/cp <nombre>` marca el punto actual con nombre. Desde cualquier checkpoint puedes volver atrás y seguir por otro camino: la rama anterior se conserva, de modo que se forma un árbol por el que moverte libremente.

| Comando | Qué hace |
|---------|----------|
| `/cp <nombre>` | Guarda un checkpoint del punto actual (o le pone nombre si no ha cambiado nada). |
| `/cp-ir <id o nombre>` | Vuelve a un checkpoint, como rewind: la conversación sigue desde ese punto. |
| `/cp-fork [id o nombre] [-- nombre]` | Abre una rama con nombre desde un checkpoint (sin id, desde el punto actual), como `/branch`. |
| `/cp-arbol` | Abre la pestaña **⎇ Árbol** del panel. |
| `/cp-diff <a> [b]` | Compara dos checkpoints desde donde se separan sus ramas: los turnos propios de cada uno (`b` es el actual si no se indica). |
| `/cp-buscar <texto>` | Busca en las conversaciones del árbol y dice en qué checkpoint aparece cada acierto. |
| `/cp-exportar [id o nombre]` | Escribe la conversación de un checkpoint (el actual si no se indica) en Markdown. |

En la pestaña **⎇ Árbol** eliges un nodo y puedes **restaurarlo**, hacerle un **fork** con nombre, **injertar** en la rama actual un resumen de lo que se hizo en otra, **compararlo** con la actual, **exportarlo**, **nombrarlo** o **borrar su rama**: el nodo y todo lo que cuelga de él, también si es la rama en que estás (la conversación sigue y el próximo turno vuelve a guardar checkpoint). Arriba del árbol, **Limpiar árbol** lo vacía entero. Ninguna de las dos borra conversaciones: siguen en `/resume`. Debajo del árbol hay un buscador; cada acierto lleva a su checkpoint. Las cadenas de turnos sin ramas se pliegan (`┄n┄`).

Cómo funciona: es la lógica de rewind y `/branch`. El motor guarda cada sesión en su transcript (`~/.claude/projects/<proyecto>/<sesión>.jsonl`), donde cada mensaje apunta al anterior. Un checkpoint es solo un puntero a uno de esos mensajes. Restaurarlo o hacerle un fork escribe una sesión nueva con la cadena de mensajes hasta ese punto y la abre con `/resume`. El modelo ve los mensajes originales, sin `/clear`, sin transcribir nada y sin compactar, y la sesión de la que vienes queda intacta (también aparece en `/resume`). Un fork lleva su nombre en `/resume`, y lo lleva también su primer checkpoint. Como las ramas comparten los mensajes comunes, el árbol se reconstruye a partir de esa historia, incluso si usas el rewind nativo.

Un rewind nativo dentro de la sesión se refleja en el árbol en un segundo, sin esperar al siguiente turno. El motor no avisa de los rewinds y el transcript no cambia hasta el siguiente mensaje, así que el mod revisa cada segundo la conversación que el motor tiene en memoria. Si se ha acortado, la compara con el transcript para saber a qué prompt se volvió y mueve allí el punto actual (`◉`). Si no logra casarlas, lo detecta el siguiente checkpoint. Los checkpoints que quedan fuera se marcan con `◌`, se muestran atenuados y aparece un aviso en la pestaña Árbol con dos opciones: **Borrar** o **Conservar**. Nada se borra solo, porque el motor no indica si el rewind restauró también el código. Si borras, solo se van los checkpoints automáticos: los que tienen nombre, los que sostienen otras ramas y los que son el punto actual de otra sesión se conservan, marcados. Al elegir uno marcado, el detalle advierte de que sus cambios pueden no estar ya en los ficheros. Restaurarlo pide confirmación y, en la conversación restaurada, el mod deja una nota a Claude: los ficheros pueden no coincidir con lo que se hizo allí, así que debe releerlos (y revisar `git status` y `git diff`) antes de editar o de dar algo por hecho. Lo mismo ocurre al hacer un fork desde un punto marcado.

Límites: solo restaura la conversación, no los ficheros del disco. La primera petición en la rama nueva reescribe la caché, igual que tras un rewind. Hace falta `node` en el `PATH` (lee los transcripts, que pueden pasar de 4 MiB). Si el motor no abre la rama por su cuenta, el mod indica el comando `/resume <id>` para abrirla.

El índice del árbol vive en `~/.claude/contexto-vivo/ramas/<proyecto>/indice.json`, y las exportaciones van a la subcarpeta `exportes/`.

## Opciones (`/config`)

| Opción | Por defecto | Qué hace |
|--------|-------------|----------|
| Aviso de contexto (%) | 70 | La barra pasa a ámbar y salta el primer aviso. |
| Alerta de contexto (%) | 85 | La barra pasa a rojo y salta el segundo aviso. |
| Avisos emergentes | sí | Umbrales, tercera relectura, golpes y caché invalidada. |
| Diagnóstico: lectura entera (tokens) | 6000 | Lectura completa sin `offset`/`limit` que se señala. |
| Diagnóstico: salida de Bash (tokens) | 5000 | Salida de Bash o PowerShell que se señala. |
| Diagnóstico: respuesta MCP (tokens) | 8000 | Respuesta de una herramienta MCP que se señala. |
| Diagnóstico: informe de subagente (tokens) | 6000 | Informe de un subagente que se señala. |
| Diagnóstico: otras herramientas (tokens) | 8000 | Resultado de Grep, WebFetch u otras que se señala. |
| Diagnóstico: fichero de memoria (tokens) | 4000 | CLAUDE.md, regla o memoria que se señala (grave al doble). |
| Diagnóstico: herramientas MCP cargadas (tokens) | 20000 | Esquemas MCP cargados que se señalan. |
| Aviso por golpe (tokens) | 15000 | Lo que una sola llamada debe añadir para avisar al momento y marcarse como grave. |
| Árbol: checkpoint en cada turno | sí | Sin esto, solo se guardan los de `/cp`. |

## Instalación

```
/plugin install contexto-vivo --marketplace Rubenpg4/Mods_claude
```

O `claude plugin install contexto-vivo --marketplace Rubenpg4/Mods_claude` desde una consola. Hace falta Claude Code 2.1.319 o posterior, y `node` en el `PATH` para el árbol de checkpoints; «resolver con IA» abre PowerShell 7 (`pwsh`) en Windows Terminal. Para desarrollarlo desde una copia local, ver el [README del repositorio](../../README.md#instalación).

**El panel al lado necesita el modo pantalla completa de Claude Code.** Con el renderizador clásico, Claude Code pone el panel encima del prompt y el terminal no envía los clics. El panel lo avisa y se abre con el teclado (Tab y ⇧Tab recorren los botones, Enter pulsa, las flechas desplazan, Esc vuelve al prompt; `ctrl+x tab` lo enfoca otra vez). Para tenerlo al lado y con clics, ejecuta `/tui fullscreen`: reinicia y retoma la sesión. También se puede fijar con `"tui": "fullscreen"` en `~/.claude/settings.json` o con la variable `CLAUDE_CODE_NO_FLICKER=1`. Claude Code desactiva ese modo por su cuenta en tmux, por SSH en Windows y si antes falló varias veces al arrancar. El panel se pone al lado desde 110 columnas.

## Datos que guarda

Bajo la carpeta `.claude` que contiene el mod (si el mod no está bajo ninguna, la `.claude` del proyecto):

- `contexto-vivo/ramas/<proyecto>/indice.json`: el árbol; `busqueda.json`, la última búsqueda; `exportes/`, las exportaciones.
- `contexto-vivo/informes/<proyecto>/`: los informes de «resolver con IA».

En el almacén del mod (`$.store`) guarda los hallazgos ignorados, la última lectura de los límites de uso y la sesión que debe abrir el árbol tras restaurar.
