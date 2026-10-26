/**
 * Host-side export evidence for package-pointer Sections and Frames.
 *
 * The surface check joins a package fill to two independent sides: the catalog
 * candidate (descriptor, pin) and the installed package artifact. This module
 * reads the second side: for every package module the candidates point at, it
 * resolves the installed package, reads that package's own exported barrel
 * (the built `exports` target when present, else the source index the build
 * compiles from) and records its bytes and export names. It never consults the
 * catalog pin for the version: the installed package.json speaks for itself, so
 * a pin/install mismatch surfaces as the check's S4 finding instead of passing.
 */
import * as fs from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "../catalog-core/digest.js";
import type { SurfaceAnyDocument, SurfacePackageEvidence } from "../catalog-core/surface-types.js";

const IDENT = /^[A-Za-z_$][\w$]*$/;
const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);

/** Value and type export names of one ES module barrel. Star re-exports are refused: the barrel alone cannot enumerate them. */
export function packageBarrelExports(text: string): { values: string[]; types: string[] } {
  // Strip comments without touching string literals (barrel specifiers never contain comment markers).
  const code = text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
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

type PackageJson = { name?: unknown; version?: unknown; exports?: unknown };
const exists = async (path: string): Promise<boolean> => { try { return (await fs.stat(path)).isFile(); } catch { return false; } };
const readJson = async (path: string): Promise<PackageJson | undefined> => { try { return JSON.parse(await fs.readFile(path, "utf8")) as PackageJson; } catch { return undefined; } };

/** Nearest installed copy of `name`: the package that owns `from` itself, else `node_modules/<name>` walking up. */
async function locatePackage(name: string, from: string): Promise<{ root: string; manifest: PackageJson } | undefined> {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    const own = await readJson(join(dir, "package.json"));
    if (own?.name === name) return { root: dir, manifest: own };
    const installed = await readJson(join(dir, "node_modules", name, "package.json"));
    if (installed?.name === name) return { root: join(dir, "node_modules", name), manifest: installed };
    if (dirname(dir) === dir) return undefined;
  }
}
const target = (entry: unknown, condition: "import" | "types"): string | undefined => {
  if (typeof entry === "string") return condition === "import" ? entry : undefined;
  if (!entry || typeof entry !== "object") return undefined;
  const value = condition === "import" ? (entry as Record<string, unknown>).import ?? (entry as Record<string, unknown>).default : (entry as Record<string, unknown>).types;
  return typeof value === "string" ? value : undefined;
};
/** The built target when it exists, else the source module the build compiles to that target. */
async function barrelFile(root: string, built: string): Promise<string | undefined> {
  const path = resolve(root, built);
  if (await exists(path)) return path;
  const source = /^\.\/dist\/(.+)\.(?:js|d\.ts)$/.exec(built)?.[1];
  if (!source) return undefined;
  for (const extension of [".ts", ".tsx"]) if (await exists(resolve(root, "src", source + extension))) return resolve(root, "src", source + extension);
  return undefined;
}

/** Package modules (`<package>/<subpath>`) the given candidate or installed surface documents point at. */
export function surfacePackageModules(docs: readonly SurfaceAnyDocument[]): string[] {
  const modules: string[] = [];
  for (const doc of docs) {
    const entries = Object.values({ ...(doc as { sections?: object }).sections, ...(doc as { frames?: object }).frames }) as { impl?: { kind?: unknown; module?: unknown } }[];
    for (const entry of entries) if (entry?.impl?.kind === "package" && typeof entry.impl.module === "string") modules.push(entry.impl.module);
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
  for (const module of surfacePackageModules(docs)) {
    const parts = module.split("/"), scoped = module.startsWith("@");
    const name = parts.slice(0, scoped ? 2 : 1).join("/"), subpath = "./" + parts.slice(scoped ? 2 : 1).join("/");
    const located = await locatePackage(name, from);
    if (!located || typeof located.manifest.version !== "string" || !located.manifest.exports || typeof located.manifest.exports !== "object") continue;
    const entry = (located.manifest.exports as Record<string, unknown>)[subpath];
    const built = target(entry, "import");
    const file = built && await barrelFile(located.root, built);
    if (!file) continue;
    const text = await fs.readFile(file, "utf8");
    const inventory = packageBarrelExports(text);
    let types = inventory.types;
    // A built JS barrel carries no types; its declaration barrel does.
    const declared = target(entry, "types");
    if (/\.[cm]?js$/.test(file) && declared && await exists(resolve(located.root, declared))) {
      const declaration = packageBarrelExports(await fs.readFile(resolve(located.root, declared), "utf8"));
      types = sorted([...declaration.types, ...declaration.values].filter(name => !inventory.values.includes(name)));
    }
    rows.push({ module, version: located.manifest.version, artifactSha256: sha256(text), values: inventory.values, types });
  }
  return rows;
}
