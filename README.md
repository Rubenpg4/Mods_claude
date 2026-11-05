# Mods de Claude Code

Colección de mods para [Claude Code](https://claude.com/claude-code): extensiones que cambian su interfaz o su comportamiento (paneles, comandos, avisos, hooks sobre las llamadas a herramientas).

## Mods

| Mod | Qué hace |
|-----|----------|
| [contexto-vivo](mods/contexto-vivo) | Ventana de contexto en directo: panel con el reparto navegable, diagnóstico de malos usos, tendencia, subagentes y llamadas. Muestra la cifra en la fila del modo y añade `/contexto-top`. |

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
