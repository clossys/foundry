#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const excluded = new Set(['app', 'node_modules', 'dist', 'build', '.next', '.git', 'generated', '__fixtures__', '__golden__']);
const primaryPattern = /(--primary\s*:\s*)([^;{}]+)(;)/g;
const radiusPattern = /\brounded-(?:none|sm|md|lg|xl|2xl|3xl|full)\b/;

async function sourcePath(root, name) {
  if (typeof name !== 'string' || isAbsolute(name)) throw new Error('Adapter source paths must be relative to the repository.');
  const path = resolve(root, name);
  const rel = relative(root, path);
  if (rel.startsWith(`..${sep}`) || rel === '..' || rel.split(sep).some(part => excluded.has(part))) {
    throw new Error(`Propagation source is outside the permitted UI source tree: ${name}`);
  }
  const canonical = await realpath(path);
  if (canonical !== path || !(await stat(path)).isFile()) throw new Error(`Propagation requires a regular source file: ${name}`);
  return path;
}

async function filesIn(path) {
  const found = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (excluded.has(entry.name) || entry.isSymbolicLink()) continue;
    const target = join(path, entry.name);
    if (entry.isDirectory()) found.push(...await filesIn(target));
    else if (/\.(?:css|tsx|jsx)$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name)) found.push(target);
  }
  return found;
}

/** A checked-in adapter is optional; ambiguous discovery deliberately fails. */
export async function discoverAdapter(root = repoRoot, configFile) {
  const config = configFile ? resolve(root, configFile) : join(root, 'packages/producer/studio/checks/p0-propagate.config.json');
  try {
    return await validateAdapter(root, JSON.parse(await readFile(config, 'utf8')));
  } catch (error) {
    if (error.code !== 'ENOENT' || configFile) throw error;
  }
  const files = await filesIn(join(root, 'packages'));
  const css = [], buttons = [];
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    if (file.endsWith('.css') && /--primary\s*:/.test(text)) css.push(relative(root, file));
    if (/button\.[jt]sx$/.test(file) && /\bbuttonVariants\b/.test(text) && /\bbg-primary\b/.test(text) && radiusPattern.test(text)) buttons.push(relative(root, file));
  }
  if (css.length !== 1 || buttons.length !== 1) {
    throw new Error(`UI propagation source discovery is unresolved (${css.length} primary CSS sources, ${buttons.length} shadcn button sources). Supply p0-propagate.config.json with primarySource, buttonSource, buttonSelector, route and buildCommands; Studio app sources are never mutated.`);
  }
  // Discovery identifies source; the build seam must be explicit rather than guessing
  // which UI package build and running Studio process consume those source files.
  throw new Error(`Discovered UI sources ${css[0]} and ${buttons[0]}; supply p0-propagate.config.json with the actual buildCommands, route and buttonSelector.`);
}

export async function validateAdapter(root, adapter) {
  if (!adapter || typeof adapter !== 'object') throw new Error('Propagation adapter must be an object.');
  const primaryPath = await sourcePath(root, adapter.primarySource);
  const buttonPath = await sourcePath(root, adapter.buttonSource);
  if (primaryPath === buttonPath) throw new Error('Primary CSS and button source must be distinct files.');
  if (typeof adapter.buttonSelector !== 'string' || !adapter.buttonSelector.trim()) throw new Error('Adapter requires the selector of a rendered primary shadcn button.');
  if (typeof adapter.route !== 'string' || !adapter.route.startsWith('/') || adapter.route.startsWith('//')) throw new Error('Adapter route must be a local absolute route.');
  if (!Array.isArray(adapter.buildCommands) || !adapter.buildCommands.length || adapter.buildCommands.some(command => !Array.isArray(command) || !command.length || command.some(part => typeof part !== 'string' || !part))) throw new Error('Adapter buildCommands must contain executable/argument arrays.');
  const occurrence = adapter.primaryOccurrence ?? 0;
  if (!Number.isInteger(occurrence) || occurrence < 0) throw new Error('primaryOccurrence must be a nonnegative integer.');
  return { ...adapter, primaryPath, buttonPath, primaryOccurrence: occurrence };
}

