/**
 * loop.cascade v2's `rerender` code step (foundry-build-0048 CP1-L1): after the reverdict, the specimens and the
 * published pages follow the pins.
 *
 * 1. Every Designer slot the reverdict judged again renders again through `clossys render designer/<slot-id>`, so
 *    its `index.json` under `clossys/.state/renders/` carries the pin-set it is judged on now.
 * 2. Every published page that places one of them (a pinned Publisher page slot whose pinned candidate names it as
 *    its frame or a section, with an install report at its `publish --install` out dir) is marked stale in
 *    `clossys/.state/publish/stale.json`.
 * 3. Each stale page is installed again through `clossys publish --install --page <id>`, with the selection its
 *    last install mounted in; a page whose install passes leaves the stale list. A page whose last install names no
 *    selection is re-run without one and fails (no selection is guessed), so it stays stale and the step fails.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { defaultInstallOut } from "@clossys/publisher/build";
import { statePath, stateRel } from "../engine/state-dir.js";
import { readCandidate, readPin } from "../records/slots.js";
import type { Iso } from "../records/types.js";

/** The step's cli: `<dependants>` is the Designer slots the reverdict judged again in this run. */
export const RERENDER_CLI = "clossys render <dependants>";
export const STALE_PAGES_SCHEMA = "clossys.publish-stale/1";
export const stalePagesRel = stateRel("publish", "stale.json");
export const stalePagesPath = (root: string): string => statePath(root, "publish", "stale.json");

export interface StalePage { readonly since: Iso; readonly cause: readonly string[]; readonly run: string }
export interface StalePages { readonly schema: typeof STALE_PAGES_SCHEMA; readonly pages: Record<string, StalePage> }

export interface RerenderCall { readonly cli: string; readonly argv: readonly string[] }
export interface RerenderOutcome { readonly exit: 0 | 1 | 2; readonly wrote: string[]; readonly why?: string }

export function readStalePages(root: string): StalePages {
  const file = stalePagesPath(root);
  if (!existsSync(file)) return { schema: STALE_PAGES_SCHEMA, pages: {} };
  const doc = JSON.parse(readFileSync(file, "utf8")) as Partial<StalePages>;
  if (doc.schema !== STALE_PAGES_SCHEMA || typeof doc.pages !== "object" || doc.pages === null) throw new Error(`${stalePagesRel} is not a ${STALE_PAGES_SCHEMA} record`);
  return { schema: STALE_PAGES_SCHEMA, pages: { ...doc.pages } };
}

function writeStalePages(root: string, doc: StalePages): void {
  const file = stalePagesPath(root);
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(doc, null, 2)}\n`);
  renameSync(temp, file);
}

/** The selection a page's last `publish --install` mounted in, from its install report; undefined when it names none. */
function lastSelection(report: unknown): string | undefined {
  const selection = (report as { selection?: { module?: unknown; export?: unknown } } | null)?.selection;
  if (typeof selection?.module !== "string" || !selection.module) return undefined;
  return typeof selection.export === "string" && selection.export ? `${selection.module}#${selection.export}` : selection.module;
}

/** The published pages that place one of `slots` (Designer slot ids): page slot id, the slots it places, its last selection. */
export function publishedPagesUsing(root: string, slots: readonly string[]): { page: string; uses: string[]; selection?: string }[] {
  const consumer = join(root, "clossys");
  const dir = join(consumer, "agents", "publisher");
  if (!existsSync(dir) || !slots.length) return [];
  const out: { page: string; uses: string[]; selection?: string }[] = [];
  for (const id of readdirSync(dir).filter(name => name.startsWith("page.")).sort()) {
    const pin = readPin(consumer, "publisher", id);
    if (!pin) continue;
    const page = JSON.parse(readCandidate(consumer, "publisher", id, pin.candidate).bytes) as { frame?: unknown; sections?: unknown };
    const placed = [...(typeof page.frame === "string" ? [page.frame] : []), ...(Array.isArray(page.sections) ? page.sections.filter((item): item is string => typeof item === "string") : [])];
    const uses = slots.filter(slot => placed.includes(slot));
    if (!uses.length) continue;
    // Published: `publish --install` wrote this page's out dir and its report.
    const report = join(defaultInstallOut(root, id.slice("page.".length)), "install-report.json");
    if (!existsSync(report)) continue;
    const selection = lastSelection(JSON.parse(readFileSync(report, "utf8")));
    out.push({ page: id, uses, ...(selection ? { selection } : {}) });
  }
  return out;
}

/** Runs the step: render, mark, install. `code` runs one verb, as the loop's code hook runs it. */
export async function rerender(root: string, input: { readonly reverdicted: readonly string[]; readonly at: Iso; readonly runId: string }, code: (call: RerenderCall) => Promise<{ readonly exit: 0 | 1 | 2; readonly wrote?: readonly string[]; readonly detail?: string }>): Promise<RerenderOutcome> {
  const designer = [...new Set(input.reverdicted.filter(ref => ref.startsWith("designer/")).map(ref => ref.slice("designer/".length)))].sort();
  const wrote: string[] = [];
  const failed: string[] = [];
  for (const slot of designer) {
    const ref = `designer/${slot}`;
    const result = await code({ cli: `clossys render ${ref}`, argv: ["clossys", "render", ref] });
    wrote.push(...(result.wrote ?? []));
    if (result.exit !== 0) failed.push(`clossys render ${ref} exited ${result.exit}${result.detail ? `: ${result.detail.split("\n")[0]}` : ""}`);
  }
  const pages = publishedPagesUsing(root, designer);
  if (pages.length) {
    const stale = readStalePages(root);
    for (const row of pages) {
      const was = stale.pages[row.page];
      stale.pages[row.page] = { since: was?.since ?? input.at, cause: [...new Set([...(was?.cause ?? []), ...row.uses.map(slot => `designer/${slot}`)])].sort(), run: input.runId };
    }
    writeStalePages(root, stale);
    wrote.push(stalePagesRel);
  }
  const stale = readStalePages(root);
  for (const row of pages) {
    const id = row.page.slice("page.".length);
    const argv = ["clossys", "publish", "--install", "--page", id, ...(row.selection ? ["--selection", row.selection] : [])];
    const result = await code({ cli: argv.join(" "), argv });
    wrote.push(...(result.wrote ?? []));
    if (result.exit === 0) delete stale.pages[row.page];
    else failed.push(`clossys publish --install --page ${id} exited ${result.exit}${row.selection ? "" : " (its last install names no selection)"}${result.detail ? `: ${result.detail.split("\n").at(-1)}` : ""}`);
  }
  if (pages.length) writeStalePages(root, stale);
  return { exit: failed.length ? 1 : 0, wrote: [...new Set(wrote)], ...(failed.length ? { why: failed.join("; ") } : {}) };
}
