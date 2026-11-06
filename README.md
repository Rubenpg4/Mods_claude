# Mods de Claude Code

Colección de mods para [Claude Code](https://claude.com/claude-code): extensiones que cambian su interfaz o su comportamiento (paneles, comandos, avisos, hooks sobre las llamadas a herramientas).

## Mods

| Mod | Qué hace |
|-----|----------|
| [contexto-vivo](mods/contexto-vivo) | Ventana de contexto en directo: panel con el reparto navegable, diagnóstico de malos usos (cada uno con sus pruebas y un botón que abre un chat aparte en Sonnet para resolverlo), tendencia, subagentes, llamadas y un árbol de checkpoints de la conversación. Muestra la cifra en la fila del modo y añade `/contexto-top`, `/cp`, `/cp-ir`, `/cp-fork` y `/cp-arbol`. |

## Árbol de checkpoints (contexto-vivo)

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

## Instalación

Copia la carpeta del mod en `~/.claude/mods/` y reinicia Claude Code:

```sh
git clone https://github.com/Rubenpg4/Mods_claude.git
cp -r Mods_claude/mods/contexto-vivo ~/.claude/mods/
```

Si quieres seguir las actualizaciones, puedes enlazar la carpeta en lugar de copiarla (en Linux/macOS `ln -s`; en Windows, una junction con `New-Item -ItemType Junction`).

Las opciones de cada mod se cambian desde `/config`.

## Licencia

[MIT](LICENSE)
