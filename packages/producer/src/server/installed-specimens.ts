/**
 * Installed specimens: every pinned library item rendered the way the site renders it.
 *
 * For each pinned slot this builds a synthetic one-item page and runs it through the same
 * install-and-bind pipeline `clossys publish --install` uses (Publisher `installAndBind` into a
 * Vite + Tailwind shadcn substrate, Writer copy bound by the page records that already use the
 * item, else the item's own preview props). Theme and font leaves get generated swatch and type
 * ramp pages that read the installed CSS variables. One `vite build` per layer (themes, assets,
 * components, sections, frames) serves them from `/__specimen-site/<key>-<layer>/`, so one broken
 * page module blanks only its own layer; the key changes with the selection (every pinned item
 * version and hash), the Writer copy and the Publisher page cells, so each item version is built once.
 *
 * Only pins reach the pinned build. Every other recorded candidate of a slot is a preview: Studio
 * names it as (slot, candidate) and it builds on first request from its own bytes, every other
 * slot kept at its pin, in its own `/__specimen-site/<key>-<option>/` build.
 *
 * `/__specimen?element=<slot>/<element>&theme=&width=&v=` answers with a small frame page that
 * loads the built page at `width` CSS px and scales it to the frame, so breakpoints follow the
 * specimen's own viewport rather than the thumbnail's size, and reports the page's natural height
 * (see specimen-frame.ts).
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, extname, join, relative, resolve, sep, isAbsolute } from "node:path";
import { specimenSubstrate } from "./specimen-substrate.js";
import { SPECIMEN_FRAME_CSP, specimenFramePage, specimenWidth } from "./specimen-frame.js";
import { resolveSampleCopy, specimenStateOf, type SpecimenState } from "./specimen-state.js";
import { fixtureChildren, itemDependencies, moduleExports, pinnedWriterCopy, specimenTreeIssues } from "./specimen-tree.js";
import { bindPage, installPage, isBlocking, substrateDependencies, type BoundPage, type InstallFinding, type InstallPageRecord, type InstallPins } from "@clossys/publisher/install";
import { slotInstallInputs } from "../specimen/slot-install-inputs.js";
import { libraryRecordSource } from "../specimen/library-source.js";
import { specimenPageSlotIds } from "../specimen/page-slot-ids.js";
import { ensureSubstrate, ensureSubstrateDependencies, npmRunner, pageModule, pageRecordFromCell, shadcnRunner, writerCopy } from "../publish/install.js";
import { isAbsent } from "../errors.js";

/** Bumped when the generated specimen pages or the substrate they build in change shape (10: substrate without `"type": "module"`). */
const SPECIMEN_FORMAT = "studio-specimens/10";
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
  /** The pinned selection: the one build pages agree with. Unpinned candidates build on demand (`buildOption`). */
  readonly builds: readonly SpecimenBuild[];
  /** `<slot>/<element>@v<version>` -> its built page, element and build key. */
  readonly pages: ReadonlyMap<string, SpecimenPage>;
  readonly findings: readonly InstallFinding[];
}

export interface InstalledSpecimens {
  /** Settles once the build finished (undefined when it could not run). */
  readonly ready: Promise<InstalledSpecimenSite | undefined>;
  /** Answers `/__specimen` for pinned items and `/__specimen-site/*`; false to fall through. */
  handle(request: IncomingMessage, response: ServerResponse, pathname: string): Promise<boolean>;
}

const specimenPageId = (slot: string, element: string, version: number) => `specimen-${slot.replace(/\./g, "-")}--${element}-v${version}`;
/** One candidate's page: the slot, the candidate's element and its version (`<element>-v<version>`). */
const pageKey = (slot: string, element: string, version: number) => `${slot}/${element}@v${version}`;
const hash = (...parts: string[]) => { const h = createHash("sha256"); for (const part of parts) h.update(part).update("\0"); return h.digest("hex"); };

