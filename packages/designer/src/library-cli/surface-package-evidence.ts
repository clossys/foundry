/**
 * Host-side export evidence for package-pointer Sections and Frames.
 *
 * The surface check joins a package fill to two independent sides: the catalog
 * candidate (descriptor, pin) and the installed package artifact. This module
 * reads the second side: for every package module the candidates point at, it
 * resolves Node's import target and records its bytes and export names. Built
 * ESM barrels use a syntax-checked static inventory; installed CommonJS uses a
 * bounded native import namespace. A missing dist target retains the historical
 * same-package source-only inventory, which is not consumer runtime proof.
 * It never consults the
 * catalog pin for the version: the installed package.json speaks for itself, so
 * a pin/install mismatch surfaces as the check's S4 finding instead of passing.
 */
import * as fs from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { sha256 } from "../catalog-core/digest.js";
import type { SurfaceAnyDocument, SurfacePackageEvidence } from "../catalog-core/surface-types.js";

const IDENT = /^[A-Za-z_$][\w$]*$/;
const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);

/** Preserve token boundaries while hiding text that cannot declare module exports. */
function barrelCode(text: string): string {
  const masked = text.split("");
  const unsupported = (): never => { throw new Error("surface package evidence: unsupported barrel lexical syntax"); };
  function quoted(start: number): number {
    const quote = text[start];
    for (let index = start + 1; index < text.length; index++) {
      if (text[index] === "\\") { index++; if (text[index] === "\r" && text[index + 1] === "\n") index++; continue; }
      if (text[index] === quote) return index + 1;
      if (text[index] === "\n" || text[index] === "\r") return unsupported();
    }
    return unsupported();
  }
  function expression(start: number): number {
    let depth = 1;
    for (let index = start; index < text.length;) {
      const end = literal(index);
      if (end !== undefined) { index = end; continue; }
      if (text[index] === "{") depth++;
      if (text[index] === "}" && --depth === 0) return index + 1;
      index++;
    }
    return unsupported();
  }
  function template(start: number): number {
    for (let index = start + 1; index < text.length; index++) {
      if (text[index] === "\\") { index++; continue; }
      if (text[index] === "`") return index + 1;
      if (text[index] === "$" && text[index + 1] === "{") index = expression(index + 2) - 1;
    }
    return unsupported();
  }
  function literal(start: number): number | undefined {
    if (text[start] === '"' || text[start] === "'") return quoted(start);
    if (text[start] === "`") return template(start);
    if (text[start] !== "/") return undefined;
    if (text[start + 1] === "/") {
      const end = text.indexOf("\n", start + 2);
      return end < 0 ? text.length : end;
    }
    if (text[start + 1] === "*") {
      const end = text.indexOf("*/", start + 2);
      return end < 0 ? unsupported() : end + 2;
    }
    // Distinguishing division from a regular-expression literal needs a wider
    // grammar. Neither may contribute guessed exports to this static contract.
    return unsupported();
  }
  for (let index = 0; index < text.length;) {
    const end = literal(index);
    if (end === undefined) { index++; continue; }
    for (let offset = index; offset < end; offset++) if (text[offset] !== "\n" && text[offset] !== "\r") masked[offset] = " ";
    index = end;
  }
  return masked.join("");
}

