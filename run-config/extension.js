const vscode = require('vscode');
const path = require('path');
const { discoverProjects, scriptArgs } = require('./node-projects');
const { mainCommand, fullCommand, isRunnable, expandSpec, parseEnvLines, describe } = require('./command');
const { openSetup } = require('./setup-panel');

// ---- saved configurations (runConfig.configurations) ----

function getSaved() {
  const list = vscode.workspace.getConfiguration('runConfig').get('configurations', []);
  return list.filter((c) => c && typeof c.name === 'string' && (isRunnable(c) || Array.isArray(c.parallel)));
}

// Edits the settings scope that already holds the list (workspace by default).
async function updateSaved(fn) {
  const cfg = vscode.workspace.getConfiguration('runConfig');
  const info = cfg.inspect('configurations');
  const useGlobal = info.workspaceValue === undefined && info.globalValue !== undefined;
  const base = (useGlobal ? info.globalValue : info.workspaceValue) ?? [];
  const target = useGlobal ? vscode.ConfigurationTarget.Global : vscode.ConfigurationTarget.Workspace;
  try {
    await cfg.update('configurations', fn(base), target);
    return true;
  } catch (err) {
    vscode.window.showErrorMessage(`Run Config: could not update settings (${err.message}). Is a folder open?`);
    return false;
  }
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
  if (node?.type === 'saved') {
    const { parallel } = node.config;
    return Array.isArray(parallel) ? parallel.filter(isRunnable) : [node.config];
  }
  return [];
}

// Each run gets its own terminal, so they all execute at the same time.
function runNodes(nodes) {
  for (const run of nodes.flatMap(toRuns)) {
    const spec = expandSpec(run, firstRoot());
    launch(run.name ?? mainCommand(spec), fullCommand(spec, isPowerShell()), resolveCwd(run.cwd), spec.env);
  }
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
      const projects = await discoverProjects();
      this.projectCount = projects.length;
      const nodes = projects.map((project) => ({ type: 'project', project }));
      return getSaved().length ? [{ type: 'savedGroup' }, ...nodes] : nodes;
    }
    if (node.type === 'savedGroup') return getSaved().map((config) => ({ type: 'saved', config }));
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
    if (node.type === 'script' || node.type === 'saved') {
      item.command = { command: 'runConfig.run', title: 'Run', arguments: [node] };
    }
    return item;
  }
}

// ---- commands ----

async function runnableItems() {
  const projects = await discoverProjects();
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
    const choice = await vscode.window.showInformationMessage('No Node scripts or saved configurations found.', 'Add Configuration');
    if (choice) vscode.commands.executeCommand('runConfig.add');
    return;
  }
  const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Select a run configuration' });
  if (picked) runNode(picked.node);
}

// Targets come from the tree selection (context menu) or, failing that, a multi-select quick pick (palette / title bar).
async function parallelTargets(node, selection) {
  const isTarget = (n) => n?.type === 'script' || n?.type === 'saved';
  const nodes = (selection?.length ? selection : [node]).filter(isTarget);
  if (nodes.length) return nodes;

  const items = await runnableItems();
  if (!items.length) {
    vscode.window.showInformationMessage('No Node scripts or saved configurations found.');
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
  await updateSaved((list) => [...list, { name, parallel: runs }]);
}

// Opens the setup form (one dialog: name, script or binary, args, before-command, env, cwd).
async function add(node) {
  const projects = await discoverProjects();
  const data = {
    projects: projects.map((p) => ({ label: p.label, pm: p.pm, rel: p.rel, scripts: p.scripts, cwd: toCwd(p.dir) ?? '' })),
    preset: {
      projectIndex: node?.project ? projects.findIndex((p) => p.dir === node.project.dir) : -1,
      script: node?.type === 'script' ? node.name : undefined,
    },
  };
  openSetup(data, (values) => saveConfig(values, projects));
}

// Validates the form values and appends the config to settings. Returns an error message, or undefined on success.
async function saveConfig(v, projects) {
  const name = v.name?.trim();
  if (!name) return 'Give the configuration a name.';

  let bin;
  let args = v.args?.trim() ?? '';
  if (v.source === 'script') {
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
  const saved = await updateSaved((list) => [...list, JSON.parse(JSON.stringify(config))]);
  return saved ? undefined : 'Could not update settings. Is a folder open?';
}

async function remove(node) {
  if (node?.type !== 'saved') return;
  const target = JSON.stringify(node.config);
  await updateSaved((list) => list.filter((c) => JSON.stringify(c) !== target));
}

function activate(context) {
  const provider = new ConfigProvider();
  const view = vscode.window.createTreeView('runConfig.view', { treeDataProvider: provider, canSelectMany: true });

  // Debounced so `npm install` (which touches thousands of package.json files) doesn't thrash the view.
  let timer;
  const scheduleRefresh = (uri) => {
    if (uri?.fsPath.includes('node_modules')) return;
    clearTimeout(timer);
    timer = setTimeout(() => provider.refresh(), 300);
  };
  const watcher = vscode.workspace.createFileSystemWatcher(
    '**/{package.json,package-lock.json,yarn.lock,pnpm-lock.yaml,bun.lock,bun.lockb}'
  );

  context.subscriptions.push(
    view,
    watcher,
    { dispose: () => clearTimeout(timer) },
    watcher.onDidCreate(scheduleRefresh),
    watcher.onDidChange(scheduleRefresh),
    watcher.onDidDelete(scheduleRefresh),
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
    vscode.commands.registerCommand('runConfig.edit', () =>
      vscode.commands.executeCommand('workbench.action.openSettings', 'runConfig.configurations')
    )
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
