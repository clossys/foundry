/**
 * `clossys publish --target preview`: assemble the consumer's active Publisher pages from
 * Designer surfaces and Writer copy, write a static site plus build report outside the
 * consumer root, and serve it on a loopback port that outlives the command.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as React from "react";
import * as ReactDOM from "react-dom";
import * as JsxRuntime from "react/jsx-runtime";
import * as JsxDevRuntime from "react/jsx-dev-runtime";
import { consumerBrand, consumerFontFile, consumerGlobals, DESIGNER_FONT_PREFIX } from "../server/designer-globals.js";
import { selectionProfile, selectionRuntime, studioSelection } from "../server/selection.js";
import { studioTheme } from "../server/theme.js";
import { planSite, type BuildReport } from "./site-plan.js";
import { renderSite, siteRuntime } from "./site-render.js";
import { readDesigner, readPublisher, readWriter } from "./site-source.js";
import { listLibraryElements } from "../specimen/library-source.js";

export const PUBLISH_TARGETS = ["preview"] as const;
export const DEFAULT_PREVIEW_PORT = 4330;
/** Ports other local tools own; the preview never takes them. */
const RESERVED_PORTS = new Set([4300, 4310]);
const MARKER = ".clossys-publish";
const STYLESHEET = "/assets/site.css";
const MARK = "/assets/brand-mark.svg";

export interface PublishOptions {
  root: string; out?: string; port?: number; serve?: boolean;
  /** Library roots served at `/__specimen`; defaults to `<root>/clossys/library` when it exists. */
  records?: readonly string[];
}
export interface PublishResult { url?: string; specimens?: { url: string; elements: string[] }; out: string; port?: number; report: BuildReport; pages: { id: string; path: string }[]; selection: { fallback: string[]; missingFonts: string[] } }

function portFree(port: number): Promise<boolean> {
  return new Promise(done => {
    const probe = createServer();
    probe.once("error", () => done(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => done(true)));
  });
}
async function choosePort(preferred: number): Promise<number> {
  for (let port = preferred; port < preferred + 100 && port <= 65535; port++) if (!RESERVED_PORTS.has(port) && await portFree(port)) return port;
  throw new Error(`publish: no free port from ${preferred}`);
}
async function waitFor(url: string): Promise<boolean> {
  for (let attempt = 0; attempt < 50; attempt++) {
    try { if ((await fetch(url)).ok) return true; } catch { /* not listening yet */ }
    await new Promise(done => setTimeout(done, 100));
  }
  return false;
}

/** Stop the server this command started last time for the same output, and nothing else. */
async function stopPrevious(out: string): Promise<void> {
  let previous: { pid?: number; out?: string } | undefined;
  try { previous = JSON.parse(await readFile(join(out, ".server.json"), "utf8")); } catch { return; }
  if (!previous?.pid || previous.out !== out) return;
  try { process.kill(previous.pid, 0); } catch { return; }
  try {
    const { execFileSync } = await import("node:child_process");
    const command = execFileSync("ps", ["-o", "command=", "-p", String(previous.pid)], { encoding: "utf8" });
    if (!command.includes("site-server.js") || !command.includes(join(out, "site"))) return;
    process.kill(previous.pid, "SIGTERM");
    for (let attempt = 0; attempt < 30; attempt++) { try { process.kill(previous.pid, 0); } catch { return; } await new Promise(done => setTimeout(done, 100)); }
  } catch { /* already gone */ }
}

/** Selection stylesheet, then the consumer's Designer theme, then its Designer globals (fonts copied beside it). */
async function siteStylesheet(root: string, selectionCss: string, site: string): Promise<{ css: string; missingFonts: string[]; brandBound: boolean }> {
  const theme = await studioTheme(root);
  const globals = await consumerGlobals(root);
  const strip = (css: string) => css.replace(/^@import[^;]*;\s*$/gm, "");
  let css = [selectionCss, strip(theme.css), globals?.css ?? ""].join("\n");
  const fonts = new Set<string>();
  css = css.replace(new RegExp(`url\\((['"]?)${DESIGNER_FONT_PREFIX.replace(/\//g, "\\/")}([^'")]+)\\1\\)`, "g"), (_match, _quote: string, rest: string) => { fonts.add(rest); return `url(/fonts/${rest})`; });
  for (const rest of fonts) {
    const file = await consumerFontFile(root, `${DESIGNER_FONT_PREFIX}${rest}`);
    if (!file) continue;
    const target = join(site, "fonts", ...rest.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.body);
  }
  return { css, missingFonts: globals?.missing ?? [], brandBound: theme.source === "consumer" };
}

