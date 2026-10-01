# Run Config: agent skill

Use this when a task involves running, adding or removing project scripts and run configurations in a workspace where the **Run Config** VS Code extension is installed.

## Calling the commands

Call these with `vscode.commands.executeCommand(id, ...args)`. They are non-interactive: no form, quick pick or prompt.

Every command resolves to `{ ok: true, ... }` or `{ ok: false, error: "<message>" }`. They never throw, so check `ok` and read `error`.

| Command ID | Arguments | Result on success |
| --- | --- | --- |
| `runConfig.agent.list` | none | `{ saved, scripts, springApps }`. Every item has a `target` to pass to `run` or `saveGroup` |
| `runConfig.agent.run` | `target` or `target[]` | `{ started: [{ name, command, cwd }] }`. An array starts all targets at once, each in its own terminal |
| `runConfig.agent.add` | `config`, `{ replace? }` | `{ saved }`, the normalized entry that was written |
| `runConfig.agent.saveGroup` | `name`, `target[]`, `{ replace? }` | `{ saved }`, a `parallel` configuration made from the targets |
| `runConfig.agent.remove` | `name` | `{ removed: name }`. Deletes every saved entry with that name |

## Workflow

1. Call `list` to see what exists. It rescans the workspace each time, so it is always current.
2. Copy a `target` from the list into `run` or `saveGroup`.
3. To create a configuration, call `add` with a `config` (see "Configuration schema").
4. To change one, call `add` with the same `name` and `{ replace: true }`.

## Targets

| Target | Runs |
| --- | --- |
| `"api: debug"` or `{ saved: "api: debug" }` | A saved configuration, matched by exact name |
| `{ script: "dev", project: "<label, relative path or absolute dir>" }` | A `package.json` script. `project` can be left out when only one project has that script |
| `{ spring: "<ClassName or fully qualified main class>", module: "<module, relative path or absolute dir>" }` | A Spring Boot application. `module` can be left out when the name is unique |
| `{ config: { bin or command, ... } }` | An ad hoc configuration. It runs without being saved |

A target that matches more than one project or module fails with an error listing the candidates as `{ project: "<dir>" }` or `{ module: "<dir>" }`. Retry with one of those.

## Configuration schema

`config` has the same shape as an entry in the `runConfig.configurations` setting. It needs `name` and exactly one of `bin`, `command` or `parallel`.

| Field | Type | Meaning |
| --- | --- | --- |
| `name` | string | Label for the configuration and its terminal tab (required) |
| `bin` | string | Executable path or name. Relative paths resolve against `cwd`. Quoted if it has spaces |
| `args` | string or string[] | A string is passed verbatim. Each array item is quoted as needed |
| `command` | string | Full shell command. Used only when `bin` is not set. `args` are still appended |
| `before` | string | Runs first. The main command runs only if it succeeds |
| `cwd` | string | Working directory. Defaults to the first workspace folder |
| `env` | object (string values) | Environment variables for the terminal, which also apply to `before` |
| `parallel` | array | Members with the same fields (`bin` or `command` required). Each starts in its own terminal. Cannot be combined with `bin` or `command` |

`${workspaceFolder}` works in `bin`, `args`, `command`, `before`, `cwd` and `env` values. It expands to the first workspace folder only.

```json
{
  "name": "web: vite on 3001",
  "before": "pnpm run codegen",
  "bin": "./node_modules/.bin/vite",
  "args": ["--port", "3001", "--host"],
  "cwd": "${workspaceFolder}/apps/web",
  "env": { "NODE_ENV": "development" }
}
```

```json
{
  "name": "full stack",
  "parallel": [
    { "name": "api", "command": "bun run start", "cwd": "${workspaceFolder}/apps/api" },
    { "name": "web", "command": "pnpm run dev", "cwd": "${workspaceFolder}/apps/web" }
  ]
}
```

## Behavior and limits

- `add` and `saveGroup` fail if the name already exists, unless you pass `{ replace: true }`.
- `add` drops unknown fields and empty strings, and trims text fields. It rejects wrong types, a missing `name`, and an entry with none of `bin`, `command` or `parallel`.
- Saving writes to the workspace `.vscode/settings.json`, or to the user `settings.json` when the list already lives there. With no folder open it fails with `Could not update settings`.
- Only saved configurations can be removed. Scripts and Spring apps come from project files, and `remove` doesn't touch them.
- Only the first workspace folder is used for `${workspaceFolder}` and as the default `cwd`.
