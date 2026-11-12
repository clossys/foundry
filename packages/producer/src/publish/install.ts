/**
 * `clossys publish --install --page <page id | page record.json>`: install the registry items a
 * consumer pinned for one page into a publishing substrate, bind its copy to Writer keys, and
 * render the bound page to static HTML outside the consumer root.
 *
 * A page id (`home` or `page.home`) is read from the consumer's own active Publisher page cell:
 * its frame, its sections, and its `## Copy` bullets. `- <key>: writer:<cell>` binds the copy
 * slot `<key>` (and `<cell>.<key>`) to the Writer key `<cell>.<key>`; `- <slot> = <key>:
 * writer:<cell>` binds the copy slot `<slot>` to `<cell>.<key>`. Keys may contain dots.
 *
 * Publisher owns install and bind (`@clossys/publisher/install`); this module supplies its
 * inputs (the consumer's Designer slot-model pins, its library through `libraryRecordSource`, its
 * compiled Writer copy), runs shadcn without a shell, and renders the result.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createRequire, isBuiltin } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { shadcnComponentsJsonText } from "@clossys/designer/shadcn-flavor";
import {
  installAndBind, isBlocking, needComponentSelection, PAGE_HOST_EXPORT, pageHostModule, relativeSpecifier, substrateDependencies,
  type BoundPage, type InstallFinding, type InstallPageRecord, type InstallPins, type InstallResult, type PageHostSelection, type ShadcnRunner,
} from "@clossys/publisher/install";
import { slotInstallInputs } from "../specimen/slot-install-inputs.js";
import { dependencyPart, treeDependencyParts } from "../server/specimen-tree.js";
import { hasSlotModel, readCandidate, readIa, readPin, readSlot } from "../records/slots.js";
import { slotPositions, validateCandidate, validateSlotDoc } from "../records/slot-model/index.js";
import { libraryRecordSource } from "../specimen/library-source.js";
import { readWriter } from "./site-source.js";
import { specimenRoots } from "./publish.js";
import { defaultInstallOut, INSTALL_MARKER } from "./install-out.js";

const MARKER = INSTALL_MARKER;
const requireHere = createRequire(import.meta.url);

export interface PublishInstallOptions {
  readonly root: string;
  /** A page id (`home`, `page.home`) read from the active Publisher cell, or a page record file (`{ id, frame, sections, bindings }`). */
  readonly page: string;
  /** Resolves a page record file path; defaults to the process cwd. */
  readonly cwd?: string;
  readonly out?: string;
  /** Canonical consumer roots; defaults to <root>/clossys. */
  readonly records?: readonly string[];
  readonly runner?: ShadcnRunner;
  /** Runs npm in the substrate (`["install", ...]`); never through a shell. */
  readonly npm?: ShadcnRunner;
  /** The consumer's component selection module (absolute, or relative to `cwd`); without it the page is a NEED. */
  readonly selection?: PageHostSelection;
}
export interface PublishInstallResult {
  readonly out: string;
  readonly substrate: string;
  readonly installed: InstallResult["installed"];
  readonly findings: readonly InstallFinding[];
  readonly page?: BoundPage;
  /** The rendered page, when every slot installed and bound. */
  readonly html?: string;
}

