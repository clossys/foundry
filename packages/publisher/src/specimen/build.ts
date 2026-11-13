/**
 * Production build of one specimen: the element's payload bundled for the browser
 * (minified, `NODE_ENV=production`) and the stylesheet it needs, compiled by Tailwind from
 * the candidates the payload actually uses plus the shadcn theme mapping.
 *
 * Builds are content-addressed: the same inputs give the same hash and are built once.
 * `esbuild` and `tailwindcss` are loaded lazily from the preview workspace; a host may
 * pass its own `esbuild` module instead.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, extname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { SHADCN_THEME_INLINE } from "./theme.js";
import { SPECIMEN_CHROME_CSS } from "./chrome.js";
import { installedPath } from "./installed-path.js";
import type { SpecimenFile, SpecimenRecord, SpecimenRecordSource } from "./types.js";

/** Bumped when the renderer's output for the same record changes. */
export const SPECIMEN_RENDERER_VERSION = "specimen-6";

export interface SpecimenBuild {
  readonly hash: string;
  /** Present for visual records: the bundle mounting the element. */
  readonly js?: string;
  readonly css: string;
  /** The entry export the specimen mounts (see specimenExport). */
  readonly export?: string;
  /** Build problems; the page still renders and reports them. */
  readonly errors: readonly string[];
}

/** The slice of esbuild's API the builder uses. */
export interface SpecimenEsbuild {
  build(options: Record<string, unknown>): Promise<{ outputFiles?: { path: string; text: string }[]; errors: { text: string }[] }>;
}

export interface SpecimenBuilderOptions {
  /** Directory npm imports resolve from (the preview workspace). Defaults to the process cwd. */
  readonly workspace?: string;
  readonly esbuild?: SpecimenEsbuild;
  /** Cold builds (Tailwind compile + esbuild bundle) that run at once; the rest queue. Defaults to 2. */
  readonly coldBuilds?: number;
}

/** Cold builds a builder runs at once: each holds a Tailwind compile and an esbuild bundle. */
export const SPECIMEN_COLD_BUILDS = 2;

/** At most `limit` tasks run at once; the rest wait their turn in arrival order. */
function limiter(limit: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async task => {
    // A finishing task hands its place straight to the next waiter, so `active` never exceeds the limit.
    if (active < limit) active++;
    else await new Promise<void>(resolve => waiting.push(resolve));
    try { return await task(); } finally { const next = waiting.shift(); if (next) next(); else active--; }
  };
}

const publisherDir = dirname(fileURLToPath(import.meta.url));
const requireHere = createRequire(import.meta.url);
const CODE = /\.(?:[cm]?[jt]sx?)$/;
const ALIAS_UTILS = "lib/utils";
/** shadcn's `cn` helper, used when the element imports `@/lib/utils` without shipping one. */
const UTILS_SHIM = `import { clsx } from "clsx";\nimport { twMerge } from "tailwind-merge";\nexport function cn(...inputs) { return twMerge(clsx(inputs)); }\n`;

/** Mounts the element with its fixture props inside an error boundary that reports to the health reporter. */
const BOOTSTRAP = `import * as React from "react";
import { createRoot } from "react-dom/client";
import * as Element from "specimen-entry";
const report = (error, source) => { try { window.__clossysSpecimen && window.__clossysSpecimen.error(error, source); } catch {} };
const config = JSON.parse(document.getElementById("specimen-props").textContent || "{}");
// Function components and forwardRef/memo objects ($$typeof) mount by the same rule, at the root and in fixture trees.
const isComponent = value => typeof value === "function" || (!!value && typeof value === "object" && "$$typeof" in value);
const pick = () => {
  const name = config.export || "default";
  if (isComponent(Element[name])) return Element[name];
  report(new Error("payload has no component export " + name), "build");
};
class Boundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { report(error, "render"); }
  render() {
    if (!this.state.error) return this.props.children;
    return React.createElement("div", { "data-specimen-error": "", role: "alert", className: "specimen-error" }, "This element did not render: " + (this.state.error && this.state.error.message || String(this.state.error)));
  }
}
// A fixture element tree: { $component, props?, children? } names another export of this payload.
const tree = (value, key) => {
  if (Array.isArray(value)) return value.map((item, index) => tree(item, String(index)));
  if (!value || typeof value !== "object") return value;
  if (typeof value.$component === "string") {
    const name = value.$component;
    const part = Object.prototype.hasOwnProperty.call(Element, name) ? Element[name] : undefined;
    if (!isComponent(part)) throw new Error("payload has no component export " + name);
    const props = tree(value.props || {});
    const children = value.children === undefined ? [] : Array.isArray(value.children) ? value.children.map(item => tree(item)) : [tree(value.children)];
    return React.createElement(part, key === undefined ? props : { ...props, key }, ...children);
  }
  return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, tree(item)]));
};
const Component = pick();
const Mount = () => React.createElement(Component, tree(config.props || {}));
const root = createRoot(document.getElementById("specimen-root"), { onCaughtError() {}, onRecoverableError(error) { report(error, "recoverable"); } });
if (Component) root.render(React.createElement(Boundary, null, React.createElement(Mount)));
`;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const stripExt = (path: string) => path.replace(/\.(?:[cm]?[jt]sx?)$/, "");

