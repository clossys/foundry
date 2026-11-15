#!/usr/bin/env node
// Fails while any non-test engine file imports a Studio path: `src/server/`, `src/studio/` or `studio/`
// of any package, whether by relative path or by a package subpath export that lands there.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const STUDIO_DIRS = ["src/server", "src/studio", "studio"];
export const SCANNED_PACKAGES = ["designer", "producer", "publisher"];
const SOURCE_EXT = /\.(?:[cm]?[jt]sx?)$/;
const SKIP_DIRS = new Set(["node_modules", "dist", ".next", ".turbo", "coverage", "test-fixtures", "__fixtures__", "__tests__", "test", "tests"]);
const TEST_FILE = /(?:\.(?:test|spec)\.[cm]?[jt]sx?|^vitest\.[\w.-]+\.[cm]?[jt]s)$/;
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*|\bexport\s*\*\s*from\s*)["'`]([^"'`\n]+)["'`]/g;

const toPosix = (p) => p.split(path.sep).join("/");

function isStudioPath(rel) {
  // rel: path relative to the packages dir, e.g. "producer/src/server/x.ts"
  const [pkg, ...rest] = toPosix(rel).split("/");
  if (!pkg) return false;
  const inner = rest.join("/");
  return STUDIO_DIRS.some((dir) => inner === dir || inner.startsWith(`${dir}/`));
}

function exportTarget(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return value.import ?? value.default ?? value.node ?? value.types ?? null;
  return null;
}

function loadExports(packagesDir) {
  const map = new Map();
  for (const dir of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const pj = path.join(packagesDir, dir.name, "package.json");
    if (!fs.existsSync(pj)) continue;
    const json = JSON.parse(fs.readFileSync(pj, "utf8"));
    if (typeof json.name === "string") map.set(json.name, { dir: dir.name, exports: json.exports ?? {} });
  }
  return map;
}

/** Package-relative source path ("src/...", "studio/...") an export target names, mapping dist to src. */
function exportSourcePath(target) {
  const clean = target.replace(/^\.\//, "");
  return clean.startsWith("dist/") ? `src/${clean.slice("dist/".length)}` : clean;
}

function resolvePackageSpecifier(spec, exportsByName) {
  const m = /^(@[^/]+\/[^/]+|[^@./][^/]*)(?:\/(.*))?$/.exec(spec);
  if (!m) return null;
  const pkg = exportsByName.get(m[1]);
  if (!pkg) return null;
  const sub = m[2] ? `./${m[2]}` : ".";
  const exp = pkg.exports;
  let target = null;
  if (typeof exp === "string") target = sub === "." ? exp : null;
  else if (exp[sub] !== undefined) target = exportTarget(exp[sub]);
  else {
    for (const [key, value] of Object.entries(exp)) {
      if (!key.includes("*")) continue;
      const [pre, post] = key.split("*");
      if (sub.startsWith(pre) && sub.endsWith(post)) {
        const t = exportTarget(value);
        if (t) target = t.replace("*", sub.slice(pre.length, sub.length - post.length));
      }
    }
  }
  if (!target) return null;
  return `${pkg.dir}/${exportSourcePath(target)}`;
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      yield* walk(full);
    } else if (entry.isFile() && SOURCE_EXT.test(entry.name) && !TEST_FILE.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      yield full;
    }
  }
}

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

/** Every import of a Studio path from a non-test file outside the Studio dirs. */
export function scanStudioImports({ root, packages = SCANNED_PACKAGES } = {}) {
  const packagesDir = path.join(root, "packages");
  const exportsByName = loadExports(packagesDir);
  const findings = [];
  for (const pkg of packages) {
    const pkgDir = path.join(packagesDir, pkg);
    if (!fs.existsSync(pkgDir)) continue;
    for (const file of walk(pkgDir)) {
      const relFile = toPosix(path.relative(packagesDir, file));
      if (isStudioPath(relFile)) continue;
      const text = stripComments(fs.readFileSync(file, "utf8"));
      const lines = text.split("\n");
      lines.forEach((line, index) => {
        for (const match of line.matchAll(SPECIFIER)) {
          const spec = match[1];
          let target = null;
          if (spec.startsWith(".")) target = toPosix(path.relative(packagesDir, path.resolve(path.dirname(file), spec)));
          else target = resolvePackageSpecifier(spec, exportsByName);
          if (target && !target.startsWith("..") && isStudioPath(target)) findings.push({ file: relFile, line: index + 1, specifier: spec, target });
        }
      });
    }
  }
  return findings;
}

function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const rootArg = process.argv.indexOf("--root");
  const root = rootArg > 0 ? path.resolve(process.argv[rootArg + 1]) : path.resolve(here, "../../..");
  const json = process.argv.includes("--json");
  const findings = scanStudioImports({ root });
  if (json) process.stdout.write(`${JSON.stringify({ ok: findings.length === 0, findings }, null, 2)}\n`);
  else if (findings.length) {
    for (const f of findings) console.error(`packages/${f.file}:${f.line} imports ${f.specifier} (packages/${f.target})`);
    console.error(`check:no-studio-imports: ${findings.length} engine import(s) of a Studio path`);
  } else console.log("check:no-studio-imports: ok (no engine file imports src/server, src/studio or studio/)");
  process.exitCode = findings.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
