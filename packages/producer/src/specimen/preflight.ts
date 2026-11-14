/**
 * Specimen preflight: one certification for every Designer candidate of every slot, pinned or
 * not, run before Studio capture (`capture:studio`) and with no browser. Each candidate passes the
 * rules a candidate submitted today passes, and none is excused for being already held:
 *
 *   submission/schema      the `designer.candidates` output schema (`clossys next --submit`);
 *   submission/duplicate   bytes identical to another candidate of the slot (a submission adds an option);
 *   slot-model/<code>      the slot model check's issues on this candidate file (`checkSlotModel`);
 *   ref-verbatim/<code>    the Designer ref-verbatim check of this candidate (`designer.check`'s strict
 *                          share), a shrink-only baseline row counted as failing;
 *   preview/missing-file   `meta.preview.entry` or `meta.preview.fixtures.file` names a file the
 *                          candidate does not ship;
 *   entry/commonjs         the entry module is CommonJS, not a component;
 *   contract/<class>       certification against the slot contract fixture (slot.json
 *                          `contract.fixture`, planner decision D1; library-source.ts certifyCandidate):
 *                          no-contract-fixture, contract-fixture-invalid, does-not-ship-fixture-export,
 *                          needs-extra-props or fixture-inputs;
 *   mount/<class>          the candidate's specimen loaded, built and mounted in jsdom as the host
 *                          `/__specimen` route mounts it, with the slot contract fixture when the slot
 *                          declares one the candidate fits (over its own preview), else its own preview,
 *                          never another candidate's: record, build, runtime (a throw or
 *                          console.error), fallback (the error boundary), empty (nothing rendered) or timeout.
 *
 * Two columns are reported beside the failing rules, never credited as passing:
 *   contractFixture  the candidate mounted the slot contract fixture;
 *   notRenderable    Studio shows it only through the `not-renderable` specimen state (a CommonJS entry).
 *
 * Every candidate is checked and every failing rule listed in one pass; a failure on one
 * candidate never stops the pass. Non-visual kinds (themes, fonts) are certified by every rule but
 * the mount, which the host route does not perform for them. Run decisions given only at
 * submission (model, tier, skill, ladder rung) are not stored with the candidate bytes and are
 * outside this certification.
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { createSpecimenBuilder, renderSpecimenPage, type SpecimenRecord, type SpecimenRecordSource } from "@clossys/publisher/specimen";
import { listSlots, readCandidate, readSlot } from "../records/slots.js";
import { checkSlotModel } from "../records/slot-check.js";
import { CANDIDATE_NAME } from "../records/slot-model/index.js";
import { validateFile } from "../pipeline/schema.js";
import { commonJsEntry } from "../server/installed-specimens.js";
import { pinnedWriterCopy } from "../server/specimen-tree.js";
import { certifyCandidate, libraryRecordSource } from "./library-source.js";
import { reasonClass } from "./contract-fixture-derive.js";

/** One candidate's certification. */
export interface CertificationRow {
  readonly slot: string;
  /** The candidate file name (`<element>-v<version>.json`). */
  readonly candidate: string;
  readonly pinned: boolean;
  /** Every failing rule, `<rule>: <detail>`; empty when the candidate is certified. */
  readonly failing: readonly string[];
  /** Mounted the slot contract fixture (slot.json `contract.fixture`). */
  readonly contractFixture: boolean;
  /** Renders in Studio only through the `not-renderable` specimen state. */
  readonly notRenderable: boolean;
}

/** One failing (slot, candidate, rule) row of a certification. */
export interface PreflightRow { readonly slot: string; readonly candidate: string; readonly pinned: boolean; readonly reason: string }

