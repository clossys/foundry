/**
 * Installed specimens: every pinned library item rendered the way the site renders it.
 *
 * For each pinned slot this builds a synthetic one-item page and runs it through the same
 * install-and-bind pipeline `clossys publish --install` uses (Publisher `installAndBind` into a
 * Vite + Tailwind shadcn substrate, Writer copy bound by the page records that already use the
 * item, else the item's own preview props). Theme and font leaves get generated swatch and type
 * ramp pages that read the installed CSS variables. One `vite build` serves them all from
 * `/__specimen-site/<key>/`; the key changes with the selection (every pinned item version and
 * hash), the Writer copy and the Publisher page cells, so each item version is built once.
 *
 * `/__specimen?element=<slot>/<element>&theme=&width=&v=` answers with a small frame page that
 * loads the built page at `width` CSS px and scales it to the frame, so breakpoints follow the
 * specimen's own viewport rather than the thumbnail's size, and reports the page's natural height
 * (see specimen-frame.ts).
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, extname, join, relative, resolve, sep, isAbsolute } from "node:path";
import { specimenSubstrate } from "./specimen-substrate.js";
import { SPECIMEN_FRAME_CSP, specimenFramePage, specimenWidth } from "./specimen-frame.js";
import { resolveSampleCopy, specimenStateOf, VISIBLE_STATE_CSS, type SpecimenState } from "./specimen-state.js";
import { fixtureChildren, itemDependencies, moduleExports, pinnedWriterCopy, specimenTreeIssues } from "./specimen-tree.js";
import { installAndBind, isBlocking, substrateDependencies, type InstallFinding, type InstallPageRecord, type InstallPins } from "@clossys/publisher/install";
import { slotInstallInputs } from "../specimen/slot-install-inputs.js";
import { libraryRecordSource } from "../specimen/library-source.js";
import { specimenPageSlotIds } from "../specimen/page-slot-ids.js";
import { ensureSubstrate, ensureSubstrateDependencies, npmRunner, pageModule, pageRecordFromCell, shadcnRunner, writerCopy } from "../publish/install.js";

/** Bumped when the generated specimen pages change shape. */
const SPECIMEN_FORMAT = "studio-specimens/6";
const SITE_PREFIX = "/__specimen-site/";
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".json": "application/json; charset=utf-8",
};

/** One built pass of the specimen substrate, served from `/__specimen-site/<key>/`. */
export interface SpecimenBuild { readonly key: string; readonly dist: string }

export interface SpecimenPage { readonly page: string; readonly element: string; readonly version: number; readonly build: string }

export interface InstalledSpecimenSite {
  readonly key: string;
  /** Pass 0 is the pinned selection; pass n swaps in each slot's n-th option (a newer, unpinned version). */
  readonly builds: readonly SpecimenBuild[];
  /** `<slot>@v<version>` -> its built page, element and build key. */
  readonly pages: ReadonlyMap<string, SpecimenPage>;
  readonly findings: readonly InstallFinding[];
}

export interface InstalledSpecimens {
  /** Settles once the build finished (undefined when it could not run). */
  readonly ready: Promise<InstalledSpecimenSite | undefined>;
  /** Answers `/__specimen` for pinned items and `/__specimen-site/*`; false to fall through. */
  handle(request: IncomingMessage, response: ServerResponse, pathname: string): Promise<boolean>;
}

const specimenPageId = (slot: string, version: number) => `specimen-${slot.replace(/\./g, "-")}-v${version}`;
const pageKey = (slot: string, version: number) => `${slot}@v${version}`;
const hash = (...parts: string[]) => { const h = createHash("sha256"); for (const part of parts) h.update(part).update("\0"); return h.digest("hex"); };

/** Pinned Publisher page slots (legacy active cells without IA), home first. */
async function pageRecords(root: string, pins: InstallPins): Promise<InstallPageRecord[]> {
  const ids = await specimenPageSlotIds(root);
  const records: InstallPageRecord[] = [];
  for (const id of ids) { try { records.push(await pageRecordFromCell(root, id, pins)); } catch { /* a page cell without frame/sections binds nothing */ } }
  return records;
}