/** Pinned Publisher page slots, home first; a page slot whose record cannot be read is a finding on that slot. */
async function pageRecords(root: string, pins: InstallPins): Promise<{ records: InstallPageRecord[]; findings: InstallFinding[] }> {
  const ids = await specimenPageSlotIds(root);
  const records: InstallPageRecord[] = [], findings: InstallFinding[] = [];
  for (const id of ids) {
    try { records.push(await pageRecordFromCell(root, id, pins)); }
    catch (error) { findings.push({ code: "invalid-page", slot: id, detail: error instanceof Error ? error.message : String(error) }); }
  }
  return { records, findings };
}

/** The copy map of the first page record that places `slot`, else of the first page (frames and parts bind shared copy keys). */
function copyFor(slot: string, records: readonly InstallPageRecord[]): Record<string, string> {
  const placed = records.find(record => record.frame === slot || record.sections.includes(slot));
  return { ...(placed ?? records[0])?.copy };
}

async function readJson(path: string): Promise<any> { return JSON.parse(await readFile(path, "utf8")); }

/**
 * The Studio specimen documents (`ThemeSpecimen`, `FontSpecimen`, `ComponentSpecimen`): the pinned
 * Designer slot components.studio.specimen-document, installed into @clossys/designer-ui. A specimen
 * pass copies that file into the substrate's shadcn `components` alias; the generated pages below
 * only import and place it, so no class or style is written here.
 */
const SPECIMEN_DOCUMENT = "specimen-document.tsx";
const SPECIMEN_DOCUMENT_IMPORT = "@/components/specimen-document";
const producerRequire = createRequire(import.meta.url);
async function specimenDocument(): Promise<string> {
  return readFile(join(dirname(producerRequire.resolve("@clossys/designer-ui")), "components", SPECIMEN_DOCUMENT), "utf8");
}

/**
 * The Writer keys the theme and font specimen documents read (strings.common
 * `studio.specimen-sample.*`): every word they show is pinned Writer copy, never a literal here.
 */
export const SPECIMEN_SAMPLE_KEYS = {
  themeTitle: "studio.specimen-sample.theme-title",
  themeText: "studio.specimen-sample.theme-text",
  glyph: "studio.specimen-sample.glyph",
  fontText: "studio.specimen-sample.font-text",
  ramp: {
    display: "studio.specimen-sample.ramp.display",
    "heading-1": "studio.specimen-sample.ramp.heading-1",
    "heading-2": "studio.specimen-sample.ramp.heading-2",
    "heading-3": "studio.specimen-sample.ramp.heading-3",
    "heading-4": "studio.specimen-sample.ramp.heading-4",
    "heading-5": "studio.specimen-sample.ramp.heading-5",
    body: "studio.specimen-sample.ramp.body",
    small: "studio.specimen-sample.ramp.small",
  },
} as const;

/** One Writer key's text, else a visible marker and a finding: a specimen never falls back to a literal. */
function sampleText(copy: Readonly<Record<string, string>>, key: string, slot: string, findings: InstallFinding[]): string {
  const text = copy[key];
  if (typeof text === "string") return text;
  findings.push({ code: "missing-copy-key", slot, detail: `${slot}: the specimen document reads Writer key ${key}, which no pinned Writer slot holds` });
  return `[missing copy ${key}]`;
}

/** Theme leaf: the pinned theme's swatches and type sample, read from its installed CSS variables. */
function themePage(names: readonly string[], text: { title: string; sample: string; glyph: string }): string {
  return [
    "// Generated by Producer Studio: places the pinned theme's specimen document.",
    `import { ThemeSpecimen } from ${JSON.stringify(SPECIMEN_DOCUMENT_IMPORT)};`,
    `export default function Page() { return <ThemeSpecimen names={${JSON.stringify(names)}} title={${JSON.stringify(text.title)}} sample={${JSON.stringify(text.sample)}} glyph={${JSON.stringify(text.glyph)}} />; }`,
    "",
  ].join("\n");
}