export interface PreflightOptions {
  /** One consumer root (holds agents/designer/ia.json). */
  readonly root: string;
  /** The repository root the specimen builder resolves Tailwind and npm dependencies from. */
  readonly workspace: string;
  /** The stock shadcn registry base (see LibrarySourceOptions.registryBase). */
  readonly registryBase?: string;
  /** Only slots whose id equals or starts with one of these (default: every Designer slot). */
  readonly slots?: readonly string[];
  /** Candidates mounted at once (default 4). */
  readonly concurrency?: number;
  /** Milliseconds one mount may take before it is a `mount/timeout` rule (default 90 s). */
  readonly timeoutMs?: number;
  /** Milliseconds the mounted page settles before its health is read (default 300). */
  readonly settleMs?: number;
  /** Whether to run the ref-verbatim rule (default true; it reads every candidate's lineage). */
  readonly refVerbatim?: boolean;
  /** Called after each candidate (progress). */
  readonly onCandidate?: (row: CertificationRow) => void;
}

export interface PreflightResult {
  /** Every candidate, in IA order then file order. */
  readonly table: readonly CertificationRow[];
  /** Every failing rule of every candidate, flat. */
  readonly rows: readonly PreflightRow[];
  /** Candidates mounted in jsdom (the visual ones whose record loaded). */
  readonly mounted: number;
  /** Rules that could not run at all (each a reason the certification is incomplete). */
  readonly limits: readonly string[];
}

/** The submission schema of a Designer element candidate (the `designer.candidates` step's output). */
export const CANDIDATE_SCHEMA = "candidate-element";

/** Browser APIs layout-measuring libraries read on mount that jsdom does not ship (as in specimen-mount.test.ts). */
export const BROWSER_STUBS = `
const SIZE = { width: 480, height: 240 };
window.ResizeObserver = class {
  constructor(callback) { this.callback = callback; }
  observe(target) { setTimeout(() => this.callback([{ target, contentRect: { ...SIZE, x: 0, y: 0, top: 0, left: 0, right: SIZE.width, bottom: SIZE.height }, borderBoxSize: [{ inlineSize: SIZE.width, blockSize: SIZE.height }], contentBoxSize: [{ inlineSize: SIZE.width, blockSize: SIZE.height }] }], this), 0); }
  unobserve() {} disconnect() {}
};
window.IntersectionObserver = window.IntersectionObserver || class { constructor() {} observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
window.HTMLElement.prototype.getBoundingClientRect = function () { return { x: 0, y: 0, top: 0, left: 0, right: SIZE.width, bottom: SIZE.height, ...SIZE, toJSON() {} }; };
for (const name of ["offsetWidth", "clientWidth", "scrollWidth"]) Object.defineProperty(window.HTMLElement.prototype, name, { configurable: true, get() { return SIZE.width; } });
for (const name of ["offsetHeight", "clientHeight", "scrollHeight"]) Object.defineProperty(window.HTMLElement.prototype, name, { configurable: true, get() { return SIZE.height; } });
window.matchMedia = query => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } });
window.CSS = window.CSS || { supports: () => false, escape: value => String(value) };
if (!window.performance.getEntriesByType) window.performance.getEntriesByType = () => [];
window.DOMMatrixReadOnly = window.DOMMatrixReadOnly || class { constructor(transform) { const scale = /scale\\(([\\d.]+)\\)/.exec(transform || ""); this.m22 = this.a = this.d = scale ? Number(scale[1]) : 1; } };
window.DOMRect = window.DOMRect || class { constructor(x = 0, y = 0, width = 0, height = 0) { Object.assign(this, { x, y, width, height, top: y, left: x, right: x + width, bottom: y + height }); } };
window.scrollTo = () => {};
window.HTMLElement.prototype.scrollIntoView = function () {};
`;

/** Certification reasons under which the contract fixture is not what the candidate mounts. */
const UNMOUNTED = new Set(["no-contract-fixture", "contract-fixture-invalid", "does-not-ship-fixture-export"]);

type RawItem = { files?: { path?: unknown; type?: unknown; content?: unknown }[]; meta?: { preview?: unknown } };
const CODE_FILE = /\.(?:[cm]?[jt]sx?)$/;
const detail = (error: unknown) => (error instanceof Error ? error.message : String(error)).split("\n")[0]!.slice(0, 400);