/** The copy map of the first page record that places `slot`, else of the first page (frames and parts bind shared copy keys). */
function copyFor(slot: string, records: readonly InstallPageRecord[]): Record<string, string> {
  const placed = records.find(record => record.frame === slot || record.sections.includes(slot));
  return { ...(placed ?? records[0])?.copy };
}

async function readJson(path: string): Promise<any> { return JSON.parse(await readFile(path, "utf8")); }

/** Theme leaf: colour swatches and a type sample, read from the installed theme's CSS variables. */
function themePage(names: readonly string[]): string {
  return [
    "// Generated by Producer Studio: the pinned theme's swatches and type sample.",
    'import type { ReactNode } from "react";',
    `const NAMES: string[] = ${JSON.stringify(names)};`,
    "export default function Page(): ReactNode {",
    "  const pairs = NAMES.filter(name => !name.endsWith(\"-foreground\"));",
    "  return <main className=\"min-h-screen bg-background p-8 text-foreground\">",
    "    <h1 className=\"font-heading text-5xl font-semibold tracking-tight\">Aa Theme</h1>",
    "    <p className=\"mt-3 max-w-2xl text-lg text-muted-foreground\">The quick brown fox jumps over the lazy dog. 0123456789</p>",
    "    <div className=\"mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6\">",
    "      {pairs.map(name => <div key={name} className=\"overflow-hidden rounded-lg border\">",
    "        <div className=\"flex h-20 items-end p-2 text-sm font-medium\" style={{ background: `var(--${name})`, color: NAMES.includes(`${name}-foreground`) ? `var(--${name}-foreground)` : undefined }}>Aa</div>",
    "        <div className=\"bg-card px-2 py-1.5 text-xs text-card-foreground\">{name}</div>",
    "      </div>)}",
    "    </div>",
    "  </main>;",
    "}",
    "",
  ].join("\n");
}

/** Font leaf: a type ramp in the installed font variable. */
function fontPage(variable: string, family: string): string {
  return [
    "// Generated by Producer Studio: the pinned font's type ramp.",
    'import type { ReactNode } from "react";',
    "const RAMP = [[\"text-6xl\", \"Display\"], [\"text-5xl\", \"Heading 1\"], [\"text-4xl\", \"Heading 2\"], [\"text-3xl\", \"Heading 3\"], [\"text-2xl\", \"Heading 4\"], [\"text-xl\", \"Heading 5\"], [\"text-base\", \"Body\"], [\"text-sm\", \"Small\"]];",
    "export default function Page(): ReactNode {",
    `  return <main className="min-h-screen bg-background p-8 text-foreground" style={{ fontFamily: ${JSON.stringify(`var(${variable})`)} }}>`,
    `    <p className="text-sm text-muted-foreground">{${JSON.stringify(family)}}</p>`,
    "    <div className=\"mt-6 flex flex-col gap-4\">",
    "      {RAMP.map(([size, label]) => <div key={label} className=\"flex items-baseline gap-6 border-b pb-3\">",
    "        <span className=\"w-24 shrink-0 font-sans text-xs text-muted-foreground\">{label}</span>",
    "        <span className={`${size} font-semibold tracking-tight`}>The quick brown fox</span>",
    "      </div>)}",
    "    </div>",
    "  </main>;",
    "}",
    "",
  ].join("\n");
}

