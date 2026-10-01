# Run Config

Adds a **Run Config** icon to the activity bar. It finds Node projects in your workspace, lists their `package.json` scripts, and runs them with the right package manager. It also finds Spring Boot applications and runs them with Maven or Gradle.

## Node projects

Every `package.json` with a `scripts` section (outside `node_modules`) shows up as a project. Click a script, or its play button, to run it in a new terminal.

The package manager is picked per project:

1. The `packageManager` field in `package.json` (e.g. `pnpm@9.1.0`).
2. The nearest lockfile, searching upward to the workspace root: `bun.lock`/`bun.lockb` → bun, `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, `package-lock.json` → npm.
3. Otherwise npm.

## Spring Boot applications

Every class annotated with `@SpringBootApplication` under `src/main/java` or `src/main/kotlin` of a Maven (`pom.xml`) or Gradle (`build.gradle[.kts]`) module is listed under **Spring Boot**. Click it, or its play button, to run it in a new terminal from the module directory:

| Build tool | Command                                         |
| ---------- | ----------------------------------------------- |
| Maven      | `mvnw spring-boot:run`                          |
| Gradle     | `gradlew bootRun`                               |

- The wrapper (`mvnw`/`gradlew`, `.cmd`/`.bat` on Windows) is used when found in the module or a parent folder up to the workspace root; otherwise `mvn`/`gradle` from `PATH`.
- A Maven module with several `@SpringBootApplication` classes gets one entry each, run with `-Dspring-boot.run.main-class=<class>`.
- Gradle's `bootRun` can't take a main class on the command line, so a Gradle module gets one entry and runs the main class its build script configures.
- Detection runs when the workspace loads and when build files or source files are added or removed. After adding the annotation to an existing file, press **Refresh**.
- Use the **+** button on an entry (or **Run: A Spring Boot application** in the setup form) to save a customized configuration, e.g. extra arguments, environment variables or a `before` command.

## Saved run configurations

Use the **+** button (or the button next to a script or project) to open the setup form. Everything is on one page:

- **Name** (suggested from the rest if left empty)
- **Run**: a project script, or a **binary or command** (a path such as `./node_modules/.bin/vite`, or a name such as `node`)
- **Project** and **Script**, when running a project script
- **Arguments**
- **Run first**: a command that must succeed before the main one runs
- **Environment variables**, one `KEY=VALUE` per line
- **Working directory**, filled in from the project

Save stores the result in the `runConfig.configurations` setting (workspace scope), and it appears under **Saved**. You can also write them by hand in `.vscode/settings.json`:

```json
{
  "runConfig.configurations": [
    {
      "name": "web: vite on 3001",
      "before": "pnpm run codegen",
      "bin": "./node_modules/.bin/vite",
      "args": ["--port", "3001", "--host"],
      "cwd": "${workspaceFolder}/apps/web",
      "env": { "NODE_ENV": "development" }
    }
  ]
}
```

| Field     | Description                                                                                                                              |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `name`    | Label in the sidebar, quick pick and terminal tab.                                                                                       |
| `bin`     | Executable path or command name. Relative paths resolve against `cwd`. Quoted automatically if it has spaces.                            |
| `args`    | A string (passed verbatim) or an array (each item quoted as needed).                                                                     |
| `command` | Full shell command, used when `bin` is not set (`args` are still appended).                                                              |
| `before`  | Command to run first. The main command only runs if it succeeds (`&&`, or `; if ($?)` in PowerShell).                                    |
| `cwd`     | Working directory. Optional.                                                                                                             |
| `env`     | Environment variables for the terminal, so they apply to `before` too. Optional.                                                         |

`${workspaceFolder}` works in `bin`, `args`, `command`, `before`, `cwd` and `env` values.

## Running in parallel

Every run opens in its own terminal, so anything you start together runs at the same time.

- **Multi-select** scripts and saved configs in the tree (Ctrl/Shift-click), right-click → **Run in Parallel**.
- Or use the **run-all** button in the view title / **Run Config: Run in Parallel** in the palette and tick what you want in the quick pick.
- Right-click a selection → **Save as Parallel Group** to store it as one saved entry; clicking that entry starts every command in it.

Groups can also be written by hand:

```json
{
  "runConfig.configurations": [
    {
      "name": "full stack",
      "parallel": [
        { "name": "api", "command": "bun run start", "cwd": "${workspaceFolder}/apps/api" },
        { "name": "web", "command": "pnpm run dev", "cwd": "${workspaceFolder}/apps/web" }
      ]
    }
  ]
}
```

**Run Config: Run Configuration...** in the command palette lists saved configurations and all scripts in one quick pick.

## Development

Open this folder in VS Code and press **F5** to launch an Extension Development Host.
`npm run build` packages a `.vsix`.