/** The preview and entry rules, from the candidate's own bytes. */
export function itemRules(bytes: string): { failing: string[]; commonJs: boolean } {
  let item: RawItem;
  try { item = JSON.parse(bytes) as RawItem; } catch { return { failing: [], commonJs: false }; }
  const failing: string[] = [];
  const files = (item.files ?? []).filter((file): file is { path: string; type?: unknown; content?: unknown } => typeof file.path === "string");
  const shipped = new Set(files.map(file => file.path));
  const preview = item.meta?.preview && typeof item.meta.preview === "object" && !Array.isArray(item.meta.preview) ? item.meta.preview as Record<string, unknown> : undefined;
  const fixtures = preview?.fixtures && typeof preview.fixtures === "object" ? preview.fixtures as Record<string, unknown> : undefined;
  for (const [where, file] of [["meta.preview.entry", preview?.entry], ["meta.preview.fixtures.file", fixtures?.file]] as const) {
    if (typeof file === "string" && !shipped.has(file)) failing.push(`preview/missing-file: ${where} names ${file}, which the candidate does not ship`);
  }
  const code = files.filter(file => CODE_FILE.test(file.path));
  const declared = typeof fixtures?.file === "string" ? fixtures.file : typeof preview?.entry === "string" ? preview.entry : undefined;
  const entry = declared !== undefined ? code.find(file => file.path === declared) : code.find(file => typeof file.type === "string" && /registry:(?:ui|component|block|page)/.test(file.type)) ?? code[0];
  const commonJs = !!entry && typeof entry.content === "string" && commonJsEntry(entry.content);
  if (commonJs) failing.push(`entry/commonjs: ${entry!.path} is a CommonJS module, not a component`);
  return { failing, commonJs };
}

class MountTimeout extends Error { constructor(ms: number) { super(`did not build and mount within ${ms} ms`); } }
function deadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([work, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new MountTimeout(ms)), ms); timer.unref?.(); })]).finally(() => clearTimeout(timer));
}

type Builder = ReturnType<typeof createSpecimenBuilder>;

/** Mount one record as `/__specimen` serves it; each problem as `mount/<class>: <detail>`. */
async function mountRecord(record: SpecimenRecord, source: SpecimenRecordSource, builder: Builder, settleMs: number): Promise<string[]> {
  const require = createRequire(import.meta.url);
  const { JSDOM, VirtualConsole } = require("jsdom") as { JSDOM: new (html: string, options: object) => { window: any }; VirtualConsole: new () => { on(event: string, listener: (value: unknown) => void): void } };
  const problems = new Set<string>();
  const theme = await source.theme(record.preview.theme);
  const build = await builder.build(record, source);
  for (const error of build.errors) problems.add(`mount/build: ${detail(error)}`);
  const html = renderSpecimenPage({ query: { element: record.id, version: record.version }, record, ...(theme ? { theme } : {}), build, mode: "light", assetBase: "/assets/", nonce: "preflight" });
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", error => problems.add(`mount/runtime: ${detail(error)}`));
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "http://localhost/", virtualConsole });
  dom.window.addEventListener("error", (event: { error?: Error; message?: string }) => problems.add(`mount/runtime: ${detail(event.error ?? event.message ?? "error")}`));
  try {
    dom.window.eval(BROWSER_STUBS);
    const bootstrap = dom.window.document.querySelector("head script")?.textContent;
    if (bootstrap) dom.window.eval(bootstrap);
    if (build.js) {
      try { dom.window.eval(build.js.replace(/^export\s*\{[^}]*\};?\s*$/m, "").replace(/\bimport\.meta\b/g, '({ url: "http://localhost/specimen.js" })')); }
      catch (error) { problems.add(`mount/runtime: ${detail(error)}`); }
    }
    await new Promise(done => setTimeout(done, settleMs));
    const health = dom.window.__clossysSpecimen?.health?.() as { errors?: { items?: { source: string; message: string }[] } } | undefined;
    for (const item of health?.errors?.items ?? []) problems.add(item.source === "build" ? `mount/build: ${detail(item.message)}` : `mount/runtime: ${item.source}: ${detail(item.message)}`);
    const root = dom.window.document.getElementById("specimen-root");
    const fallback = root?.querySelector("[data-specimen-error]")?.textContent;
    if (fallback) problems.add(`mount/fallback: ${detail(fallback)}`);
    else if (!root || !root.innerHTML.trim()) problems.add("mount/empty: the specimen root rendered nothing");
  } finally { dom.window.close(); }
  return [...problems];
}