/** Value and type export names of one ES module barrel. Star re-exports are refused: the barrel alone cannot enumerate them. */
export function packageBarrelExports(text: string): { values: string[]; types: string[] } {
  const code = barrelCode(text);
  if (/\bexport\s*\*/.test(code)) throw new Error("surface package evidence: star re-export cannot be enumerated from the barrel");
  const values = new Set<string>(), types = new Set<string>();
  for (const match of code.matchAll(/\bexport\s+(type\s+)?\{([^}]*)\}/g)) {
    for (const raw of match[2]!.split(",")) {
      const binding = raw.trim();
      if (!binding) continue;
      const typeOnly = !!match[1] || /^type\s+/.test(binding);
      const name = binding.replace(/^type\s+/, "").split(/\s+as\s+/).at(-1)!.trim();
      if (IDENT.test(name)) (typeOnly ? types : values).add(name);
    }
  }
  for (const match of code.matchAll(/\bexport\s+(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(function\*?|class|enum|const|let|var)\s+([^;{(=]+)/g)) {
    if (["const", "let", "var"].includes(match[1]!)) {
      // `export const A = 1, B = 2;` — names before each `=` at the top level of the declaration.
      const declaration = code.slice(match.index!).split(";")[0]!;
      for (const part of declaration.replace(/^export\s+(?:declare\s+)?(?:const|let|var)\s+/, "").split(/,(?![^({[]*[)}\]])/)) {
        const name = part.split(/[=:]/)[0]!.trim();
        if (IDENT.test(name)) values.add(name);
      }
    } else {
      const name = match[2]!.trim().split(/[\s<]/)[0]!;
      if (IDENT.test(name)) values.add(name);
    }
  }
  for (const match of code.matchAll(/\bexport\s+(?:declare\s+)?(interface|type)\s+([A-Za-z_$][\w$]*)/g)) types.add(match[2]!);
  if (/\bexport\s+default\b/.test(code)) values.add("default");
  return { values: sorted(values), types: sorted([...types].filter(name => !values.has(name))) };
}

type PackageJson = { name?: unknown; version?: unknown; exports?: unknown; type?: unknown };
const exists = async (path: string): Promise<boolean> => { try { return (await fs.stat(path)).isFile(); } catch { return false; } };
const readJson = async (path: string): Promise<PackageJson | undefined> => { try { return JSON.parse(await fs.readFile(path, "utf8")) as PackageJson; } catch { return undefined; } };

/** Nearest installed copy of `name`: the package that owns `from` itself, else `node_modules/<name>` walking up. */
async function locatePackage(name: string, from: string): Promise<{ root: string; manifest: PackageJson } | undefined> {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    const own = await readJson(join(dir, "package.json"));
    if (own?.name === name && own.exports != null) return { root: dir, manifest: own };
    const installed = await readJson(join(dir, "node_modules", name, "package.json"));
    if (installed?.name === name) return { root: join(dir, "node_modules", name), manifest: installed };
    if (dirname(dir) === dir) return undefined;
  }
}
const runNode = promisify(execFile);
const inside = (root: string, file: string): boolean => {
  const path = relative(root, file);
  return !!path && path !== ".." && !path.startsWith(".." + sep) && !isAbsolute(path);
};
const MODULE = /^(?:@[a-z0-9-]+\/)?[a-z0-9-]+(?:\/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*$/;
/** Node, rather than a second export-map implementation, selects the import target. */
async function importTarget(module: string, from: string, types = false): Promise<string | undefined> {
  try {
    const { stdout } = await runNode(process.execPath, ["--experimental-import-meta-resolve", ...(types ? ["--conditions=types"] : []), "--input-type=module", "-e",
      'process.stdout.write(JSON.stringify(import.meta.resolve(process.argv[1], process.argv[2])))', module, pathToFileURL(join(resolve(from), "surface-evidence.mjs")).href], { timeout: 5000, maxBuffer: 1024 * 1024 });
    const url: unknown = JSON.parse(stdout);
    return typeof url === "string" && url.startsWith("file:") ? fileURLToPath(url) : undefined;
  } catch { return undefined; }
}
/** Resolve symlinks before reading bytes or executing an installed CommonJS module. */
async function containedFile(root: string, file: string): Promise<string | undefined> {
  if (!inside(root, file)) return undefined;
  try {
    const actual = await fs.realpath(file);
    return inside(await fs.realpath(root), actual) && await exists(actual) ? actual : undefined;
  } catch { return undefined; }
}
/** Missing dist targets retain the historical source-only barrel inventory, not runtime proof. */
async function barrelFile(root: string, built: string, sourceFallback: boolean): Promise<{ file: string; source: boolean } | undefined> {
  const file = await containedFile(root, built);
  if (file) return { file, source: false };
  if (!sourceFallback) return undefined;
  // An existing escaped symlink is not a missing build and must never trigger fallback.
  try { await fs.lstat(built); return undefined; } catch { /* missing build */ }
  if (!inside(root, built)) return undefined;
  for (let parent = dirname(built); ; parent = dirname(parent)) {
    try {
      const actual = await fs.realpath(parent);
      if (actual !== root && !inside(root, actual)) return undefined;
      break;
    } catch { if (dirname(parent) === parent) return undefined; }
  }
  const source = /^dist\/(.+)\.js$/.exec(relative(root, built).split(sep).join("/"))?.[1];
  if (!source) return undefined;
  for (const extension of [".ts", ".tsx"]) {
    const file = await containedFile(root, resolve(root, "src", source + extension));
    if (file) return { file, source: true };
  }
  return undefined;
}
async function commonJs(file: string): Promise<boolean> {
  if (file.endsWith(".cjs")) return true;
  if (file.endsWith(".mjs")) return false;
  for (let dir = dirname(file); ; dir = dirname(dir)) {
    const manifest = await readJson(join(dir, "package.json"));
    if (manifest) return manifest.type !== "module";
    if (dirname(dir) === dir) return true;
  }
}
// The package can write every inherited descriptor and exit successfully. Only
// this wrapper's completed import may authenticate a result. Consume the private
// key before import and capture the operations used afterward; do not serialize
// result objects/arrays through package-controlled prototype hooks. This protects
// wrapper completion, not against native code or debugger access to its memory.
const COMMON_JS_WORKER = String.raw`
import { readFileSync, writeSync } from "node:fs";
import { createHmac } from "node:crypto";
const key = readFileSync(0);
const mac = createHmac("sha256", key);
key.fill(0);
const update = mac.update.bind(mac);
const digest = mac.digest.bind(mac);
const keys = Object.keys;
const encode = JSON.stringify;
const write = writeSync;
const namespace = await import(process.argv[1]);
const names = keys(namespace);
let body = "[";
for (let index = 0; index < names.length; index++) body += (index ? "," : "") + encode(names[index]);
body += "]";
update(body);
write(3, '{"body":' + encode(body) + ',"mac":' + encode(digest("hex")) + '}');
`;

async function commonJsExports(file: string): Promise<string[] | undefined> {
  const key = randomBytes(32);
  return await new Promise<string[] | undefined>(resolve => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", COMMON_JS_WORKER, pathToFileURL(file).href], { stdio: ["pipe", "pipe", "pipe", "pipe"] });
    const output: Buffer[] = [];
    let bytes = 0, failed = false, settled = false;
    const timer = setTimeout(refuse, 5000);
    function refuse(): void { failed = true; child.kill("SIGKILL"); }
    function finish(values?: string[]): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      key.fill(0);
      resolve(values);
    }
    const collect = (result: boolean) => (chunk: Buffer): void => {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) { refuse(); return; }
      if (result) output.push(chunk);
    };
    child.stdout!.on("data", collect(false));
    child.stderr!.on("data", collect(false));
    child.stdio[3]!.on("data", collect(true));
    child.stdio[3]!.on("error", refuse);
    child.stdin!.on("error", refuse);
    child.on("error", () => finish());
    child.on("close", (code, signal) => {
      if (failed || code !== 0 || signal) { finish(); return; }
      try {
        const frame: unknown = JSON.parse(Buffer.concat(output).toString("utf8"));
        if (!frame || typeof frame !== "object" || Array.isArray(frame) || Object.keys(frame).sort().join(",") !== "body,mac") { finish(); return; }
        const { body, mac } = frame as { body?: unknown; mac?: unknown };
        if (typeof body !== "string" || typeof mac !== "string" || !/^[a-f0-9]{64}$/.test(mac) || !timingSafeEqual(createHmac("sha256", key).update(body).digest(), Buffer.from(mac, "hex"))) { finish(); return; }
        const names: unknown = JSON.parse(body);
        finish(Array.isArray(names) && names.every(name => typeof name === "string") ? sorted(names.filter(name => IDENT.test(name))) : undefined);
      } catch { finish(); }
    });
    child.stdin!.end(key);
  });
}
async function validBuiltEsm(file: string): Promise<boolean> {
  try {
    await runNode(process.execPath, ["--check", file], { timeout: 5000, maxBuffer: 1024 * 1024 });
    return true;
  } catch { return false; }
}