export async function publishPreview(options: PublishOptions): Promise<PublishResult> {
  const root = resolve(options.root);
  const writer = await readWriter(root);
  const publisher = await readPublisher(root);
  const out = resolve(options.out ?? join(tmpdir(), "clossys-publish", createHash("sha256").update(root).digest("hex").slice(0, 12), publisher.publicationId));
  if (existsSync(out) && !existsSync(join(out, MARKER))) throw new Error(`publish: ${out} exists and was not written by clossys publish`);
  await stopPrevious(out);
  await rm(join(out, "site"), { recursive: true, force: true });
  await mkdir(join(out, "site", "assets"), { recursive: true });
  await writeFile(join(out, MARKER), "clossys publish --target preview output\n");

  const selection = await studioSelection(root);
  const runtimeHash = selection.runtimeUrl ? new URL(selection.runtimeUrl, "http://localhost").searchParams.get("hash") : null;
  const code = runtimeHash ? selectionRuntime(runtimeHash) : undefined;
  const profile: any = selectionProfile(selection.hash);
  if (!code || !profile) throw new Error(`publish: Designer selection did not compile${selection.message ? `: ${selection.message}` : ""}`);
  const runtimeFile = join(out, `runtime-${runtimeHash}.mjs`);
  await writeFile(runtimeFile, code);
  // The compiled selection reads React from the host instead of bundling a second copy.
  (globalThis as any).__studioDesignerRuntime = { react: React, "react-dom": ReactDOM, "react/jsx-runtime": JsxRuntime, "react/jsx-dev-runtime": JsxDevRuntime, "react-dom/client": {} };
  const selected = await import(pathToFileURL(runtimeFile).href);

  const brand = await consumerBrand(root);
  const site = join(out, "site");
  if (brand.mark) await writeFile(join(site, MARK.slice(1)), brand.mark.light);
  const designer = await readDesigner(root, profile, brand.mark ? { svg: brand.mark.light, src: MARK } : undefined);
  const plan = planSite(publisher, writer, designer);
  const { css, missingFonts, brandBound } = await siteStylesheet(root, selection.css ?? "", site);
  const runtime = { ...await siteRuntime({ profile, selected, consumer: profile.surfaces?.consumer ?? "consumer", locale: writer.locale }), brandBound };
  await writeFile(join(site, STYLESHEET.slice(1)), css);
  const rendered = await renderSite(plan.pages, runtime, plan.report, STYLESHEET);
  for (const page of rendered) {
    const target = join(site, ...page.path.split("/").filter(Boolean), "index.html");
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, page.html);
  }
  if (!brandBound) plan.report.requests.push({ agent: "designer", subject: "tokens", need: "activate the consumer's token fills; the site renders Foundry's unbranded theme" });
  const fallback = selection.leaves.filter(leaf => leaf.source !== "consumer").map(leaf => `${leaf.leaf}:${leaf.source}`);
  const report = { ...plan.report, selection: { fallback, missingFonts } };
  await writeFile(join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  const result: PublishResult = { out, report: plan.report, pages: rendered.map(page => ({ id: page.id, path: page.path })), selection: { fallback, missingFonts } };
  if (options.serve === false) return result;

  const port = await choosePort(options.port ?? DEFAULT_PREVIEW_PORT);
  const server = join(dirname(fileURLToPath(import.meta.url)), "site-server.js");
  const records = specimenRoots(root, options.records);
  const specimenArgs = records.length ? [...records.flatMap(dir => ["--records", dir]), "--workspace", specimenWorkspace(root)] : [];
  const child = spawn(process.execPath, [server, site, String(port), ...specimenArgs], { detached: true, stdio: "ignore" });
  child.unref();
  const url = `http://127.0.0.1:${port}/`;
  if (!await waitFor(url)) throw new Error(`publish: preview server did not start on ${port}`);
  await writeFile(join(out, ".server.json"), `${JSON.stringify({ pid: child.pid, port, out })}\n`);
  const specimens = records.length ? { url: `${url}__specimen`, elements: listLibraryElements(records) } : undefined;
  return { ...result, url, port, ...(specimens ? { specimens } : {}) };
}

/** Library roots to serve: the ones given, else the consumer's own `clossys/library` when present. */
export function specimenRoots(root: string, given?: readonly string[]): string[] {
  if (given?.length) return given.map(dir => resolve(root, dir));
  const own = join(root, "clossys", "library");
  return existsSync(own) ? [own] : [];
}

/** Payload npm imports resolve from the consumer's install when it has React, else from Producer's own. */
export function specimenWorkspace(root: string): string {
  const consumer = join(root, "clossys");
  return existsSync(join(consumer, "node_modules", "react", "package.json")) ? consumer : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

export function reportSummary(result: PublishResult): string {
  const { report } = result;
  const lines = [
    ...(result.url ? [`Preview: ${result.url}`] : []),
    ...(result.specimens ? [`Specimens: ${result.specimens.url}?element=<id> (${result.specimens.elements.length} elements${result.specimens.elements.length ? `: ${result.specimens.elements.slice(0, 5).join(", ")}${result.specimens.elements.length > 5 ? ", ..." : ""}` : ""})`] : []),
    `Pages: ${report.pages.map(page => `${page.path} (${page.frame} + ${page.sections.length} sections)`).join(", ")}`,
    `Empty slots: ${report.emptySlots.length}`, ...report.emptySlots.map(row => `  ${row.page} ${row.section}: ${row.reason}`),
    `Unbound keys: ${report.unboundKeys.length}`, ...report.unboundKeys.map(row => `  ${row.page} ${row.key}: ${row.reason}`),
    `Requests: ${report.requests.length}`, ...report.requests.map(row => `  ${row.agent} ${row.subject}: ${row.need}`),
    ...(result.selection.missingFonts.length ? [`Missing font packages: ${result.selection.missingFonts.join(", ")}`] : []),
    ...(result.selection.fallback.length ? [`Selection fallbacks: ${result.selection.fallback.length}`] : []),
    `Report: ${join(result.out, "report.json")}`,
  ];
  return lines.join("\n");
}
