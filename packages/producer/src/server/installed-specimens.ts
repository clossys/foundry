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
import { installAndBind, isBlocking, substrateDependencies, type InstallFinding, type InstallPageRecord, type InstallPins } from "@clossys/publisher/install";
import { slotInstallInputs } from "../specimen/slot-install-inputs.js";
import { libraryRecordSource } from "../specimen/library-source.js";
import { specimenPageSlotIds } from "../specimen/page-slot-ids.js";
import { ensureSubstrate, ensureSubstrateDependencies, npmRunner, pageModule, pageRecordFromCell, shadcnRunner, writerCopy } from "../publish/install.js";

/** Bumped when the generated specimen pages change shape. */
const SPECIMEN_FORMAT = "studio-specimens/8";
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

/** Theme leaf: the pinned theme's swatches and type sample, read from its installed CSS variables. */
function themePage(names: readonly string[]): string {
  return [
    "// Generated by Producer Studio: places the pinned theme's specimen document.",
    `import { ThemeSpecimen } from ${JSON.stringify(SPECIMEN_DOCUMENT_IMPORT)};`,
    `export default function Page() { return <ThemeSpecimen names={${JSON.stringify(names)}} />; }`,
    "",
  ].join("\n");
}

/** Font leaf: the pinned font's type ramp, in its installed font variable. */
function fontPage(variable: string, family: string): string {
  return [
    "// Generated by Producer Studio: places the pinned font's specimen document.",
    `import { FontSpecimen } from ${JSON.stringify(SPECIMEN_DOCUMENT_IMPORT)};`,
    `export default function Page() { return <FontSpecimen variable={${JSON.stringify(variable)}} family={${JSON.stringify(family)}} />; }`,
    "",
  ].join("\n");
}

