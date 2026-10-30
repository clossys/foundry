#!/usr/bin/env node
/** Build the complete browser graph of every exported web entry before packing. */
import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const inside = (root, file) => file === root || file.startsWith(root + path.sep);
const nodeBuiltins = new Set(builtinModules.flatMap(name => [name, name.replace(/^node:/, '')]));
const serverSpecifier = name => name.startsWith('node:') || nodeBuiltins.has(name)
  || name === 'server-only' || /^react-dom\/server(?:[./]|$)/.test(name)
  || /^react-server-dom-[^/]+\/server(?:[./]|$)/.test(name)
  || /^(?:next\/headers|next\/server)(?:\/|$)/.test(name);

// Conditional exports are ordered. In particular, "node" and "react-server"
// must never be added to the browser condition set to make resolution succeed.
export function browserTarget(value, mode) {
  if (typeof value === 'string' || value === null) return value;
  if (Array.isArray(value)) throw new Error('Export arrays need an explicit boundary policy');
  if (!value || typeof value !== 'object') return undefined;
  for (const [condition, target] of Object.entries(value)) {
    if (['browser', 'import', 'default', mode].includes(condition)) {
      const selected = browserTarget(target, mode);
      if (selected !== undefined) return selected;
    }
  }
}

function binding(root) {
  const git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean).sort();
  return {
    head: git(['rev-parse', 'HEAD']), tree: git(['rev-parse', 'HEAD^{tree}']),
    trackedDiffSha256: hash(git(['diff', 'HEAD', '--binary'])),
    untracked: untracked.map(file => ({ file, sha256: hash(fs.readFileSync(path.join(root, file))) })),
  };
}

function packageRoots(packageRoot, pkg, repositoryRoot) {
  const scope = pkg.name.slice(0, pkg.name.lastIndexOf('/'));
  const roots = new Map([[pkg.name, fs.realpathSync(packageRoot)]]);
  const workspace = path.join(repositoryRoot, 'packages');
  // A packed consumer resolves exclusively from its own node_modules. A source
  // workspace resolves exclusively from the packages in this same checkout.
  if (inside(workspace, packageRoot)) {
    for (const dir of fs.readdirSync(workspace)) {
      const root = path.join(workspace, dir), file = path.join(root, 'package.json');
      if (fs.existsSync(file)) {
        const manifest = readJson(file);
        if (manifest.name?.startsWith(scope + '/')) roots.set(manifest.name, fs.realpathSync(root));
      }
    }
  } else {
    const scoped = path.dirname(packageRoot);
    if (path.basename(scoped) !== scope) throw new Error('Packed package must be installed under its scope directory');
    for (const dir of fs.readdirSync(scoped)) {
      const root = path.join(scoped, dir), file = path.join(root, 'package.json');
      if (fs.existsSync(file)) {
        const manifest = readJson(file);
        if (manifest.name?.startsWith(scope + '/')) roots.set(manifest.name, fs.realpathSync(root));
      }
    }
  }
  return { scope, roots };
}

