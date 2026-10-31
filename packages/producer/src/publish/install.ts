/**
 * `clossys publish --install --page <page record>`: install the registry items a consumer
 * pinned for one page into a publishing substrate, bind its copy to Writer keys, and render
 * the bound page to static HTML outside the consumer root.
 *
 * Publisher owns install and bind (`@clossys/publisher/install`); this module supplies its
 * inputs (the consumer's selection pins, its library through `libraryRecordSource`, its
 * compiled Writer copy), runs shadcn without a shell, and renders the result.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { installAndBind, type BoundPage, type InstallFinding, type InstallPageRecord, type InstallPins, type InstallResult, type ShadcnRunner } from "@clossys/publisher/install";
import { loadSelection, SELECTION_FILE } from "../records/index.js";
import { libraryRecordSource } from "../specimen/library-source.js";
import { readWriter } from "./site-source.js";
import { specimenRoots } from "./publish.js";

const MARKER = ".clossys-publish-install";
const requireHere = createRequire(import.meta.url);

export interface PublishInstallOptions {
  readonly root: string;
  /** The page record file (`{ id, frame, sections, bindings }`). */
  readonly page: string;
  readonly out?: string;
  /** Library roots; defaults to `<root>/clossys/library`. */
  readonly records?: readonly string[];
  readonly runner?: ShadcnRunner;
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

/**
 * The publishing substrate: a minimal Vite + Tailwind v4 shadcn project, written once. Its
 * `main.tsx` mounts a generated page module (`clossys/pages/<id>.tsx`; `?page=<id>`, and
 * `?theme=dark` for the dark mode). shadcn installs each item's npm dependencies into it; the
 * dev server itself (`npx vite`) needs the substrate's own `npm install`.
 */
async function ensureSubstrate(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  if (existsSync(join(dir, "components.json"))) return;
  const write = (name: string, value: unknown) => writeFile(join(dir, name), typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
  await write("package.json", {
    name: "publishing-substrate", private: true, type: "module",
    scripts: { dev: "vite", build: "vite build" },
    dependencies: { react: "^19.2.0", "react-dom": "^19.2.0" },
    devDependencies: { vite: "^8.3.4", tailwindcss: "^4.3.3", "@tailwindcss/vite": "^4.3.3", "tw-animate-css": "^1.4.0" },
  });
  await write("tsconfig.json", { compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] }, jsx: "react-jsx", module: "esnext", moduleResolution: "bundler", target: "es2022", skipLibCheck: true } });
  await write("components.json", {
    $schema: "https://ui.shadcn.com/schema.json", style: "new-york", rsc: false, tsx: true,
    tailwind: { config: "", css: "app.css", baseColor: "neutral", cssVariables: true },
    aliases: { components: "@/components", utils: "@/lib/utils", ui: "@/components/ui", lib: "@/lib", hooks: "@/hooks" },
  });
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
}

/** The page module: imports every bound slot's installed entry and composes the page. Shared by the static render and the dev server. */
export function pageModule(page: BoundPage, substrate: string): string {
  const slots = [page.frame, ...page.sections, ...page.parts];
  const from = join(substrate, "clossys", "pages");
  const specifier = (file: string) => {
    const path = relative(from, join(substrate, file)).split(sep).join("/").replace(/\.[cm]?[jt]sx?$/, "");
    return path.startsWith(".") ? path : `./${path}`;
  };
  const table = Object.fromEntries(slots.map(slot => [slot.slot, { id: slot.id, export: slot.entry.export, copyKeys: slot.copyKeys, props: slot.props, text: slot.text }]));
  return [
    "// Generated by clossys publish --install. Rerun the install rather than editing this file.",
    'import { createElement, type ReactNode } from "react";',
    ...slots.map((slot, index) => `import * as m${index} from ${JSON.stringify(specifier(slot.entry.file))};`),
    "",
    `const modules: Record<string, Record<string, any>> = { ${slots.map((slot, index) => `${JSON.stringify(slot.slot)}: m${index}`).join(", ")} };`,
    `const slots: Record<string, { id: string; export?: string; copyKeys?: string; props: Record<string, unknown>; text: Record<string, string> }> = ${JSON.stringify(table, null, 2)};`,
    "",
    "function resolve(value: unknown, keyed = false): unknown {",
    "  if (Array.isArray(value)) return value.map(item => resolve(item, true));",
    '  if (!value || typeof value !== "object") return value;',
    "  const node = value as Record<string, unknown>;",
    '  if (typeof node.$element === "string") return mount(node.$element, keyed);',
    "  return Object.fromEntries(Object.entries(node).map(([key, item]) => [key, resolve(item)]));",
    "}",
    "",
    "function mount(name: string, keyed = false): ReactNode {",
    "  const slot = slots[name], mod = modules[name];",
    "  if (!slot || !mod) throw new Error(`clossys page: no bound slot ${name}`);",
    '  const component = slot.export ? mod[slot.export] : mod.default ?? Object.values(mod).find(value => typeof value === "function");',
    '  if (typeof component !== "function" && typeof component !== "object") throw new Error(`clossys page: ${slot.id} exports no component ${slot.export ?? ""}`);',
    "  const props = resolve(slot.props) as Record<string, unknown>;",
    "  if (slot.copyKeys) {",
    "    const map = mod[slot.copyKeys] as Record<string, string> | undefined;",
    "    if (!map) throw new Error(`clossys page: ${slot.id} has no export ${slot.copyKeys}`);",
    "    props.copy = Object.fromEntries(Object.entries(map).map(([prop, copySlot]) => {",
    "      if (!Object.hasOwn(slot.text, copySlot)) throw new Error(`clossys page: ${slot.id} copy ${prop} reads ${copySlot}, which is not bound`);",
    "      return [prop, slot.text[copySlot]];",
    "    }));",
    "  }",
    "  return createElement(component, keyed ? { ...props, key: name } : props);",
    "}",
    "",
    `export const pageId = ${JSON.stringify(page.id)};`,
    `export default function Page(): ReactNode { return mount(${JSON.stringify(page.frame.slot)}); }`,
    "",
  ].join("\n");
}