/** Font leaf: the pinned font's type ramp, in its installed font variable. */
function fontPage(variable: string, family: string, text: { sample: string; labels: Record<string, string> }): string {
  return [
    "// Generated by Producer Studio: places the pinned font's specimen document.",
    `import { FontSpecimen } from ${JSON.stringify(SPECIMEN_DOCUMENT_IMPORT)};`,
    `export default function Page() { return <FontSpecimen variable={${JSON.stringify(variable)}} family={${JSON.stringify(family)}} sample={${JSON.stringify(text.sample)}} labels={${JSON.stringify(text.labels)}} />; }`,
    "",
  ].join("\n");
}

/** Component leaf: the bound item centred on the page ground, in its slot's declared specimen state. */
function componentPage(item: string, state?: SpecimenState): string {
  const open = state?.state === "open" ? state : undefined;
  const provider = state?.state === "provider" ? state.provider : undefined;
  return [
    "// Generated by Producer Studio: places one component in its specimen document.",
    ...(open ? ['import { useEffect } from "react";', `import { ${open.opener.export} as openSpecimen } from ${JSON.stringify(open.opener.module)};`] : []),
    ...(provider ? [`import { ${provider.export} as SpecimenProvider } from ${JSON.stringify(provider.module)};`] : []),
    `import { ComponentSpecimen } from ${JSON.stringify(SPECIMEN_DOCUMENT_IMPORT)};`,
    `import Item from ${JSON.stringify(item)};`,
    "export default function Page() {",
    ...(open ? [`  useEffect(() => { openSpecimen(${JSON.stringify(open.sample)}, { duration: Infinity }); }, []);`] : []),
    `  return <ComponentSpecimen state={${JSON.stringify(state?.state ?? "rest")}}>${provider ? "<SpecimenProvider><Item /></SpecimenProvider>" : "<Item />"}</ComponentSpecimen>;`,
    "}",
    "",
  ].join("\n");
}

function run(command: string, args: string[], cwd: string, signal?: AbortSignal): Promise<{ code: number; output: string }> {
  return new Promise(done => execFile(command, args, { cwd, timeout: 600_000, maxBuffer: 32 * 1024 * 1024, ...(signal ? { signal } : {}) }, (error, stdout, stderr) => {
    done({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, output: `${stdout}${stderr}` });
  }));
}

export interface PassResult { pages: Map<string, SpecimenPage>; findings: InstallFinding[]; built: boolean }

/**
 * Install and bind `slots` against `pins` into the shared substrate, then build them into `dist`.
 * Passes run one after another in one substrate: installPage re-installs whatever a previous pass
 * left at a different version, so a pass's bundle holds exactly its own pins.
 */
export interface PassOptions {
  readonly library: string; readonly substrate: string; readonly pins: InstallPins; readonly slots: readonly string[];
  readonly records: readonly InstallPageRecord[]; readonly copy: Record<string, string>;
  /** The pinned Writer copy (`pinnedWriterCopy` of the library), scanned once per site, never per pass or candidate. */
  readonly pinnedCopy: Readonly<Record<string, string>>;
  /** Candidates the substrate cannot build (their code imports a host package): refused before any install. */
  readonly hostOnly?: ReadonlyMap<string, readonly string[]>;
  readonly build: SpecimenBuild;
  /** Stops the pass and its shadcn, npm and vite children when the server closes. */
  readonly signal?: AbortSignal;
}

/** Lines of a failed `vite build` a finding keeps from each end: vite names the error first and the stack last. */
const FAILURE_HEAD = 20, FAILURE_TAIL = 5;
/** A failed `vite build` as a finding: the head of its output (the error itself) and its tail, never only the last lines of a stack. */
export function renderFailedFinding(key: string, code: number, output: string): InstallFinding {
  const lines = output.trim().split("\n");
  const shown = lines.length > FAILURE_HEAD + FAILURE_TAIL ? [...lines.slice(0, FAILURE_HEAD), `[${lines.length - FAILURE_HEAD - FAILURE_TAIL} lines omitted]`, ...lines.slice(-FAILURE_TAIL)] : lines;
  return { code: "render-failed", detail: `specimen build ${key} exited ${code}:\n${shown.join("\n")}` };
}

