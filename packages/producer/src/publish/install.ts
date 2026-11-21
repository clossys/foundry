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
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire, isBuiltin } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { isModuleAbsent } from "../errors.js";
import { DESIGNER_SHADCN_UTILS, shadcnComponentsJsonText } from "@clossys/designer/shadcn-flavor";
import {
  installAndBind, isBlocking, needComponentSelection, PAGE_HOST_EXPORT, pageHostModule, relativeSpecifier, substrateDependencies,
  type BoundPage, type InstallFinding, type InstallPageRecord, type InstallPins, type InstallResult, type PageHostSelection, type ShadcnRunner,
} from "@clossys/publisher/install";
import { slotInstallInputs } from "../specimen/slot-install-inputs.js";
import { isHostPackage } from "../specimen/host-packages.js";
import { dependencyPart, treeDependencyParts } from "../specimen/specimen-tree.js";
import { firstComponentSource } from "@clossys/publisher/build";
import { hasSlotModel, readCandidate, readIa, readPin, readSlot, slotCandidateIssues, viewPlacedAt } from "../records/slots.js";
import { slotPositions, validateCandidate } from "../records/slot-model/index.js";
import { libraryRecordSource } from "../specimen/library-source.js";
import { readWriter } from "./site-source.js";
import { specimenRoots } from "./publish.js";
import { defaultInstallOut, INSTALL_MARKER } from "@clossys/publisher/build";

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

