#!/usr/bin/env node
/**
 * check-compile-pure (R-COMPILE-PURE): rendering is deterministic code with zero model spend.
 *
 * `clossys compile` reads only the decision files packages/producer/decision-inputs.json lists
 * (plus package code) and writes the Studio page output, the generated route files and
 * compile.lock.json. This check proves the contract on the built CLI (packages/producer/dist):
 *
 *   inputs        decision-inputs.json exists, is well formed and resolves to files in clossys/.
 *   purity        no module reachable from the CLI entry (dist/cli/index.js, through first-party
 *                 relative and @clossys/* imports) imports an agent or model client
 *                 (anthropic, openai, ...) or spawns claude/codex through child_process.
 *   determinism   two compiles of the same root into two temp dirs, with PATH reduced to a dir
 *                 holding only node and npm, no network env, and network/child_process blocked
 *                 in-process, produce byte-identical trees; compile never writes into its root.
 *   lock          compile.lock.json holds the sha256 of every resolved decision input and of every
 *                 other output file, and those hashes are true.
 *   decisions     a root holding only the resolved decision files compiles to the same bytes; an
 *                 edit to non-decision files (an unpinned candidate, selection.json, a library
 *                 file) leaves the output unchanged; re-pinning one pin.json to another candidate
 *                 changes the rendered output (not only the lock).
 *
 * Usage: node packages/producer/scripts/check-compile-pure.mjs
 * Needs `npm run build` first (it runs the built CLI). Exit 0 clean, 1 on any finding.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const producer = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(producer, '../..');
const clossys = join(repo, 'clossys');
const inputsFile = join(producer, 'decision-inputs.json');
const cliEntry = join(producer, 'dist', 'cli', 'index.js');
const findings = [];
const finding = (rule, message) => findings.push(`${rule}: ${message}`);
const portable = path => path.split(sep).join('/');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** Every file under a directory, relative and sorted. */
function files(dir) {
  const out = [];
  const walk = sub => {
    for (const entry of readdirSync(join(dir, sub), { withFileTypes: true })) {
      const rel = sub ? `${sub}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(rel);
      else out.push(rel);
    }
  };
  if (existsSync(dir)) walk('');
  return out.sort();
}
function treeHash(dir) {
  return new Map(files(dir).map(rel => [rel, sha256(readFileSync(join(dir, rel)))]));
}
function treeDiff(a, b) {
  const diff = [];
  for (const [rel, hash] of a) if (!b.has(rel)) diff.push(`only in first: ${rel}`); else if (b.get(rel) !== hash) diff.push(`differs: ${rel}`);
  for (const rel of b.keys()) if (!a.has(rel)) diff.push(`only in second: ${rel}`);
  return diff;
}

// ---------------------------------------------------------------- inputs
let spec;
if (!existsSync(inputsFile)) finding('inputs', 'packages/producer/decision-inputs.json is missing: compile has no machine list of decision files');
else {
  try { spec = JSON.parse(readFileSync(inputsFile, 'utf8')); }
  catch (error) { finding('inputs', `decision-inputs.json is not JSON: ${error.message}`); }
  if (spec && (spec.schema !== 'clossys.decision-inputs/1' || !Array.isArray(spec.inputs) || !spec.inputs.length)) {
    finding('inputs', 'decision-inputs.json needs schema clossys.decision-inputs/1 and a non-empty inputs list');
    spec = undefined;
  }
}

// ---------------------------------------------------------------- purity
// Model and agent clients, by npm scope (written as bare names so no account-shaped literal appears here)
// and by unscoped package name.
const MODEL_SCOPES = ['anthropic-ai', 'anthropic', 'openai', 'ai-sdk', 'mistralai', 'langchain', 'modelcontextprotocol', 'huggingface'];
const MODEL_NAMES = ['anthropic', 'openai', 'ai', 'cohere-ai', 'ollama', 'groq-sdk', 'langchain', 'replicate'];
const GOOGLE_MODEL = /^(?:generative-ai|genai)(?:\/|$)/;
function isModelPackage(spec) {
  const scoped = /^@([^/]+)\/(.+)$/.exec(spec);
  if (scoped) return MODEL_SCOPES.includes(scoped[1]) || (scoped[1] === 'google' && GOOGLE_MODEL.test(scoped[2]));
  return MODEL_NAMES.includes(spec.split('/')[0]);
}
const AGENT_SPAWN = /\b(?:spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)\s*\(\s*[^)]{0,120}?['"`](?:[^'"`]*\/)?(?:claude|codex|cursor-agent)(?:\.cmd)?['"`]/;
// In a module that loads child_process, any string naming an agent binary is a spawn target.
const AGENT_BINARY = /['"`](?:[^'"`\s]*\/)?(?:claude|codex|cursor-agent)(?:\.cmd|\.exe)?['"`]/;
const SPECIFIER = /(?:\bimport\s*(?:[\w*{}\s,$]+?\s*from\s*)?|\bexport\s*[\w*{}\s,$]+?\s*from\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)(['"])([^'"]+)\1/g;

function packageEntry(spec, fromDir) {
  // First-party workspace packages only: @clossys/<name>[/subpath] -> packages/<dir>/package.json exports.
  const match = /^(@clossys\/[^/]+)(\/.*)?$/.exec(spec);
  if (!match) return undefined;
  let dir = fromDir;
  while (true) {
    const candidate = join(dir, 'node_modules', match[1]);
    if (existsSync(join(candidate, 'package.json'))) {
      const manifest = JSON.parse(readFileSync(join(candidate, 'package.json'), 'utf8'));
      const sub = match[2] ? `.${match[2]}` : '.';
      let target = manifest.exports?.[sub] ?? (sub === '.' ? manifest.main : undefined);
      if (target && typeof target === 'object') target = target.import ?? target.default ?? target.node;
      return target ? resolve(candidate, target) : undefined;
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}
function resolveRelative(spec, fromDir) {
  const base = resolve(fromDir, spec);
  for (const path of [base, `${base}.js`, `${base}.mjs`, join(base, 'index.js')]) if (existsSync(path) && statSync(path).isFile()) return path;
  return undefined;
}
function purity(entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const file = realpathSync(queue.pop());
    if (seen.has(file)) continue;
    seen.add(file);
    // Comments carry example specifiers (`./x.js`, `./<Name>.js`); only code imports count.
    const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const where = portable(relative(repo, file));
    const childProcess = /['"](?:node:)?child_process['"]/.test(text);
    if (AGENT_SPAWN.test(text) || (childProcess && AGENT_BINARY.test(text))) finding('purity', `${where} spawns an agent binary through child_process`);
    for (const [, , spec] of text.matchAll(SPECIFIER)) {
      if (isModelPackage(spec)) { finding('purity', `${where} imports the agent or model client ${spec}`); continue; }
      if (/[$<>\s]/.test(spec)) continue; // a template or placeholder, not a module path
      if (spec.startsWith('.')) {
        if (!/\.(?:[cm]?js|json)$/.test(spec) && !existsSync(resolve(dirname(file), spec))) continue;
        if (spec.endsWith('.json')) continue;
        const target = resolveRelative(spec, dirname(file));
        if (target) queue.push(target);
        else finding('purity', `${where} imports ${spec}, which does not resolve`);
      } else if (spec.startsWith('@clossys/')) {
        const target = packageEntry(spec, dirname(file));
        if (target && existsSync(target)) queue.push(target);
      }
    }
  }
  return seen.size;
}

// ---------------------------------------------------------------- compile runs
const scratch = mkdtempSync(join(tmpdir(), 'check-compile-pure-'));
// A bin dir with node and npm only: no git, no claude, no codex on PATH.
const bin = join(scratch, 'bin');
mkdirSync(bin);
symlinkSync(process.execPath, join(bin, 'node'));
const npmCli = join(dirname(process.execPath), 'npm');
if (existsSync(npmCli)) symlinkSync(npmCli, join(bin, 'npm'));
// Network and process spawning fail loudly inside the compile process.
const guard = join(scratch, 'guard.mjs');
writeFileSync(guard, `import { syncBuiltinESMExports, createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const refuse = name => () => { throw new Error('compile-pure guard: ' + name + ' is not allowed during compile'); };
const net = require('node:net'), dns = require('node:dns'), cp = require('node:child_process'), http = require('node:http'), https = require('node:https');
net.connect = net.createConnection = refuse('net.connect');
net.Socket.prototype.connect = refuse('socket.connect');
for (const key of ['lookup', 'resolve', 'resolve4', 'resolve6']) dns[key] = refuse('dns.' + key);
for (const key of ['request', 'get']) { http[key] = refuse('http.' + key); https[key] = refuse('https.' + key); }
if (typeof globalThis.fetch === 'function') globalThis.fetch = refuse('fetch');
for (const key of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) cp[key] = refuse('child_process.' + key);
syncBuiltinESMExports();
`);
const env = { PATH: bin, HOME: join(scratch, 'home'), TMPDIR: join(scratch, 'tmp'), LANG: 'C', LC_ALL: 'C', TZ: 'UTC', NODE_OPTIONS: '' };
mkdirSync(env.HOME); mkdirSync(env.TMPDIR);

function compile(root, out) {
  const result = spawnSync(join(bin, 'node'), ['--import', guard, cliEntry, 'compile', '--root', root, '--out', out, '--json'], { cwd: scratch, env, encoding: 'utf8', timeout: 600_000 });
  if (result.status !== 0) {
    finding('determinism', `compile --root ${portable(relative(scratch, root))} exited ${result.status ?? result.signal}: ${(result.stderr || result.stdout).trim().split('\n').slice(-3).join(' | ')}`);
    return undefined;
  }
  return treeHash(out);
}
function copyRoot(name) {
  const root = join(scratch, name);
  mkdirSync(root);
  cpSync(clossys, join(root, 'clossys'), { recursive: true });
  return root;
}

let entryOk = existsSync(cliEntry);
if (!entryOk) finding('compile', 'packages/producer/dist/cli/index.js is not built: run npm run build');
else {
  const cli = readFileSync(cliEntry, 'utf8') + (existsSync(join(producer, 'dist/cli/main.js')) ? readFileSync(join(producer, 'dist/cli/main.js'), 'utf8') : '');
  if (!/["']compile["']/.test(cli)) { finding('compile', 'the built CLI has no compile verb'); entryOk = false; }
}

try {
  if (entryOk) {
    const modules = purity(cliEntry);
    console.log(`purity: ${modules} modules reachable from dist/cli/index.js`);
  }
  if (entryOk && spec) {
    const rootA = copyRoot('root-a');
    const before = treeHash(join(rootA, 'clossys'));
    const a = compile(rootA, join(scratch, 'out-a'));
    const b = compile(rootA, join(scratch, 'out-b'));
    const after = treeHash(join(rootA, 'clossys'));
    for (const line of treeDiff(before, after)) finding('determinism', `compile wrote into its root: ${line}`);
    if (a && b) {
      const diff = treeDiff(a, b);
      for (const line of diff.slice(0, 20)) finding('determinism', `two compiles differ: ${line}`);
      if (!diff.length) console.log(`determinism: ${a.size} output files byte-identical across two runs`);
    }
    if (a) {
      // compile.lock.json: true hashes of every resolved decision input and every other output.
      const lockPath = join(scratch, 'out-a', 'compile.lock.json');
      let lock;
      try { lock = JSON.parse(readFileSync(lockPath, 'utf8')); } catch { finding('lock', 'compile wrote no readable compile.lock.json'); }
      if (lock) {
        const inputs = new Map((lock.inputs ?? []).map(row => [row.path, row.sha256]));
        const outputs = new Map((lock.outputs ?? []).map(row => [row.path, row.sha256]));
        if (!inputs.size) finding('lock', 'compile.lock.json lists no inputs');
        for (const [path, hash] of inputs) {
          const file = join(rootA, path);
          if (!existsSync(file)) finding('lock', `input ${path} does not exist in the root`);
          else if (sha256(readFileSync(file)) !== hash) finding('lock', `input ${path} hash is wrong`);
        }
        for (const [rel, hash] of a) {
          if (rel === 'compile.lock.json') continue;
          if (outputs.get(rel) !== hash) finding('lock', `output ${rel} is ${outputs.has(rel) ? 'hashed wrong' : 'not hashed'} in compile.lock.json`);
        }
        for (const rel of outputs.keys()) if (!a.has(rel)) finding('lock', `compile.lock.json lists ${rel}, which compile did not write`);
        for (const path of inputs.keys()) if (!/^clossys\/agents\//.test(path)) finding('lock', `input ${path} is outside clossys/agents`);
        if (!a.has('generated/studio-map.json') || ![...a.keys()].some(rel => /^app\/.+\/page\.tsx$/.test(rel))) finding('compile', 'compile output holds no Studio page projection or no installed route files');

        // Only decision files: a root of exactly the locked inputs compiles to the same bytes.
        const rootM = join(scratch, 'root-min');
        for (const path of inputs.keys()) { mkdirSync(dirname(join(rootM, path)), { recursive: true }); cpSync(join(rootA, path), join(rootM, path)); }
        writeFileSync(join(rootM, 'clossys', 'clossys.config.ts'), '// root marker\n');
        const m = compile(rootM, join(scratch, 'out-min'));
        if (m) for (const line of treeDiff(a, m).slice(0, 20)) finding('decisions', `a root of only the decision files compiles differently: ${line}`);

        // Non-decision edits leave the output unchanged.
        const rootC = copyRoot('root-c');
        const pinnedCandidates = new Set([...inputs.keys()].filter(path => path.includes('/candidates/')));
        const unpinned = files(join(rootC, 'clossys', 'agents')).map(rel => `clossys/agents/${rel}`)
          .filter(path => path.includes('/candidates/') && !pinnedCandidates.has(path));
        const edits = [unpinned[0], 'clossys/selection.json', 'clossys/clossys.config.ts', files(join(rootC, 'clossys', 'library')).map(rel => `clossys/library/${rel}`)[0]].filter(Boolean);
        for (const path of edits) {
          const file = join(rootC, path);
          if (!existsSync(file)) continue;
          const text = readFileSync(file, 'utf8');
          writeFileSync(file, path.endsWith('.json') && text.trim().startsWith('{') ? text.replace(/\{/, '{"compilePureProbe":"edited",') : `${text}\n// compile-pure probe edit\n`);
        }
        writeFileSync(join(rootC, 'clossys', 'agents', 'compile-pure-probe.md'), 'not a decision\n');
        const c = compile(rootC, join(scratch, 'out-c'));
        if (c) {
          const diff = treeDiff(a, c);
          for (const line of diff.slice(0, 20)) finding('decisions', `editing non-decision files (${edits.join(', ')}) changed the output: ${line}`);
          if (!diff.length) console.log(`decisions: non-decision edits left output unchanged (${edits.length} files)`);
        }

        // Re-pinning one slot changes the rendered output.
        const rootD = copyRoot('root-d');
        let repinned;
        for (const path of [...inputs.keys()].filter(path => path.startsWith('clossys/agents/writer/') && path.endsWith('/pin.json'))) {
          const pin = JSON.parse(readFileSync(join(rootD, path), 'utf8'));
          const dir = join(rootD, dirname(path), 'candidates');
          const other = existsSync(dir) ? readdirSync(dir).filter(name => name !== pin.candidate && name.endsWith('.md')).sort().pop() : undefined;
          if (!other) continue;
          const bytes = readFileSync(join(dir, other));
          writeFileSync(join(rootD, path), `${JSON.stringify({ ...pin, candidate: other, sha256: sha256(bytes) }, null, 2)}\n`);
          repinned = `${path} -> ${other}`;
          break;
        }
        if (!repinned) finding('decisions', 'no Writer pin with a second candidate to re-pin');
        else {
          const d = compile(rootD, join(scratch, 'out-d'));
          if (d) {
            const changed = treeDiff(a, d).filter(line => !line.endsWith('compile.lock.json'));
            if (!changed.length) finding('decisions', `re-pinning ${repinned} did not change the rendered output`);
            else console.log(`decisions: re-pinning ${repinned} changed ${changed.length} output files`);
          }
        }
      }
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

if (findings.length) {
  console.error(`check-compile-pure: ${findings.length} findings`);
  for (const line of findings) console.error(`  ${line}`);
  process.exitCode = 1;
} else console.log('check-compile-pure: clean');
