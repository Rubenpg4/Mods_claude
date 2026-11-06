# Mods de Claude Code

Colección de mods para [Claude Code](https://claude.com/claude-code): extensiones que cambian su interfaz o su comportamiento (paneles, comandos, avisos, hooks sobre las llamadas a herramientas).

## Mods

| Mod | Qué hace |
|-----|----------|
| [contexto-vivo](mods/contexto-vivo) | Ventana de contexto en directo: panel con el reparto navegable, diagnóstico de malos usos (cada uno con sus pruebas y un botón que abre un chat aparte en Sonnet para resolverlo), tendencia, subagentes, llamadas y un árbol de checkpoints de la conversación. Muestra la cifra en la fila del modo y añade `/contexto-top`, `/cp`, `/cp-ir`, `/cp-fork` y `/cp-arbol`. Uso y opciones en su [README](mods/contexto-vivo/README.md). |

## Documentación

- Cada mod tiene un `README.md` (qué hace, uso y opciones) y un `ARQUITECTURA.md` (cómo está hecho: módulos, estado, eventos y decisiones).
- [`CLAUDE.md`](CLAUDE.md) es la guía para trabajar en el repositorio con Claude Code: comandos, dónde va cada cosa y las reglas del motor que no se pueden romper.

## Instalación

El repositorio es un marketplace de Claude Code. En el prompt de una sesión de terminal:

```
/plugin install contexto-vivo --marketplace Rubenpg4/Mods_claude
```

O desde una consola:

```sh
claude plugin install contexto-vivo --marketplace Rubenpg4/Mods_claude
```

Responde `y` para añadir el marketplace y elige el ámbito (el de usuario, el primero, lo carga en todas las sesiones). Para actualizarlo: `claude plugin update contexto-vivo` y, en una sesión abierta, `/reload-plugins`. En la app de escritorio: **+** junto al prompt → Plugins → Add marketplace con `Rubenpg4/Mods_claude` → Add plugin.

Hace falta Claude Code 2.1.319 o posterior (`claude --version`; `claude update` para actualizar).

### Desde una copia local (para desarrollar el mod)

Clona el repositorio y apunta Claude Code a la carpeta del mod con `CLAUDE_CODE_PLUGIN_DIRS`, en el bloque `env` de `~/.claude/settings.json` (copiarla a `~/.claude/mods/` sin esto no la carga):

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "C:/ruta/a/Mods_claude/mods/contexto-vivo" } }
```

Con esta forma, lo que edites se recarga en caliente. No la combines con la instalación desde el marketplace: el mod se cargaría dos veces.

Las opciones de cada mod se cambian desde `/config`.

## Licencia

[MIT](LICENSE)