/**
 * The payload file the specimen mounts: the preview's entry, else the item's outermost surface.
 * A block's `registry:page` composes its `registry:component` parts (sidebar-07's page wraps
 * AppSidebar in SidebarProvider), so a page wins over a block, and a block over a part.
 */
export function specimenEntry(record: SpecimenRecord): SpecimenFile | undefined {
  const files = record.payload.files.filter(file => CODE.test(file.path));
  if (record.preview.entry) return files.find(file => file.path === record.preview.entry);
  for (const type of ["registry:page", "registry:block"]) {
    const found = files.find(file => file.type === type);
    if (found) return found;
  }
  return files.find(file => /registry:(?:ui|component|block|page)/.test(file.type ?? "")) ?? files[0];
}

/** Value export names of a module source, in source order; `default` when it has a default export. */
function exportNames(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
  const found: [number, string][] = [];
  for (const match of code.matchAll(/\bexport\s+default\b/g)) found.push([match.index!, "default"]);
  for (const match of code.matchAll(/\bexport\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)|\bexport\s+(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) found.push([match.index!, (match[1] ?? match[2])!]);
  for (const match of code.matchAll(/\bexport\s+(type\s+)?\{([^}]*)\}/g)) {
    if (match[1]) continue;
    for (const raw of match[2]!.split(",")) {
      const spec = raw.trim();
      if (!spec || spec.startsWith("type ")) continue;
      found.push([match.index!, spec.split(/\s+as\s+/).at(-1)!.trim()]);
    }
  }
  return [...new Set(found.sort((a, b) => a[0] - b[0]).map(([, name]) => name))];
}

const pascal = (value: string) => value.replace(/\.[^.]+$/, "").split(/[^A-Za-z0-9]+/).filter(Boolean).map(part => part[0]!.toUpperCase() + part.slice(1)).join("");

/**
 * The entry export a specimen mounts, the same rule for every component: the preview's named
 * export, else the default export, else the export named after the element or its entry file
 * (`scroll-area` -> `ScrollArea`, `breadcrumb.tsx` -> `Breadcrumb`), else the first component
 * (capitalised) export in source order — shadcn modules list the root part first.
 */
export function specimenExport(record: SpecimenRecord, entry: SpecimenFile | undefined = specimenEntry(record)): string | undefined {
  if (record.preview.export) return record.preview.export;
  if (!entry) return undefined;
  const names = exportNames(entry.content);
  if (names.includes("default")) return "default";
  for (const wanted of [pascal(record.id.split("/").at(-1)!), pascal(basename(entry.path))]) if (wanted && names.includes(wanted)) return wanted;
  return names.find(name => /^[A-Z]/.test(name));
}