/** Component leaf: the bound item centred on the page ground, in its slot's declared specimen state. */
function componentPage(item: string, state?: SpecimenState): string {
  const open = state?.state === "open" ? state : undefined;
  return [
    "// Generated by Producer Studio: places one component in its specimen document.",
    ...(open ? ['import { useEffect } from "react";', `import { ${open.opener.export} as openSpecimen } from ${JSON.stringify(open.opener.module)};`] : []),
    `import { ComponentSpecimen } from ${JSON.stringify(SPECIMEN_DOCUMENT_IMPORT)};`,
    `import Item from ${JSON.stringify(item)};`,
    "export default function Page() {",
    ...(open ? [`  useEffect(() => { openSpecimen(${JSON.stringify(open.sample)}, { duration: Infinity }); }, []);`] : []),
    `  return <ComponentSpecimen state={${JSON.stringify(state?.state ?? "rest")}}><Item /></ComponentSpecimen>;`,
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
  await mkdir(join(substrate, "components"), { recursive: true });
  await writeFile(join(substrate, "components", SPECIMEN_DOCUMENT), await specimenDocument());
  const source = libraryRecordSource({ roots: [library] });
  const runner = shadcnRunner();
  const include = Object.keys(pins).filter(slot => slot.startsWith("themes.")).sort();
  const findings: InstallFinding[] = [];
  const pages = new Map<string, SpecimenPage>();
  let dependencies: Record<string, string> = {};
  // Theme items first: every other page installs them through `include`.
  for (const slot of [...options.slots].sort((a, b) => Number(!a.startsWith("themes.")) - Number(!b.startsWith("themes.")) || a.localeCompare(b))) {
    const pin = pins[slot]!, page = specimenPageId(slot, pin.element, pin.version);
    if (slot.startsWith("themes.")) {
      // The pinned candidate itself, through the same slot reader every other page installs from.
      const record = await source.read(`${slot}/${pin.element}`, pin.version).catch(() => undefined);
      let item: any;
      try { item = record ? JSON.parse(record.payload.raw) : undefined; } catch { item = undefined; }
      if (!item) { findings.push({ code: "missing-record", slot, detail: `${slot}: no registry item for ${pin.element}@v${pin.version}` }); continue; }
      // The item itself installs through the `include` of every other page in the pass; this page only reads its variables.
      if (item.type === "registry:font" && item.font?.variable) await writeFile(join(pagesDir, `${page}.tsx`), fontPage(item.font.variable, String(item.title ?? item.font.family ?? pin.element)));
      else await writeFile(join(pagesDir, `${page}.tsx`), themePage(Object.keys({ ...item.cssVars?.light, ...item.cssVars?.dark }).filter(name => name !== "radius" && !name.startsWith("chart-") && !name.startsWith("sidebar"))));
      pages.set(pageKey(slot, pin.element, pin.version), { page, element: pin.element, version: pin.version, build: build.key });
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
    pages.set(pageKey(slot, pin.element, pin.version), { page, element: pin.element, version: pin.version, build: build.key });
  }
  if (!pages.size) return { pages, findings, built: false };
  const failed = await ensureSubstrateDependencies(substrate, dependencies, npmRunner());
  if (failed) { findings.push(failed); return { pages: new Map(), findings, built: false }; }
  const vite = join(substrate, "node_modules", "vite", "bin", "vite.js");
  const built = await run(process.execPath, [vite, "build", "--base", `${SITE_PREFIX}${build.key}/`, "--outDir", build.dist, "--emptyOutDir", "--logLevel", "error"], substrate);
  if (built.code !== 0) { findings.push({ code: "render-failed", detail: `specimen build ${build.key} exited ${built.code}: ${built.output.trim().split("\n").slice(-3).join(" ")}` }); return { pages: new Map(), findings, built: false }; }
  return { pages, findings, built: true };
}

interface SiteInputs {
  readonly root: string; readonly library: string; readonly key: string; readonly substrate: string; readonly base: string;
  readonly pins: InstallPins; readonly unpinned: InstallPins; readonly options: ReadonlyMap<string, readonly { element: string; version: number }[]>;
  readonly records: readonly InstallPageRecord[]; readonly copy: Record<string, string>;
}

async function siteInputs(root: string, library: string): Promise<SiteInputs | undefined> {
  const inputs = slotInstallInputs(library);
  if (!inputs) return undefined;
  // Compiled Writer copy wins; the pinned Writer slots fill a consumer that has not compiled yet.
  const copy = { ...pinnedWriterCopy(library), ...await writerCopy(root).catch(() => ({} as Record<string, string>)) };
  const records = await pageRecords(root, inputs.pins);
  const key = hash(SPECIMEN_FORMAT, await specimenDocument(), root, inputs.fingerprint, JSON.stringify(copy), JSON.stringify(records)).slice(0, 16);
  const substrate = specimenSubstrate(root);
  return { root, library, key, substrate, base: dirname(substrate), pins: inputs.pins, unpinned: inputs.unpinned, options: inputs.options, records, copy };
}

/** A saved build is reused while every dist it names is still on disk. */
async function savedSite(manifest: string): Promise<{ builds: SpecimenBuild[]; pages: Map<string, SpecimenPage>; findings: InstallFinding[] } | undefined> {
  if (!existsSync(manifest)) return undefined;
  const saved = await readJson(manifest);
  if (!(saved.builds as SpecimenBuild[]).every(build => existsSync(join(build.dist, "index.html")))) return undefined;
  return { builds: saved.builds, pages: new Map(Object.entries(saved.pages)), findings: saved.findings };
}

/** The pinned selection: one pass, every pinned slot, exactly the pins pages install. */
async function buildSite(inputs: SiteInputs): Promise<InstalledSpecimenSite> {
  const { key, base, substrate, pins, library, records, copy } = inputs;
  const manifest = join(base, `site-${key}.json`);
  const saved = await savedSite(manifest);
  if (saved) return { key, ...saved };
  await ensureSubstrate(substrate);
  const build = { key, dist: join(base, `dist-${key}`) };
  const result = await buildPass({ library, substrate, pins, slots: Object.keys(pins), records, copy, build });
  const builds = result.built ? [build] : [];
  const pages = result.built ? result.pages : new Map<string, SpecimenPage>();
  await writeFile(manifest, `${JSON.stringify({ schema: SPECIMEN_FORMAT, key, builds, pages: Object.fromEntries(pages), findings: result.findings }, null, 2)}\n`);
  return { key, builds, pages, findings: result.findings };
}

/**
 * One recorded candidate that is not the pin, rendered from its own bytes: the slot swaps in this
 * (element, version) and every other slot keeps its pin. Built when Studio first asks for it.
 */
async function buildOption(inputs: SiteInputs, slot: string, option: { element: string; version: number }): Promise<{ build?: SpecimenBuild; page?: SpecimenPage; findings: InstallFinding[] }> {
  const { base, substrate, pins, unpinned, library, records, copy } = inputs;
  const key = `${inputs.key}-${hash(slot, option.element, String(option.version)).slice(0, 12)}`;
  const manifest = join(base, `site-${key}.json`);
  const saved = await savedSite(manifest);
  if (saved) return { ...(saved.builds[0] ? { build: saved.builds[0] } : {}), ...(saved.pages.get(pageKey(slot, option.element, option.version)) ? { page: saved.pages.get(pageKey(slot, option.element, option.version))! } : {}), findings: saved.findings };
  await ensureSubstrate(substrate);
  const build = { key, dist: join(base, `dist-${key}`) };
  const result = await buildPass({ library, substrate, pins: { ...unpinned, ...pins, [slot]: option }, slots: [slot], records, copy, build });
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

export function installedSpecimens(options: { root: string; library: string }): InstalledSpecimens {
  const warn = (error: unknown) => {
    console.warn("Producer specimens could not be built:", error instanceof Error ? error.message.split("\n")[0] : String(error));
    return undefined;
  };
  const inputs = siteInputs(resolve(options.root), resolve(options.library)).catch(warn);
  return installedSpecimenRoutes(inputs.then(value => value ? buildSite(value) : undefined).catch(warn), inputs);
}

/**
 * The `/__specimen` and `/__specimen-site/*` routes over a (being) built pinned site. With the
 * site's inputs, a recorded candidate that is not the pin is built on first request.
 */
export function installedSpecimenRoutes(ready: Promise<InstalledSpecimenSite | undefined>, inputs: Promise<SiteInputs | undefined> = Promise.resolve(undefined)): InstalledSpecimens {
  const warn = (error: unknown) => {
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
      pending = queue.then(() => buildOption(site, slot, { element, version })).then(result => { if (result.build) builtOptions.push(result.build); return result; }, error => { warn(error); return {}; });
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
        const site = await ready, given = await inputs;
        const version = params.get("v");
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
        try { target = await realpath(file); if (!(await stat(target)).isFile() || relative(await realpath(build.dist), target).startsWith("..")) target = undefined; } catch { target = undefined; }
      }
      if (!target) { response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); response.end("Not found\n"); return true; }
      response.writeHead(200, { "Content-Type": TYPES[extname(target)] ?? "application/octet-stream", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": specimenSiteCsp(`http://${request.headers.host ?? ""}`, build.key) });
      response.end(request.method === "HEAD" ? undefined : await readFile(target));
      return true;
    },
  };
}