export function createMutations(primary, button, radius, occurrence = 0) {
  const declarations = [...primary.matchAll(primaryPattern)];
  const declaration = declarations[occurrence];
  if (!declaration) throw new Error('Selected UI CSS source has no matching --primary declaration.');
  const originalColor = declaration[2].trim();
  if (!/^(?:oklch|oklab|hsl|hsla|rgb|rgba|color|color-mix)\(|^#[a-f\d]{3,8}$/i.test(originalColor)) throw new Error('Selected --primary must be a literal CSS color expression; legacy channel-only tokens need an explicit source adapter.');
  if (!Number.isFinite(radius) || radius < 0) throw new Error('The rendered button radius must resolve to pixels.');
  if (!/\bbuttonVariants\b/.test(button) || !/\bbg-primary\b/.test(button)) throw new Error('Selected button source is not the primary shadcn button variant.');
  const token = button.match(radiusPattern)?.[0];
  if (!token) throw new Error('Selected button source has no supported rounded class to mutate.');
  const nextRadius = radius + 3;
  const replacement = `${declaration[1]}color-mix(in srgb, ${originalColor} 70%, transparent)${declaration[3]}`;
  return {
    primary: primary.slice(0, declaration.index) + replacement + primary.slice(declaration.index + declaration[0].length),
    button: button.replace(token, `rounded-[${nextRadius}px]`),
    originalColor, originalClass: token, nextRadius,
  };
}

export function runCommand(command, root, signal, timeout = 180_000) {
  return new Promise((accept, reject) => {
    if (signal?.aborted) { reject(new Error('Propagation build was cancelled.')); return; }
    // npm build commands may spawn grandchildren. Stop the whole build group
    // before restoring source, so a cancelled compiler cannot consume half a revert.
    const grouped = process.platform !== 'win32';
    const child = spawn(command[0], command.slice(1), { cwd: root, stdio: ['ignore', 'inherit', 'inherit'], detached: grouped });
    let failure, escalation;
    const stop = () => {
      const send = value => {
        try { if (grouped && child.pid) process.kill(-child.pid, value); else child.kill(value); }
        catch (error) { if (error.code !== 'ESRCH') failure ??= error; }
      };
      send('SIGTERM');
      escalation ??= setTimeout(() => send('SIGKILL'), 2_000);
    };
    const cancel = () => { failure = new Error('Propagation build was cancelled.'); stop(); };
    const timer = setTimeout(() => { failure = new Error('Propagation build timed out.'); stop(); }, timeout);
    signal?.addEventListener('abort', cancel, { once: true });
    child.once('error', error => { failure = error; });
    child.once('close', (code, stopped) => {
      clearTimeout(timer);
      clearTimeout(escalation);
      signal?.removeEventListener('abort', cancel);
      if (failure) reject(failure);
      else if (code === 0) accept();
      else reject(new Error(`Propagation build exited ${code ?? stopped}: ${command.join(' ')}`));
    });
  });
}

async function browserDriver() {
  const require = createRequire(import.meta.url);
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true });
  return {
    async sample(url, selector) {
      const context = await browser.newContext({ colorScheme: 'light' });
      const page = await context.newPage();
      try {
        const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
        if (!response?.ok()) throw new Error(`Propagation route returned ${response?.status() ?? 'no response'}: ${url}`);
        const button = page.locator(selector).first();
        await button.waitFor({ state: 'visible' });
        return await button.evaluate(node => {
          const style = getComputedStyle(node);
          const primary = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
          const probe = document.createElement('span');
          probe.style.backgroundColor = 'var(--primary)';
          document.body.appendChild(probe);
          const resolvedPrimary = getComputedStyle(probe).backgroundColor;
          probe.remove();
          return { primary, resolvedPrimary, background: style.backgroundColor, radius: parseFloat(style.borderTopLeftRadius) };
        });
      } finally { await context.close(); }
    },
    close: () => browser.close(),
  };
}