/** The shadcn CLI from this workspace, run with the current Node; arguments only, never a shell. `signal` stops a running call. */
export function shadcnRunner(env: NodeJS.ProcessEnv = process.env, signal?: AbortSignal): ShadcnRunner {
  let bin: string;
  try { bin = requireHere.resolve("shadcn"); } catch { throw new Error("publish --install: the shadcn CLI is not installed in this workspace"); }
  return (args, { cwd }) => new Promise(done => {
    execFile(process.execPath, [bin, ...args], { cwd, env, timeout: 120_000, maxBuffer: 8 * 1024 * 1024, ...(signal ? { signal } : {}) }, (error, stdout, stderr) => {
      done({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

/** npm, run with arguments only and never a shell. `signal` stops a running call. */
export function npmRunner(env: NodeJS.ProcessEnv = process.env, signal?: AbortSignal): ShadcnRunner {
  const bin = process.platform === "win32" ? "npm.cmd" : "npm";
  return (args, { cwd }) => new Promise(done => {
    execFile(bin, [...args], { cwd, env, timeout: 600_000, maxBuffer: 16 * 1024 * 1024, ...(signal ? { signal } : {}) }, (error, stdout, stderr) => {
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
 * The flavor's `utils` alias module (`lib/utils.ts`), as `shadcn init` writes it, and the `cn`
 * package it imports. Items import `cn` from `@/lib/utils` without listing it as a registry
 * dependency, so a substrate without it fails to build (`Could not load lib/utils`), or
 * resolves that import to whatever else an item put at `lib/utils`. A substrate written before
 * the module existed gains it.
 */
async function ensureFlavorUtils(dir: string): Promise<void> {
  const file = join(dir, DESIGNER_SHADCN_UTILS.path);
  if (!existsSync(file)) {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, DESIGNER_SHADCN_UTILS.content);
  }
  const manifestFile = join(dir, "package.json");
  if (!existsSync(manifestFile)) return;
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  const dependencies: Record<string, string> = { ...manifest.dependencies };
  const missing = Object.entries(DESIGNER_SHADCN_UTILS.dependencies).filter(([name]) => !Object.hasOwn(dependencies, name));
  if (!missing.length) return;
  for (const [name, range] of missing) dependencies[name] = range;
  await writeFile(manifestFile, `${JSON.stringify({ ...manifest, dependencies: Object.fromEntries(Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b))) }, null, 2)}\n`);
}

/**
 * The substrate has no Next server, so nothing serves `/_next/image`: `next/image` built with
 * Next's default image config rewrites every `src` to `/_next/image?url=...`, which a static
 * build answers with nothing (and which a specimen site's CSP, `img-src <its own build>/`,
 * refuses). Every substrate Vite config defines `process.env.__NEXT_IMAGE_OPTS`, the image config
 * a Next build bakes into `next/image`, as Next's own default with `unoptimized: true` (as
 * `images.unoptimized` in a Next config does), so an image keeps the URL its item gave it. Read
 * from the substrate's installed `next` at build time; without Next there is nothing to configure.
 * The Publisher's record specimens do the same (`@clossys/publisher` specimen build).
 * Only an absent `next` (MODULE_NOT_FOUND, isModuleAbsent) means no define; any other error is thrown.
 */
const NEXT_ABSENT_CATCH = 'if ((error as { code?: unknown } | null)?.code !== "MODULE_NOT_FOUND") throw error; return {};';
export const NEXT_IMAGE_VITE_DEFINE = [
  'import { createRequire } from "node:module";',
  "",
  "/** next/image without a Next server: Next's default image config, unoptimized (see NEXT_IMAGE_VITE_DEFINE). */",
  "function nextImageDefine(): Record<string, string> {",
  "  try {",
  '    const { imageConfigDefault } = createRequire(import.meta.url)("next/dist/shared/lib/image-config.js") as { imageConfigDefault?: object };',
  '    return imageConfigDefault ? { "process.env.__NEXT_IMAGE_OPTS": JSON.stringify({ ...imageConfigDefault, unoptimized: true }) } : {};',
  `  } catch (error) { ${NEXT_ABSENT_CATCH} }`,
  "}",
].join("\n");

/**
 * NEXT_IMAGE_VITE_DEFINE's define for the static per-route render (`renderBoundPage`), which
 * bundles next/image with esbuild rather than Vite: the same unoptimized image config, read from
 * the substrate's installed `next`, so the static HTML keeps each image's own URL as the client
 * bundle does. Without Next there is nothing to configure.
 */
export function nextImageDefine(substrate: string): Record<string, string> {
  try {
    const { imageConfigDefault } = createRequire(join(substrate, "package.json"))("next/dist/shared/lib/image-config.js") as { imageConfigDefault?: object };
    return imageConfigDefault ? { "process.env.__NEXT_IMAGE_OPTS": JSON.stringify({ ...imageConfigDefault, unoptimized: true }) } : {};
  } catch (error) { if (!isModuleAbsent(error)) throw error; return {}; }
}

/**
 * The substrate's `resolve.alias`, `here` being the expression for the substrate directory. The
 * flavor's utils alias (`@/lib/utils`, components.json `aliases.utils`) resolves to exactly the
 * module the flavor writes (DESIGNER_SHADCN_UTILS, `lib/utils.ts`), ahead of the `@` prefix
 * alias. Vite tries `.js` before `.ts`, so through `@` alone any `lib/utils.js` an item ships
 * shadows it: the @tailwindcss/typography sources (sections.legal-prose v1, sections.article v1,
 * sections.sectioned-document v1) install their CommonJS `utils.js` there, and every item that
 * imports `cn` from `@/lib/utils` in the same substrate threw "(0 , X.cn) is not a function".
 */
export function substrateViteAlias(here: string): string {
  const module = DESIGNER_SHADCN_UTILS.path;
  const specifier = `@/${module.replace(/\.[cm]?[jt]sx?$/, "")}`;
  const find = `/^${specifier.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}$/`;
  return `[{ find: ${find}, replacement: fileURLToPath(new URL(${JSON.stringify(`./${module}`)}, import.meta.url)) }, { find: "@", replacement: ${here} }]`;
}

/** The substrate's Vite config (`npx vite`, the specimen site's `vite build --base`). */
export const SUBSTRATE_VITE_CONFIG = [
  "// Generated by clossys publish --install. Rerun the install rather than editing this file.",
  'import { fileURLToPath } from "node:url";',
  'import tailwindcss from "@tailwindcss/vite";',
  'import { defineConfig } from "vite";',
  NEXT_IMAGE_VITE_DEFINE,
  "",
  "export default defineConfig({",
  "  plugins: [tailwindcss()],",
  "  define: nextImageDefine(),",
  '  oxc: { jsx: { runtime: "automatic", importSource: "react" } },',
  `  resolve: { alias: ${substrateViteAlias('fileURLToPath(new URL(".", import.meta.url))')} },`,
  "});",
  "",
].join("\n");

/**
 * The substrate Vite configs as written before NEXT_IMAGE_VITE_DEFINE, and with its earlier
 * catch-all (any require error read as no Next), so an installed substrate gains the current one.
 */
const LEGACY_SUBSTRATE_VITE_CONFIGS = [SUBSTRATE_VITE_CONFIG.replace(`catch (error) { ${NEXT_ABSENT_CATCH} }`, "catch { return {}; }"), [
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
].join("\n")];

/**
 * A substrate written before its Vite config defined the image config gains it. Only the config
 * this module writes is replaced: the routed site's (`SITE_VITE_CONFIG`, written before its build)
 * carries the same define, and any other config is left alone.
 */
async function ensureViteConfig(file: string): Promise<void> {
  const text = existsSync(file) ? await readFile(file, "utf8") : undefined;
  if (text === undefined || LEGACY_SUBSTRATE_VITE_CONFIGS.includes(text)) await writeFile(file, SUBSTRATE_VITE_CONFIG);
}

/**
 * The Tailwind plugin npm class-contract candidates style with (`prose`, check-ref-verbatim), at the
 * exact version the Designer's reference manifest records. The substrate's stylesheet loads it and its
 * package.json declares it; a substrate written before it gains both.
 */
export const SUBSTRATE_TYPOGRAPHY = Object.freeze({ name: "@tailwindcss/typography", version: "0.5.20", line: '@plugin "@tailwindcss/typography";' });

/**
 * `css` with the typography `@plugin` line inserted where Tailwind reads it and no @import is
 * disturbed: after the last top-level `@import` statement (a multi-line one ends at its `;`), since an
 * @import after any other statement is not resolved; with no @import, after a leading `@charset` (which
 * must stay first), else as the first line.
 */
function withTypographyPlugin(css: string): string {
  const lines = css.split("\n");
  let at = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^@import[\s"'(]/.test(lines[i]!)) continue;
    let end = i;
    while (end < lines.length - 1 && !lines[end]!.includes(";")) end += 1;
    at = end + 1;
    i = end;
  }
  if (at < 0) at = /^@charset\s/.test(lines[0] ?? "") ? 1 : 0;
  lines.splice(at, 0, SUBSTRATE_TYPOGRAPHY.line);
  return lines.join("\n");
}

async function ensureTypographyPlugin(dir: string): Promise<void> {
  const cssFile = join(dir, "app.css");
  if (existsSync(cssFile)) {
    const css = await readFile(cssFile, "utf8");
    if (!css.split("\n").includes(SUBSTRATE_TYPOGRAPHY.line)) await writeFile(cssFile, withTypographyPlugin(css));
  }
  const manifestFile = join(dir, "package.json");
  if (!existsSync(manifestFile)) return;
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  if (Object.hasOwn(manifest.dependencies ?? {}, SUBSTRATE_TYPOGRAPHY.name) || Object.hasOwn(manifest.devDependencies ?? {}, SUBSTRATE_TYPOGRAPHY.name)) return;
  const devDependencies: Record<string, string> = { ...manifest.devDependencies, [SUBSTRATE_TYPOGRAPHY.name]: SUBSTRATE_TYPOGRAPHY.version };
  await writeFile(manifestFile, `${JSON.stringify({ ...manifest, devDependencies: Object.fromEntries(Object.entries(devDependencies).sort(([a], [b]) => a.localeCompare(b))) }, null, 2)}\n`);
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
    await ensureFlavorUtils(dir);
    await ensureViteConfig(join(dir, "vite.config.ts"));
    await ensureTypographyPlugin(dir);
    return;
  }
  const write = (name: string, value: unknown) => writeFile(join(dir, name), typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
  await write("package.json", {
    // No `"type": "module"`, as in a Next app: see `dropModuleType`.
    name: "publishing-substrate", private: true,
    scripts: { dev: "vite", build: "vite build" },
    dependencies: { react: "^19.2.0", "react-dom": "^19.2.0" },
    devDependencies: { "@tailwindcss/typography": SUBSTRATE_TYPOGRAPHY.version, "@tailwindcss/vite": "^4.3.3", tailwindcss: "^4.3.3", "tw-animate-css": "^1.4.0", vite: "^8.3.4" },
  });
  await write("tsconfig.json", { compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] }, jsx: "react-jsx", module: "esnext", moduleResolution: "bundler", target: "es2022", skipLibCheck: true } });
  // The base layer shadcn init writes, in plain variables so it holds before any theme item is installed.
  await write("app.css", [
    '@import "tailwindcss";', '@import "tw-animate-css";', SUBSTRATE_TYPOGRAPHY.line, "", "@custom-variant dark (&:is(.dark *));", "",
    "@layer base {", "  * { border-color: var(--border, currentColor); }",
    "  body { background-color: var(--background, Canvas); color: var(--foreground, CanvasText); }", "}", "",
  ].join("\n"));
  await write("vite.config.ts", SUBSTRATE_VITE_CONFIG);
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
  await ensureFlavorUtils(dir);
  await ensureTypographyPlugin(dir);
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
 * The host-injected records a page module reads (foundry-build-0048 U20b): the generated records module (relative to
 * the substrate) and, per data-bound Designer slot id the page places, the port its records fill and the route
 * parameters its scope keys on. The module's `records.ports[port][key]` is that section's prop `port`, `key` being the
 * scope's route parameter values joined by `/` (`""` for workspace scope); a key the records lack is empty (`null` for
 * the one-record `slot` port, `[]` otherwise), so the section renders its own empty state.
 */
export interface PageModuleRecords { readonly module: string; readonly reads: Readonly<Record<string, { readonly port: string; readonly scope: readonly string[] }>> }

/**
 * The page module: imports every bound slot's installed entry and composes the page inside the
 * substrate's Publisher host. Shared by the static render and the dev server. `host: false` is for
 * Studio specimens only, which Studio mounts inside its own component selection provider. `hostFile`
 * names the host of the page's locale (a publication with more than one locale installs one per locale).
 */
export function pageModule(page: BoundPage, substrate: string, options: { readonly host?: boolean; readonly hostFile?: string; readonly records?: PageModuleRecords } = {}): string {
  const host = options.host ?? true;
  // Keyed by mount key: a data-bound section listed twice reads under each of its keys.
  const reads = Object.fromEntries([page.frame, ...page.sections, ...page.parts].flatMap(slot => options.records && Object.hasOwn(options.records.reads, slot.slot) ? [[slot.key, options.records.reads[slot.slot]!]] : []));
  const records = Object.keys(reads).length ? options.records : undefined;
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
    ...(host ? [`import { ${PAGE_HOST_EXPORT} } from ${JSON.stringify(relativeSpecifier("clossys/pages/page.tsx", options.hostFile ?? SUBSTRATE_HOST_FILE))};`] : []),
    ...(records ? [`import { records } from ${JSON.stringify(specifier(records.module))};`] : []),
    ...slots.map((slot, index) => `import * as m${index} from ${JSON.stringify(specifier(slot.entry.file))};`),
    ...packages.map((name, index) => `import * as p${index} from ${JSON.stringify(name)};`),
    "",
    `const packages: Record<string, Record<string, any>> = { ${packages.map((name, index) => `${JSON.stringify(name)}: p${index}`).join(", ")} };`,
    `const modules: Record<string, Record<string, any>> = { ${slots.map((slot, index) => `${JSON.stringify(slot.key)}: m${index}`).join(", ")} };`,
    `const slots: Record<string, { id: string; export?: string; copyKeys?: string; props: Record<string, unknown>; text: Record<string, string> }> = ${JSON.stringify(table, null, 2)};`,
    "",
    ...(records ? [
      "/** The data-bound sections: the port the host fills from the records, keyed by the route parameters of the section's scope. */",
      `const reads: Record<string, { port: string; scope: string[] }> = ${JSON.stringify(reads, null, 2)};`,
      "/** The route parameters of the render in progress: set by Page before it mounts, read while it mounts (synchronously). */",
      "let routeParams: Record<string, string> = {};",
      "",
      "/** A data-bound section's records: absent or unreadable records are empty, so the section renders its empty state. */",
      "function recordsOf(name: string): unknown {",
      "  const read = reads[name]!;",
      '  const port = (records.ports as Record<string, Record<string, unknown>>)[read.port] ?? {};',
      '  const key = read.scope.map(name => routeParams[name] ?? "").join("/");',
      '  return Object.hasOwn(port, key) ? port[key] : read.port === "slot" ? null : [];',
      "}",
      "",
    ] : []),
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
    "  const children = (node.children === undefined ? [] : (Array.isArray(node.children) ? node.children : [node.children]).map(child => resolve(child, mod))) as ReactNode[];",
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
    `  const component = slot.export ? mod[slot.export] : ${firstComponentSource("mod")};`,
    '  if (typeof component !== "function" && typeof component !== "object") throw new Error(`clossys page: ${slot.id} exports no component ${slot.export ?? ""}`);',
    "  const props = resolve(slot.props, mod) as Record<string, unknown>;",
    ...(records ? ["  if (Object.hasOwn(reads, name)) props[reads[name]!.port] = recordsOf(name);"] : []),
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
    ...(records ? [
      `export default function Page({ params }: { params?: Record<string, string> } = {}): ReactNode {`,
      "  routeParams = params ?? {};",
      host ? `  return createElement(${PAGE_HOST_EXPORT}, null, mount(${JSON.stringify(page.frame.key)}));` : `  return mount(${JSON.stringify(page.frame.key)});`,
      "}",
    ] : [host
      ? `export default function Page(): ReactNode { return createElement(${PAGE_HOST_EXPORT}, null, mount(${JSON.stringify(page.frame.key)})); }`
      : `export default function Page(): ReactNode { return mount(${JSON.stringify(page.frame.key)}); }`]),
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
  /** The Writer key (or `<writer slot>#<key>` ref) of the page's document title (page.assembled requires one). */
  readonly title?: string;
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

/** A page record with the Writer key of its document title: the `<title>` of its rendered HTML is that key's text. */
export type TitledPageRecord = InstallPageRecord & { readonly title?: string };

/**
 * The page record for a page id, read from the consumer's pinned Publisher page slot. Theme
 * slots (`themes.*`) the consumer pinned are included; the candidate's copy refs bind copy slots.
 */
export async function pageRecordFromCell(root: string, id: string, pins: InstallPins, writer?: Readonly<Record<string, string>>): Promise<TitledPageRecord> {
  const cellId = id.startsWith("page.") ? id : `page.${id}`;
  const consumer = join(root, "clossys");
  if (hasSlotModel(consumer) && readIa(consumer, "publisher")) {
    const ia = readIa(consumer, "publisher");
    const position = ia ? slotPositions("publisher", ia).get(cellId) : undefined;
    if (!position) throw new Error(`publish --install: Publisher has no page slot ${cellId} in ia.json`);
    const slot = readSlot(consumer, "publisher", cellId);
    if (!viewPlacedAt(slot, cellId, "publisher", position) || slot.kind !== "page") {
      throw new Error(`publish --install: invalid Publisher page slot ${cellId}`);
    }
    const pin = readPin(consumer, "publisher", cellId);
    if (!pin) throw new Error(`publish --install: Publisher page slot ${cellId} has no valid pin`);
    // The view: the page as published, never its clossys header; the file bytes are what the slot's rules judge.
    const candidate = readCandidate(consumer, "publisher", cellId, pin.candidate);
    if (candidate.sha256 !== pin.sha256) throw new Error(`publish --install: Publisher page slot ${cellId} has pin hash drift`);
    if (slotCandidateIssues(consumer, "publisher", cellId, candidate.name, candidate.raw).length) {
      throw new Error(`publish --install: invalid pinned Publisher page candidate ${cellId}`);
    }
    const page = JSON.parse(candidate.bytes) as NativePageCandidate;
    if (!page.frame) throw new Error(`publish --install: Publisher page slot ${cellId} names no installable frame`);
    const include = Object.keys(pins).filter(slot => slot.startsWith("themes.")).sort();
    const title = typeof page.title === "string" && page.title ? { title: page.title.includes("#") ? writerKeyOf(page.title, writer) : page.title } : {};
    return { id: cellId.slice("page.".length), frame: page.frame, sections: page.sections, ...(include.length ? { include } : {}), ...title, ...installCopy(page, writer) };
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
      // `clossys/` holds the generated pages and `dist/` the substrate's own bundled build output: neither is a source
      // that imports a package (a rebuild over minified `dist/` code would read its fragments as package names).
      if (entry.name === "node_modules" || entry.name.startsWith(".") || (dir === substrate && (entry.name === "clossys" || entry.name === "dist"))) continue;
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

/**
 * Union every item's npm dependencies, and every package an installed file imports, into the substrate package.json; run `npm install` when any declared package is missing.
 * Host packages (`@clossys/*`, host-packages.ts) are not on the npm registry: none is declared, and one an
 * earlier scan declared as `latest` is dropped, since it made every later `npm install` there fail (404).
 */
export async function ensureSubstrateDependencies(substrate: string, items: Record<string, string>, npm: ShadcnRunner): Promise<InstallFinding | undefined> {
  const file = join(substrate, "package.json");
  const manifest = JSON.parse(await readFile(file, "utf8"));
  let wanted = Object.fromEntries(Object.entries(items).filter(([name]) => !isHostPackage(name)));
  const dependencies: Record<string, string> = { ...manifest.dependencies };
  let changed = false;
  for (const [name, range] of Object.entries(dependencies)) if (isHostPackage(name) && range === "latest") { delete dependencies[name]; changed = true; }
  for (const name of await importedPackages(substrate)) if (!isHostPackage(name) && !Object.hasOwn(wanted, name)) wanted = { ...wanted, [name]: "latest" };
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

/** HTML text escaping for the document title. */
const escapeText = (text: string): string => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/**
 * Write the page module, bundle it with esbuild and render it with this process's React. `title` is the page's
 * Writer title text, the document `<title>`; without one the document has none (never the page id).
 *
 * The bundle imports the host React by its absolute path in this install, so it is a transient of the render: it is
 * removed once imported and never stays in the substrate, whose files a release copies and digests.
 */
export async function renderBoundPage(page: BoundPage, substrate: string, title?: string): Promise<string> {
  const esbuild = await import("esbuild");
  const file = join(substrate, "clossys", "pages", `${page.id}.tsx`);
  await mkdir(join(substrate, "clossys", "pages"), { recursive: true });
  await writeFile(file, pageModule(page, substrate));
  const result = await esbuild.build({
    entryPoints: [file], absWorkingDir: substrate, bundle: true, write: false, format: "esm", platform: "node", jsx: "automatic", logLevel: "silent",
    define: nextImageDefine(substrate),
    // The host imports Publisher and Designer; a substrate outside the workspace resolves them from here.
    nodePaths: hostNodePaths(),
    plugins: [{ name: "host-react", setup(build) { build.onResolve({ filter: /^react(-dom)?(\/.*)?$/ }, args => ({ path: requireHere.resolve(args.path), external: true })); } }],
    // A bundled CommonJS module (use-sync-external-store, under @tiptap/react) requires the external host React; an
    // ESM bundle has no `require` of its own, so esbuild's shim would throw "Dynamic require ... is not supported".
    banner: { js: 'import { createRequire as __clossysCreateRequire } from "node:module"; const require = __clossysCreateRequire(import.meta.url);' },
  });
  const bundle = join(substrate, ".clossys", `render-${createHash("sha256").update(result.outputFiles[0]!.text).digest("hex").slice(0, 12)}.mjs`);
  await mkdir(join(substrate, ".clossys"), { recursive: true });
  await writeFile(bundle, result.outputFiles[0]!.text);
  const module = await import(pathToFileURL(bundle).href).finally(() => rm(bundle, { force: true }));
  const React = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const body = renderToStaticMarkup(React.createElement(module.default));
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${title === undefined ? "" : `<title>${escapeText(title)}</title>`}</head><body>${body}</body></html>\n`;
}

/** The consumer's pinned Designer elements, from its slot model (`clossys/agents/designer`). */
export function designerPins(root: string): InstallPins {
  const inputs = slotInstallInputs(join(root, "clossys"));
  if (!inputs) throw new Error("publish --install: the consumer has no Designer slot model (clossys/agents/designer/ia.json)");
  return inputs.pins;
}

/** A selection module path the caller named relative to `cwd` becomes absolute; a package specifier stays as is. */
export const selectionModule = (module: string, cwd = process.cwd()) => /\.(?:[cm]?[jt]sx?)$/.test(module) ? resolve(cwd, module) : module;

/**
 * The document title of a page: the Writer text of its title key. A title key Writer does not hold is a blocking
 * `missing-copy-key`; a record with no title key renders no `<title>` and says so (never the page id).
 */
export function documentTitle(page: TitledPageRecord, copy: Readonly<Record<string, string>>): { text?: string; finding?: InstallFinding } {
  if (typeof page.title !== "string" || !page.title) return { finding: { code: "unbound-copy-slot", severity: "info", detail: `${page.id}: the page names no Writer title key, so the document has no title` } };
  // A `<writer slot>#<key>` ref (a page record read from a file) binds the same key a page cell's ref does.
  const key = page.title.includes("#") ? writerKeyOf(page.title, copy) : page.title;
  if (!Object.hasOwn(copy, key)) return { finding: { code: "missing-copy-key", detail: `${page.id}: Writer has no key ${key} (for the page title)` } };
  return { text: copy[key]! };
}

export async function publishInstall(options: PublishInstallOptions): Promise<PublishInstallResult> {
  const root = resolve(options.root);
  const pins = designerPins(root);
  const file = resolve(options.cwd ?? process.cwd(), options.page);
  const copy = await writerCopy(root);
  const page = /^(page\.)?[a-z0-9][a-z0-9-]*$/.test(options.page) && !existsSync(file)
    ? await pageRecordFromCell(root, options.page, pins, copy)
    : JSON.parse(await readFile(file, "utf8")) as TitledPageRecord;
  if (typeof page?.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(page.id)) throw new Error(`publish --install: ${options.page} needs a page id ([a-z0-9-])`);
  const out = resolve(options.out ?? defaultInstallOut(root, page.id));
  if (existsSync(out) && !existsSync(join(out, MARKER))) throw new Error(`publish: ${out} exists and was not written by clossys publish --install`);
  await mkdir(out, { recursive: true });
  await writeFile(join(out, MARKER), "clossys publish --install output\n");
  const substrate = join(out, "substrate");
  await ensureSubstrate(substrate);

  const source = libraryRecordSource({ roots: specimenRoots(root, options.records), slotStates: false });
  // The substrate under clossys-written output (`MARKER`): replaced files are removed.
  const result = await installAndBind({ page, pins, source, substrate, runner: options.runner ?? shadcnRunner(), copy, ownedSubstrate: true });
  const findings: InstallFinding[] = [...result.findings];
  if (result.page && !options.selection) findings.push(needComponentSelection(page.id));
  const title = documentTitle(page, copy);
  if (title.finding) findings.push(title.finding);
  if (result.page) {
    const failed = await ensureSubstrateDependencies(substrate, substrateDependencies(result.slots), options.npm ?? npmRunner());
    if (failed) findings.push(failed);
  }
  let html: string | undefined;
  if (result.page && options.selection && !findings.some(isBlocking)) {
    try {
      await writeSubstrateHost(substrate, { ...options.selection, module: selectionModule(options.selection.module, options.cwd) }, copy);
      const markup = await renderBoundPage(result.page, substrate, title.text);
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