/** A candidate the substrate never builds: a slot finding, so the pass (and its layer) still builds and is reused. */
export function hostOnlyFinding(slot: string, pin: { element: string; version: number }, packages: readonly string[]): InstallFinding {
  return { code: "invalid-page", slot, detail: `${slot}/${pin.element}@v${pin.version} imports host package ${packages.join(", ")}, which the specimen substrate cannot install; the host specimen mount renders it` };
}

async function buildPass(options: PassOptions): Promise<PassResult> {
  const { library, substrate, pins, records, copy, build } = options;
  const pagesDir = join(substrate, "clossys", "pages");
  // Only this pass's pages: a page from another pass or an earlier selection must not reach the bundle.
  await rm(pagesDir, { recursive: true, force: true });
  await mkdir(pagesDir, { recursive: true });
  await mkdir(join(substrate, "components"), { recursive: true });
  await writeFile(join(substrate, "components", SPECIMEN_DOCUMENT), await specimenDocument());
  // One Writer snapshot: a Writer scan per candidate load held the server's event loop for minutes.
  const source = libraryRecordSource({ roots: [library], writerCopy: options.pinnedCopy });
  const runner = shadcnRunner(process.env, options.signal);
  const include = Object.keys(pins).filter(slot => slot.startsWith("themes.")).sort();
  const findings: InstallFinding[] = [];
  const pages = new Map<string, SpecimenPage>();
  let dependencies: Record<string, string> = {};
  // Theme items first: every other page installs them through `include`.
  for (const slot of [...options.slots].sort((a, b) => Number(!a.startsWith("themes.")) - Number(!b.startsWith("themes.")) || a.localeCompare(b))) {
    options.signal?.throwIfAborted();
    const pin = pins[slot]!, page = specimenPageId(slot, pin.element, pin.version);
    // Installing it would add an uninstallable host package to the shared substrate's package.json
    // and fail every later npm install there; the host specimen mount renders it instead.
    const host = options.hostOnly?.get(pageKey(slot, pin.element, pin.version));
    if (host) { findings.push(hostOnlyFinding(slot, pin, host)); continue; }
    if (slot.startsWith("themes.")) {
      // The pinned candidate itself, through the same slot reader every other page installs from.
      const record = await source.read(`${slot}/${pin.element}`, pin.version).catch(() => undefined);
      let item: any;
      try { item = record ? JSON.parse(record.payload.raw) : undefined; }
      catch (error) { findings.push({ code: "not-a-registry-item", slot, detail: `${slot}: ${pin.element}@v${pin.version} is not JSON (${error instanceof Error ? error.message : String(error)})` }); continue; }
      if (!item) { findings.push({ code: "missing-record", slot, detail: `${slot}: no registry item for ${pin.element}@v${pin.version}` }); continue; }
      // The item itself installs through the `include` of every other page in the pass; this page only reads its variables.
      const said = (key: string) => sampleText(copy, key, slot, findings);
      if (item.type === "registry:font" && item.font?.variable) {
        const labels = Object.fromEntries(Object.entries(SPECIMEN_SAMPLE_KEYS.ramp).map(([step, key]) => [step, said(key)]));
        await writeFile(join(pagesDir, `${page}.tsx`), fontPage(item.font.variable, String(item.title ?? item.font.family ?? pin.element), { sample: said(SPECIMEN_SAMPLE_KEYS.fontText), labels }));
      } else await writeFile(join(pagesDir, `${page}.tsx`), themePage(Object.keys({ ...item.cssVars?.light, ...item.cssVars?.dark }).filter(name => name !== "radius" && !name.startsWith("chart-") && !name.startsWith("sidebar")), { title: said(SPECIMEN_SAMPLE_KEYS.themeTitle), sample: said(SPECIMEN_SAMPLE_KEYS.themeText), glyph: said(SPECIMEN_SAMPLE_KEYS.glyph) }));
      pages.set(pageKey(slot, pin.element, pin.version), { page, element: pin.element, version: pin.version, build: build.key });
      continue;
    }
    const record: InstallPageRecord = { id: page, frame: slot, sections: [], ...(include.length ? { include } : {}), copy: copyFor(slot, records) };
    const installed = await installPage({ page: record, pins, source, substrate, runner });
    let result: typeof installed & { page?: BoundPage } = installed;
    if (!installed.findings.some(isBlocking)) {
      // A specimen binds each copy slot explicitly to the Writer key its element previews it with
      // (`previewCopy`); copy of a page record that already places the item wins. Binding itself
      // never falls back to a preview key.
      const bindings = Object.fromEntries(installed.slots.filter(row => row.mounted).map(row => [row.slot, { copy: { ...row.previewCopy, ...record.copy } }]));
      const bound = bindPage({ page: { ...record, bindings }, slots: installed.slots, copy });
      result = { ...installed, findings: bound.findings, ...(bound.page ? { page: bound.page } : {}) };
    }
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
        try { item = mounted ? JSON.parse(mounted.payload.raw) : undefined; }
        catch (error) { findings.push({ code: "not-a-registry-item", slot, detail: `${slot}/${pin.element}@v${pin.version}: mounted record is not JSON (${error instanceof Error ? error.message : String(error)})` }); continue; }
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
    pages.set(pageKey(slot, pin.element, pin.version), { page, element: pin.element, version: pin.version, build: build.key });
  }
  if (!pages.size) return { pages, findings, built: false };
  options.signal?.throwIfAborted();
  const failed = await ensureSubstrateDependencies(substrate, dependencies, npmRunner(process.env, options.signal));
  options.signal?.throwIfAborted();
  if (failed) { findings.push(failed); return { pages: new Map(), findings, built: false }; }
  const vite = join(substrate, "node_modules", "vite", "bin", "vite.js");
  const built = await run(process.execPath, [vite, "build", "--base", `${SITE_PREFIX}${build.key}/`, "--outDir", build.dist, "--emptyOutDir", "--logLevel", "error"], substrate, options.signal);
  options.signal?.throwIfAborted();
  if (built.code !== 0) { findings.push(renderFailedFinding(build.key, built.code, built.output)); return { pages: new Map(), findings, built: false }; }
  return { pages, findings, built: true };
}

