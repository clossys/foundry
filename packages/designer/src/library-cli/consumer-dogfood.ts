import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveStylesheetPackage, stylesheetPackageTarget } from "./stylesheet-import.js";
import { dogfoodCssImports } from "../catalog-core/dogfood-css.js";
import { dogfoodSourceModules, DOGFOOD_PACKAGE_NAME, runDogfood, type DogfoodInput } from "../catalog-core/dogfood.js";

/** Resolution contract, never a list of excluded source files or accepted findings. */
export interface ConsumerDogfoodContract {
  readonly version: 1;
  /** Exact module names, or prefixes ending in /. Targets resolve beside the contract. */
  readonly sources: Readonly<Record<string, string>>;
  /** Page component files that must lease the Frame header. No page is omitted from scanning. */
  readonly pages: readonly string[];
}
export function parseConsumerDogfoodContract(value: unknown): ConsumerDogfoodContract {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Consumer dogfood contract must be an object");
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join(",") !== "pages,sources,version" || row.version !== 1 || !row.sources || typeof row.sources !== "object" || Array.isArray(row.sources) || !Array.isArray(row.pages) || !row.pages.length || row.pages.some(page => typeof page !== "string" || !page.trim()) || new Set(row.pages).size !== row.pages.length) throw new Error("Invalid consumer dogfood contract; version, sources and nonempty unique pages required");
  for (const [module, target] of Object.entries(row.sources)) {
    if (!module.trim() || module.startsWith(".") || (module === "react-aria-components" || module.startsWith("react-aria-components/")) || module === DOGFOOD_PACKAGE_NAME || module.startsWith(`${DOGFOOD_PACKAGE_NAME}/`) || module.startsWith("next/") || typeof target !== "string" || !target.trim()) throw new Error("Source mappings require real project source; framework/library boundaries cannot be remapped");
  }
  return row as unknown as ConsumerDogfoodContract;
}
async function text(file: string): Promise<string> {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { if (!(await handle.stat()).isFile()) throw new Error("Dogfood source must be a regular file"); return new TextDecoder("utf-8", { fatal: true }).decode(await handle.readFile()); }
  finally { await handle.close(); }
}
/** Follow local and explicitly mapped project code, parse JSON as data, and scan CSS.
 * Package primitives remain public boundaries; arbitrary project modules never do. */