/** Component leaf: the bound item centred on the page ground, in its slot's declared specimen state. */
function componentPage(item: string, state?: SpecimenState): string {
  const open = state?.state === "open" ? state : undefined;
  return [
    "// Generated by Producer Studio: one component, centred on the page ground.",
    `import { ${open ? "useEffect, " : ""}type ReactNode } from "react";`,
    ...(open ? [`import { ${open.opener.export} as openSpecimen } from ${JSON.stringify(open.opener.module)};`] : []),
    `import Item from ${JSON.stringify(item)};`,
    "export default function Page(): ReactNode {",
    ...(open ? [`  useEffect(() => { openSpecimen(${JSON.stringify(open.sample)}, { duration: Infinity }); }, []);`] : []),
    `  return <main data-specimen-state=${JSON.stringify(state?.state ?? "rest")} className="flex min-h-screen items-center justify-center bg-background p-8 text-foreground">`,
    ...(state?.state === "visible" ? [`    <style>{${JSON.stringify(VISIBLE_STATE_CSS)}}</style>`] : []),
    "    <Item />",
    "  </main>;",
    "}",
    "",
  ].join("\n");
}

function run(command: string, args: string[], cwd: string): Promise<{ code: number; output: string }> {
  return new Promise(done => execFile(command, args, { cwd, timeout: 600_000, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
    done({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, output: `${stdout}${stderr}` });
  }));
}

interface PassResult { pages: Map<string, SpecimenPage>; findings: InstallFinding[]; built: boolean }

/**
 * Install and bind `slots` against `pins` into the shared substrate, then build them into `dist`.
 * Passes run one after another in one substrate: installPage re-installs whatever a previous pass
 * left at a different version, so a pass's bundle holds exactly its own pins.
 */