export interface SiteInputs {
  readonly root: string; readonly library: string; readonly key: string; readonly substrate: string; readonly base: string;
  readonly pins: InstallPins; readonly unpinned: InstallPins; readonly options: ReadonlyMap<string, readonly { element: string; version: number }[]>;
  /** Candidates whose code imports a host package (`<slot>/<element>@v<version>` -> packages): never built in the substrate. */
  readonly hostOnly: ReadonlyMap<string, readonly string[]>;
  readonly records: readonly InstallPageRecord[]; readonly recordFindings: readonly InstallFinding[]; readonly copy: Record<string, string>;
  readonly pinnedCopy: Readonly<Record<string, string>>;
}

async function siteInputs(root: string, library: string): Promise<SiteInputs | undefined> {
  const inputs = slotInstallInputs(library);
  if (!inputs) return undefined;
  const pinnedCopy = pinnedWriterCopy(library);
  // Compiled Writer copy wins; the pinned Writer slots fill a consumer that has not compiled yet.
  const copy = { ...pinnedCopy, ...await writerCopy(root).catch(() => ({} as Record<string, string>)) };
  const { records, findings: recordFindings } = await pageRecords(root, inputs.pins);
  const key = hash(SPECIMEN_FORMAT, await specimenDocument(), root, inputs.fingerprint, JSON.stringify(copy), JSON.stringify(records), JSON.stringify(recordFindings)).slice(0, 16);
  const substrate = specimenSubstrate(root);
  return { root, library, key, substrate, base: dirname(substrate), pins: inputs.pins, unpinned: inputs.unpinned, options: inputs.options, hostOnly: inputs.hostOnly, records, recordFindings, copy, pinnedCopy };
}

/** A finding that says the pass itself did not build (vite, or the substrate's npm install), not one slot. */
const passFailed = (finding: InstallFinding) => finding.code === "render-failed" || (finding.code === "install-failed" && !finding.slot);