// Optional host tooling, resolved from the consumer just like its declarations.
// This worker never emits files, supplies runtime values, or searches a package tree.
const DECLARATION_WORKER = String.raw`
import fs from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
const request = JSON.parse(process.argv[1]);
const inside = (root, file) => {
  const path = relative(root, file);
  return !!path && path !== ".." && !path.startsWith(".." + sep) && !isAbsolute(path);
};
const owns = (owner, file) => {
  try {
    const root = fs.realpathSync(owner.root);
    const manifest = JSON.parse(fs.readFileSync(join(root, "package.json"), "utf8"));
    return manifest.name === owner.name && manifest.version === owner.version && inside(root, fs.realpathSync(file));
  } catch { return false; }
};
const compilerUrl = import.meta.resolve("typescript", request.parent);
if (!owns(request.compiler, fileURLToPath(compilerUrl))) throw new Error("Consumer compiler provenance differs");
const imported = await import(compilerUrl);
const ts = imported.default ?? imported;
const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, skipLibCheck: true, types: [], noEmit: true };
const host = ts.createCompilerHost(options);
const entries = [];
for (const entry of request.modules) {
  const resolved = ts.resolveModuleName(entry.module, join(request.from, "surface-evidence.ts"), options, host).resolvedModule;
  if (!resolved || !/\.d\.[cm]?ts$/.test(resolved.resolvedFileName) || !resolved.packageId) continue;
  const owner = entry.owners.find(owner => owner.name === resolved.packageId.name && owner.version === resolved.packageId.version && owns(owner, resolved.resolvedFileName));
  if (owner) entries.push({ module: entry.module, file: resolved.resolvedFileName });
}
const program = ts.createProgram(entries.map(entry => entry.file), options, host);
const checker = program.getTypeChecker();
const result = [];
for (const entry of entries) {
  const source = program.getSourceFile(entry.file);
  if (!source?.isDeclarationFile || source.parseDiagnostics.length) continue;
  const assignment = source.statements.find(statement => ts.isExportAssignment(statement) && statement.isExportEquals);
  let symbol = checker.getSymbolAtLocation(assignment ? assignment.expression : source);
  if (!symbol) continue;
  if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  const types = checker.getExportsOfModule(symbol).filter(symbol => {
    const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    return !!(target.flags & ts.SymbolFlags.Type);
  }).map(symbol => symbol.name);
  result.push({ module: entry.module, types });
}
process.stdout.write(JSON.stringify(result));
`;

