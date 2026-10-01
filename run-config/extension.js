import * as vscode from 'vscode';
import path from 'path';
import { discoverProjects, scriptArgs } from './node-projects.js';
import { discoverSpringApps, springRun } from './spring-apps.js';
import { mainCommand, fullCommand, isRunnable, expandSpec, parseEnvLines, describe, validateConfig } from './command.js';
import { openSetup } from './setup-panel.js';

// ---- saved configurations (runConfig.configurations) ----

function getSaved() {
  const list = vscode.workspace.getConfiguration('runConfig').get('configurations', []);
  return list.filter((c) => c && typeof c.name === 'string' && (isRunnable(c) || Array.isArray(c.parallel)));
}

// Edits the settings scope that already holds the list (workspace by default).
// Returns an error message, or undefined on success.
async function updateSaved(fn) {
  const cfg = vscode.workspace.getConfiguration('runConfig');
  const info = cfg.inspect('configurations');
  const useGlobal = info.workspaceValue === undefined && info.globalValue !== undefined;
  const base = (useGlobal ? info.globalValue : info.workspaceValue) ?? [];
  const target = useGlobal ? vscode.ConfigurationTarget.Global : vscode.ConfigurationTarget.Workspace;
  try {
    await cfg.update('configurations', fn(base), target);
  } catch (err) {
    return `Could not update settings (${err.message}). Is a folder open?`;
  }
}

async function updateSavedOrShow(fn) {
  const error = await updateSaved(fn);
  if (error) vscode.window.showErrorMessage(`Run Config: ${error}`);
}

// ---- running ----