/**
 * A saved build is reused while every dist it names is still on disk. A pass that did not build
 * is never reused: its manifest names no dist (`[].every` holds), so a failed build would
 * otherwise be served as a finished one until the selection changed.
 */
export async function savedSite(manifest: string): Promise<{ builds: SpecimenBuild[]; pages: Map<string, SpecimenPage>; findings: InstallFinding[] } | undefined> {
  if (!existsSync(manifest)) return undefined;
  const saved = await readJson(manifest);
  const builds = saved.builds as SpecimenBuild[], findings = (saved.findings ?? []) as InstallFinding[];
  if (!builds.length && findings.some(passFailed)) return undefined;
  if (!builds.every(build => existsSync(join(build.dist, "index.html")))) return undefined;
  return { builds, pages: new Map(Object.entries(saved.pages)), findings };
}

/** The layer a pinned slot builds in: its IA root (`components.button` -> `components`). */
const layerOf = (slot: string) => slot.split(".")[0]!;

/** What a site build runs; tests replace the substrate and the pass. */
export interface SiteBuildSteps { readonly prepare: (substrate: string) => Promise<unknown>; readonly pass: (options: PassOptions) => Promise<PassResult> }
const SITE_STEPS: SiteBuildSteps = { prepare: ensureSubstrate, pass: buildPass };

/**
 * The pinned selection, one build per layer (themes, assets, components, sections, frames), each
 * with exactly the pins pages install. A page module that breaks its bundle blanks only its own
 * layer, and its finding is surfaced with the site's. Themes build last: their pages read the
 * CSS variables every other layer's pages install through `include`.
 */
export async function buildSite(inputs: SiteInputs, steps: SiteBuildSteps = SITE_STEPS, signal?: AbortSignal): Promise<InstalledSpecimenSite> {
  const { key, base, substrate, pins, library, records, recordFindings, copy, pinnedCopy } = inputs;
  const layers = [...new Set(Object.keys(pins).map(layerOf))].sort((a, b) => Number(a === "themes") - Number(b === "themes") || a.localeCompare(b));
  const builds: SpecimenBuild[] = [], pages = new Map<string, SpecimenPage>(), findings: InstallFinding[] = [...recordFindings];
  let prepared = false;
  for (const layer of layers) {
    // `<site key>-<12 hex>`: the shape the site CSP accepts (an option build's key has it too).
    const layerKey = `${key}-${hash("layer", layer).slice(0, 12)}`;
    const layerBuild = { key: layerKey, dist: join(base, `dist-${layerKey}`) };
    const manifest = join(base, `site-${layerBuild.key}.json`);
    let result = await savedSite(manifest);
    if (!result) {
      signal?.throwIfAborted();
      if (!prepared) { await steps.prepare(substrate); prepared = true; }
      const slots = Object.keys(pins).filter(slot => layerOf(slot) === layer);
      const passed = await steps.pass({ library, substrate, pins, slots, records, copy, pinnedCopy, hostOnly: inputs.hostOnly, build: layerBuild, ...(signal ? { signal } : {}) });
      // A pass stopped by shutdown is never saved: its findings name the stop, not the selection.
      signal?.throwIfAborted();
      result = { builds: passed.built ? [layerBuild] : [], pages: passed.built ? passed.pages : new Map(), findings: passed.findings };
      await writeFile(manifest, `${JSON.stringify({ schema: SPECIMEN_FORMAT, key: layerBuild.key, layer, builds: result.builds, pages: Object.fromEntries(result.pages), findings: result.findings }, null, 2)}\n`);
    }
    builds.push(...result.builds);
    for (const [name, page] of result.pages) pages.set(name, page);
    findings.push(...result.findings);
  }
  return { key, builds, pages, findings };
}

/**
 * One recorded candidate that is not the pin, rendered from its own bytes: the slot swaps in this
 * (element, version) and every other slot keeps its pin. Built when Studio first asks for it.
 */