export async function checkClientBoundary(packageRoot, { repositoryRoot, build: suppliedBuild } = {}) {
  packageRoot = path.resolve(packageRoot);
  repositoryRoot ??= path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const report = { schemaVersion: 1, gate: 'client-boundary', ok: false, exitCode: 2, packageRoot,
    policy: { platform: 'browser', treeShaking: false, externals: [], conditions: ['browser', 'import', 'production|development'] },
    source: binding(repositoryRoot), census: [], graphs: [], errors: [] };
  try {
    const pkg = readJson(path.join(packageRoot, 'package.json'));
    const { scope, roots } = packageRoots(packageRoot, pkg, repositoryRoot);
    const build = suppliedBuild ?? (await import('esbuild')).build;
    const ts = await import('typescript');
    const inspected = new Map();
    const owners = new Map();
    const ownerOf = file => {
      let dir = path.dirname(file);
      if (owners.has(dir)) return owners.get(dir);
      const visited = [];
      while (dir !== path.dirname(dir)) {
        visited.push(dir);
        const manifest = path.join(dir, 'package.json');
        if (fs.existsSync(manifest)) {
          const owner = { name: readJson(manifest).name, root: dir };
          for (const item of visited) owners.set(item, owner);
          return owner;
        }
        dir = path.dirname(dir);
      }
    };
    if (!pkg.exports || typeof pkg.exports !== 'object') throw new Error('Missing package export census');
    for (const [entry, spec] of Object.entries(pkg.exports)) {
      if (entry.includes('*')) throw new Error('Wildcard exports need an explicit boundary census');
      const checked = entry === './web' || entry.startsWith('./web/') || entry === './preview' || entry.startsWith('./preview/') || entry === './content-map';
      report.census.push({ entry, checked, production: browserTarget(spec, 'production') ?? null,
        development: browserTarget(spec, 'development') ?? null,
        reason: checked ? 'declared browser surface' : 'outside web client contract' });
    }
    const entries = report.census.filter(row => row.checked);
    if (!entries.length) throw new Error('No client entries found; refusing an empty graph');
    let missing = false;
    for (const row of entries) for (const mode of ['production', 'development']) {
      const target = row[mode];
      if (!target || !target.startsWith('./') || !fs.statSync(path.resolve(packageRoot, target)).isFile()) {
        throw new Error(`Missing browser input for ${row.entry} (${mode}): ${target}`);
      }
      const edges = [], violations = [], errors = [];
      const specifier = pkg.name + row.entry.slice(1);
      const plugin = { name: 'closed-client-graph', setup(builder) {
        builder.onLoad({ filter: /\.[cm]?js$/ }, args => {
          const real = fs.realpathSync(args.path);
          if (!inspected.has(real)) {
            const source = ts.createSourceFile(real, fs.readFileSync(real, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
            const opaque = [];
            const visit = node => {
              if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
                || ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
                const argument = node.arguments[0];
                if (!argument || !ts.isStringLiteralLike(argument)) opaque.push('Nonliteral module edge cannot be proven browser-safe');
              }
              ts.forEachChild(node, visit);
            };
            visit(source);
            inspected.set(real, opaque);
          }
          const opaque = inspected.get(real);
          if (opaque.length) {
            violations.push({ importer: args.path, specifier: '<nonliteral module edge>', reason: opaque[0] });
            return { errors: opaque.map(text => ({ text })) };
          }
        });
        builder.onResolve({ filter: /.*/ }, async args => {
          if (args.pluginData?.boundaryResolve) return;
          const edge = { importer: args.importer || '<entry>', specifier: args.path, kind: args.kind };
          edges.push(edge);
          if (serverSpecifier(args.path)) {
            violations.push({ ...edge, reason: 'server-only import' });
            return { errors: [{ text: `Server-only import refused: ${args.path}` }] };
          }
          const resolved = await builder.resolve(args.path, { kind: args.kind, importer: args.importer,
            resolveDir: args.resolveDir, pluginData: { boundaryResolve: true } });
          edge.resolved = resolved.path;
          edge.external = resolved.external;
          edge.namespace = resolved.namespace;
          if (resolved.external) return { errors: [{ text: `External import hides graph input: ${args.path}` }] };
          if (args.path.startsWith(scope + '/')) {
            const name = args.path.split('/').slice(0, 2).join('/'), root = roots.get(name);
            if (!root || !resolved.path || !inside(root, fs.realpathSync(resolved.path))) {
              return { errors: [{ text: `First-party input escaped owning package: ${args.path}` }] };
            }
          }
          if (resolved.path && resolved.namespace === 'file') {
            const real = fs.realpathSync(resolved.path);
            const owner = ownerOf(real);
            if (owner?.name?.startsWith(scope + '/') && roots.get(owner.name) !== owner.root) {
              return { errors: [{ text: `Unpinned first-party input: ${args.path}` }] };
            }
            const lexicalOwner = [...roots.values()].find(root => inside(root, resolved.path));
            if (lexicalOwner && !inside(lexicalOwner, real) && !path.relative(lexicalOwner, resolved.path).split(path.sep).includes('node_modules')) {
              return { errors: [{ text: `First-party input escaped owning package: ${args.path}` }] };
            }
          }
          return resolved;
        });
      } };
      let result;
      try {
        result = await build({ stdin: { contents: `import * as entry from ${JSON.stringify(specifier)}; globalThis.__clientBoundary = entry;`, resolveDir: packageRoot, sourcefile: 'client-boundary-entry.mjs' },
          absWorkingDir: packageRoot, bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true,
          outfile: path.join(packageRoot, 'node_modules/.cache/client-boundary.js'), treeShaking: false,
          conditions: ['browser', mode], preserveSymlinks: true, plugins: [plugin], logLevel: 'silent', loader: { '.svg': 'dataurl' } });
      } catch (error) {
        errors.push(...(error.errors ?? [{ text: error.message }]).map(error => ({ text: error.text, location: error.location })));
      }
      const graphInputs = result?.metafile?.inputs;
      const inputs = graphInputs ? Object.keys(graphInputs).filter(file => file !== 'client-boundary-entry.mjs').sort().map(file => {
        const absolute = path.resolve(packageRoot, file);
        return { file, sha256: hash(fs.readFileSync(absolute)), bytes: fs.statSync(absolute).size };
      }) : [];
      if (result && (!graphInputs || !inputs.length || !inputs.some(input => path.resolve(packageRoot, input.file) === path.resolve(packageRoot, target)))) {
        missing = true;
        errors.push({ text: 'Missing graph or exported entry input; refusing incomplete evidence' });
      }
      if (result && graphInputs) {
        const covered = new Set(inputs.map(input => path.resolve(packageRoot, input.file)));
        for (const edge of edges) if (edge.namespace === 'file' && edge.resolved && !covered.has(edge.resolved)) {
          missing = true;
          errors.push({ text: `Resolved input missing from graph: ${edge.resolved}` });
        }
      }
      // A sorted breadth-first walk gives stable shortest importer chains even
      // when the bundler resolves shared modules concurrently or encounters cycles.
      edges.sort((a, b) => `${a.importer}\0${a.specifier}`.localeCompare(`${b.importer}\0${b.specifier}`));
      const adjacency = new Map();
      for (const edge of edges) {
        if (!adjacency.has(edge.importer)) adjacency.set(edge.importer, []);
        adjacency.get(edge.importer).push(edge);
      }
      const start = path.join(packageRoot, 'client-boundary-entry.mjs');
      const chains = new Map([[start, []]]), queue = [start];
      for (let index = 0; index < queue.length; index++) for (const edge of adjacency.get(queue[index]) ?? []) {
        if (edge.resolved && !chains.has(edge.resolved)) {
          chains.set(edge.resolved, [...chains.get(queue[index]), edge]);
          queue.push(edge.resolved);
        }
      }
      violations.sort((a, b) => `${a.importer}\0${a.specifier}`.localeCompare(`${b.importer}\0${b.specifier}`));
      const chain = edge => [...(chains.get(edge.importer) ?? []), edge];
      report.graphs.push({ entry: row.entry, mode, target, ok: !!result && !errors.length && !violations.length,
        inputs, edges, violations: violations.map(edge => ({ ...edge, chain: chain(edge) })), errors });
    }
    report.ok = report.graphs.length === entries.length * 2 && report.graphs.every(graph => graph.ok);
    report.exitCode = report.ok ? 0 : missing ? 2 : 1;
  } catch (error) { report.errors.push(error.message); }
  return report;
}

async function main() {
  const args = process.argv.slice(2), flag = args.indexOf('--report');
  if (args.length !== 3 || flag !== 1 || !args[2]) {
    console.error('Usage: node scripts/check-client-boundary.mjs <package-directory> --report <report.json>');
    return 2;
  }
  let report;
  try { report = await checkClientBoundary(args[0]); }
  catch (error) { report = { schemaVersion: 1, gate: 'client-boundary', ok: false, exitCode: 2, errors: [error.message] }; }
  const output = path.resolve(args[2]);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  for (const graph of report.graphs ?? []) {
    console.log(`${graph.ok ? 'PASS' : 'FAIL'} ${graph.entry} (${graph.mode}): ${graph.inputs.length} inputs`);
    for (const violation of graph.violations) console.error(violation.chain.map(edge => `${edge.importer} -> ${edge.specifier}`).join('\n  '));
    for (const error of graph.errors) console.error(error.text);
  }
  for (const error of report.errors) console.error(error);
  console.log(`client-boundary: ${report.ok ? 'PASS' : 'FAIL'}; report ${output}`);
  return report.exitCode;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