async function buildPass(options: { library: string; substrate: string; pins: InstallPins; slots: readonly string[]; records: readonly InstallPageRecord[]; copy: Record<string, string>; build: SpecimenBuild }): Promise<PassResult> {
  const { library, substrate, pins, records, copy, build } = options;
  const pagesDir = join(substrate, "clossys", "pages");
  // Only this pass's pages: a page from another pass or an earlier selection must not reach the bundle.
  await rm(pagesDir, { recursive: true, force: true });
  await mkdir(pagesDir, { recursive: true });
  const source = libraryRecordSource({ roots: [library] });
  const runner = shadcnRunner();
  const include = Object.keys(pins).filter(slot => slot.startsWith("themes.")).sort();
  const findings: InstallFinding[] = [];
  const pages = new Map<string, SpecimenPage>();
  let dependencies: Record<string, string> = {};
  // Theme items first: every other page installs them through `include`.
  for (const slot of [...options.slots].sort((a, b) => Number(!a.startsWith("themes.")) - Number(!b.startsWith("themes.")) || a.localeCompare(b))) {
    const pin = pins[slot]!, page = specimenPageId(slot, pin.version);
    if (slot.startsWith("themes.")) {
      // The pinned candidate itself, through the same slot reader every other page installs from.
      const record = await source.read(`${slot}/${pin.element}`, pin.version).catch(() => undefined);
      let item: any;
      try { item = record ? JSON.parse(record.payload.raw) : undefined; } catch { item = undefined; }
      if (!item) { findings.push({ code: "missing-record", slot, detail: `${slot}: no registry item for ${pin.element}@v${pin.version}` }); continue; }
      // The item itself installs through the `include` of every other page in the pass; this page only reads its variables.
      if (item.type === "registry:font" && item.font?.variable) await writeFile(join(pagesDir, `${page}.tsx`), fontPage(item.font.variable, String(item.title ?? item.font.family ?? pin.element)));
      else await writeFile(join(pagesDir, `${page}.tsx`), themePage(Object.keys({ ...item.cssVars?.light, ...item.cssVars?.dark }).filter(name => name !== "radius" && !name.startsWith("chart-") && !name.startsWith("sidebar"))));
      pages.set(pageKey(slot, pin.version), { page, element: pin.element, version: pin.version, build: build.key });
      continue;
    }
    const record: InstallPageRecord = { id: page, frame: slot, sections: [], ...(include.length ? { include } : {}), copy: copyFor(slot, records) };
    const result = await installAndBind({ page: record, pins, source, substrate, runner, copy });
    const blocking = result.findings.filter(isBlocking);
    if (!result.page || blocking.length) { findings.push(...blocking); continue; }
    // A specimen frames one item: only a frame composes the (empty) section list as children.
    const state = specimenStateOf(slot), props = result.page.frame.props as Record<string, unknown>;
    if (!slot.startsWith("frames.")) {
      delete props.children;
      // Every other item renders the sample children its candidate's preview fixture declares:
      // text, Writer copy and elements of the candidate's own module (specimen-tree.ts).
      const mounted = result.slots.find(row => row.slot === slot && row.mounted)?.record;
      const sample = fixtureChildren(mounted?.preview.fixtures);
      if (sample !== undefined) {
        const text = { ...copy, ...result.page.frame.text };
        const source = await readFile(join(substrate, result.page.frame.entry.file), "utf8").catch(() => "");
        let item: unknown;
        try { item = JSON.parse(mounted?.payload.raw ?? ""); } catch { item = undefined; }
        const issues = specimenTreeIssues(sample, moduleExports(source), text, itemDependencies(item));
        if (issues.length) { findings.push({ code: "invalid-page", slot, detail: `${slot}/${pin.element}@v${pin.version} preview children: ${issues.join("; ")}` }); continue; }
        props.children = resolveSampleCopy(sample, text);
      }
    }
    dependencies = { ...dependencies, ...substrateDependencies(result.slots) };
    if (slot.startsWith("components.")) {
      // A component is a small part of a page: centre it on the page ground instead of pinning it to the top-left corner.
      await writeFile(join(pagesDir, `${page}--item.tsx`), pageModule(result.page, substrate, { host: false }));
      await writeFile(join(pagesDir, `${page}.tsx`), componentPage(`./${page}--item`, state));
    } else await writeFile(join(pagesDir, `${page}.tsx`), pageModule(result.page, substrate, { host: false }));
    pages.set(pageKey(slot, pin.version), { page, element: pin.element, version: pin.version, build: build.key });
  }
  if (!pages.size) return { pages, findings, built: false };
  const failed = await ensureSubstrateDependencies(substrate, dependencies, npmRunner());
  if (failed) { findings.push(failed); return { pages: new Map(), findings, built: false }; }
  const vite = join(substrate, "node_modules", "vite", "bin", "vite.js");
  const built = await run(process.execPath, [vite, "build", "--base", `${SITE_PREFIX}${build.key}/`, "--outDir", build.dist, "--emptyOutDir", "--logLevel", "error"], substrate);
  if (built.code !== 0) { findings.push({ code: "render-failed", detail: `specimen build ${build.key} exited ${built.code}: ${built.output.trim().split("\n").slice(-3).join(" ")}` }); return { pages: new Map(), findings, built: false }; }
  return { pages, findings, built: true };
}