async function buildOption(inputs: SiteInputs, slot: string, option: { element: string; version: number }, signal?: AbortSignal): Promise<{ build?: SpecimenBuild; page?: SpecimenPage; findings: InstallFinding[] }> {
  const { base, substrate, pins, unpinned, library, records, copy, pinnedCopy } = inputs;
  const key = `${inputs.key}-${hash(slot, option.element, String(option.version)).slice(0, 12)}`;
  const manifest = join(base, `site-${key}.json`);
  const saved = await savedSite(manifest);
  if (saved) return { ...(saved.builds[0] ? { build: saved.builds[0] } : {}), ...(saved.pages.get(pageKey(slot, option.element, option.version)) ? { page: saved.pages.get(pageKey(slot, option.element, option.version))! } : {}), findings: saved.findings };
  await ensureSubstrate(substrate);
  const build = { key, dist: join(base, `dist-${key}`) };
  const result = await buildPass({ library, substrate, pins: { ...unpinned, ...pins, [slot]: option }, slots: [slot], records, copy, pinnedCopy, hostOnly: inputs.hostOnly, build, ...(signal ? { signal } : {}) });
  signal?.throwIfAborted();
  const builds = result.built ? [build] : [];
  await writeFile(manifest, `${JSON.stringify({ schema: SPECIMEN_FORMAT, key, builds, pages: Object.fromEntries(result.built ? result.pages : []), findings: result.findings }, null, 2)}\n`);
  const page = result.built ? result.pages.get(pageKey(slot, option.element, option.version)) : undefined;
  return { ...(result.built ? { build } : {}), ...(page ? { page } : {}), findings: result.findings };
}

const LOCAL_ORIGIN = /^http:\/\/(?:127\.0\.0\.1|localhost):\d{1,5}$/;
/**
 * The policy every `/__specimen-site/<key>/` response carries. The built page loads only its own
 * build: script, stylesheets, fonts and images from `<origin>/__specimen-site/<key>/` (a path
 * source, so neither Studio's routes nor another build qualify), inline styles for the
 * components that inject them, and `data:` fonts and images. It has nothing to fetch, frame,
 * submit or embed (`connect-src`, `frame-src`, `form-action`, `object-src` fall to `'none'`).
 *
 * Its own sandbox (`allow-scripts allow-same-origin`, no `allow-top-navigation`, `allow-popups`,
 * `allow-forms` or `allow-modals`) keeps the bundle from navigating the top window, opening
 * windows or submitting forms wherever it loads. In Studio's own cards it keeps Studio's origin
 * (the frame page measures it); framed by a served preview page it inherits that frame's
 * opaque origin, which no CSP flag can widen.
 *
 * No `frame-ancestors`: inside a preview its parent frame page is opaque, and `'self'` never
 * matches an opaque ancestor. That parent (`/__specimen`) carries `frame-ancestors 'self'`.
 */
export function specimenSiteCsp(origin: string, build: string): string {
  const site = LOCAL_ORIGIN.test(origin) && /^[a-z0-9]+(?:-[a-f0-9]{12})?$/.test(build) ? `${origin}${SITE_PREFIX}${build}/` : "'none'";
  return [
    "sandbox allow-scripts allow-same-origin", "default-src 'none'", `script-src ${site}`, `style-src ${site} 'unsafe-inline'`,
    `font-src ${site} data:`, `img-src ${site} data:`, "connect-src 'none'", "base-uri 'none'", "form-action 'none'",
  ].join("; ");
}

/**
 * `signal` (the server's close) stops the pinned and option builds and their children: a closed
 * server must exit at once, not after a cold substrate install and vite build (about 55 s
 * measured 2026-11-12 on a fresh TMPDIR).
 */
export function installedSpecimens(options: { root: string; library: string; signal?: AbortSignal }): InstalledSpecimens {
  const { signal } = options;
  const warn = (error: unknown) => {
    if (signal?.aborted) return undefined;
    console.warn("Producer specimens could not be built:", error instanceof Error ? error.message.split("\n")[0] : String(error));
    return undefined;
  };
  const inputs = siteInputs(resolve(options.root), resolve(options.library)).catch(warn);
  return installedSpecimenRoutes(inputs.then(value => value ? buildSite(value, SITE_STEPS, signal) : undefined).catch(warn), inputs, signal);
}