export async function consumerDogfoodSources(paths: readonly string[], contract: ConsumerDogfoodContract, base: string, cwd = process.cwd()) {
  contract = parseConsumerDogfoodContract(contract);
  const own = resolve(fileURLToPath(new URL("../../src", import.meta.url)));
  const visited = new Set<string>();
  const files = new Map<string, string>(), data: string[] = [], localModules: Record<string, string> = {}, sourceImports: Record<string, string> = {};
  const display = (file: string) => relative(cwd, file).split("\\").join("/");
  const pages = contract.pages.map(page => display(resolve(base, page)));
  async function target(base: string): Promise<string> {
    const bare = base.replace(/\.[cm]?jsx?$/, "");
    for (const path of [...new Set([base, ...[".tsx", ".ts", ".jsx", ".js", ".json", ".css"].map(extension => bare + extension), join(bare, "index.tsx"), join(bare, "index.ts")])]) {
      try { const info = await fs.lstat(path); if (info.isSymbolicLink()) throw new Error("Dogfood source symlink is not scanned"); if (info.isFile()) return path; }
      catch (error) { if (!["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error; }
    }
    throw new Error(`Unresolved project source: ${display(base)}`);
  }
  async function visit(file: string, packageRoot?: string): Promise<void> {
    const info = await fs.lstat(file);
    if (info.isSymbolicLink()) throw new Error("Dogfood source symlink is not scanned");
    if (info.isDirectory()) {
      for (const name of (await fs.readdir(file)).sort()) if (!["node_modules", ".git", ".next", "dist", "build", "coverage"].includes(name)) await visit(join(file, name));
      return;
    }
    if (!info.isFile() || !/\.(?:[cm]?[jt]sx?|css|json)$/.test(file) || /\.(?:test|spec|stories|check)\.[cm]?[jt]sx?$|\.d\.ts$/.test(file) || data.includes(file)) return;
    const scope = JSON.stringify([file, packageRoot]);
    if (visited.has(scope)) return;
    visited.add(scope);
    const content = await text(file);
    if (extname(file) === ".json") { JSON.parse(content); data.push(file); return; }
    files.set(file, content);
    const css = extname(file) === ".css";
    for (const module of css ? dogfoodCssImports(content) : dogfoodSourceModules(content)) {
      let local: string | undefined, nextPackageRoot: string | undefined;
      if (module.startsWith(".")) {
        local = await target(resolve(dirname(file), module));
        if (css && packageRoot) { await stylesheetPackageTarget(local, packageRoot); nextPackageRoot = packageRoot; }
      }
      else {
        const key = Object.keys(contract.sources).sort((a, b) => b.length - a.length).find(key => module === key || key.endsWith("/") && module.startsWith(key));
        if (key) local = await target(resolve(base, contract.sources[key]!, key.endsWith("/") ? module.slice(key.length) : ""));
        else if (module === `${DOGFOOD_PACKAGE_NAME}/studio`) local = await target(join(own, "studio/index.ts"));
        else if (module === `${DOGFOOD_PACKAGE_NAME}/studio/state`) local = await target(join(own, "studio/WholeStudioProvider.tsx"));
        else if (css || module.endsWith(".css")) {
          const resolved = await resolveStylesheetPackage(module, file);
          local = resolved.file; nextPackageRoot = resolved.root;
        }
      }
      if (!local) continue;
      if ((css || module.endsWith(".css")) && extname(local) !== ".css") throw new Error(`Stylesheet import resolved to non-CSS: ${module} -> ${display(local)}`);
      const owned = relative(own, local).split("\\").join("/");
      const primitive = /^(components|icons|charts|blocks|shell|frames)\//.exec(owned)?.[1];
      if (primitive) { localModules[`${display(file)}:${module}`] = `${DOGFOOD_PACKAGE_NAME}/${primitive}`; continue; }
      await visit(local, nextPackageRoot);
      if (files.has(local) && /\.[cm]?[jt]sx?$/.test(local)) sourceImports[`${display(file)}:${module}`] = display(local);
    }
  }
  if (!paths.length) throw new Error("Consumer dogfood requires source paths");
  for (const file of paths) await visit(resolve(cwd, file));
  for (const page of pages) if (![...files.keys()].some(file => display(file) === page)) throw new Error(`Page contract not reached from source roots: ${page}`);
  const pageChromeFiles = new Set(pages);
  for (let previous = -1; previous !== pageChromeFiles.size;) {
    previous = pageChromeFiles.size;
    for (const [edge, target] of Object.entries(sourceImports)) if ([...pageChromeFiles].some(page => edge.startsWith(page + ":"))) pageChromeFiles.add(target);
  }
  return { files: [...files].map(([file, content]) => ({ file: display(file), content })), localModules,
    consumerBoundary: { pages, sourceImports, pageChromeFiles: [...pageChromeFiles].sort() }, data: data.map(display).sort() };
}
/** No exception manifest, suppression comment or caller-selected visual boundary is accepted. */
export function runConsumerDogfood(input: Omit<DogfoodInput, "exceptions" | "consumerBoundary"> & { consumerBoundary: NonNullable<DogfoodInput["consumerBoundary"]> }) {
  for (const page of input.consumerBoundary.pages) if (!input.files.some(file => file.file === page)) throw new Error(`Unscanned page contract: ${page}`);
  if (!input.consumerBoundary.pages.length) throw new Error("At least one page contract is required");
  for (const target of Object.values(input.consumerBoundary.sourceImports)) if (!input.files.some(file => file.file === target)) throw new Error(`Unscanned source boundary: ${target}`);
  return { ...runDogfood({ ...input, exceptions: [] }), consumerBoundary: input.consumerBoundary };
}
