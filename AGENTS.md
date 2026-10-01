# AGENTS.md

Monorepo of VS Code extensions. Each extension is a top-level folder (currently `run-config/`).

## Layout

```
package.json        root package: workspaces + build scripts
.gitignore          the only .gitignore in the repo
dist/               all built extensions (.vsix), git-ignored
out/                (inside each extension) esbuild bundle, git-ignored
node_modules/       the only node_modules in the repo (npm workspaces)
shared/             utilities shared between extensions
<extension>/        one folder per extension, with its own package.json (the extension manifest) and skills.md
```

## Rules

### One node_modules
- Install from the repo root only: `npm install` (add deps with `npm install <pkg> -w <extension>`).
- Never run `npm install` inside an extension folder and never commit or leave a nested `node_modules/`.
- Extensions are npm workspaces (`shared/` is not), listed in the root `package.json` `workspaces` array.

### One .gitignore
- The root `.gitignore` is the only one. Don't add `.gitignore` files in extension folders.
- `.vscodeignore` is separate (it controls what goes in the `.vsix`); each extension keeps its own.

### Root package.json and builds
- The root `package.json` has one script per extension: `build:<extension>` runs `npm run build -w <extension>`.
- `npm run build` builds every extension.
- Each extension defines its own `build` script (currently `bundle` then `vsce package --no-dependencies`; the flag is required because vsce's dependency scan fails with a hoisted workspace `node_modules`), which must write its `.vsix` to the root `dist/` folder (`vsce package --out ../dist`). The root `predist` script creates `dist/`; every root `build*` script has a matching `pre` script that runs it, so a new `build:<extension>` needs a `"prebuild:<extension>": "npm run predist"` too. Always build from the root.

### Adding a new extension
1. Create `<extension>/` with its `package.json` (manifest, `"type": "module"`), `bundle` and `build` scripts, `.vscodeignore`, and `skills.md` (see "Extension skills").
2. Add `"<extension>"` to `workspaces` in the root `package.json`.
3. Add `"build:<extension>": "npm run build -w <extension>"` and `"prebuild:<extension>": "npm run predist"` to the root `package.json` scripts.
4. Run `npm install` at the root.
5. Update the Layout section above if the structure changed.

### Extension skills
- Every extension folder has its own `skills.md`. It is for AI agents only.
- **What `skills.md` contains:**
  - The agent commands: ID, arguments, result, failure cases.
  - The instructions an agent needs to use them: workflow, target and argument formats, the schema of any config it passes, behavior and limits.
- **What `skills.md` must not contain:**
  - Commands, buttons or menus that only a human uses (sidebar actions, forms, quick picks, palette commands).
  - User-guide material: feature tours, screenshots, setup steps, how the UI works.
  - Internals an agent doesn't need to call the commands (how detection works, how command lines are built).
  - Manual workarounds such as editing settings files by hand. If an agent needs something, expose it as an agent command.
  - `README.md` is the user-facing doc; don't duplicate it in `skills.md`.
- **Agent commands:** every extension that has features an agent could use exposes them as non-interactive agent commands, named `<extensionId>.agent.<verb>` (e.g. `runConfig.agent.run`). Rules:
  - Never open a form, quick pick, input box, or modal. Everything comes in as arguments.
  - Resolve to `{ ok: true, ...result }` or `{ ok: false, error }`, and never throw. Validate arguments and return a clear error message.
  - Declare each in `contributes.commands` (so `executeCommand` activates the extension) and hide it from the palette with a `commandPalette` entry whose `when` is `"false"`.
  - Give them the same effect as the UI, ideally sharing the same code. The UI commands remain for humans; agent commands are not a replacement for them.
  - Document each one in `skills.md`.
- Write `skills.md` against the real code and manifest, not from memory.
- **Whenever an agent command or the config it accepts changes, update `skills.md` in the same change.** A new extension isn't done until its `skills.md` exists.

### shared/
- Put code here once two or more extensions need it. Don't put extension-specific code here.
- **Every time a utility is added, renamed or removed, update both `shared/index.js` and the table in `shared/README.md`** so the list stays accurate.
- Import with a relative ES module path, e.g. `import { x } from '../shared/index.js'` (`shared/` is plain JS, not a package or workspace).
- The bundler (esbuild) inlines `shared/` code into each extension's bundle, so nothing outside the extension folder needs to be packaged.

## Conventions
- All code is ES6+ JavaScript using ES modules (`import`/`export`, always with the `.js` extension in relative imports). No `require`, no `module.exports`. Each extension sets `"type": "module"` in its `package.json`.
- VS Code loads extensions as CommonJS, so each extension is bundled by esbuild (`bundle` script: entry `extension.js` → `out/extension.cjs`, `vscode` external) and its manifest `main` points at `./out/extension.cjs`. The `build` script runs `bundle` before `vsce package`. The `.vscodeignore` must exclude source (`*.js`) and keep `out/**`.
- To debug (F5), run `npm run bundle -w <extension>` first so `out/` exists.
- Built output goes only in the root `dist/`. Never leave a `.vsix` inside an extension folder. Don't commit `dist/`, `.vsix` files or `node_modules/`.
