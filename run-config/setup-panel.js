import * as vscode from 'vscode';
import crypto from 'crypto';

let panel;

// Opens the "new run configuration" form. `data` is sent to the page as-is ({ projects, preset });
// `onSubmit(values)` returns an error message to show in the form, or undefined to close it.
function openSetup(data, onSubmit) {
  panel?.dispose();
  const current = vscode.window.createWebviewPanel(
    'runConfig.setup',
    'New Run Configuration',
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  panel = current;
  current.onDidDispose(() => {
    if (panel === current) panel = undefined;
  });

  const nonce = crypto.randomBytes(16).toString('hex');
  current.webview.html = PAGE.replace(/__NONCE__/g, nonce).replace(/__CSP__/g, current.webview.cspSource);
  current.webview.onDidReceiveMessage(async (msg) => {
    if (msg.type === 'ready') {
      current.webview.postMessage({ type: 'init', ...data });
    } else if (msg.type === 'cancel') {
      current.dispose();
    } else if (msg.type === 'save') {
      const error = await onSubmit(msg.values);
      if (error) current.webview.postMessage({ type: 'error', message: error });
      else current.dispose();
    }
  });
}

// NB: no template-literal interpolation in here, so "$&#123;" is written as an HTML entity in the placeholders.
const PAGE = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src __CSP__ 'nonce-__NONCE__'; script-src 'nonce-__NONCE__';">
<title>New Run Configuration</title>
<style nonce="__NONCE__">
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 16px 24px 32px; }
  form { max-width: 640px; }
  h1 { font-size: 1.5em; font-weight: 600; margin: 0 0 20px; }
  .row { margin-bottom: 16px; }
  label { display: block; font-weight: 600; margin-bottom: 4px; }
  .opt { font-weight: normal; }
  .hint { color: var(--vscode-descriptionForeground); font-size: 0.9em; margin-top: 4px; }
  input, select, textarea {
    width: 100%; box-sizing: border-box; padding: 4px 6px; font: inherit;
    color: var(--vscode-input-foreground); background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px;
  }
  select { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border-color: var(--vscode-dropdown-border); }
  input:focus, select:focus, textarea:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  textarea { font-family: var(--vscode-editor-font-family); min-height: 72px; resize: vertical; }
  .mono { font-family: var(--vscode-editor-font-family); }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 480px) { .cols { grid-template-columns: 1fr; } }
  hr { border: 0; border-top: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); margin: 20px 0; }
  .actions { display: flex; gap: 8px; margin-top: 24px; }
  button { font: inherit; padding: 6px 14px; border: 1px solid transparent; border-radius: 2px; cursor: pointer; }
  button.primary { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
  button.primary:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
  button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  button:disabled { opacity: 0.5; cursor: default; }
  #error { color: var(--vscode-errorForeground); margin-top: 16px; white-space: pre-wrap; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<form id="form" novalidate>
  <h1>New Run Configuration</h1>

  <div class="row">
    <label for="name">Name</label>
    <input id="name" autocomplete="off">
  </div>

  <div class="cols">
    <div class="row">
      <label for="source">Run</label>
      <select id="source">
        <option value="script">A project script</option>
        <option value="spring">A Spring Boot application</option>
        <option value="custom">A binary or command</option>
      </select>
    </div>
    <div class="row" id="projectRow">
      <label for="project">Project</label>
      <select id="project"></select>
    </div>
    <div class="row" id="springRow" hidden>
      <label for="spring">Application</label>
      <select id="spring"></select>
    </div>
  </div>

  <div class="row" id="scriptRow">
    <label for="script">Script</label>
    <select id="script"></select>
    <div class="hint" id="scriptHint"></div>
  </div>

  <div class="row" id="binRow" hidden>
    <label for="bin">Binary path or command</label>
    <input id="bin" class="mono" autocomplete="off" spellcheck="false" placeholder="node, ./node_modules/.bin/vite, &#36;{workspaceFolder}/tools/run.sh">
    <div class="hint">Relative paths resolve against the working directory. Quoted automatically if it has spaces.</div>
  </div>

  <div class="row">
    <label for="args" id="argsLabel">Arguments</label>
    <input id="args" class="mono" autocomplete="off" spellcheck="false" placeholder="--port 3000">
    <div class="hint" id="argsHint">Passed as typed. Quote values that contain spaces.</div>
  </div>

  <hr>

  <div class="row">
    <label for="before">Run first <span class="opt">(optional)</span></label>
    <input id="before" class="mono" autocomplete="off" spellcheck="false" placeholder="npm run build">
    <div class="hint">The main command is skipped if this fails.</div>
  </div>

  <div class="row">
    <label for="env">Environment variables <span class="opt">(optional)</span></label>
    <textarea id="env" class="mono" spellcheck="false" placeholder="NODE_ENV=production&#10;PORT=3000"></textarea>
    <div class="hint">One KEY=VALUE per line.</div>
  </div>

  <div class="row">
    <label for="cwd">Working directory <span class="opt">(optional)</span></label>
    <input id="cwd" class="mono" autocomplete="off" spellcheck="false" placeholder="workspace root">
    <div class="hint">Supports &#36;{workspaceFolder}. Filled in from the project.</div>
  </div>

  <div id="error" role="alert" hidden></div>

  <div class="actions">
    <button type="submit" class="primary" id="save">Save</button>
    <button type="button" class="secondary" id="cancel">Cancel</button>
  </div>
</form>

<script nonce="__NONCE__">
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  let projects = [];
  let springApps = [];
  let cwdTouched = false;

  const selectedProject = () => projects[Number($('project').value)];
  const selectedApp = () => springApps[Number($('spring').value)];

  function option(value, text) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = text;
    return o;
  }

  function suggestName() {
    if ($('source').value === 'spring') {
      const a = selectedApp();
      return a ? a.label + ' (Spring Boot)' : '';
    }
    if ($('source').value === 'script') {
      const p = selectedProject();
      const s = $('script').value;
      return s ? (p ? p.label + ': ' + s : s) : '';
    }
    const base = $('bin').value.trim().split(/[\\/]/).pop();
    return [base, $('args').value.trim()].filter(Boolean).join(' ');
  }

  function refresh(fromProject) {
    const source = $('source').value;
    const isScript = source === 'script';
    const isSpring = source === 'spring';
    $('projectRow').hidden = isSpring;
    $('springRow').hidden = !isSpring;
    $('scriptRow').hidden = !isScript;
    $('binRow').hidden = source !== 'custom';
    $('argsLabel').textContent = isScript || isSpring ? 'Extra arguments' : 'Arguments';
    $('argsHint').textContent = isSpring
      ? 'Added to the build command, e.g. -Dspring-boot.run.profiles=dev (Maven) or --args="--spring.profiles.active=dev" (Gradle).'
      : 'Passed as typed. Quote values that contain spaces.';

    if (fromProject) {
      const p = selectedProject();
      const scripts = $('script');
      const previous = scripts.value;
      scripts.replaceChildren();
      for (const [name] of (p ? p.scripts : [])) scripts.appendChild(option(name, name));
      if (previous) scripts.value = previous;
      if (!cwdTouched) $('cwd').value = isSpring ? (selectedApp()?.cwd ?? '') : (p ? p.cwd : '');
    }
    const p = selectedProject();
    const cmd = p && p.scripts.find((s) => s[0] === $('script').value);
    $('scriptHint').textContent = !p ? 'Choose a project to pick one of its scripts.'
      : cmd ? p.pm + ' run ' + cmd[0] + '  →  ' + cmd[1] : '';
    $('name').placeholder = suggestName() || 'Name';
  }

  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (msg.type === 'init') {
      projects = msg.projects;
      const sel = $('project');
      sel.appendChild(option(-1, 'None (workspace root)'));
      projects.forEach((p, i) => sel.appendChild(option(i, p.label + (p.rel ? '  ·  ' + p.rel : '') + '  (' + p.pm + ')')));
      springApps = msg.springApps;
      springApps.forEach((a, i) => $('spring').appendChild(option(i, a.label + '  ·  ' + a.tool + (a.rel ? '  ·  ' + a.rel : ''))));
      const preset = msg.preset || {};
      sel.value = preset.projectIndex >= 0 ? preset.projectIndex : (projects.length ? 0 : -1);
      if (preset.springIndex >= 0) $('spring').value = preset.springIndex;
      $('source').value = preset.springIndex >= 0 ? 'spring' : projects.length ? 'script' : springApps.length ? 'spring' : 'custom';
      refresh(true);
      if (preset.script) { $('script').value = preset.script; refresh(false); }
      $('name').focus();
    } else if (msg.type === 'error') {
      $('error').textContent = msg.message;
      $('error').hidden = false;
      $('save').disabled = false;
    }
  });

  $('project').addEventListener('change', () => refresh(true));
  $('source').addEventListener('change', () => refresh(true));
  $('spring').addEventListener('change', () => refresh(true));
  $('script').addEventListener('change', () => refresh(false));
  $('bin').addEventListener('input', () => refresh(false));
  $('args').addEventListener('input', () => refresh(false));
  $('cwd').addEventListener('input', () => { cwdTouched = true; });
  $('cancel').addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));

  $('form').addEventListener('submit', (e) => {
    e.preventDefault();
    $('error').hidden = true;
    $('save').disabled = true;
    vscode.postMessage({
      type: 'save',
      values: {
        name: $('name').value.trim() || suggestName(),
        source: $('source').value,
        projectIndex: Number($('project').value),
        springIndex: Number($('spring').value),
        script: $('script').value,
        bin: $('bin').value,
        args: $('args').value,
        before: $('before').value,
        env: $('env').value,
        cwd: $('cwd').value,
      },
    });
  });

  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;

export { openSetup };
