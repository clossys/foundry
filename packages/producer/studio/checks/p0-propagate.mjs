#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { studioOrigin } from './studio-origin.mjs';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const excluded = new Set(['app', 'node_modules', 'dist', 'build', '.next', '.git', 'generated', '__fixtures__', '__golden__']);
function variablePattern(name) {
  if (typeof name !== 'string' || !/^--[a-zA-Z_][a-zA-Z0-9_-]*$/.test(name)) throw new Error('cssVariable must be a CSS custom property name.');
  return new RegExp(`(?<![a-zA-Z0-9_-])(${name}\\s*:\\s*)([^;{}]+)(;)`, 'g');
}
const radiusPattern = /\brounded-(?:none|sm|md|lg|xl|2xl|3xl|full)\b/;
const literalColor = /^(?:oklch|oklab|hsl|hsla|rgb|rgba|color|color-mix)\(|^#[a-f\d]{3,8}$/i;
const themeModes = ['theme', 'light', 'dark'];
const sha256 = text => createHash('sha256').update(text).digest('hex');
const canonical = value => `${JSON.stringify(value, null, 2)}\n`;

/**
 * A compiled-theme source is a pinned Designer `registry:theme` candidate
 * (`clossys/agents/designer/themes.<id>/candidates/<file>.json`): Studio serves its cssVars as the
 * consumer's tokens. Its slot pin must select exactly these bytes, so for the run the pin's sha256 is
 * re-pointed at the mutated bytes and then restored byte-exactly. This file never writes a pin itself:
 * the read, the re-point and the restore are the slot writer's theme-probe helpers
 * (src/records/slot-write.ts), which accept a Designer themes.* slot only, so no other agent's pin
 * (a Publisher page pin included) is reachable from the probe.
 */
function parseCanonical(text, what) {
  let value;
  try { value = JSON.parse(text); } catch { throw new Error(`${what} is not JSON.`); }
  if (canonical(value) !== text) throw new Error(`${what} is not canonical JSON (two-space indent, trailing newline); refusing to rewrite it.`);
  return value;
}

const slotWriter = () => import(new URL('../../dist/records/slot-write.js', import.meta.url).href);
const THEME_CANDIDATE = /^clossys\/agents\/designer\/(themes\.[a-z0-9][a-z0-9.-]*)\/candidates\/([^/]+\.json)$/;

async function themeSlot(root, primaryPath, primaryText) {
  const match = relative(root, primaryPath).split(sep).join('/').match(THEME_CANDIDATE);
  if (!match) throw new Error('A theme-candidate primarySource must be a Designer themes.* slot candidate (clossys/agents/designer/themes.<id>/candidates/<file>.json).');
  const consumer = join(root, 'clossys');
  const original = (await slotWriter()).readThemeProbePin(consumer, match[1], match[2], primaryText);
  return { consumer, id: match[1], original };
}

function mutatePrimary(primary, occurrence, cssVariable, format) {
  const mix = color => `color-mix(in srgb, ${color} 70%, transparent)`;
  const check = color => { if (!literalColor.test(color)) throw new Error(`Selected ${cssVariable} must be a literal CSS color expression; legacy channel-only tokens need an explicit source adapter.`); };
  if (format === 'theme-json') {
    const item = parseCanonical(primary, 'The theme candidate');
    const name = cssVariable.slice(2);
    if (item?.type !== 'registry:theme' || !item.cssVars || typeof item.cssVars !== 'object') throw new Error('The theme candidate is not a registry:theme item with cssVars.');
    // Occurrences follow the compiled order: theme, then light (both :root), then dark (.dark).
    const found = themeModes.filter(mode => typeof item.cssVars[mode]?.[name] === 'string');
    const mode = found[occurrence];
    if (!mode) throw new Error(`Selected theme candidate declares no matching ${cssVariable} variable.`);
    const originalColor = item.cssVars[mode][name].trim();
    check(originalColor);
    item.cssVars[mode][name] = mix(originalColor);
    return { primary: canonical(item), originalColor };
  }
  const declarations = [...primary.matchAll(variablePattern(cssVariable))];
  const declaration = declarations[occurrence];
  if (!declaration) throw new Error(`Selected UI CSS source has no matching ${cssVariable} declaration.`);
  const originalColor = declaration[2].trim();
  check(originalColor);
  const replacement = `${declaration[1]}${mix(originalColor)}${declaration[3]}`;
  return { primary: primary.slice(0, declaration.index) + replacement + primary.slice(declaration.index + declaration[0].length), originalColor };
}

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
export async function discoverAdapter(root = repoRoot, configFile, overrides = {}) {
  const config = configFile ? resolve(root, configFile) : join(root, 'packages/producer/studio/checks/p0-propagate.config.json');
  let configText;
  try { configText = await readFile(config, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT' || configFile) throw error; }
  if (configText !== undefined) return validateAdapter(root, { ...JSON.parse(configText), ...overrides });
  if (overrides.primarySource && overrides.buttonSource) return validateAdapter(root, overrides);
  const files = await filesIn(join(root, 'packages'));
  const pattern = variablePattern(overrides.cssVariable ?? '--primary');
  const css = [], buttons = [];
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    if (file.endsWith('.css') && new RegExp(pattern.source).test(text)) css.push(relative(root, file));
    if (/button\.[jt]sx$/.test(file) && /\bbuttonVariants\b/.test(text) && /\bbg-primary\b/.test(text) && radiusPattern.test(text)) buttons.push(relative(root, file));
  }
  if (css.length !== 1 || buttons.length !== 1) {
    throw new Error(`UI propagation source discovery is unresolved (${css.length} primary CSS sources, ${buttons.length} shadcn button sources). Supply p0-propagate.config.json with primarySource, buttonSource, cssVariable, route and buildCommands; Studio app sources are never mutated.`);
  }
  // Discovery identifies source; the build seam must be explicit rather than guessing
  // which UI package build and running Studio process consume those source files.
  throw new Error(`Discovered UI sources ${css[0]} and ${buttons[0]}; supply p0-propagate.config.json with the actual buildCommands and route (buttonSelector defaults to [data-slot="button"]).`);
}

export async function validateAdapter(root, adapter) {
  if (!adapter || typeof adapter !== 'object') throw new Error('Propagation adapter must be an object.');
  const cssVariable = adapter.cssVariable ?? '--primary';
  variablePattern(cssVariable);
  const primaryPath = await sourcePath(root, adapter.primarySource);
  const buttonPath = await sourcePath(root, adapter.buttonSource);
  if (primaryPath === buttonPath) throw new Error('Primary CSS and button source must be distinct files.');
  const buttonSelector = adapter.buttonSelector ?? '[data-slot="button"]';
  if (typeof buttonSelector !== 'string' || !buttonSelector.trim()) throw new Error('Adapter requires the selector of a rendered primary shadcn button.');
  if (typeof adapter.route !== 'string' || !adapter.route.startsWith('/') || adapter.route.startsWith('//')) throw new Error('Adapter route must be a local absolute route.');
  if (!Array.isArray(adapter.buildCommands) || !adapter.buildCommands.length || adapter.buildCommands.some(command => !Array.isArray(command) || !command.length || command.some(part => typeof part !== 'string' || !part))) throw new Error('Adapter buildCommands must contain executable/argument arrays.');
  const occurrence = adapter.primaryOccurrence ?? 0;
  if (!Number.isInteger(occurrence) || occurrence < 0) throw new Error('primaryOccurrence must be a nonnegative integer.');
  const primaryFormat = primaryPath.endsWith('.json') ? 'theme-json' : 'css';
  const theme = primaryFormat === 'theme-json' ? await themeSlot(root, primaryPath, await readFile(primaryPath, 'utf8')) : undefined;
  return { ...adapter, cssVariable, buttonSelector, primaryPath, buttonPath, primaryOccurrence: occurrence, primaryFormat, theme };
}

export function createMutations(primary, button, radius, occurrence = 0, cssVariable = '--primary', format = 'css') {
  const { primary: mutatedPrimary, originalColor } = mutatePrimary(primary, occurrence, cssVariable, format);
  if (!Number.isFinite(radius) || radius < 0) throw new Error('The rendered button radius must resolve to pixels.');
  if (!/\bbuttonVariants\b/.test(button) || !/\bbg-primary\b/.test(button)) throw new Error('Selected button source is not the primary shadcn button variant.');
  const token = button.match(radiusPattern)?.[0];
  if (!token) throw new Error('Selected button source has no supported rounded class to mutate.');
  const nextRadius = radius + 3;
  return {
    primary: mutatedPrimary,
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
      // A shell may exit on TERM before a compiler grandchild does. Finish the
      // process group before allowing callers to restore either source file.
      if (failure && grouped && child.pid) {
        try { process.kill(-child.pid, 'SIGKILL'); }
        catch (error) { if (error.code !== 'ESRCH') failure = error; }
      }
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
  const { launchChrome } = require('./chrome-launch.cjs');
  const browser = await launchChrome({ headless: true });
  return {
    async sample(url, selector, cssVariable = '--primary') {
      const context = await browser.newContext({ colorScheme: 'light' });
      const page = await context.newPage();
      try {
        const response = await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
        if (!response?.ok()) throw new Error(`Propagation route returned ${response?.status() ?? 'no response'}: ${url}`);
        const button = page.locator(selector).first();
        await button.waitFor({ state: 'visible' });
        return await button.evaluate((node, variable) => {
          const style = getComputedStyle(node);
          const primary = style.getPropertyValue(variable).trim();
          const probe = document.createElement('span');
          probe.style.backgroundColor = `var(${variable})`;
          document.body.appendChild(probe);
          const resolvedPrimary = getComputedStyle(probe).backgroundColor;
          probe.remove();
          return { primary, resolvedPrimary, background: style.backgroundColor, radius: parseFloat(style.borderTopLeftRadius) };
        }, cssVariable);
      } finally { await context.close(); }
    },
    close: () => browser.close(),
  };
}

/** Source restoration and a restoration build execute on every post-write exit. */
export async function runPropagation({ root = repoRoot, adapter, baseURL = studioOrigin(), driver, execute = runCommand, signal, artifactDir } = {}) {
  adapter = await validateAdapter(root, adapter ?? await discoverAdapter(root));
  const url = new URL(adapter.route, baseURL);
  if (url.origin !== new URL(baseURL).origin) throw new Error('Propagation route escaped the Studio origin.');
  // The mutated files: the primary source and the button source; a theme candidate's slot pin is
  // re-pointed (and restored) through the slot writer's theme-probe helpers, never written here.
  const paths = [adapter.primaryPath, adapter.buttonPath];
  const originals = await Promise.all(paths.map(path => readFile(path, 'utf8')));
  const theme = adapter.theme;
  const writer = theme ? await slotWriter() : undefined;
  const ownedDriver = !driver;
  driver ??= await browserDriver();
  let touched = false, outcome, failure;
  const build = async restore => {
    for (const command of adapter.buildCommands) await execute(command, root, restore ? undefined : signal);
  };
  try {
    if (signal?.aborted) throw new Error('Propagation was cancelled before source mutation.');
    const before = await driver.sample(url.href, adapter.buttonSelector, adapter.cssVariable);
    const mutation = createMutations(originals[0], originals[1], before.radius, adapter.primaryOccurrence, adapter.cssVariable, adapter.primaryFormat);
    const mutated = [mutation.primary, mutation.button];
    // Source backups default to the OS temp directory: a write under the checkout dirties the tree.
    const evidenceDir = artifactDir ?? join(tmpdir(), 'p0-propagate', `${Date.now()}-${process.pid}`);
    await mkdir(evidenceDir, { recursive: true });
    await writeFile(join(evidenceDir, 'primary.original.txt'), originals[0]);
    await writeFile(join(evidenceDir, 'button.original.txt'), originals[1]);
    if (theme) await writeFile(join(evidenceDir, 'pin.original.txt'), theme.original);
    touched = true;
    for (const [index, path] of paths.entries()) await writeFile(path, mutated[index]);
    if (theme) writer.repointThemeProbePin(theme.consumer, theme.id, theme.original, mutation.primary);
    await build(false);
    if (signal?.aborted) throw new Error('Propagation was cancelled during source build.');
    const after = await driver.sample(url.href, adapter.buttonSelector, adapter.cssVariable);
    if (after.primary === before.primary || after.background === before.background || after.background !== after.resolvedPrimary) throw new Error(`The mutated ${adapter.cssVariable} did not reach the rendered primary button. Rebuild/restart the process serving ${new URL(baseURL).origin} through the adapter buildCommands (or pass --own-studio).`);
    if (Math.abs(after.radius - mutation.nextRadius) > 0.1) throw new Error('The actual shadcn button class mutation did not reach the rendered button.');
    outcome = { status: 'passed', url: url.href, primarySource: adapter.primarySource, primaryFormat: adapter.primaryFormat, buttonSource: adapter.buttonSource, cssVariable: adapter.cssVariable, buttonSelector: adapter.buttonSelector, originalClass: mutation.originalClass, before, after, sourceRestored: false };
  } catch (error) { failure = error; }
  finally {
    try {
      if (touched) {
        const restoration = await Promise.allSettled([
          ...paths.map((path, index) => writeFile(path, originals[index])),
          ...(theme ? [(async () => { if (!writer.restoreThemeProbePin(theme.consumer, theme.id, theme.original)) throw new Error('The theme slot pin was not restored byte-exactly.'); })()] : []),
        ]);
        const restoreFailures = restoration.filter(item => item.status === 'rejected').map(item => item.reason);
        if (restoreFailures.length) throw new AggregateError(restoreFailures, 'Source restoration failed; original source backups are retained.');
        await build(true);
        const restored = await Promise.all(paths.map(path => readFile(path, 'utf8')));
        if (restored.some((text, index) => text !== originals[index])) throw new Error('Propagation source restoration did not preserve the original bytes.');
        if (outcome) outcome.sourceRestored = true;
      }
    } catch (error) { failure = failure ? new AggregateError([failure, error], 'Propagation failed and the restoration build also failed; source backups are retained.') : error; }
    finally { if (ownedDriver) await driver.close(); }
  }
  if (failure) throw failure;
  return outcome;
}

const usage = 'Usage: studio:propagate [--config relative-adapter.json] [--base-url URL | --own-studio] [--evidence-dir DIR] [--css-source FILE --component-source FILE --css-variable --primary --selector SELECTOR --route PATH --build-command JSON_ARRAY]';

/** Build commands stay argument arrays; CLI values never become shell commands. */
export function parseArgs(args) {
  const parsed = { baseURL: studioOrigin(), overrides: {} };
  const seen = new Set();
  const fields = { '--css-source': 'primarySource', '--component-source': 'buttonSource', '--css-variable': 'cssVariable', '--selector': 'buttonSelector', '--route': 'route' };
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    // --own-studio takes no value: this run starts, restarts after each rebuild and stops its own Studio.
    if (flag === '--own-studio') { if (seen.has(flag) || seen.has('--base-url')) throw new Error(usage); seen.add(flag); parsed.ownStudio = true; continue; }
    const value = args[++index];
    const field = Object.hasOwn(fields, flag) ? fields[flag] : undefined;
    if (!value || (!field && !['--config', '--base-url', '--build-command', '--primary-occurrence', '--evidence-dir'].includes(flag)) || (flag === '--base-url' && parsed.ownStudio)) throw new Error(usage);
    if (flag !== '--build-command' && seen.has(flag)) throw new Error(usage);
    seen.add(flag);
    if (field) parsed.overrides[field] = value;
    else if (flag === '--config') parsed.config = value;
    else if (flag === '--base-url') parsed.baseURL = value;
    else if (flag === '--evidence-dir') parsed.artifactDir = resolve(value);
    else if (flag === '--primary-occurrence') parsed.overrides.primaryOccurrence = Number(value);
    else {
      let command;
      try { command = JSON.parse(value); } catch { throw new Error('--build-command must be a JSON executable/argument array.'); }
      if (!Array.isArray(command) || !command.length || command.some(part => typeof part !== 'string' || !part)) throw new Error('--build-command must be a JSON executable/argument array.');
      (parsed.overrides.buildCommands ??= []).push(command);
    }
  }
  return parsed;
}

async function freePort() {
  const server = createServer();
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
  const { port } = server.address();
  await new Promise(accept => server.close(accept));
  return port;
}

/**
 * --own-studio: the propagation proof needs the serving process to load each rebuild, and a running
 * Studio holds its build in memory. So this run starts its own Studio on a free local port (the
 * check:studio starter, which builds dist/studio first), stops it before every adapter build command
 * and starts it again from the fresh build, and stops it at the end.
 */
async function ownStudioRun(adapter, signal, artifactDir) {
  const { startStudio } = await import('../../scripts/check-studio.mjs');
  const port = await freePort(), log = line => console.error(line);
  let studio = await startStudio({ port, log });
  const execute = async (command, root, buildSignal) => {
    await studio?.stop(); studio = undefined;
    await runCommand(command, root, buildSignal);
    studio = await startStudio({ port, log, build: false });
  };
  try { return await runPropagation({ adapter, baseURL: studio.origin, execute, signal, artifactDir }); }
  finally { await studio?.stop(); }
}

async function main(args) {
  const { config, baseURL, overrides, ownStudio, artifactDir } = parseArgs(args);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);
  try {
    const adapter = await discoverAdapter(repoRoot, config, overrides);
    const outcome = ownStudio ? await ownStudioRun(adapter, controller.signal, artifactDir) : await runPropagation({ adapter, baseURL, signal: controller.signal, artifactDir });
    console.log(JSON.stringify(outcome, null, 2));
  }
  finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(`Studio propagation failed: ${error.message}`); process.exitCode = error?.code === 'BLOCKED_NO_BROWSER' ? 2 : 1; });
}