/** Candidate class names in the given sources: Tailwind's own scanner, else a plain split. */
async function candidatesOf(sources: readonly { content: string; extension: string }[]): Promise<string[]> {
  try {
    const oxide = await import("@tailwindcss/oxide" as string) as { Scanner: new (options: object) => { scanFiles(files: { content: string; extension: string }[]): string[] } };
    return new oxide.Scanner({}).scanFiles([...sources]);
  } catch {
    return [...new Set(sources.flatMap(source => source.content.split(/[\s"'`{}();,<>]+/)).filter(Boolean))];
  }
}

function resolveFrom(id: string, workspace: string): string {
  for (const base of [workspace, publisherDir]) {
    try { return createRequire(join(base, "noop.js")).resolve(id); } catch { /* next base */ }
  }
  return requireHere.resolve(id);
}

/**
 * The layers the app stylesheet (designer-ui `index.css`) imports after Tailwind: tw-animate's
 * enter/exit utilities and shadcn's own layer (its `data-open`, `data-selected`,
 * `data-horizontal`, ... variants). Each is included when the workspace has it.
 */
const APP_LAYERS = ["tw-animate-css", "shadcn/tailwind.css"];

/** A stylesheet id as Tailwind resolves it: a file export, else the package's `style` export condition. */
function resolveStyle(id: string, workspace: string): string {
  try { return resolveFrom(id, workspace); } catch (error) {
    if (id.split("/").length !== (id.startsWith("@") ? 2 : 1)) throw error;
    for (const base of [workspace, publisherDir]) {
      for (const dir of createRequire(join(base, "noop.js")).resolve.paths(id) ?? []) {
        const manifest = join(dir, id, "package.json");
        if (!existsSync(manifest)) continue;
        const exported = (JSON.parse(readFileSync(manifest, "utf8")) as { exports?: { ".": { style?: unknown } }; style?: unknown });
        const style = exported.exports?.["."]?.style ?? exported.style;
        if (typeof style === "string") return join(dir, id, style);
      }
    }
    throw error;
  }
}

function resolvable(id: string, workspace: string): boolean {
  try { resolveStyle(id, workspace); return true; } catch { return false; }
}

/** Per workspace: the Tailwind entry and every stylesheet it loads, resolved and read once. */
const tailwindInputs = new Map<string, { entry: string; sheets: Map<string, Promise<{ path: string; base: string; content: string }>> }>();
function tailwindInputsOf(workspace: string) {
  let inputs = tailwindInputs.get(workspace);
  if (!inputs) {
    const entry = [
      "@layer theme, base, components, utilities;",
      '@import "tailwindcss/theme.css" layer(theme);',
      '@import "tailwindcss/preflight.css" layer(base);',
      '@import "tailwindcss/utilities.css" layer(utilities);',
      // The app build imports shadcn's layer; without it a React Aria `data-orientation` never meets `data-horizontal:`.
      ...APP_LAYERS.filter(id => resolvable(id, workspace)).map(id => `@import "${id}";`),
      SHADCN_THEME_INLINE,
    ].join("\n");
    inputs = { entry, sheets: new Map() };
    tailwindInputs.set(workspace, inputs);
  }
  return inputs;
}

/** `compiledCss`: one builder's stylesheets by workspace, entry and candidate set, so the same inputs compile once. */
async function compileCss(sources: readonly { content: string; extension: string }[], workspace: string, compiledCss: Map<string, Promise<string>>): Promise<string> {
  const inputs = tailwindInputsOf(workspace);
  const candidates = [...new Set(await candidatesOf(sources))].sort();
  const key = sha256(JSON.stringify([workspace, inputs.entry, candidates]));
  let css = compiledCss.get(key);
  if (!css) {
    // A Tailwind compiler accumulates every candidate it was ever given, so one is never shared
    // between specimens; what is shared is the parsed inputs (entry and stylesheet reads) and the output.
    css = (async () => {
      const tailwind = await import("tailwindcss") as { compile: (css: string, options: Record<string, unknown>) => Promise<{ build(candidates: string[]): string }> };
      const compiled = await tailwind.compile(inputs.entry, {
        base: workspace,
        loadStylesheet: (id: string) => {
          let sheet = inputs.sheets.get(id);
          if (!sheet) {
            sheet = (async () => { const path = resolveStyle(id, workspace); return { path, base: dirname(path), content: await readFile(path, "utf8") }; })();
            inputs.sheets.set(id, sheet);
            sheet.catch(() => inputs.sheets.delete(id));
          }
          return sheet;
        },
      });
      return `${compiled.build(candidates)}\n${SPECIMEN_CHROME_CSS}`;
    })();
    compiledCss.set(key, css);
    css.catch(() => compiledCss.delete(key));
  }
  return css;
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** The unnamespaced shadcn registry dependencies an item declares (`registryDependencies` of its registry item). */
function registryDependenciesOf(record: SpecimenRecord): string[] {
  try {
    const item = JSON.parse(record.payload.raw) as unknown;
    return isRecord(item) && Array.isArray(item.registryDependencies) ? item.registryDependencies.filter((name): name is string => typeof name === "string") : [];
  } catch { return []; }
}

interface Closure {
  readonly files: Map<string, string>;
  /** `@/` alias (no extension) -> the file key it names, by the install mapping (installed-path.ts). */
  readonly aliases: Map<string, string>;
}

/**
 * Files the element imports through the `@/` alias. The record's own files keep their payload
 * paths and answer the alias of their install path; any other alias resolves through the source
 * to the item that installs it (the consumer's pinned candidate), whose files join the bundle at
 * their install paths, exactly where the real app build has them. A source without `alias`
 * falls back to a sibling record of the alias's last segment.
 */
async function closure(record: SpecimenRecord, source: SpecimenRecordSource | undefined, errors: string[]): Promise<Closure> {
  const files = new Map<string, string>(), aliases = new Map<string, string>(), dependencies = new Set<string>();
  const addItem = (item: SpecimenRecord, own: boolean): string[] => {
    for (const name of registryDependenciesOf(item)) dependencies.add(name);
    const added: string[] = [];
    for (const file of item.payload.files) {
      const installed = installedPath(file);
      const key = own || !installed ? posix.normalize(file.path) : installed;
      if (!own && !CODE.test(key)) continue;
      if (!files.has(key)) { files.set(key, file.content); added.push(key); }
      if (installed && CODE.test(installed) && !aliases.has(stripExt(installed))) aliases.set(stripExt(installed), key);
    }
    return added;
  };
  const pending = addItem(record, true).filter(path => CODE.test(path));
  const seen = new Set<string>([record.id]);
  while (pending.length) {
    const path = pending.pop()!;
    for (const match of files.get(path)!.matchAll(/from\s+["']@\/([^"']+)["']|import\s+["']@\/([^"']+)["']/g)) {
      const alias = (match[1] ?? match[2])!;
      if (aliasTarget({ files, aliases }, alias)) continue;
      if (source?.alias) {
        if (alias === ALIAS_UTILS || seen.has(`@/${alias}`)) continue;
        seen.add(`@/${alias}`);
        let item: SpecimenRecord | undefined;
        try { item = await source.alias(alias, { registryDependencies: [...dependencies].sort() }); }
        catch (error) { errors.push(`import @/${alias}: ${error instanceof Error ? error.message : String(error)}`); continue; }
        if (!item) { errors.push(`import @/${alias}: no pinned item installs it`); continue; }
        pending.push(...addItem(item, false));
        if (!aliasTarget({ files, aliases }, alias)) errors.push(`import @/${alias}: ${item.id} does not install it`);
        continue;
      }
      if (alias === ALIAS_UTILS) continue;
      const name = alias.split("/").pop()!;
      if (!source || seen.has(name)) continue;
      seen.add(name);
      const sibling = await source.read(name).catch(() => undefined);
      if (!sibling) { errors.push(`import @/${alias}: no file in the payload and no sibling record ${name}`); continue; }
      for (const file of sibling.payload.files) {
        const key = posix.normalize(file.path);
        // The sibling's files answer the alias of their install path, as the record's own do.
        const installed = installedPath(file);
        if (installed && CODE.test(installed) && !aliases.has(stripExt(installed))) aliases.set(stripExt(installed), key);
        if (files.has(key)) continue;
        files.set(key, file.content);
        if (CODE.test(key)) pending.push(key);
      }
    }
  }
  return { files, aliases };
}

function aliasTarget({ files, aliases }: Closure, alias: string): string | undefined {
  if (alias.startsWith("/") || alias.split("/").some(part => part === ".." || part === ".")) return undefined;
  const mapped = aliases.get(stripExt(alias)) ?? aliases.get(`${stripExt(alias)}/index`);
  if (mapped) return mapped;
  const paths = [...files.keys()].filter(path => CODE.test(path));
  const targets = paths.filter(path => stripExt(path) === alias || stripExt(path).endsWith(`/${alias}`) || stripExt(path) === `${alias}/index`);
  return targets.length === 1 ? targets[0] : undefined;
}

function relativeTarget(files: ReadonlyMap<string, string>, importer: string, specifier: string): string | undefined {
  const base = posix.normalize(posix.join(posix.dirname(importer), specifier));
  return [base, ...[".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts"].map(ext => base + ext)].find(path => files.has(path));
}

const loaderOf = (path: string) => ({ ".tsx": "tsx", ".ts": "ts", ".jsx": "jsx", ".js": "js", ".mjs": "js", ".cjs": "js", ".css": "css" } as Record<string, string>)[extname(path)] ?? "tsx";

/**
 * A specimen page has no Next server: `next/image` would request `/_next/image`, which nothing
 * serves. When the preview workspace has Next, its default image config is built in unoptimized,
 * so images load from their own URLs. Without Next there is nothing to configure.
 */
function nextImageDefine(workspace: string): Record<string, string> {
  for (const base of [workspace, publisherDir]) {
    try {
      const { imageConfigDefault } = createRequire(join(base, "noop.js"))("next/dist/shared/lib/image-config.js") as { imageConfigDefault?: object };
      if (imageConfigDefault) return { "process.env.__NEXT_IMAGE_OPTS": JSON.stringify({ ...imageConfigDefault, unoptimized: true }) };
    } catch { /* no next here */ }
  }
  return {};
}

async function bundle(esbuild: SpecimenEsbuild, graph: Closure, entry: string, workspace: string): Promise<{ js?: string; css: string; errors: string[] }> {
  const { files } = graph;
  const plugin = {
    name: "specimen-records",
    setup(build: any) {
      build.onResolve({ filter: /^specimen-entry$/ }, () => ({ path: entry, namespace: "specimen" }));
      build.onResolve({ filter: /^@\//, namespace: "specimen" }, (args: any) => {
        const alias = args.path.slice(2);
        const target = aliasTarget(graph, alias);
        if (target) return { path: target, namespace: "specimen" };
        if (alias === ALIAS_UTILS) return { path: "@/lib/utils", namespace: "specimen-utils" };
        return { errors: [{ text: `unresolved element import ${args.path}` }] };
      });
      build.onResolve({ filter: /^\.\.?\//, namespace: "specimen" }, (args: any) => {
        const target = relativeTarget(files, args.importer, args.path);
        return target ? { path: target, namespace: "specimen" } : { errors: [{ text: `unresolved relative import ${args.path} from ${args.importer}` }] };
      });
      // npm imports resolve from the preview workspace, then from this package's own install.
      build.onResolve({ filter: /^[^./]/ }, async (args: any) => {
        const virtual = args.namespace === "specimen" || args.namespace === "specimen-utils";
        const bootstrap = args.importer === join(workspace, "specimen-bootstrap.js");
        if (args.pluginData?.specimenFallback || args.path.startsWith("@/") || (!virtual && !bootstrap)) return undefined;
        for (const resolveDir of [workspace, publisherDir]) {
          const result = await build.resolve(args.path, { kind: args.kind, resolveDir, pluginData: { specimenFallback: true } });
          if (!result.errors.length) return { path: result.path, external: result.external, sideEffects: result.sideEffects };
        }
        return { errors: [{ text: `cannot resolve ${args.path} from the preview workspace` }] };
      });
      build.onLoad({ filter: /.*/, namespace: "specimen" }, (args: any) => ({ contents: files.get(args.path)!, loader: loaderOf(args.path), resolveDir: workspace }));
      build.onLoad({ filter: /.*/, namespace: "specimen-utils" }, () => ({ contents: UTILS_SHIM, loader: "js", resolveDir: workspace }));
    },
  };
  try {
    const result = await esbuild.build({
      stdin: { contents: BOOTSTRAP, loader: "js", resolveDir: workspace, sourcefile: "specimen-bootstrap.js" },
      bundle: true, write: false, format: "esm", platform: "browser", target: "es2022", minify: true,
      // A browser has no `process`: npm code reading `process.env.X` (next/image, next/link) sees an empty env.
      jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', ...nextImageDefine(workspace), "process.env": "{}" }, outdir: "specimen-out", entryNames: "specimen",
      logLevel: "silent", legalComments: "none", plugins: [plugin],
    });
    const output = result.outputFiles ?? [];
    const js = output.find(file => file.path.endsWith(".js"))?.text;
    return { ...(js ? { js } : {}), css: output.filter(file => file.path.endsWith(".css")).map(file => file.text).join("\n"), errors: js ? [] : ["visual specimen has no executable bundle"] };
  } catch (error: any) {
    const messages = Array.isArray(error?.errors) && error.errors.length ? error.errors.map((row: any) => row.text) : [error instanceof Error ? error.message : String(error)];
    return { css: "", errors: messages };
  }
}

/** Content-addressed builder; one per server. */
export function createSpecimenBuilder(options: SpecimenBuilderOptions = {}) {
  const workspace = options.workspace ?? process.cwd();
  const builds = new Map<string, Promise<SpecimenBuild>>();
  const compiledCss = new Map<string, Promise<string>>();
  const cold = limiter(Math.max(1, options.coldBuilds ?? SPECIMEN_COLD_BUILDS));
  // The content hash needs the closure, so a finished build is found only after the walk. A
  // request for a record already being built (same record bytes, preview and source) joins
  // that build instead of walking the closure again; a settled one walks it again, because
  // another slot's pin can change which items the closure resolves to.
  const inflight = new Map<string, { source: SpecimenRecordSource | undefined; pending: Promise<SpecimenBuild> }>();
  const build = async (record: SpecimenRecord, source?: SpecimenRecordSource): Promise<SpecimenBuild> => {
    const errors: string[] = [];
    const visual = record.kind === "visual";
    const graph: Closure = visual ? await closure(record, source, errors) : { files: new Map(), aliases: new Map() };
    const files = graph.files;
    const entry = visual ? specimenEntry(record) : undefined;
    if (visual && !entry) errors.push(`${record.id}: payload has no code file to mount`);
    const mounted = visual ? specimenExport(record, entry) : undefined;
    if (visual && entry && !mounted) errors.push(`${record.id}: ${entry.path} exports no component to mount`);
    // Fixture props (an element tree's class names included) are styled like the payload's own sources.
    const fixtures = visual && record.preview.fixtures ? JSON.stringify(record.preview.fixtures) : "";
    const hash = sha256(JSON.stringify([SPECIMEN_RENDERER_VERSION, BOOTSTRAP, record.kind, entry?.path ?? null, mounted ?? null, [...files].sort(), errors, fixtures])).slice(0, 24);
    let pending = builds.get(hash);
    if (!pending) {
      pending = cold(async () => {
        const sources = [...files].filter(([path]) => CODE.test(path)).map(([path, content]) => ({ content, extension: extname(path).slice(1) }));
        const css = await compileCss([...sources, { content: BOOTSTRAP, extension: "js" }, ...(fixtures ? [{ content: fixtures, extension: "json" }] : [])], workspace, compiledCss);
        const exported = mounted ? { export: mounted } : {};
        if (!visual || !entry) return { hash, css, errors, ...exported };
        const esbuild = options.esbuild ?? await import("esbuild" as string) as SpecimenEsbuild;
        const built = await bundle(esbuild, graph, posix.normalize(entry.path), workspace);
        return { hash, css: built.css ? `${css}\n${built.css}` : css, errors: [...errors, ...built.errors], ...exported, ...(built.js ? { js: built.js } : {}) };
      });
      builds.set(hash, pending);
      pending.catch(() => builds.delete(hash));
    }
    return pending;
  };
  return {
    workspace,
    build(record: SpecimenRecord, source?: SpecimenRecordSource): Promise<SpecimenBuild> {
      const key = JSON.stringify([record.id, record.version, record.kind, record.contentHash, record.preview]);
      const joined = inflight.get(key);
      if (joined && joined.source === source) return joined.pending;
      const pending = build(record, source);
      inflight.set(key, { source, pending });
      const settle = () => { if (inflight.get(key)?.pending === pending) inflight.delete(key); };
      pending.then(settle, settle);
      return pending;
    },
    /** A built asset by hash, for `/__specimen/assets/<hash>.<js|css>`. */
    async asset(hash: string, type: "js" | "css"): Promise<string | undefined> {
      const build = await builds.get(hash)?.catch(() => undefined);
      return type === "js" ? build?.js : build?.css;
    },
  };
}
export type SpecimenBuilder = ReturnType<typeof createSpecimenBuilder>;