async function buildSite(root: string, library: string): Promise<InstalledSpecimenSite | undefined> {
  const inputs = slotInstallInputs(library);
  if (!inputs) return undefined;
  const { pins, options, unpinned } = inputs;
  const passes = Math.max(Object.keys(unpinned).length ? 1 : 0, ...[...options.values()].map(list => list.length));
  // Compiled Writer copy wins; the pinned Writer slots fill a consumer that has not compiled yet.
  const copy = { ...pinnedWriterCopy(library), ...await writerCopy(root).catch(() => ({} as Record<string, string>)) };
  const records = await pageRecords(root, pins);
  const key = hash(SPECIMEN_FORMAT, root, inputs.fingerprint, JSON.stringify(copy), JSON.stringify(records)).slice(0, 16);
  const substrate = specimenSubstrate(root), base = dirname(substrate), manifest = join(base, `site-${key}.json`);
  if (existsSync(manifest)) {
    const saved = await readJson(manifest);
    if ((saved.builds as SpecimenBuild[]).every(build => existsSync(join(build.dist, "index.html")))) return { key, builds: saved.builds, pages: new Map(Object.entries(saved.pages)), findings: saved.findings };
  }
  await ensureSubstrate(substrate);
  const builds: SpecimenBuild[] = [];
  const pages = new Map<string, SpecimenPage>();
  const findings: InstallFinding[] = [];
  for (let pass = 0; pass <= passes; pass++) {
    const swapped = pass === 0 ? Object.keys(pins) : [...options].filter(([, list]) => list.length >= pass).map(([slot]) => slot);
    if (pass === 1) swapped.push(...Object.keys(unpinned));
    const passPins: InstallPins = pass === 0 ? pins : {
      ...unpinned, ...pins,
      ...Object.fromEntries(swapped.filter(slot => pins[slot]).map(slot => [slot, { element: pins[slot]!.element, version: options.get(slot)![pass - 1]! }])),
    };
    const build = { key: pass === 0 ? key : `${key}-o${pass}`, dist: join(base, pass === 0 ? `dist-${key}` : `dist-${key}-o${pass}`) };
    const result = await buildPass({ library, substrate, pins: passPins, slots: swapped, records, copy, build });
    findings.push(...result.findings);
    if (!result.built) continue;
    builds.push(build);
    for (const [name, page] of result.pages) pages.set(name, page);
  }
  await writeFile(manifest, `${JSON.stringify({ schema: SPECIMEN_FORMAT, key, builds, pages: Object.fromEntries(pages), findings }, null, 2)}\n`);
  return { key, builds, pages, findings };
}

export function installedSpecimens(options: { root: string; library: string }): InstalledSpecimens {
  const ready = buildSite(resolve(options.root), resolve(options.library)).catch(error => {
    console.warn("Producer specimens could not be built:", error instanceof Error ? error.message.split("\n")[0] : String(error));
    return undefined;
  });
  return {
    ready,
    async handle(request, response, pathname) {
      if (pathname === "/__specimen") {
        const params = new URL(request.url ?? "", "http://studio.invalid").searchParams;
        const [slot, element] = (params.get("element") ?? "").split("/");
        const site = await ready;
        const version = params.get("v");
        // Without `v` the pinned version answers: the pass-0 page of this slot.
        const entry = !site || !slot ? undefined : version !== null ? site.pages.get(pageKey(slot, Number(version)))
          : [...site.pages.entries()].find(([name, page]) => name.startsWith(`${slot}@v`) && page.build === site.key)?.[1];
        if (!site || !entry || entry.element !== element) return false;
        const width = Number(params.get("width"));
        const theme = params.get("theme") === "dark" ? "dark" : "light";
        const src = `${SITE_PREFIX}${entry.build}/index.html?${new URLSearchParams({ page: entry.page, ...(theme === "dark" ? { theme } : {}) })}`;
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": SPECIMEN_FRAME_CSP });
        response.end(request.method === "HEAD" ? undefined : specimenFramePage({ src, width: specimenWidth(width), title: `${slot} specimen` }));
        return true;
      }
      if (!pathname.startsWith(SITE_PREFIX)) return false;
      const site = await ready;
      const rest = pathname.slice(SITE_PREFIX.length);
      const build = site?.builds.find(candidate => rest.startsWith(`${candidate.key}/`));
      if (!build) { response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); response.end("Specimen build is not available\n"); return true; }
      const file = resolve(build.dist, rest.slice(build.key.length + 1) || "index.html");
      const inside = relative(build.dist, file);
      let target: string | undefined;
      if (inside && !inside.startsWith("..") && !isAbsolute(inside) && !inside.split(sep).some(part => part.startsWith("."))) {
        try { target = await realpath(file); if (!(await stat(target)).isFile() || relative(await realpath(build.dist), target).startsWith("..")) target = undefined; } catch { target = undefined; }
      }
      if (!target) { response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); response.end("Not found\n"); return true; }
      response.writeHead(200, { "Content-Type": TYPES[extname(target)] ?? "application/octet-stream", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" });
      response.end(request.method === "HEAD" ? undefined : await readFile(target));
      return true;
    },
  };
}