/** Read and mount one candidate through `source`; its mount rules (empty when it mounts cleanly). */
async function mountRules(source: SpecimenRecordSource, builder: Builder, id: string, version: number, options: { settleMs: number; timeoutMs: number }): Promise<{ failing: string[]; record?: SpecimenRecord }> {
  let record: SpecimenRecord | undefined;
  try { record = await source.read(id, version); } catch (error) { return { failing: [`mount/record: ${detail(error)}`] }; }
  if (!record) return { failing: ["mount/record: the specimen source does not load this candidate"] };
  if (record.kind !== "visual") return { failing: [], record };
  try { return { failing: await deadline(mountRecord(record, source, builder, options.settleMs), options.timeoutMs), record }; }
  catch (error) { return { failing: [error instanceof MountTimeout ? `mount/timeout: ${error.message}` : `mount/runtime: ${detail(error)}`], record }; }
}

/** Ref-verbatim findings of every candidate, keyed `<slot>/<candidate file>`; a run that cannot happen is a limit. */
async function refVerbatimRules(root: string): Promise<{ byCandidate: Map<string, string[]>; limit?: string }> {
  const byCandidate = new Map<string, string[]>();
  try {
    const { refVerbatimReport } = await import("@clossys/designer/ref-verbatim" as string) as { refVerbatimReport: (root: string, options: { all: boolean }) => { elements: { slot?: string; element?: string; version?: number; status?: string; findings?: { code: string; detail: string; file?: string }[] }[] } };
    for (const element of refVerbatimReport(root, { all: true }).elements) {
      if (!element.slot || !element.element || !element.version) continue;
      const key = `${element.slot}/${element.element}-v${element.version}.json`;
      const rules = (element.findings ?? []).map(finding => `ref-verbatim/${finding.code}: ${detail(`${finding.file ? `${finding.file}: ` : ""}${finding.detail}`)}`);
      if (element.status === "baselined" && !rules.length) rules.push("ref-verbatim/REF-BASELINED: fails ref-verbatim; listed in the shrink-only baseline");
      if (rules.length) byCandidate.set(key, [...(byCandidate.get(key) ?? []), ...rules]);
    }
    return { byCandidate };
  } catch (error) { return { byCandidate, limit: `ref-verbatim could not run: ${detail(error)}` }; }
}