/**
 * The `/__specimen` and `/__specimen-site/*` routes over a (being) built pinned site. With the
 * site's inputs, a recorded candidate that is not the pin is built on first request.
 */
export function installedSpecimenRoutes(ready: Promise<InstalledSpecimenSite | undefined>, inputs: Promise<SiteInputs | undefined> = Promise.resolve(undefined), signal?: AbortSignal): InstalledSpecimens {
  const warn = (error: unknown) => {
    if (signal?.aborted) return undefined;
    console.warn("Producer specimens could not be built:", error instanceof Error ? error.message.split("\n")[0] : String(error));
    return undefined;
  };
  // Option builds share the one substrate with the pinned build, so they run one at a time after it.
  let queue: Promise<unknown> = ready;
  const optionBuilds = new Map<string, Promise<{ build?: SpecimenBuild; page?: SpecimenPage }>>();
  const builtOptions: SpecimenBuild[] = [];
  const option = (site: SiteInputs, slot: string, element: string, version: number) => {
    const name = pageKey(slot, element, version);
    let pending = optionBuilds.get(name);
    if (!pending) {
      pending = queue.then(() => buildOption(site, slot, { element, version }, signal)).then(result => { if (result.build) builtOptions.push(result.build); return result; }, error => { warn(error); return {}; });
      optionBuilds.set(name, pending);
      queue = pending;
    }
    return pending;
  };
  return {
    ready,
    async handle(request, response, pathname) {
      if (pathname === "/__specimen") {
        const params = new URL(request.url ?? "", "http://studio.invalid").searchParams;
        const [slot, element] = (params.get("element") ?? "").split("/");
        const given = await inputs;
        const version = params.get("v");
        // A candidate the substrate never builds (its code imports a host package) falls through to the
        // host specimen mount at once: it must not wait on the pinned site's build or the option queue.
        const named = version === null ? given?.pins[slot ?? ""] : { element, version: Number(version) };
        if (given && slot && element && named && named.element === element && given.hostOnly.has(pageKey(slot, element, named.version))) return false;
        const site = await ready;
        if (!site || !slot || !element) return false;
        // Without `v` the pinned candidate answers. With `v` the named candidate answers: the pin from
        // the pinned build, any other recorded candidate from its own preview build.
        let entry: SpecimenPage | undefined;
        if (version === null) entry = [...site.pages].find(([name]) => name.startsWith(`${slot}/`))?.[1];
        else {
          const v = Number(version);
          entry = site.pages.get(pageKey(slot, element, v));
          if (!entry && given && given.options.get(slot)?.some(row => row.element === element && row.version === v)) entry = (await option(given, slot, element, v)).page;
        }
        if (!entry || entry.element !== element) return false;
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
      // Longest key first: an option build's key extends the pinned build's key.
      const build = [...(site?.builds ?? []), ...builtOptions].sort((a, b) => b.key.length - a.key.length).find(candidate => rest.startsWith(`${candidate.key}/`));
      if (!build) { response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); response.end("Specimen build is not available\n"); return true; }
      const file = resolve(build.dist, rest.slice(build.key.length + 1) || "index.html");
      const inside = relative(build.dist, file);
      let target: string | undefined;
      if (inside && !inside.startsWith("..") && !isAbsolute(inside) && !inside.split(sep).some(part => part.startsWith("."))) {
        try { target = await realpath(file); if (!(await stat(target)).isFile() || relative(await realpath(build.dist), target).startsWith("..")) target = undefined; } catch (error) { if (!isAbsent(error)) throw error; target = undefined; }
      }
      if (!target) { response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); response.end("Not found\n"); return true; }
      response.writeHead(200, { "Content-Type": TYPES[extname(target)] ?? "application/octet-stream", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": specimenSiteCsp(`http://${request.headers.host ?? ""}`, build.key) });
      response.end(request.method === "HEAD" ? undefined : await readFile(target));
      return true;
    },
  };
}