async function consumerDeclarationTypes(modules: readonly string[], from: string): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  const compiler = await locatePackage("typescript", from);
  if (!compiler || typeof compiler.manifest.version !== "string") return result;
  const entries = [];
  for (const module of modules) {
    const name = module.split("/").slice(0, module.startsWith("@") ? 2 : 1).join("/");
    const names = [name, "@types/" + name.replace(/^@/, "").replace("/", "__")];
    const owners = [];
    for (const name of names) {
      const located = await locatePackage(name, from);
      if (located && typeof located.manifest.version === "string") owners.push({ name, version: located.manifest.version, root: await fs.realpath(located.root) });
    }
    entries.push({ module, owners });
  }
  try {
    const request = { from: resolve(from), parent: pathToFileURL(join(resolve(from), "surface-evidence.mjs")).href, compiler: { name: "typescript", version: compiler.manifest.version, root: await fs.realpath(compiler.root) }, modules: entries };
    const { stdout } = await runNode(process.execPath, ["--experimental-import-meta-resolve", "--input-type=module", "-e", DECLARATION_WORKER, JSON.stringify(request)], { timeout: 5000, maxBuffer: 1024 * 1024 });
    const rows: unknown = JSON.parse(stdout);
    if (!Array.isArray(rows)) return result;
    for (const row of rows) {
      if (!row || typeof row !== "object" || !modules.includes(row.module) || result.has(row.module) || !Array.isArray(row.types) || !row.types.every((name: unknown) => typeof name === "string" && IDENT.test(name))) return new Map();
      result.set(row.module, sorted(row.types));
    }
  } catch { /* Missing, escaped, or unsupported declarations provide no type evidence. */ }
  return result;
}