/** Certify every Designer candidate of `root`; the table, the flat failing rows and any rule that could not run. */
export async function specimenPreflight(options: PreflightOptions): Promise<PreflightResult> {
  const root = resolve(options.root);
  const writerCopy = pinnedWriterCopy(root);
  const shared = { roots: [root], writerCopy, ...(options.registryBase ? { registryBase: options.registryBase } : {}) };
  // Certification mode: the slot contract fixture, over a candidate's own preview; never a sibling's.
  const source = libraryRecordSource({ ...shared, certify: true });
  const builder = createSpecimenBuilder({ workspace: options.workspace });
  const timing = { settleMs: options.settleMs ?? 300, timeoutMs: options.timeoutMs ?? 90_000 };
  const prefixes = options.slots?.length ? options.slots : undefined;
  const limits: string[] = [];
  const model = checkSlotModel(root);
  const refs = options.refVerbatim === false ? { byCandidate: new Map<string, string[]>() } : await refVerbatimRules(root);
  if ("limit" in refs && refs.limit) limits.push(refs.limit);

  const work: { slot: string; candidate: string; element: string; version: number; pinned: boolean; siblings: readonly string[]; layer: string; contract: Readonly<Record<string, unknown>> | undefined }[] = [];
  for (const entry of listSlots(root, "designer")) {
    if (prefixes && !prefixes.some(prefix => entry.id === prefix || entry.id.startsWith(prefix))) continue;
    let contract: Readonly<Record<string, unknown>> | undefined;
    try { contract = readSlot(root, "designer", entry.id).contract; } catch { contract = undefined; }
    const layer = entry.position.l0 ?? entry.id.split(".")[0]!;
    for (const candidate of entry.candidates) {
      const match = CANDIDATE_NAME.exec(candidate);
      if (match?.[3] === "json") work.push({ slot: entry.id, candidate, element: match[1]!, version: Number(match[2]), pinned: entry.pin?.candidate === candidate, siblings: entry.candidates, layer, contract });
    }
  }
  const digests = new Map<string, string>();
  const digest = (slot: string, name: string) => {
    const key = `${slot}/${name}`;
    if (!digests.has(key)) { try { digests.set(key, createHash("sha256").update(readCandidate(root, "designer", slot, name).bytes).digest("hex")); } catch { digests.set(key, ""); } }
    return digests.get(key)!;
  };

  let mounted = 0;
  const certify = async (unit: typeof work[number]): Promise<CertificationRow> => {
    const { slot, candidate, element, version, pinned } = unit;
    const failing: string[] = [];
    let bytes: string | undefined;
    try { bytes = readCandidate(root, "designer", slot, candidate).bytes; } catch (error) { failing.push(`slot-model/unreadable: ${detail(error)}`); }
    let commonJs = false, contractFixture = false;
    if (bytes !== undefined) {
      for (const issue of validateFile(CANDIDATE_SCHEMA, `clossys/agents/designer/${slot}/candidates/${candidate}`, bytes)) failing.push(`submission/schema: ${issue.path} ${issue.message}`);
      const mine = digest(slot, candidate);
      const same = unit.siblings.filter(name => name !== candidate && mine && digest(slot, name) === mine);
      if (same.length) failing.push(`submission/duplicate: byte-identical to ${same.join(", ")}`);
      const item = itemRules(bytes);
      failing.push(...item.failing);
      commonJs = item.commonJs;
      const certified = certifyCandidate({ root, slot, name: candidate, bytes, contract: unit.contract, layer: unit.layer, writerSource: () => writerCopy });
      for (const reason of certified.reasons) failing.push(`contract/${reasonClass(reason)}: ${detail(reason)}`);
      // The certifying source mounts the contract fixture exactly when the slot declares a valid one the candidate fits.
      contractFixture = certified.mounts && !certified.reasons.some(reason => UNMOUNTED.has(reasonClass(reason)));
    }
    for (const issue of model) if (issue.path.includes(`/${slot}/candidates/${candidate}`)) failing.push(`slot-model/${issue.code}: ${issue.message}`);
    failing.push(...(refs.byCandidate.get(`${slot}/${candidate}`) ?? []));
    const id = `${slot}/${element}`;
    const mount = await mountRules(source, builder, id, version, timing);
    if (mount.record?.kind === "visual") mounted += 1;
    failing.push(...mount.failing);
    return { slot, candidate, pinned, failing, contractFixture, notRenderable: commonJs };
  };

  const table: CertificationRow[] = new Array(work.length);
  let next = 0;
  const lane = async () => {
    while (next < work.length) {
      const index = next++;
      table[index] = await certify(work[index]!);
      options.onCandidate?.(table[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(options.concurrency ?? 4, work.length)) }, lane));
  const rows = table.flatMap(row => row.failing.map(reason => ({ slot: row.slot, candidate: row.candidate, pinned: row.pinned, reason })));
  return { table, rows, mounted, limits };
}
