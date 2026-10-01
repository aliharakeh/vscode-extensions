import * as vscode from 'vscode';
import fs from 'fs';
import path from 'path';

const BUILD_FILES = [
  ['pom.xml', 'maven'],
  ['build.gradle', 'gradle'],
  ['build.gradle.kts', 'gradle'],
];
const SOURCE_ROOTS = ['src/main/java', 'src/main/kotlin'];
const SOURCE_FILE = /\.(java|kt)$/;
const SKIP_DIRS = new Set(['node_modules', 'target', 'build', 'out', '.git', '.gradle']);
const MAX_SOURCE_FILES = 5000;

const WRAPPERS = {
  maven: process.platform === 'win32' ? 'mvnw.cmd' : 'mvnw',
  gradle: process.platform === 'win32' ? 'gradlew.bat' : 'gradlew',
};
const FALLBACK_BIN = { maven: 'mvn', gradle: 'gradle' };

// The wrapper script nearest to `dir` (walking up to the workspace root), as a path relative to `dir`.
function findWrapper(dir, tool, stopAt) {
  for (let d = dir; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, WRAPPERS[tool]))) {
      const rel = path.relative(dir, d).split(path.sep).join('/');
      return `${rel || '.'}/${WRAPPERS[tool]}`;
    }
    if (d === stopAt || path.dirname(d) === d) return undefined;
  }
}

async function* sourceFiles(dir) {
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* sourceFiles(full);
    } else if (SOURCE_FILE.test(entry.name)) {
      yield full;
    }
  }
}

// Classes annotated with @SpringBootApplication in one module, e.g. [{ className, mainClass }].
async function findApplications(moduleDir) {
  const apps = [];
  let seen = 0;
  for (const root of SOURCE_ROOTS) {
    for await (const file of sourceFiles(path.join(moduleDir, root))) {
      if (++seen > MAX_SOURCE_FILES) return apps;
      let src;
      try {
        src = await fs.promises.readFile(file, 'utf8');
      } catch {
        continue;
      }
      const annotation = /^\s*@SpringBootApplication\b/m.exec(src);
      if (!annotation) continue;
      const cls = /\b(?:class|object)\s+(\w+)/.exec(src.slice(annotation.index));
      if (!cls) continue;
      const pkg = /^\s*package\s+([\w.]+)/m.exec(src)?.[1];
      // A Kotlin top-level `fun main` lives in <File>Kt, not in the annotated class.
      const topLevelMain = file.endsWith('.kt') && /^fun\s+main\b/m.test(src);
      const name = topLevelMain ? `${path.basename(file, '.kt')}Kt` : cls[1];
      apps.push({ className: cls[1], mainClass: pkg ? `${pkg}.${name}` : name });
    }
  }
  return apps.sort((a, b) => a.mainClass.localeCompare(b.mainClass));
}

// Spring Boot "root" applications: every @SpringBootApplication class in src/main of a Maven or Gradle module.
// Maven can run any of them (-Dspring-boot.run.main-class); bootRun has no such option on the command line,
// so a Gradle module gets one entry and runs whatever its build script configures.
async function discoverSpringApps() {
  const uris = await vscode.workspace.findFiles(
    '**/{pom.xml,build.gradle,build.gradle.kts}',
    '**/{node_modules,target,build,out,.gradle}/**',
    100
  );
  const modules = new Map();
  for (const uri of uris) {
    const dir = path.dirname(uri.fsPath);
    const tool = BUILD_FILES.find(([file]) => file === path.basename(uri.fsPath))[1];
    if (!modules.has(dir) || tool === 'maven') modules.set(dir, { dir, tool, uri });
  }

  const result = [];
  for (const { dir, tool, uri } of modules.values()) {
    const found = await findApplications(dir);
    if (!found.length) continue;
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    const rel = folder ? path.relative(folder.uri.fsPath, dir) : dir;
    const apps = tool === 'gradle' ? found.slice(0, 1) : found;
    for (const app of apps) {
      result.push({
        ...app,
        dir,
        tool,
        rel,
        wrapper: findWrapper(dir, tool, folder?.uri.fsPath),
        pickMain: tool === 'maven' && found.length > 1,
        module: rel || folder?.name || path.basename(dir),
      });
    }
  }
  return result.sort((a, b) => a.dir.localeCompare(b.dir) || a.mainClass.localeCompare(b.mainClass));
}

// { bin, args } for a run spec. `extra` is appended verbatim (e.g. -Dspring-boot.run.profiles=dev).
function springRun(app, extra = '') {
  const goal = app.tool === 'maven' ? 'spring-boot:run' : 'bootRun';
  const main = app.pickMain ? `-Dspring-boot.run.main-class=${app.mainClass}` : '';
  return {
    bin: app.wrapper ?? FALLBACK_BIN[app.tool],
    args: [goal, main, extra.trim()].filter(Boolean).join(' '),
  };
}

export { discoverSpringApps, springRun };