/** Package modules (`<package>/<subpath>`) the given candidate or installed surface documents point at. */
export function surfacePackageModules(docs: readonly SurfaceAnyDocument[]): string[] {
  const modules: string[] = [];
  for (const doc of docs) {
    const entries = Object.values({ ...(doc as { sections?: object }).sections, ...(doc as { frames?: object }).frames }) as { impl?: { kind?: unknown; module?: unknown }; dependencies?: readonly { module?: unknown }[] }[];
    for (const entry of entries) {
      if (entry?.impl?.kind === "package" && typeof entry.impl.module === "string") modules.push(entry.impl.module);
      if (entry?.impl?.kind === "source" && Array.isArray(entry.dependencies)) for (const dependency of entry.dependencies) if (typeof dependency.module === "string") modules.push(dependency.module);
    }
  }
  return sorted(modules);
}

/**
 * Export inventory rows (SurfacePackageEvidence) for every package module the documents point at,
 * read from the installed package's own barrel. Missing packages or subpaths yield no row.
 * `from` is where installed packages are resolved from; it defaults to this Designer install.
 */
export async function readSurfacePackageEvidence(docs: readonly SurfaceAnyDocument[], options: { from?: string } = {}): Promise<SurfacePackageEvidence[]> {
  const from = options.from ?? dirname(fileURLToPath(import.meta.url));
  const rows: SurfacePackageEvidence[] = [];
  const needsDeclarations: string[] = [];
  for (const module of surfacePackageModules(docs)) {
    if (!MODULE.test(module)) continue;
    const parts = module.split("/"), scoped = module.startsWith("@");
    const name = parts.slice(0, scoped ? 2 : 1).join("/");
    const located = await locatePackage(name, from);
    if (!located || typeof located.manifest.version !== "string") continue;
    const built = await importTarget(module, from);
    const root = await fs.realpath(located.root);
    const selected = built && inside(located.root, built) ? resolve(root, relative(located.root, built)) : built;
    const barrel = selected && await barrelFile(root, selected, located.manifest.exports != null);
    if (!barrel || !barrel.source && !/\.[cm]?js$/.test(barrel.file)) continue;
    const { file } = barrel;
    const text = await fs.readFile(file, "utf8");
    const runtime = !barrel.source && await commonJs(file);
    let inventory: { values: string[]; types: string[] };
    if (runtime) {
      const values = await commonJsExports(file);
      if (!values) continue;
      inventory = { values, types: [] };
    } else {
      if (!barrel.source && !await validBuiltEsm(file)) continue;
      try { inventory = packageBarrelExports(text); } catch { continue; }
    }
    let types = inventory.types;
    // A built JS barrel carries no types; its declaration barrel does.
    const declared = await importTarget(module, from, true);
    const declaredPath = declared && inside(located.root, declared) ? resolve(root, relative(located.root, declared)) : declared;
    const declarationFile = declaredPath && /\.d\.[cm]?ts$/.test(declaredPath) && await containedFile(root, declaredPath);
    if (!barrel.source && declarationFile) {
      const declaration = packageBarrelExports(await fs.readFile(declarationFile, "utf8"));
      types = sorted([...declaration.types, ...declaration.values].filter(name => !inventory.values.includes(name)));
    }
    if (!barrel.source && !declarationFile) needsDeclarations.push(module);
    rows.push({ module, version: located.manifest.version, artifactSha256: sha256(text), values: inventory.values, types });
  }
  if (!needsDeclarations.length) return rows;
  const declarations = await consumerDeclarationTypes(needsDeclarations, from);
  return rows.map(row => ({ ...row, types: sorted([...row.types, ...(declarations.get(row.module) ?? [])].filter(name => !row.values.includes(name))) }));
}