/** Writer copy by key: compiled records, plus aliases to them. */
async function writerCopy(root: string): Promise<Record<string, string>> {
  const writer = await readWriter(root);
  const copy: Record<string, string> = {};
  for (const record of writer.records) copy[record.id] = record.text;
  for (const [alias, id] of Object.entries(writer.aliases)) if (Object.hasOwn(copy, id)) copy[alias] = copy[id]!;
  return copy;
}

/** Write the page module, bundle it with esbuild and render it with this process's React. */
export async function renderBoundPage(page: BoundPage, substrate: string): Promise<string> {
  const esbuild = await import("esbuild");
  const file = join(substrate, "clossys", "pages", `${page.id}.tsx`);
  await mkdir(join(substrate, "clossys", "pages"), { recursive: true });
  await writeFile(file, pageModule(page, substrate));
  const result = await esbuild.build({
    entryPoints: [file], absWorkingDir: substrate, bundle: true, write: false, format: "esm", platform: "node", jsx: "automatic", logLevel: "silent",
    plugins: [{ name: "host-react", setup(build) { build.onResolve({ filter: /^react(-dom)?(\/.*)?$/ }, args => ({ path: requireHere.resolve(args.path), external: true })); } }],
  });
  const bundle = join(substrate, ".clossys", `render-${createHash("sha256").update(result.outputFiles[0]!.text).digest("hex").slice(0, 12)}.mjs`);
  await mkdir(join(substrate, ".clossys"), { recursive: true });
  await writeFile(bundle, result.outputFiles[0]!.text);
  const module = await import(pathToFileURL(bundle).href);
  const React = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const body = renderToStaticMarkup(React.createElement(module.default));
  return `<!doctype html><html><head><meta charset="utf-8"><title>${page.id}</title></head><body>${body}</body></html>\n`;
}

export async function publishInstall(options: PublishInstallOptions): Promise<PublishInstallResult> {
  const root = resolve(options.root);
  const page = JSON.parse(await readFile(resolve(options.page), "utf8")) as InstallPageRecord;
  if (typeof page?.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(page.id)) throw new Error(`publish --install: ${options.page} needs a page id ([a-z0-9-])`);
  const out = resolve(options.out ?? join(tmpdir(), "clossys-publish", createHash("sha256").update(root).digest("hex").slice(0, 12), `install-${page.id}`));
  if (existsSync(out) && !existsSync(join(out, MARKER))) throw new Error(`publish: ${out} exists and was not written by clossys publish --install`);
  await mkdir(out, { recursive: true });
  await writeFile(join(out, MARKER), "clossys publish --install output\n");
  const substrate = join(out, "substrate");
  await ensureSubstrate(substrate);

  const selection = loadSelection(join(root, "clossys", SELECTION_FILE));
  const pins: InstallPins = Object.fromEntries(Object.entries(selection.pins).map(([slot, pin]) => [slot, { element: pin.element, version: pin.version }]));
  const source = libraryRecordSource({ roots: specimenRoots(root, options.records) });
  const result = await installAndBind({ page, pins, source, substrate, runner: options.runner ?? shadcnRunner(), copy: await writerCopy(root) });
  const report = { page: page.id, installed: result.installed, findings: result.findings, ...(result.page ? { bound: result.page } : {}) };
  await writeFile(join(out, "install-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  if (!result.page) return { out, substrate, installed: result.installed, findings: result.findings };
  const html = join(out, "site", page.id, "index.html");
  await mkdir(join(out, "site", page.id), { recursive: true });
  await writeFile(html, await renderBoundPage(result.page, substrate));
  return { out, substrate, installed: result.installed, findings: result.findings, page: result.page, html };
}

export function installSummary(result: PublishInstallResult): string {
  const page = result.page;
  const copySlots = page ? [page.frame, ...page.sections, ...page.parts].reduce((sum, slot) => sum + Object.keys(slot.copy).length, 0) : 0;
  return [
    `Installed: ${result.installed.length}`, ...result.installed.map(row => `  ${row.slot} ${row.id}@v${row.version} ${row.status}: ${row.files.join(", ")}`),
    ...(page ? [`Bound: ${page.id} (frame ${page.frame.id} + ${page.sections.length} sections + ${page.parts.length} parts, ${copySlots} copy slots bound)`] : []),
    `Findings: ${result.findings.length}`, ...result.findings.map(row => `  ${row.code}${row.slot ? ` ${row.slot}` : ""}: ${row.detail}`),
    `Substrate: ${result.substrate}`,
    ...(result.html ? [`Page: ${result.html}`] : []),
    `Report: ${join(result.out, "install-report.json")}`,
  ].join("\n");
}
