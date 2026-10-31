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
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, extname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { SHADCN_THEME_INLINE } from "./theme.js";
import { SPECIMEN_CHROME_CSS } from "./chrome.js";
import type { SpecimenFile, SpecimenRecord, SpecimenRecordSource } from "./types.js";

/** Bumped when the renderer's output for the same record changes. */
export const SPECIMEN_RENDERER_VERSION = "specimen-1";

export interface SpecimenBuild {
  readonly hash: string;
  /** Present for visual records: the bundle mounting the element. */
  readonly js?: string;
  readonly css: string;
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
const pick = () => {
  if (config.export && typeof Element[config.export] === "function") return Element[config.export];
  if (typeof Element.default === "function") return Element.default;
  return Object.values(Element).find(value => typeof value === "function" && /^[A-Z]/.test(value.name || "")) || Object.values(Element).find(value => typeof value === "function");
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
const Component = pick();
const root = createRoot(document.getElementById("specimen-root"), { onCaughtError() {}, onRecoverableError(error) { report(error, "recoverable"); } });
if (!Component) report(new Error("payload exports no component"), "build");
else root.render(React.createElement(Boundary, null, React.createElement(Component, config.props || {})));
`;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const stripExt = (path: string) => path.replace(/\.(?:[cm]?[jt]sx?)$/, "");

/** The payload file the specimen mounts. */
export function specimenEntry(record: SpecimenRecord): SpecimenFile | undefined {
  const files = record.payload.files.filter(file => CODE.test(file.path));
  if (record.preview.entry) return files.find(file => file.path === record.preview.entry);
  return files.find(file => /registry:(?:ui|component|block|page)/.test(file.type ?? "")) ?? files[0];
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

async function compileCss(sources: readonly { content: string; extension: string }[], workspace: string): Promise<string> {
  const tailwind = await import("tailwindcss") as { compile: (css: string, options: Record<string, unknown>) => Promise<{ build(candidates: string[]): string }> };
  const entry = [
    "@layer theme, base, components, utilities;",
    '@import "tailwindcss/theme.css" layer(theme);',
    '@import "tailwindcss/preflight.css" layer(base);',
    '@import "tailwindcss/utilities.css" layer(utilities);',
    SHADCN_THEME_INLINE,
  ].join("\n");
  const compiled = await tailwind.compile(entry, {
    base: workspace,
    loadStylesheet: async (id: string) => {
      const path = resolveFrom(id, workspace);
      return { path, base: dirname(path), content: await readFile(path, "utf8") };
    },
  });
  const candidates = [...new Set(await candidatesOf(sources))].sort();
  return `${compiled.build(candidates)}\n${SPECIMEN_CHROME_CSS}`;
}

/** Files the element imports through the `@/` alias, found in its own payload or a sibling record. */
async function closure(record: SpecimenRecord, source: SpecimenRecordSource | undefined, errors: string[]): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const file of record.payload.files) files.set(posix.normalize(file.path), file.content);
  const seen = new Set<string>([record.id]);
  const pending = [...files.keys()].filter(path => CODE.test(path));
  while (pending.length) {
    const path = pending.pop()!;
    for (const match of files.get(path)!.matchAll(/from\s+["']@\/([^"']+)["']|import\s+["']@\/([^"']+)["']/g)) {
      const alias = (match[1] ?? match[2])!;
      if (alias === ALIAS_UTILS || aliasTarget(files, alias)) continue;
      const name = alias.split("/").pop()!;
      if (!source || seen.has(name)) continue;
      seen.add(name);
      const sibling = await source.read(name).catch(() => undefined);
      if (!sibling) { errors.push(`import @/${alias}: no file in the payload and no sibling record ${name}`); continue; }
      for (const file of sibling.payload.files) {
        const key = posix.normalize(file.path);
        if (files.has(key)) continue;
        files.set(key, file.content);
        if (CODE.test(key)) pending.push(key);
      }
    }
  }
  return files;
}

function aliasTarget(files: ReadonlyMap<string, string>, alias: string): string | undefined {
  const paths = [...files.keys()].filter(path => CODE.test(path));
  return paths.find(path => stripExt(path) === alias || stripExt(path).endsWith(`/${alias}`))
    ?? paths.find(path => posix.basename(stripExt(path)) === posix.basename(alias));
}

function relativeTarget(files: ReadonlyMap<string, string>, importer: string, specifier: string): string | undefined {
  const base = posix.normalize(posix.join(posix.dirname(importer), specifier));
  return [base, ...[".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts"].map(ext => base + ext)].find(path => files.has(path));
}

const loaderOf = (path: string) => ({ ".tsx": "tsx", ".ts": "ts", ".jsx": "jsx", ".js": "js", ".mjs": "js", ".cjs": "js", ".css": "css" } as Record<string, string>)[extname(path)] ?? "tsx";

async function bundle(esbuild: SpecimenEsbuild, files: ReadonlyMap<string, string>, entry: string, workspace: string): Promise<{ js?: string; css: string; errors: string[] }> {
  const plugin = {
    name: "specimen-records",
    setup(build: any) {
      build.onResolve({ filter: /^specimen-entry$/ }, () => ({ path: entry, namespace: "specimen" }));
      build.onResolve({ filter: /^@\// }, (args: any) => {
        const alias = args.path.slice(2);
        const target = aliasTarget(files, alias);
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
        if (args.pluginData?.specimenFallback || args.path.startsWith("@/")) return undefined;
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
      jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, outdir: "specimen-out", entryNames: "specimen",
      logLevel: "silent", legalComments: "none", plugins: [plugin],
    });
    const output = result.outputFiles ?? [];
    return { js: output.find(file => file.path.endsWith(".js"))?.text, css: output.filter(file => file.path.endsWith(".css")).map(file => file.text).join("\n"), errors: [] };
  } catch (error: any) {
    const messages = Array.isArray(error?.errors) && error.errors.length ? error.errors.map((row: any) => row.text) : [error instanceof Error ? error.message : String(error)];
    return { css: "", errors: messages };
  }
}

/** Content-addressed builder; one per server. */
export function createSpecimenBuilder(options: SpecimenBuilderOptions = {}) {
  const workspace = options.workspace ?? process.cwd();
  const builds = new Map<string, Promise<SpecimenBuild>>();
  return {
    workspace,
    async build(record: SpecimenRecord, source?: SpecimenRecordSource): Promise<SpecimenBuild> {
      const errors: string[] = [];
      const visual = record.kind === "visual";
      const files = visual ? await closure(record, source, errors) : new Map<string, string>();
      const entry = visual ? specimenEntry(record) : undefined;
      if (visual && !entry) errors.push(`${record.id}: payload has no code file to mount`);
      const hash = sha256(JSON.stringify([SPECIMEN_RENDERER_VERSION, record.kind, entry?.path ?? null, [...files].sort(), errors])).slice(0, 24);
      let pending = builds.get(hash);
      if (!pending) {
        pending = (async () => {
          const sources = [...files].filter(([path]) => CODE.test(path)).map(([path, content]) => ({ content, extension: extname(path).slice(1) }));
          const css = await compileCss([...sources, { content: BOOTSTRAP, extension: "js" }], workspace);
          if (!visual || !entry) return { hash, css, errors };
          const esbuild = options.esbuild ?? await import("esbuild" as string) as SpecimenEsbuild;
          const built = await bundle(esbuild, files, posix.normalize(entry.path), workspace);
          return { hash, css: built.css ? `${css}\n${built.css}` : css, errors: [...errors, ...built.errors], ...(built.js ? { js: built.js } : {}) };
        })();
        builds.set(hash, pending);
        pending.catch(() => builds.delete(hash));
      }
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
