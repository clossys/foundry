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
import { join, resolve } from "node:path";
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

/** A minimal shadcn project to install into, written once. */
async function ensureSubstrate(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  if (existsSync(join(dir, "components.json"))) return;
  const write = (name: string, value: unknown) => writeFile(join(dir, name), typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
  await write("package.json", { name: "publishing-substrate", private: true, type: "module" });
  await write("tsconfig.json", { compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] }, jsx: "react-jsx" } });
  await write("components.json", {
    $schema: "https://ui.shadcn.com/schema.json", style: "new-york", rsc: false, tsx: true,
    tailwind: { config: "", css: "app.css", baseColor: "neutral", cssVariables: true },
    aliases: { components: "@/components", utils: "@/lib/utils", ui: "@/components/ui", lib: "@/lib", hooks: "@/hooks" },
  });
  await write("app.css", "");
}

/** Writer copy by key: compiled records, plus aliases to them. */
async function writerCopy(root: string): Promise<Record<string, string>> {
  const writer = await readWriter(root);
  const copy: Record<string, string> = {};
  for (const record of writer.records) copy[record.id] = record.text;
  for (const [alias, id] of Object.entries(writer.aliases)) if (Object.hasOwn(copy, id)) copy[alias] = copy[id]!;
  return copy;
}

/** Bundle the installed entries with esbuild and render the bound page with this process's React. */
export async function renderBoundPage(page: BoundPage, substrate: string): Promise<string> {
  const esbuild = await import("esbuild");
  const slots = [page.frame, ...page.sections];
  const entry = slots.map((slot, index) => `export * as s${index} from ${JSON.stringify(join(substrate, slot.entry.file))};`).join("\n");
  const result = await esbuild.build({
    stdin: { contents: entry, resolveDir: substrate, loader: "ts" }, bundle: true, write: false, format: "esm", platform: "node", jsx: "automatic",
    plugins: [{ name: "host-react", setup(build) { build.onResolve({ filter: /^react(-dom)?(\/.*)?$/ }, args => ({ path: requireHere.resolve(args.path), external: true })); } }],
  });
  const bundle = join(substrate, ".clossys", `render-${createHash("sha256").update(result.outputFiles[0]!.text).digest("hex").slice(0, 12)}.mjs`);
  await mkdir(join(substrate, ".clossys"), { recursive: true });
  await writeFile(bundle, result.outputFiles[0]!.text);
  const modules = await import(pathToFileURL(bundle).href);
  const React = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const component = (index: number): any => {
    const mod = modules[`s${index}`], name = slots[index]!.entry.export;
    const found = name ? mod[name] : mod.default ?? Object.values(mod).find(value => typeof value === "function");
    if (typeof found !== "function") throw new Error(`publish --install: ${slots[index]!.id} exports no component`);
    return found;
  };
  const sections = page.sections.map((slot, index) => React.createElement(component(index + 1), { key: slot.slot, ...slot.props }));
  const body = renderToStaticMarkup(React.createElement(component(0), page.frame.props, ...sections));
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
  const copySlots = page ? [page.frame, ...page.sections].reduce((sum, slot) => sum + Object.keys(slot.copy).length, 0) : 0;
  return [
    `Installed: ${result.installed.length}`, ...result.installed.map(row => `  ${row.slot} ${row.id}@v${row.version} ${row.status}: ${row.files.join(", ")}`),
    ...(page ? [`Bound: ${page.id} (frame ${page.frame.id} + ${page.sections.length} sections, ${copySlots} copy slots bound)`] : []),
    `Findings: ${result.findings.length}`, ...result.findings.map(row => `  ${row.code}${row.slot ? ` ${row.slot}` : ""}: ${row.detail}`),
    `Substrate: ${result.substrate}`,
    ...(result.html ? [`Page: ${result.html}`] : []),
    `Report: ${join(result.out, "install-report.json")}`,
  ].join("\n");
}