/** The shadcn CLI from this workspace, run with the current Node; arguments only, never a shell. */
export function shadcnRunner(env: NodeJS.ProcessEnv = process.env): ShadcnRunner {
  let bin: string;
  try { bin = requireHere.resolve("shadcn"); } catch { throw new Error("publish --install: the shadcn CLI is not installed in this workspace"); }
  return (args, { cwd }) => new Promise(done => {
    execFile(process.execPath, [bin, ...args], { cwd, env, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      done({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

/** npm, run with arguments only and never a shell. */
export function npmRunner(env: NodeJS.ProcessEnv = process.env): ShadcnRunner {
  const bin = process.platform === "win32" ? "npm.cmd" : "npm";
  return (args, { cwd }) => new Promise(done => {
    execFile(bin, [...args], { cwd, env, timeout: 600_000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      done({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

/**
 * The substrate's package.json carries no `"type": "module"`. Registry items are written for a
 * Next app, whose bundler honours `__esModule` on a default import of a CommonJS module; in a
 * `"type": "module"` package Vite 8 (Rolldown, like esbuild) applies Node interop instead, so
 * `import Image from "next/image"` yields the CommonJS exports object and React throws #130
 * ("element type is invalid ... got: object"). A substrate written with that field loses it.
 */
async function dropModuleType(file: string): Promise<void> {
  if (!existsSync(file)) return;
  const manifest = JSON.parse(await readFile(file, "utf8"));
  if (manifest.type !== "module") return;
  delete manifest.type;
  await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`);
}

/**
 * The publishing substrate: a minimal Vite + Tailwind v4 shadcn project, written once. Its
 * `main.tsx` mounts a generated page module (`clossys/pages/<id>.tsx`; `?page=<id>`, and
 * `?theme=dark` for the dark mode). Every installed item's npm dependencies are unioned into its
 * package.json and installed (see `ensureSubstrateDependencies`), so `npx vite` runs as is.
 */
export async function ensureSubstrate(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  // components.json is the Designer's shadcn flavor, from its one writer; an older substrate is brought to it.
  const flavor = shadcnComponentsJsonText({ css: "app.css" }), flavorPath = join(dir, "components.json");
  if (existsSync(flavorPath)) {
    if (await readFile(flavorPath, "utf8") !== flavor) await writeFile(flavorPath, flavor);
    await dropModuleType(join(dir, "package.json"));
    return;
  }
  const write = (name: string, value: unknown) => writeFile(join(dir, name), typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
  await write("package.json", {
    // No `"type": "module"`, as in a Next app: see `dropModuleType`.
    name: "publishing-substrate", private: true,
    scripts: { dev: "vite", build: "vite build" },
    dependencies: { react: "^19.2.0", "react-dom": "^19.2.0" },
    devDependencies: { vite: "^8.3.4", tailwindcss: "^4.3.3", "@tailwindcss/vite": "^4.3.3", "tw-animate-css": "^1.4.0" },
  });
  await write("tsconfig.json", { compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] }, jsx: "react-jsx", module: "esnext", moduleResolution: "bundler", target: "es2022", skipLibCheck: true } });
  // The base layer shadcn init writes, in plain variables so it holds before any theme item is installed.
  await write("app.css", [
    '@import "tailwindcss";', '@import "tw-animate-css";', "", "@custom-variant dark (&:is(.dark *));", "",
    "@layer base {", "  * { border-color: var(--border, currentColor); }",
    "  body { background-color: var(--background, Canvas); color: var(--foreground, CanvasText); }", "}", "",
  ].join("\n"));
  await write("vite.config.ts", [
    'import { fileURLToPath } from "node:url";',
    'import tailwindcss from "@tailwindcss/vite";',
    'import { defineConfig } from "vite";',
    "",
    "export default defineConfig({",
    "  plugins: [tailwindcss()],",
    '  oxc: { jsx: { runtime: "automatic", importSource: "react" } },',
    '  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },',
    "});",
    "",
  ].join("\n"));
  await write("index.html", '<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1" />\n    <title>Publishing substrate</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/main.tsx"></script>\n  </body>\n</html>\n');
  await write("main.tsx", [
    'import "./app.css";',
    'import { createElement } from "react";',
    'import { createRoot } from "react-dom/client";',
    "",
    'const pages = import.meta.glob("./clossys/pages/*.tsx", { eager: true }) as Record<string, { default: () => unknown }>;',
    "const params = new URLSearchParams(location.search);",
    'const id = params.get("page");',
    "const key = id ? `./clossys/pages/${id}.tsx` : Object.keys(pages).sort()[0];",
    'if (params.get("theme") === "dark") document.documentElement.classList.add("dark");',
    "const page = key ? pages[key] : undefined;",
    'const root = createRoot(document.getElementById("root")!);',
    'root.render(page ? createElement(page.default as any) : createElement("p", null, `No installed page ${id ?? ""}`));',
    "",
  ].join("\n"));
  // Last, so a substrate interrupted mid-write is written again.
  await writeFile(flavorPath, flavor);
}

/** The Publisher host module every installed page mounts inside (see `writeSubstrateHost`). */
export const SUBSTRATE_HOST_FILE = "clossys/publisher-host.tsx";

/**
 * Write the substrate's Publisher host: `PublisherHost` fed by the consumer's component selection
 * module and its Writer shell copy. `selection.module` is absolute or substrate-relative.
 */
export async function writeSubstrateHost(substrate: string, selection: PageHostSelection, copy: Readonly<Record<string, string>>): Promise<void> {
  const module = /\.(?:[cm]?[jt]sx?)$/.test(selection.module) && isAbsolute(selection.module)
    ? relative(substrate, selection.module).split(sep).join("/") : selection.module;
  await mkdir(join(substrate, "clossys"), { recursive: true });
  await writeFile(join(substrate, SUBSTRATE_HOST_FILE), await pageHostModule({ selection: { ...selection, module }, copy, file: SUBSTRATE_HOST_FILE }));
}

/**
 * The page module: imports every bound slot's installed entry and composes the page inside the
 * substrate's Publisher host. Shared by the static render and the dev server. `host: false` is for
 * Studio specimens only, which Studio mounts inside its own component selection provider.
 */
export function pageModule(page: BoundPage, substrate: string, options: { readonly host?: boolean } = {}): string {
  const host = options.host ?? true;
  const slots = [page.frame, ...page.sections, ...page.parts];
  const from = join(substrate, "clossys", "pages");
  const specifier = (file: string) => {
    const path = relative(from, join(substrate, file)).split(sep).join("/").replace(/\.[cm]?[jt]sx?$/, "");
    return path.startsWith(".") ? path : `./${path}`;
  };
  const table = Object.fromEntries(slots.map(slot => [slot.key, { id: slot.id, export: slot.entry.export, copyKeys: slot.copyKeys, props: slot.props, text: slot.text }]));
  // `<package>.<Export>` tree elements (specimen-tree.ts) import their package namespace once.
  const packages = [...new Set(slots.flatMap(slot => treeDependencyParts(slot.props)).map(name => dependencyPart(name)!.module))].sort();
  return [
    "// Generated by clossys publish --install. Rerun the install rather than editing this file.",
    'import { createElement, type ReactNode } from "react";',
    ...(host ? [`import { ${PAGE_HOST_EXPORT} } from ${JSON.stringify(relativeSpecifier("clossys/pages/page.tsx", SUBSTRATE_HOST_FILE))};`] : []),
    ...slots.map((slot, index) => `import * as m${index} from ${JSON.stringify(specifier(slot.entry.file))};`),
    ...packages.map((name, index) => `import * as p${index} from ${JSON.stringify(name)};`),
    "",
    `const packages: Record<string, Record<string, any>> = { ${packages.map((name, index) => `${JSON.stringify(name)}: p${index}`).join(", ")} };`,
    `const modules: Record<string, Record<string, any>> = { ${slots.map((slot, index) => `${JSON.stringify(slot.key)}: m${index}`).join(", ")} };`,
    `const slots: Record<string, { id: string; export?: string; copyKeys?: string; props: Record<string, unknown>; text: Record<string, string> }> = ${JSON.stringify(table, null, 2)};`,
    "",
    "/** `{ $element }` mounts another bound slot; `{ $component, props?, children? }` is an element of the slot's own module `mod`, or `<package>.<Export>` of a package it depends on. */",
    "function resolve(value: unknown, mod: Record<string, any>, key?: string): unknown {",
    "  if (Array.isArray(value)) return value.map((item, index) => resolve(item, mod, String(index)));",
    '  if (!value || typeof value !== "object") return value;',
    "  const node = value as Record<string, unknown>;",
    '  if (typeof node.$element === "string") return mount(node.$element, key !== undefined);',
    '  if (typeof node.$component === "string") return part(node, mod, key);',
    "  return Object.fromEntries(Object.entries(node).map(([name, item]) => [name, resolve(item, mod)]));",
    "}",
    "",
    "function part(node: Record<string, unknown>, mod: Record<string, any>, key?: string): ReactNode {",
    "  const name = node.$component as string, dot = name.lastIndexOf(\".\"), owner = !Object.hasOwn(mod, name) && dot > 0 ? packages[name.slice(0, dot)] : undefined;",
    "  const component = Object.hasOwn(mod, name) ? mod[name] : owner && Object.hasOwn(owner, name.slice(dot + 1)) ? owner[name.slice(dot + 1)] : undefined;",
    '  if (typeof component !== "function" && typeof component !== "object") throw new Error(`clossys page: the module exports no component ${name}`);',
    "  const props = (resolve(node.props ?? {}, mod) ?? {}) as Record<string, unknown>;",
    "  const children = node.children === undefined ? [] : (Array.isArray(node.children) ? node.children : [node.children]).map(child => resolve(child, mod));",
    "  return createElement(component, key === undefined ? props : { ...props, key }, ...children);",
    "}",
    "",
    "/** Each copy slot name in a copyKeys map (strings, arrays, objects) becomes its bound text; an unbound slot is empty. */",
    "function copyOf(map: unknown, text: Record<string, string>): unknown {",
    '  if (typeof map === "string") return Object.hasOwn(text, map) ? text[map] : "";',
    "  if (Array.isArray(map)) return map.map(item => copyOf(item, text));",
    '  if (map && typeof map === "object") return Object.fromEntries(Object.entries(map).map(([key, item]) => [key, copyOf(item, text)]));',
    "  return map;",
    "}",
    "",
    "function mount(name: string, keyed = false): ReactNode {",
    "  const slot = slots[name], mod = modules[name];",
    "  if (!slot || !mod) throw new Error(`clossys page: no bound slot ${name}`);",
    '  const component = slot.export ? mod[slot.export] : mod.default ?? Object.values(mod).find(value => typeof value === "function");',
    '  if (typeof component !== "function" && typeof component !== "object") throw new Error(`clossys page: ${slot.id} exports no component ${slot.export ?? ""}`);',
    "  const props = resolve(slot.props, mod) as Record<string, unknown>;",
    "  if (slot.copyKeys) {",
    "    // A dotted copyKeys name (`legalCopyKeys.terms`) is a path into the module's exports.",
    '    const map = slot.copyKeys.split(".").reduce<any>((value, key) => value == null ? undefined : value[key], mod);',
    "    if (!map || typeof map !== \"object\") throw new Error(`clossys page: ${slot.id} has no export ${slot.copyKeys}`);",
    "    props.copy = copyOf(map, slot.text);",
    "  }",
    "  return createElement(component, keyed ? { ...props, key: name } : props);",
    "}",
    "",
    `export const pageId = ${JSON.stringify(page.id)};`,
    host
      ? `export default function Page(): ReactNode { return createElement(${PAGE_HOST_EXPORT}, null, mount(${JSON.stringify(page.frame.key)})); }`
      : `export default function Page(): ReactNode { return mount(${JSON.stringify(page.frame.key)}); }`,
    "",
  ].join("\n");
}

/** Writer copy by key: compiled records, aliases to them, and a record's context when no alias names it. */
export async function writerCopy(root: string): Promise<Record<string, string>> {
  const writer = await readWriter(root);
  const copy: Record<string, string> = {};
  for (const record of writer.records) copy[record.id] = record.text;
  for (const [alias, id] of Object.entries(writer.aliases)) if (Object.hasOwn(copy, id)) copy[alias] = copy[id]!;
  for (const record of writer.records) if (typeof record.context === "string" && record.context && !Object.hasOwn(copy, record.context)) copy[record.context] = record.text;
  return copy;
}

/** The fields of a clossys.page/1 candidate install reads. `copy` maps copy slot to `<writer slot>#<key>`; `bindings` does per section instance key. */
export interface NativePageCandidate {
  readonly frame: string | null;
  readonly sections: readonly string[];
  readonly copy: Readonly<Record<string, string>>;
  readonly bindings?: Readonly<Record<string, { readonly copy?: Readonly<Record<string, string>> }>>;
}

/**
 * A Writer key ref (`<writer slot>#<key>`) to the Writer copy key it binds: the key itself (a
 * native Writer row), else the compiled `<writer cell>.<key>` id a legacy Writer store holds.
 * Without `writer` copy, the bare key.
 */
function writerKeyOf(ref: string, writer?: Readonly<Record<string, string>>): string {
  const hash = ref.indexOf("#"), cell = ref.slice(0, hash), key = ref.slice(hash + 1);
  if (!writer || Object.hasOwn(writer, key)) return key;
  return [ref, `${cell}.${key}`].find(id => Object.hasOwn(writer, id)) ?? key;
}

/** A page candidate's copy as install bindings: copy slot to Writer key, page-wide and per section instance. */
export function installCopy(page: Pick<NativePageCandidate, "copy" | "bindings">, writer?: Readonly<Record<string, string>>): Pick<InstallPageRecord, "copy" | "bindings"> {
  const keysOf = (copy: Readonly<Record<string, string>>) => Object.fromEntries(Object.entries(copy).map(([slot, ref]) => [slot, writerKeyOf(ref, writer)]));
  const bindings = Object.entries(page.bindings ?? {}).filter(([, binding]) => binding.copy);
  return { copy: keysOf(page.copy), ...(bindings.length ? { bindings: Object.fromEntries(bindings.map(([key, binding]) => [key, { copy: keysOf(binding.copy!) }])) } : {}) };
}

/**
 * The page record for a page id, read from the consumer's pinned Publisher page slot. Theme
 * slots (`themes.*`) the consumer pinned are included; the candidate's copy refs bind copy slots.
 */
export async function pageRecordFromCell(root: string, id: string, pins: InstallPins, writer?: Readonly<Record<string, string>>): Promise<InstallPageRecord> {
  const cellId = id.startsWith("page.") ? id : `page.${id}`;
  const consumer = join(root, "clossys");
  if (hasSlotModel(consumer) && readIa(consumer, "publisher")) {
    const ia = readIa(consumer, "publisher");
    const position = ia ? slotPositions("publisher", ia).get(cellId) : undefined;
    if (!position) throw new Error(`publish --install: Publisher has no page slot ${cellId} in ia.json`);
    const slot = readSlot(consumer, "publisher", cellId);
    if (validateSlotDoc(slot).length || slot.id !== cellId || slot.agent !== "publisher" || slot.kind !== "page"
      || slot.ia.l0 !== position.l0 || slot.ia.l1 !== position.l1 || slot.ia.l2 !== position.l2 || slot.ia.order !== position.order) {
      throw new Error(`publish --install: invalid Publisher page slot ${cellId}`);
    }
    const pin = readPin(consumer, "publisher", cellId);
    if (!pin) throw new Error(`publish --install: Publisher page slot ${cellId} has no valid pin`);
    const candidate = readCandidate(consumer, "publisher", cellId, pin.candidate);
    if (candidate.sha256 !== pin.sha256) throw new Error(`publish --install: Publisher page slot ${cellId} has pin hash drift`);
    if (validateCandidate(slot.kind, cellId, candidate.name, candidate.bytes).length) {
      throw new Error(`publish --install: invalid pinned Publisher page candidate ${cellId}`);
    }
    const page = JSON.parse(candidate.bytes) as NativePageCandidate;
    if (!page.frame) throw new Error(`publish --install: Publisher page slot ${cellId} names no installable frame`);
    const include = Object.keys(pins).filter(slot => slot.startsWith("themes.")).sort();
    return { id: cellId.slice("page.".length), frame: page.frame, sections: page.sections, ...(include.length ? { include } : {}), ...installCopy(page, writer) };
  }
  throw new Error("publish --install: the consumer has no Publisher slot model (clossys/agents/publisher/ia.json)");
}

const IMPORT = /\bfrom\s*["']([^"']+)["']|\bimport\s*\(?\s*["']([^"']+)["']/g;

/**
 * Packages the installed source files import by bare specifier. Registry dependencies shadcn
 * fetches itself (an upstream `button`) bring imports no pinned item lists; they count too.
 */
async function importedPackages(substrate: string): Promise<string[]> {
  const found = new Set<string>();
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (entry.name === "node_modules" || entry.name.startsWith(".") || (dir === substrate && entry.name === "clossys")) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { await walk(path); continue; }
      if (!/\.[cm]?[jt]sx?$/.test(entry.name)) continue;
      for (const match of (await readFile(path, "utf8")).matchAll(IMPORT)) {
        const specifier = match[1] ?? match[2]!;
        if (/^(\.|\/|@\/|~|node:|virtual:)/.test(specifier) || isBuiltin(specifier)) continue;
        const parts = specifier.split("/");
        found.add(specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!);
      }
    }
  }
  await walk(substrate);
  return [...found].sort();
}

/** Union every item's npm dependencies, and every package an installed file imports, into the substrate package.json; run `npm install` when any declared package is missing. */
export async function ensureSubstrateDependencies(substrate: string, items: Record<string, string>, npm: ShadcnRunner): Promise<InstallFinding | undefined> {
  const file = join(substrate, "package.json");
  const manifest = JSON.parse(await readFile(file, "utf8"));
  let wanted = items;
  const dependencies: Record<string, string> = { ...manifest.dependencies };
  for (const name of await importedPackages(substrate)) if (!Object.hasOwn(wanted, name)) wanted = { ...wanted, [name]: "latest" };
  let changed = false;
  for (const [name, range] of Object.entries(wanted)) if (!Object.hasOwn(dependencies, name) && !Object.hasOwn(manifest.devDependencies ?? {}, name)) { dependencies[name] = range; changed = true; }
  if (changed) await writeFile(file, `${JSON.stringify({ ...manifest, dependencies: Object.fromEntries(Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b))) }, null, 2)}\n`);
  const declared = [...Object.keys(dependencies), ...Object.keys(manifest.devDependencies ?? {})];
  const missing = declared.filter(name => !existsSync(join(substrate, "node_modules", ...name.split("/"), "package.json")));
  if (!missing.length) return undefined;
  const run = await npm(["install", "--no-audit", "--no-fund"], { cwd: substrate });
  if (run.code !== 0) return { code: "install-failed", detail: `npm install in the substrate exited ${run.code} (missing ${missing.join(", ")}): ${(run.stderr || run.stdout).trim().split("\n").slice(-3).join(" ")}` };
  return undefined;
}

/** Every node_modules folder above this package: where the host's `@clossys/*` imports resolve. */
function hostNodePaths(): string[] {
  const paths: string[] = [];
  for (let dir = dirname(requireHere.resolve("@clossys/publisher/install")); dirname(dir) !== dir; dir = dirname(dir)) {
    if (dir.endsWith(`${sep}node_modules`)) continue;
    if (existsSync(join(dir, "node_modules"))) paths.push(join(dir, "node_modules"));
  }
  return paths;
}

/** Write the page module, bundle it with esbuild and render it with this process's React. */
export async function renderBoundPage(page: BoundPage, substrate: string): Promise<string> {
  const esbuild = await import("esbuild");
  const file = join(substrate, "clossys", "pages", `${page.id}.tsx`);
  await mkdir(join(substrate, "clossys", "pages"), { recursive: true });
  await writeFile(file, pageModule(page, substrate));
  const result = await esbuild.build({
    entryPoints: [file], absWorkingDir: substrate, bundle: true, write: false, format: "esm", platform: "node", jsx: "automatic", logLevel: "silent",
    // The host imports Publisher and Designer; a substrate outside the workspace resolves them from here.
    nodePaths: hostNodePaths(),
    plugins: [{ name: "host-react", setup(build) { build.onResolve({ filter: /^react(-dom)?(\/.*)?$/ }, args => ({ path: requireHere.resolve(args.path), external: true })); } }],
  });
  const bundle = join(substrate, ".clossys", `render-${createHash("sha256").update(result.outputFiles[0]!.text).digest("hex").slice(0, 12)}.mjs`);
  await mkdir(join(substrate, ".clossys"), { recursive: true });
  await writeFile(bundle, result.outputFiles[0]!.text);
  const module = await import(pathToFileURL(bundle).href);
  const React = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const body = renderToStaticMarkup(React.createElement(module.default));
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${page.id}</title></head><body>${body}</body></html>\n`;
}

/** The consumer's pinned Designer elements, from its slot model (`clossys/agents/designer`). */
export function designerPins(root: string): InstallPins {
  const inputs = slotInstallInputs(join(root, "clossys"));
  if (!inputs) throw new Error("publish --install: the consumer has no Designer slot model (clossys/agents/designer/ia.json)");
  return inputs.pins;
}

/** A selection module path the caller named relative to `cwd` becomes absolute; a package specifier stays as is. */
export const selectionModule = (module: string, cwd = process.cwd()) => /\.(?:[cm]?[jt]sx?)$/.test(module) ? resolve(cwd, module) : module;

export async function publishInstall(options: PublishInstallOptions): Promise<PublishInstallResult> {
  const root = resolve(options.root);
  const pins = designerPins(root);
  const file = resolve(options.cwd ?? process.cwd(), options.page);
  const copy = await writerCopy(root);
  const page = /^(page\.)?[a-z0-9][a-z0-9-]*$/.test(options.page) && !existsSync(file)
    ? await pageRecordFromCell(root, options.page, pins, copy)
    : JSON.parse(await readFile(file, "utf8")) as InstallPageRecord;
  if (typeof page?.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(page.id)) throw new Error(`publish --install: ${options.page} needs a page id ([a-z0-9-])`);
  const out = resolve(options.out ?? defaultInstallOut(root, page.id));
  if (existsSync(out) && !existsSync(join(out, MARKER))) throw new Error(`publish: ${out} exists and was not written by clossys publish --install`);
  await mkdir(out, { recursive: true });
  await writeFile(join(out, MARKER), "clossys publish --install output\n");
  const substrate = join(out, "substrate");
  await ensureSubstrate(substrate);

  const source = libraryRecordSource({ roots: specimenRoots(root, options.records) });
  const result = await installAndBind({ page, pins, source, substrate, runner: options.runner ?? shadcnRunner(), copy });
  const findings: InstallFinding[] = [...result.findings];
  if (result.page && !options.selection) findings.push(needComponentSelection(page.id));
  if (result.page) {
    const failed = await ensureSubstrateDependencies(substrate, substrateDependencies(result.slots), options.npm ?? npmRunner());
    if (failed) findings.push(failed);
  }
  let html: string | undefined;
  if (result.page && options.selection && !findings.some(isBlocking)) {
    try {
      await writeSubstrateHost(substrate, { ...options.selection, module: selectionModule(options.selection.module, options.cwd) }, copy);
      const markup = await renderBoundPage(result.page, substrate);
      html = join(out, "site", page.id, "index.html");
      await mkdir(join(out, "site", page.id), { recursive: true });
      await writeFile(html, markup);
    } catch (error) {
      const errors = Array.isArray((error as { errors?: unknown })?.errors) ? (error as { errors: { text: string; location?: { file?: string } | null }[] }).errors : [];
      const reason = errors.length ? errors.map(row => `${row.text}${row.location?.file ? ` (${row.location.file})` : ""}`).join("; ") : error instanceof Error ? error.message.split("\n")[0] : String(error);
      findings.push({ code: "render-failed", detail: `${page.id}: the bound page did not render: ${reason}` });
    }
  }
  const report = { page: page.id, installed: result.installed, findings, ...(result.page ? { bound: result.page } : {}) };
  await writeFile(join(out, "install-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  return { out, substrate, installed: result.installed, findings, ...(result.page ? { page: result.page } : {}), ...(html ? { html } : {}) };
}

export function installSummary(result: PublishInstallResult): string {
  const page = result.page;
  const copySlots = page ? [page.frame, ...page.sections, ...page.parts].reduce((sum, slot) => sum + Object.keys(slot.copy).length, 0) : 0;
  return [
    `Installed: ${result.installed.length}`, ...result.installed.map(row => `  ${row.slot} ${row.id}@v${row.version} ${row.status}: ${row.files.join(", ")}`),
    ...(page ? [`Bound: ${page.id} (frame ${page.frame.id} + ${page.sections.length} sections + ${page.parts.length} parts, ${copySlots} copy slots bound)`] : []),
    `Findings: ${result.findings.filter(isBlocking).length}${result.findings.some(row => !isBlocking(row)) ? ` (+${result.findings.filter(row => !isBlocking(row)).length} info)` : ""}`,
    ...result.findings.map(row => `  ${isBlocking(row) ? "" : "info "}${row.code}${row.slot ? ` ${row.slot}` : ""}: ${row.detail}`),
    `Substrate: ${result.substrate}`,
    ...(result.html ? [`Page: ${result.html}`] : []),
    `Report: ${join(result.out, "install-report.json")}`,
    ...(installFailed(result) ? [`publish --install failed: ${result.findings.filter(isBlocking).length} blocking finding(s); no page was rendered`] : []),
  ].join("\n");
}

/** Whether the install stopped short of a rendered page (exit 1). */
export function installFailed(result: PublishInstallResult): boolean {
  return !result.html || result.findings.some(isBlocking);
}
