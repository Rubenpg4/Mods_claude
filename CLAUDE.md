# CLAUDE.md

Guía para trabajar en este repositorio con Claude Code.

## Qué es

Una colección de mods de Claude Code (`mods/<nombre>/`). Ahora hay uno, **contexto-vivo**: ventana de contexto en directo, diagnóstico de malos usos, selector de modelo y esfuerzo, y árbol de checkpoints. Todo (código, comentarios, nombres, commits y documentación) está en **español**.

- Uso y opciones: `mods/contexto-vivo/README.md`
- Cómo está hecho (estado, eventos, árbol, reglas del motor): `mods/contexto-vivo/ARQUITECTURA.md` (≈ 25 KB, ≈ 7k tokens). **Consúltalo antes de cambiar algo que no sea trivial, pero por secciones, nunca entero**: `grep -n '^#' mods/contexto-vivo/ARQUITECTURA.md` da el índice y después se lee solo el rango que haga falta (`sed -n 'A,Bp'` o `Read` con `offset`/`limit`). §9 (reglas del motor) y la sección del dominio que toques bastan casi siempre.
- `CLAUDE.md` ya está en contexto al empezar: no lo vuelvas a leer con `cat`.

`~/.claude/mods/contexto-vivo` suele ser un enlace a esta carpeta: lo que edites aquí es el mod que está en uso.

## Comandos

```sh
claude plugin test mods/contexto-vivo       # tests (19); deben pasar todos
claude plugin validate mods/contexto-vivo   # manifiesto, hooks, llamadas a $, estado
```

No hay `tsc` ni `node_modules` en el repo, y no hay que instalarlos sin preguntar. El comprobador de tipos ya da avisos sin que se toque nada (unos 244 TS2786 de JSX, un TS7006 y dos TS2322; ver ARQUITECTURA §9). Un cambio no debe añadir avisos **nuevos**. Los tests no deben correr desde una copia que esté bajo una carpeta `.claude`.

## Dónde va cada cosa

```
mods/contexto-vivo/hooks/
  register.tsx   tabla de eventos y comandos: solo conecta, sin lógica propia
  config.ts      opciones de /config
  comun/         utilidades puras (formato, colores, estilo, barras, gráficos) + entorno
  estado/        átomos con sus leer…/cambiar…, por dominio
  contexto/      medición, límites, reparto, diagnóstico, tendencia, informes, ignorados
  ia/            «resolver con IA»: informe (puro) y lanzador
  selector/      modelos (puro), aplicar, banda
  arbol/         modelo y mensajes (puros), disco, operaciones, rewind, consultas
  panel/         index (dibujarPanel), tipos (Ctx), piezas, cabecera, pestanas/<pestaña>.tsx
scripts/transcript.cjs   Node aparte: leer y bifurcar transcripts (> 4 MiB)
types/index.d.ts         tipos compartidos y PluginState (forma de cada átomo)
```

Cada carpeta importa solo de las anteriores: `comun`/`estado` → `contexto`/`ia`/`selector` → `arbol` → `panel` → `register.tsx`. No crees ciclos entre carpetas.

- Un cálculo nuevo sin `$`: al fichero puro de su dominio, con su test.
- Una pestaña nueva: `panel/pestanas/<nombre>.tsx` con `export function vistaX($: EngineInterface, c: Ctx)`. Añádela a `PESTANAS` y al despacho de `panel/index.tsx` y al tipo `Pestana`.
- Un átomo nuevo: en el `estado/<dominio>.ts` que le toque, con su `leer…`/`cambiar…` al lado, y su forma en `PluginState` (types/index.d.ts).
- Un comando nuevo: regístralo en `session.start` y pon su `on('command.run', …)` en `register.tsx`. La lógica va en su dominio.
- Una opción de /config: `plugin.json` (`userConfig`) + `Config` + `leerConfig`, y documéntala.

## Reglas que no se pueden romper

1. **`$` nunca dentro de un objeto** (literal, spread, devuelto o guardado): se pasa como argumento propio llamado `$`. Si no, el motor no carga el módulo.
2. **Cada átomo con sus `leer…`/`cambiar…` en el mismo fichero**, y como funciones con nombre (lo exige el validador).
3. **Si cambian los campos de un átomo, cambia su `shape`** (`'foto-3'` → `'foto-4'`). Nunca cambies su `key`, o se pierde lo guardado.
4. **Las variables de módulo** (`cola`, `vigia`/`visto`/`mirando`, `marcas`, `turno`/`propios`, `tic`, `sondeo`) solo pueden reasignarse dentro de su fichero. Si cambias de fichero una función que las modifica, va con ellas.
5. **En `hooks/`, nada de Node, `require` ni `import()` dinámico.** Por convención se importa la ruta del fichero (`./panel/index`): no se ha comprobado si el motor resuelve una carpeta (`./panel`).
6. **`$.command.run` no puede ejecutarse dentro del hook del comando** que espera el turno: aplázalo con `$.clock.after(10, …)`.
7. **Las operaciones sobre el índice del árbol van en `enCola`**, para que no se pisen.
8. **Nada se borra solo tras un rewind**: se marca y decide la persona.

## Al terminar un cambio

1. `claude plugin test mods/contexto-vivo`: todo en verde.
2. `claude plugin validate mods/contexto-vivo`: «Validation passed».
3. Si cambian el comportamiento visible, las opciones o el estado, actualiza `README.md` y `ARQUITECTURA.md` del mod. Si cambia la estructura o una regla, también este fichero.
4. Si es una versión nueva, sube `version` en `plugin.json`.
5. Commits en español, en el estilo de la historia: `contexto-vivo: <qué cambia>`.
