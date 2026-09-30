const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const MANAGERS = ['npm', 'yarn', 'pnpm', 'bun'];
const LOCKFILES = [
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
];

// "packageManager" field wins, then the nearest lockfile (walking up to the workspace root, for monorepos).
function detectPackageManager(dir, pkg, stopAt) {
  const declared = typeof pkg.packageManager === 'string' ? pkg.packageManager.split('@')[0] : undefined;
  if (MANAGERS.includes(declared)) return declared;
  for (let d = dir; ; d = path.dirname(d)) {
    for (const [file, pm] of LOCKFILES) {
      if (fs.existsSync(path.join(d, file))) return pm;
    }
    if (d === stopAt || path.dirname(d) === d) return 'npm';
  }
}

async function discoverProjects() {
  const uris = await vscode.workspace.findFiles('**/package.json', '**/node_modules/**', 100);
  const projects = [];
  for (const uri of uris) {
    let pkg;
    try {
      pkg = JSON.parse(await fs.promises.readFile(uri.fsPath, 'utf8'));
    } catch {
      continue;
    }
    const scripts = Object.entries(pkg.scripts ?? {}).filter(([, cmd]) => typeof cmd === 'string');
    if (!scripts.length) continue;

    const dir = path.dirname(uri.fsPath);
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    const rel = folder ? path.relative(folder.uri.fsPath, dir) : dir;
    projects.push({
      dir,
      scripts,
      pm: detectPackageManager(dir, pkg, folder?.uri.fsPath),
      label: pkg.name ?? (rel || folder?.name || dir),
      rel,
    });
  }
  return projects.sort((a, b) => a.dir.localeCompare(b.dir));
}

// Everything after the package manager: `run <script> [-- ]<args>`.
function scriptArgs(pm, script, args = '') {
  const name = /^[\w:.@/-]+$/.test(script) ? script : JSON.stringify(script);
  // npm needs "--" to forward arguments to the script; the others forward them as-is.
  const sep = args ? (pm === 'npm' ? ' -- ' : ' ') : '';
  return `run ${name}${sep}${args}`;
}

module.exports = { discoverProjects, scriptArgs };