/** Source restoration and a restoration build execute on every post-write exit. */
export async function runPropagation({ root = repoRoot, adapter, baseURL = 'http://127.0.0.1:4300', driver, execute = runCommand, signal, artifactDir } = {}) {
  adapter = await validateAdapter(root, adapter ?? await discoverAdapter(root));
  const url = new URL(adapter.route, baseURL);
  if (url.origin !== new URL(baseURL).origin) throw new Error('Propagation route escaped the Studio origin.');
  const originals = await Promise.all([readFile(adapter.primaryPath, 'utf8'), readFile(adapter.buttonPath, 'utf8')]);
  const ownedDriver = !driver;
  driver ??= await browserDriver();
  let touched = false, outcome, failure;
  const build = async restore => {
    for (const command of adapter.buildCommands) await execute(command, root, restore ? undefined : signal);
  };
  try {
    if (signal?.aborted) throw new Error('Propagation was cancelled before source mutation.');
    const before = await driver.sample(url.href, adapter.buttonSelector);
    const mutation = createMutations(...originals, before.radius, adapter.primaryOccurrence);
    const evidenceDir = artifactDir ?? join(root, 'ignoredtmp/p0b/propagation', `${Date.now()}-${process.pid}`);
    await mkdir(evidenceDir, { recursive: true });
    await writeFile(join(evidenceDir, 'primary.original.txt'), originals[0]);
    await writeFile(join(evidenceDir, 'button.original.txt'), originals[1]);
    touched = true;
    await writeFile(adapter.primaryPath, mutation.primary);
    await writeFile(adapter.buttonPath, mutation.button);
    await build(false);
    if (signal?.aborted) throw new Error('Propagation was cancelled during source build.');
    const after = await driver.sample(url.href, adapter.buttonSelector);
    if (after.primary === before.primary || after.background === before.background || after.background !== after.resolvedPrimary) throw new Error('The mutated --primary did not reach the rendered primary button. Rebuild/restart the process serving port 4300 through the adapter buildCommands.');
    if (Math.abs(after.radius - mutation.nextRadius) > 0.1) throw new Error('The actual shadcn button class mutation did not reach the rendered button.');
    outcome = { status: 'passed', url: url.href, primarySource: adapter.primarySource, buttonSource: adapter.buttonSource, originalClass: mutation.originalClass, before, after, sourceRestored: false };
  } catch (error) { failure = error; }
  finally {
    try {
      if (touched) {
        const restoration = await Promise.allSettled([
          writeFile(adapter.primaryPath, originals[0]), writeFile(adapter.buttonPath, originals[1]),
        ]);
        const restoreFailures = restoration.filter(item => item.status === 'rejected').map(item => item.reason);
        if (restoreFailures.length) throw new AggregateError(restoreFailures, 'Source restoration failed; original source backups are retained.');
        await build(true);
        const restored = await Promise.all([readFile(adapter.primaryPath, 'utf8'), readFile(adapter.buttonPath, 'utf8')]);
        if (restored.some((text, index) => text !== originals[index])) throw new Error('Propagation source restoration did not preserve the original bytes.');
        if (outcome) outcome.sourceRestored = true;
      }
    } catch (error) { failure = failure ? new AggregateError([failure, error], 'Propagation failed and the restoration build also failed; source backups are retained.') : error; }
    finally { if (ownedDriver) await driver.close(); }
  }
  if (failure) throw failure;
  return outcome;
}

async function main(args) {
  let config, baseURL = 'http://127.0.0.1:4300';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--config' && args[i + 1]) config = args[++i];
    else if (args[i] === '--base-url' && args[i + 1]) baseURL = args[++i];
    else throw new Error('Usage: studio:propagate [--config relative-adapter.json] [--base-url http://127.0.0.1:4300]');
  }
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try { console.log(JSON.stringify(await runPropagation({ adapter: await discoverAdapter(repoRoot, config), baseURL, signal: controller.signal }), null, 2)); }
  finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(`Studio propagation failed: ${error.message}`); process.exitCode = 1; });
}
