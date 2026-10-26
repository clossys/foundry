import * as fs from "node:fs/promises";
import { createRequire } from "node:module";
import { extname, isAbsolute, join, relative, resolve } from "node:path";

/** A package CSS edge is data resolution, never a JavaScript module load. */
export async function stylesheetPackageTarget(file: string, root: string): Promise<string> {
  const inside = (path: string) => { const part = relative(root, path); return part !== ".." && !part.startsWith("../") && !isAbsolute(part); };
  if (!inside(file) || !inside(await fs.realpath(file))) throw new Error("Stylesheet package target escapes package");
  if (extname(file) !== ".css") throw new Error("Stylesheet import resolved to non-CSS");
  if (!(await fs.lstat(file)).isFile()) throw new Error("Stylesheet package target must be a regular file");
  return file;
}

/** Only CSS/style/default conditions are known here; runtime conditions are not guessed. */
function cssExport(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value === null) return undefined;
  if (!value || typeof value !== "object") throw new Error("Unresolved stylesheet export");
  if (Array.isArray(value)) {
    if (value.length !== 1) throw new Error("Ambiguous stylesheet export alternatives");
    return cssExport(value[0]);
  }
  const row = value as Record<string, unknown>;
  const style = ["style", "css"].filter(key => Object.hasOwn(row, key));
  if (style.length > 1) throw new Error("Ambiguous stylesheet export conditions");
  if (style.length) return cssExport(row[style[0]!]!);
  return Object.hasOwn(row, "default") ? cssExport(row.default) : undefined;
}

export async function resolveStylesheetPackage(module: string, importer: string): Promise<{ file: string; root: string }> {
  const parts = module.split("/"), count = module.startsWith("@") ? 2 : 1;
  if (parts.length < count || parts.some(part => !part || part === "." || part === ".." || /[\\%?#:]/.test(part))) throw new Error("Unsafe stylesheet package specifier");
  const name = parts.slice(0, count).join("/"), subpath = parts.slice(count).join("/");
  let root: string | undefined;
  for (const directory of createRequire(importer).resolve.paths(name) ?? []) {
    try { root = await fs.realpath(join(directory, name)); break; }
    catch (error) { if (!["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error; }
  }
  if (!root) throw new Error(`Unresolved stylesheet package: ${module}`);
  const manifest = JSON.parse(await fs.readFile(await stylesheetManifest(root), "utf8")) as Record<string, unknown>;
  let selected: string | undefined;
  if (Object.hasOwn(manifest, "exports")) {
    const exports = manifest.exports;
    if (exports && typeof exports === "object" && !Array.isArray(exports) && Object.keys(exports).some(key => key.startsWith("."))) {
      const row = exports as Record<string, unknown>;
      if (Object.keys(row).some(key => !key.startsWith("."))) throw new Error("Ambiguous stylesheet export map");
      const key = subpath ? `./${subpath}` : ".";
      if (Object.hasOwn(row, key)) selected = cssExport(row[key]);
      else {
        const patterns = Object.keys(row).filter(key => key.includes("*"));
        if (patterns.some(key => key.split("*").length !== 2)) throw new Error("Ambiguous stylesheet export pattern");
        const matches = patterns.map(pattern => {
          const [prefix, suffix] = pattern.split("*") as [string, string];
          return { pattern, prefix, suffix };
        }).filter(({ prefix, suffix }) => key.startsWith(prefix) && key.endsWith(suffix) && key.length >= prefix.length + suffix.length)
          .sort((a, b) => b.prefix.length - a.prefix.length || b.suffix.length - a.suffix.length);
        if (matches.length) {
          const { pattern, prefix, suffix } = matches[0]!;
          const replacement = key.slice(prefix.length, key.length - suffix.length);
          selected = cssExport(row[pattern])?.split("*").join(replacement);
        }
      }
    } else if (!subpath) selected = cssExport(exports);
  } else {
    const entry = subpath || manifest.style || manifest.main || "index.css";
    if (typeof entry !== "string") throw new Error("Unresolved stylesheet package entry");
    selected = entry.startsWith("./") ? entry : `./${entry}`;
  }
  if (!selected) throw new Error(`Unresolved stylesheet export: ${module}`);
  if (!selected.startsWith("./") || selected.slice(2).split("/").some(part => !part || part === "." || part === ".." || part === "node_modules" || /[\\%?#:*]/.test(part))) throw new Error("Unsafe stylesheet package target");
  return { file: await stylesheetPackageTarget(resolve(root, selected), root), root };
}
async function stylesheetManifest(root: string): Promise<string> {
  const manifest = join(root, "package.json");
  if ((await fs.lstat(manifest)).isSymbolicLink()) throw new Error("Stylesheet package manifest symlink is not scanned");
  return manifest;
}
