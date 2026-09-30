// Turns a run spec into a shell command line. No vscode dependency, so it can be tested on its own.
//
// spec: { name?, bin?, command?, args?, before?, cwd?, env? }
//   bin     executable path or command name (quoted when it has spaces)
//   command full shell command, used when `bin` is absent
//   args    string (verbatim) or string[] (each item quoted as needed)
//   before  command that must succeed before the main one runs

const SAFE = /^[\w@%+=:,./\\-]+$/;
const VARIABLE = /\$\{workspaceFolder\}/g;

const text = (v) => (typeof v === 'string' ? v.trim() : '');

function quote(arg) {
  return SAFE.test(arg) ? arg : `"${arg.replace(/"/g, '\\"')}"`;
}

function argsString(args) {
  return Array.isArray(args) ? args.map((a) => quote(String(a))).join(' ') : text(args);
}

function mainCommand(spec, powershell = false) {
  const bin = text(spec.bin);
  // PowerShell needs the call operator to run a quoted path.
  const base = bin ? (SAFE.test(bin) ? bin : `${powershell ? '& ' : ''}${quote(bin)}`) : text(spec.command);
  return base ? [base, argsString(spec.args)].filter(Boolean).join(' ') : '';
}

function fullCommand(spec, powershell = false) {
  const main = mainCommand(spec, powershell);
  const before = text(spec.before);
  if (!main || !before) return main;
  // Windows PowerShell 5.1 has no `&&`.
  return powershell ? `${before}; if ($?) { ${main} }` : `${before} && ${main}`;
}

const isRunnable = (spec) => !!spec && mainCommand(spec) !== '';

// Replaces ${workspaceFolder} in every string that ends up on the command line or in the environment.
function expandSpec(spec, root) {
  if (!root) return spec;
  const sub = (s) => (typeof s === 'string' ? s.replace(VARIABLE, root) : s);
  return {
    ...spec,
    bin: sub(spec.bin),
    command: sub(spec.command),
    before: sub(spec.before),
    args: Array.isArray(spec.args) ? spec.args.map(sub) : sub(spec.args),
    env: spec.env && Object.fromEntries(Object.entries(spec.env).map(([k, v]) => [k, sub(String(v))])),
  };
}

// One KEY=VALUE per line -> { env } (undefined when empty), or { error } naming the first bad line.
function parseEnvLines(input) {
  const env = {};
  const lines = String(input ?? '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const m = /^([A-Za-z_]\w*)=(.*)$/.exec(line);
    if (!m) return { error: `Environment line ${i + 1} ("${line}") is not KEY=VALUE.` };
    env[m[1]] = m[2];
  }
  return { env: Object.keys(env).length ? env : undefined };
}

// Multi-line summary for tooltips.
function describe(spec) {
  const lines = [];
  if (text(spec.before)) lines.push(`before: ${text(spec.before)}`);
  lines.push(`run: ${mainCommand(spec)}`);
  if (text(spec.cwd)) lines.push(`cwd: ${text(spec.cwd)}`);
  for (const [k, v] of Object.entries(spec.env ?? {})) lines.push(`env: ${k}=${v}`);
  return lines.join('\n');
}

module.exports = { mainCommand, fullCommand, isRunnable, expandSpec, parseEnvLines, describe };