function firstRoot() {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function resolveCwd(cwd) {
  const root = firstRoot();
  if (!cwd) return root;
  return root ? cwd.replace(/\$\{workspaceFolder\}/g, root) : cwd;
}

// Portable cwd for saved configs: relative to the first workspace folder when possible.
function toCwd(dir) {
  const root = firstRoot();
  if (!dir) return undefined;
  if (!root) return dir;
  const rel = path.relative(root, dir);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return dir;
  return rel ? `\${workspaceFolder}/${rel.split(path.sep).join('/')}` : undefined;
}

function launch(name, command, cwd, env) {
  const terminal = vscode.window.createTerminal({ name, cwd, env });
  terminal.show();
  terminal.sendText(command);
}

const isPowerShell = () => /pwsh|powershell/i.test(vscode.env.shell ?? '');

// A node expands to one or more run specs (see command.js); a saved group expands to its members.
function toRuns(node) {
  if (node?.type === 'script') {
    const { project, name } = node;
    return [{ name: `${project.label}: ${name}`, bin: project.pm, args: scriptArgs(project.pm, name), cwd: toCwd(project.dir) }];
  }
  if (node?.type === 'spring') {
    const { app } = node;
    return [{ name: `${app.className} (Spring Boot)`, ...springRun(app), cwd: toCwd(app.dir) }];
  }
  if (node?.type === 'saved') {
    const { parallel } = node.config;
    return Array.isArray(parallel) ? parallel.filter(isRunnable) : [node.config];
  }
  return [];
}

// Each run gets its own terminal, so they all execute at the same time.
// Returns what was started: [{ name, command, cwd }].
function runNodes(nodes) {
  return nodes.flatMap(toRuns).map((run) => {
    const spec = expandSpec(run, firstRoot());
    const name = run.name ?? mainCommand(spec);
    const command = fullCommand(spec, isPowerShell());
    const cwd = resolveCwd(run.cwd);
    launch(name, command, cwd, spec.env);
    return { name, command, cwd };
  });
}

const runNode = (node) => runNodes([node]);

// ---- tree ----

class ConfigProvider {
  constructor() {
    this._emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._emitter.event;
    this.projectCount = 0;
  }

  refresh() {
    this._emitter.fire();
  }

  async getChildren(node) {
    if (!node) {
      const [projects, apps] = await Promise.all([discoverProjects(), discoverSpringApps()]);
      this.projectCount = projects.length;
      const nodes = projects.map((project) => ({ type: 'project', project }));
      if (apps.length) nodes.unshift({ type: 'springGroup', apps });
      return getSaved().length ? [{ type: 'savedGroup' }, ...nodes] : nodes;
    }
    if (node.type === 'savedGroup') return getSaved().map((config) => ({ type: 'saved', config }));
    if (node.type === 'springGroup') return node.apps.map((app) => ({ type: 'spring', app }));
    if (node.type === 'project') {
      return node.project.scripts.map(([name, cmd]) => ({ type: 'script', project: node.project, name, cmd }));
    }
    return [];
  }

  getTreeItem(node) {
    const expanded = vscode.TreeItemCollapsibleState.Expanded;
    const collapsed = vscode.TreeItemCollapsibleState.Collapsed;
    const none = vscode.TreeItemCollapsibleState.None;
    let item;

    switch (node.type) {
      case 'savedGroup':
        item = new vscode.TreeItem('Saved', expanded);
        item.iconPath = new vscode.ThemeIcon('bookmark');
        item.id = 'saved';
        break;
      case 'springGroup':
        item = new vscode.TreeItem('Spring Boot', expanded);
        item.iconPath = new vscode.ThemeIcon('server-process');
        item.id = 'spring';
        break;
      case 'spring': {
        const { app } = node;
        item = new vscode.TreeItem(app.className, none);
        item.description = [app.tool, app.rel].filter(Boolean).join(' · ');
        const { bin, args } = springRun(app);
        item.tooltip = `${app.mainClass}\n${bin} ${args}\ncwd: ${app.dir}`;
        item.iconPath = new vscode.ThemeIcon('play');
        item.id = `spring:${app.dir}:${app.mainClass}`;
        break;
      }
      case 'saved':
        item = new vscode.TreeItem(node.config.name, none);
        if (node.config.parallel) {
          item.description = `${node.config.parallel.length} in parallel`;
          item.tooltip = node.config.parallel.map((r) => mainCommand(r)).join('\n');
          item.iconPath = new vscode.ThemeIcon('run-all');
        } else {
          item.description = mainCommand(node.config);
          item.tooltip = describe(node.config);
          item.iconPath = new vscode.ThemeIcon('play');
        }
        item.id = `saved:${node.config.name}:${mainCommand(node.config) || 'group'}`;
        break;
      case 'project':
        item = new vscode.TreeItem(node.project.label, this.projectCount === 1 ? expanded : collapsed);
        item.description = [node.project.pm, node.project.rel].filter(Boolean).join(' · ');
        item.iconPath = new vscode.ThemeIcon('package');
        item.tooltip = node.project.dir;
        item.id = `project:${node.project.dir}`;
        break;
      case 'script':
        item = new vscode.TreeItem(node.name, none);
        item.description = node.cmd;
        item.tooltip = `${node.project.pm} ${scriptArgs(node.project.pm, node.name)}`;
        item.iconPath = new vscode.ThemeIcon('play');
        item.id = `script:${node.project.dir}:${node.name}`;
        break;
    }
    item.contextValue = node.type;
    if (node.type === 'script' || node.type === 'saved' || node.type === 'spring') {
      item.command = { command: 'runConfig.run', title: 'Run', arguments: [node] };
    }
    return item;
  }
}

// ---- commands ----

async function runnableItems() {
  const [projects, apps] = await Promise.all([discoverProjects(), discoverSpringApps()]);
  const saved = getSaved();
  const Separator = vscode.QuickPickItemKind.Separator;
  const items = [];

  if (saved.length) {
    items.push({ label: 'Saved', kind: Separator });
    items.push(
      ...saved.map((config) => ({
        label: config.name,
        description: config.parallel ? `${config.parallel.length} in parallel` : mainCommand(config),
        node: { type: 'saved', config },
      }))
    );
  }
  if (apps.length) {
    items.push({ label: 'Spring Boot', kind: Separator });
    items.push(
      ...apps.map((app) => ({
        label: app.className,
        description: [app.tool, app.rel].filter(Boolean).join(' · '),
        node: { type: 'spring', app },
      }))
    );
  }
  for (const project of projects) {
    items.push({ label: `${project.label} (${project.pm})`, kind: Separator });
    items.push(
      ...project.scripts.map(([name, cmd]) => ({ label: name, description: cmd, node: { type: 'script', project, name, cmd } }))
    );
  }
  return items;
}

async function pick() {
  const items = await runnableItems();
  if (!items.length) {
    const choice = await vscode.window.showInformationMessage('No Node scripts, Spring Boot applications or saved configurations found.', 'Add Configuration');
    if (choice) vscode.commands.executeCommand('runConfig.add');
    return;
  }
  const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Select a run configuration' });
  if (picked) runNode(picked.node);
}

// Targets come from the tree selection (context menu) or, failing that, a multi-select quick pick (palette / title bar).
async function parallelTargets(node, selection) {
  const isTarget = (n) => n?.type === 'script' || n?.type === 'saved' || n?.type === 'spring';
  const nodes = (selection?.length ? selection : [node]).filter(isTarget);
  if (nodes.length) return nodes;

  const items = await runnableItems();
  if (!items.length) {
    vscode.window.showInformationMessage('No Node scripts, Spring Boot applications or saved configurations found.');
    return [];
  }
  const picked = await vscode.window.showQuickPick(items, { canPickMany: true, placeHolder: 'Select commands to run in parallel' });
  return picked?.map((i) => i.node) ?? [];
}

async function runParallel(node, selection) {
  runNodes(await parallelTargets(node, selection));
}

async function saveGroup(node, selection) {
  const runs = (await parallelTargets(node, selection)).flatMap(toRuns);
  if (!runs.length) return;
  const name = await vscode.window.showInputBox({ prompt: `Name for this group of ${runs.length} parallel commands` });
  if (!name) return;
  await updateSavedOrShow((list) => [...list, { name, parallel: runs }]);
}

// Opens the setup form (one dialog: name, script or binary, args, before-command, env, cwd).
async function add(node) {
  const [projects, apps] = await Promise.all([discoverProjects(), discoverSpringApps()]);
  const data = {
    projects: projects.map((p) => ({ label: p.label, pm: p.pm, rel: p.rel, scripts: p.scripts, cwd: toCwd(p.dir) ?? '' })),
    springApps: apps.map((a) => ({ label: a.className, tool: a.tool, rel: a.rel, cwd: toCwd(a.dir) ?? '' })),
    preset: {
      projectIndex: node?.project ? projects.findIndex((p) => p.dir === node.project.dir) : -1,
      script: node?.type === 'script' ? node.name : undefined,
      springIndex: node?.type === 'spring' ? apps.findIndex((a) => a.dir === node.app.dir && a.mainClass === node.app.mainClass) : -1,
    },
  };
  openSetup(data, (values) => saveConfig(values, projects, apps));
}

// Validates the form values and appends the config to settings. Returns an error message, or undefined on success.
async function saveConfig(v, projects, apps) {
  const name = v.name?.trim();
  if (!name) return 'Give the configuration a name.';

  let bin;
  let args = v.args?.trim() ?? '';
  if (v.source === 'spring') {
    const app = apps[v.springIndex];
    if (!app) return 'Choose a Spring Boot application.';
    ({ bin, args } = springRun(app, args));
  } else if (v.source === 'script') {
    const project = projects[v.projectIndex];
    if (!project) return 'Choose a project to run one of its scripts.';
    if (!project.scripts.some(([s]) => s === v.script)) return 'Choose a script.';
    bin = project.pm;
    args = scriptArgs(project.pm, v.script, args);
  } else {
    bin = v.bin?.trim();
    if (!bin) return 'Enter a binary path or command.';
  }

  const { env, error } = parseEnvLines(v.env);
  if (error) return error;

  const config = {
    name,
    bin,
    args: args || undefined,
    before: v.before?.trim() || undefined,
    env,
    cwd: v.cwd?.trim() || undefined,
  };
  return updateSaved((list) => [...list, JSON.parse(JSON.stringify(config))]);
}

async function remove(node) {
  if (node?.type !== 'saved') return;
  const target = JSON.stringify(node.config);
  await updateSavedOrShow((list) => list.filter((c) => JSON.stringify(c) !== target));
}

// ---- agent commands ----
// Non-interactive twins of the UI commands, for AI agents calling vscode.commands.executeCommand.
// They never open a form, quick pick or prompt, and always resolve to { ok: true, ... } or { ok: false, error }.

async function agentCall(fn) {
  try {
    return { ok: true, ...(await fn()) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

const discoverAll = () => Promise.all([discoverProjects(), discoverSpringApps()]);

function pickOne(matches, what, label) {
  if (matches.length === 1) return matches[0];
  if (!matches.length) throw new Error(`No ${what} found.`);
  throw new Error(`${what} is ambiguous, specify one of: ${matches.map(label).join('; ')}`);
}

// target: "<saved name>" | { saved } | { script, project? } | { spring, module? } | { config: <spec> } (ad hoc, not saved)
function resolveTarget(target, projects, apps) {
  if (typeof target === 'string') target = { saved: target };
  if (target?.saved !== undefined) {
    const config = getSaved().find((c) => c.name === target.saved);
    if (!config) throw new Error(`No saved configuration named "${target.saved}".`);
    return { type: 'saved', config };
  }
  if (target?.script !== undefined) {
    const matches = projects.filter(
      (p) =>
        p.scripts.some(([s]) => s === target.script) &&
        (target.project === undefined || [p.label, p.rel, p.dir].includes(target.project))
    );
    const project = pickOne(matches, `project with script "${target.script}"`, (p) => `{ project: "${p.dir}" }`);
    return { type: 'script', project, name: target.script };
  }
  if (target?.spring !== undefined) {
    const matches = apps.filter(
      (a) =>
        [a.className, a.mainClass].includes(target.spring) &&
        (target.module === undefined || [a.module, a.rel, a.dir].includes(target.module))
    );
    return { type: 'spring', app: pickOne(matches, `Spring Boot application "${target.spring}"`, (a) => `{ module: "${a.dir}" }`) };
  }
  if (target?.config !== undefined) {
    const { config, error } = validateConfig({ name: 'ad hoc', ...target.config });
    if (error) throw new Error(error);
    return { type: 'saved', config };
  }
  throw new Error('Unknown target. Use a saved name, { saved }, { script, project? }, { spring, module? } or { config }.');
}

async function resolveTargets(target) {
  const list = Array.isArray(target) ? target : [target];
  if (!list.length) throw new Error('No targets given.');
  const [projects, apps] = await discoverAll();
  return list.map((t) => resolveTarget(t, projects, apps));
}

async function saveNamed(config, replace) {
  const { config: clean, error } = validateConfig(config);
  if (error) throw new Error(error);
  if (!replace && getSaved().some((c) => c.name === clean.name)) {
    throw new Error(`A configuration named "${clean.name}" already exists. Pass { replace: true } to overwrite it.`);
  }
  const failure = await updateSaved((list) => [...list.filter((c) => !(replace && c?.name === clean.name)), clean]);
  if (failure) throw new Error(failure);
  return { saved: clean };
}

const agentCommands = {
  // Everything runnable, each with the `target` to pass to run / saveGroup.
  'runConfig.agent.list': () =>
    agentCall(async () => {
      const [projects, apps] = await discoverAll();
      return {
        saved: getSaved().map((config) => ({ target: { saved: config.name }, config })),
        scripts: projects.flatMap((p) =>
          p.scripts.map(([name, script]) => ({
            target: { script: name, project: p.dir },
            project: p.label,
            dir: p.dir,
            script,
            command: `${p.pm} ${scriptArgs(p.pm, name)}`,
          }))
        ),
        springApps: apps.map((a) => {
          const { bin, args } = springRun(a);
          return { target: { spring: a.mainClass, module: a.dir }, name: a.className, tool: a.tool, dir: a.dir, command: `${bin} ${args}` };
        }),
      };
    }),
  // Starts one target, or an array of targets in parallel, each in its own terminal.
  'runConfig.agent.run': (target) => agentCall(async () => ({ started: runNodes(await resolveTargets(target)) })),
  // Saves a configuration (same shape as a runConfig.configurations entry). options: { replace }.
  'runConfig.agent.add': (config, options) => agentCall(() => saveNamed(config, options?.replace)),
  // Saves several targets as one parallel group. options: { replace }.
  'runConfig.agent.saveGroup': (name, targets, options) =>
    agentCall(async () => saveNamed({ name, parallel: (await resolveTargets(targets)).flatMap(toRuns) }, options?.replace)),
  // Deletes every saved configuration with this name.
  'runConfig.agent.remove': (name) =>
    agentCall(async () => {
      if (!getSaved().some((c) => c.name === name)) throw new Error(`No saved configuration named "${name}".`);
      const failure = await updateSaved((list) => list.filter((c) => c?.name !== name));
      if (failure) throw new Error(failure);
      return { removed: name };
    }),
};

function activate(context) {
  const provider = new ConfigProvider();
  const view = vscode.window.createTreeView('runConfig.view', { treeDataProvider: provider, canSelectMany: true });

  // Debounced so `npm install` (which touches thousands of package.json files) doesn't thrash the view.
  let timer;
  const scheduleRefresh = (uri) => {
    if (uri && /[\\/](node_modules|target)[\\/]/.test(uri.fsPath)) return;
    clearTimeout(timer);
    timer = setTimeout(() => provider.refresh(), 300);
  };
  const watcher = vscode.workspace.createFileSystemWatcher(
    '**/{package.json,package-lock.json,yarn.lock,pnpm-lock.yaml,bun.lock,bun.lockb,pom.xml,build.gradle,build.gradle.kts}'
  );
  // Spring Boot sources: only added/removed files (an existing file gaining @SpringBootApplication needs a manual refresh).
  const sources = vscode.workspace.createFileSystemWatcher('**/src/main/**/*.{java,kt}', false, true, false);

  context.subscriptions.push(
    view,
    watcher,
    sources,
    { dispose: () => clearTimeout(timer) },
    watcher.onDidCreate(scheduleRefresh),
    watcher.onDidChange(scheduleRefresh),
    watcher.onDidDelete(scheduleRefresh),
    sources.onDidCreate(scheduleRefresh),
    sources.onDidDelete(scheduleRefresh),
    vscode.workspace.onDidChangeWorkspaceFolders(() => provider.refresh()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('runConfig')) provider.refresh();
    }),
    vscode.commands.registerCommand('runConfig.refresh', () => provider.refresh()),
    vscode.commands.registerCommand('runConfig.run', runNode),
    vscode.commands.registerCommand('runConfig.pick', pick),
    vscode.commands.registerCommand('runConfig.runParallel', runParallel),
    vscode.commands.registerCommand('runConfig.saveGroup', saveGroup),
    vscode.commands.registerCommand('runConfig.add', add),
    vscode.commands.registerCommand('runConfig.delete', remove),
    ...Object.entries(agentCommands).map(([id, fn]) => vscode.commands.registerCommand(id, fn)),
    vscode.commands.registerCommand('runConfig.edit', () =>
      vscode.commands.executeCommand('workbench.action.openSettings', 'runConfig.configurations')
    )
  );
}

function deactivate() {}

export { activate, deactivate };
