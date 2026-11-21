/**
 * The opt-in starter publication plan (foundry-build-0048 SITE-PUBLICATION): the pages and publication `clossys init
 * --starters <id>` seats in a consumer workspace, read from the installed Publisher package's own starter
 * (`starters/<id>/publication.json`) and, per page, its page archetype. Read-only; init-starters.ts places it.
 *
 * A page archetype is the package's whole statement of one page, read by code, never authored in the consumer:
 * - the directory tree's page slot (`@clossys/publisher`): its publication, its route (`path`) or its
 *   status, its layout and, for a dynamic route, the collection it ranges over;
 * - the layout's composition (`@clossys/publisher`): the Designer frame, and each chrome's Designer unit
 *   and Writer copy;
 * - the package default (`defaults/<page>/starter-v1.json`): the ordered Designer sections, each section's Writer copy,
 *   and the page's Writer meta record.
 *
 * Any part missing, or a default that disagrees with its directory slot (another route or layout), is a
 * PageArchetypeError naming the page and the part: the seat refuses rather than guess (no fallback).
 *
 * A status page (a directory slot with `status` and no route: not-found, error) is held, not seated: `page.assembled`
 * holds every page record to a route, so a status page slot could take no candidate. Seating one needs a check
 * change, an owner decision.
 */
import { existsSync, readFileSync } from "node:fs";
import { publicationRootFindings } from "../constitution/certify/route.js";
import { packagePath } from "../package-path.js";
import { reservedValues } from "./admin-plan.js";

/** The starters `init --starters` seats; the admin starter is plain init's own (init-admin.ts). */
export const SEATABLE_STARTERS: readonly string[] = ["site"];

/** The plan could not be read from the installed Publisher package. */
export class StarterPlanError extends Error {
  override readonly name: string = "StarterPlanError";
}
/** A starter names a page the installed Publisher package states no complete archetype for. */
export class PageArchetypeError extends StarterPlanError {
  override readonly name = "PageArchetypeError";
  constructor(readonly starter: string, readonly page: string, readonly missing: string) {
    super(`no page archetype for publisher/${page} (starter ${starter}): ${missing}`);
  }
}

export interface StarterPage {
  readonly id: string;
  /** The archetype's route (`/<slug>` is a dynamic route). */
  readonly route: string;
  /** A sample route the contract's fixture names (a dynamic route's parameters take the value `sample`). */
  readonly sample: string;
  readonly layout: string;
  /** The Designer slot ids the page composes: its frame, each chrome's unit, then its sections in order. */
  readonly uses: readonly string[];
  /** The Writer slot ids the page reads: its meta record, each section's copy in order, then each chrome's copy. */
  readonly copy: readonly string[];
  /** Every slot the page cites (`uses`, then `copy`); its inputs and uses are the ones the workspace holds. */
  readonly cites: readonly string[];
  readonly params: readonly string[];
  readonly collection?: string;
  readonly reserved: Readonly<Record<string, readonly string[]>>;
}
/** A page of the starter the seat holds back, and why. */
export interface HeldPage { readonly id: string; readonly status: number; readonly reason: string }
export interface StarterPlan {
  readonly starter: string;
  readonly publication: string;
  readonly root: string;
  readonly pages: readonly StarterPage[];
  readonly held: readonly HeldPage[];
}

type Slots = Record<string, Record<string, unknown>>;
interface Starter { id?: string; root?: string; pages?: unknown }
interface PageDefault { path?: unknown; status?: unknown; layout?: unknown; sections?: unknown; meta?: { copy?: unknown } }

const PARAM = /^<([a-z][a-z0-9]*)>$/;
const DESIGNER = /^designer\/((?:frames|sections)\.[a-z0-9][a-z0-9.-]*)$/;
const WRITER = /^writer\/([a-z][a-z0-9.-]*)#[a-z0-9][a-z0-9.-]*$/;
const segmentsOf = (path: string): string[] => path === "/" ? [] : path.slice(1).split("/");

/** Where one starter slot sits in the workspace Publisher IA: tab `<starter>`, one group (L2) per slot, as the admin seat does. */
export const starterUnder = (plan: Pick<StarterPlan, "starter" | "publication">, slot: string): string =>
  `${plan.starter}/${slot === plan.publication ? "publication" : slot.replace(/^page\./, "").replace(/\./g, "-")}`;

function readJson<T>(file: string, what: string): T {
  if (!existsSync(file)) throw new StarterPlanError(`${what} is missing (${file})`);
  try { return JSON.parse(readFileSync(file, "utf8")) as T; } catch (error) { throw new StarterPlanError(`${what} is not valid JSON (${(error as Error).message})`); }
}

/** The plan for starter `starter`, as the installed Publisher package states it for `root`. */
export function starterPlan(root: string, starter: string): StarterPlan {
  const publisher = (rel: string) => packagePath(root, `packages/publisher/${rel}`);
  const manifest = readJson<Starter>(publisher(`starters/${starter}/publication.json`), `the Publisher starter ${starter}`);
  if (manifest.id !== starter || typeof manifest.root !== "string" || !Array.isArray(manifest.pages) || !manifest.pages.every(page => typeof page === "string")) {
    throw new StarterPlanError(`the Publisher starter ${starter} names no id ${starter}, root and page list`);
  }
  const directory = readJson<{ slots: Slots }>(publisher("src/catalog/ia/directory.json"), "the Publisher directory tree").slots;
  const composition = readJson<{ slots: Slots }>(publisher("src/catalog/ia/composition.json"), "the Publisher composition tree").slots;
  const paths = Object.values(directory).filter(slot => slot.kind === "page" && typeof slot.path === "string").map(slot => String(slot.path));
  const pages: StarterPage[] = [], held: HeldPage[] = [];
  for (const id of manifest.pages as string[]) {
    const missing = (what: string): never => { throw new PageArchetypeError(starter, id, what); };
    const slot = directory[id];
    if (!slot || slot.kind !== "page") missing("the Publisher directory tree holds no page slot of that id");
    if (slot!.publication !== starter) missing(`its directory slot belongs to publication ${JSON.stringify(slot!.publication)}, not ${starter}`);
    const layoutRef = Array.isArray(slot!.layouts) && typeof slot!.layouts[0] === "string" ? slot!.layouts[0] : missing("its directory slot names no layout");
    const layout = layoutRef.replace(/^publisher\//, "");
    const shape = composition[layout];
    if (!shape || shape.kind !== "layout") missing(`the Publisher composition tree holds no layout ${layout}`);
    const frame = DESIGNER.exec(String(shape!.frame ?? ""))?.[1] ?? missing(`layout ${layout} names no Designer frame`);
    const chrome = ((shape!.chrome as unknown[] | undefined) ?? []).map(ref => {
      const piece = composition[String(ref).replace(/^publisher\//, "")];
      const unit = DESIGNER.exec(String(piece?.unit ?? ""))?.[1];
      const copy = WRITER.exec(String(piece?.copy ?? ""))?.[1];
      return unit && copy ? { unit, copy } : missing(`layout ${layout} places chrome ${String(ref)}, which names no Designer unit and Writer copy`);
    });
    const defaultFile = publisher(`defaults/${id}/starter-v1.json`);
    if (!existsSync(defaultFile)) missing(`the package default defaults/${id}/starter-v1.json is missing`);
    let fill: PageDefault;
    try { fill = (JSON.parse(readFileSync(defaultFile, "utf8")) as { content?: PageDefault }).content ?? missing(`defaults/${id}/starter-v1.json holds no content`); }
    catch (error) { if (error instanceof PageArchetypeError) throw error; return missing(`defaults/${id}/starter-v1.json is not valid JSON (${(error as Error).message})`); }
    if (fill.layout !== layoutRef) missing(`its package default places layout ${JSON.stringify(fill.layout)}, not the directory's ${layoutRef}`);
    const sectionList = Array.isArray(fill.sections) && fill.sections.length ? fill.sections as { use?: unknown; copy?: unknown }[] : missing("its package default orders no sections");
    const sections = sectionList.map((section, index) => DESIGNER.exec(String(section.use ?? ""))?.[1] ?? missing(`section ${index + 1} of its package default names no Designer section`));
    const sectionCopy = sectionList.map((section, index) => WRITER.exec(String(section.copy ?? ""))?.[1] ?? missing(`section ${index + 1} of its package default binds no Writer copy`));
    const meta = WRITER.exec(String(fill.meta?.copy ?? ""))?.[1] ?? missing("its package default names no Writer meta record");
    if (typeof slot!.path !== "string") {
      const status = typeof slot!.status === "number" ? slot!.status : missing("its directory slot names neither a route nor a status");
      if (fill.status !== status) missing(`its package default serves status ${JSON.stringify(fill.status)}, not the directory's ${status}`);
      held.push({ id, status, reason: `a status page (${status}) has no route, and page.assembled holds every page record to one: no candidate could certify, so the slot is not seated` });
      continue;
    }
    const route = slot!.path;
    if (fill.path !== route) missing(`its package default routes ${JSON.stringify(fill.path)}, not the directory's ${route}`);
    const uses = [...new Set([frame, ...chrome.map(piece => piece.unit), ...sections])];
    const copy = [...new Set([meta, ...sectionCopy, ...chrome.map(piece => piece.copy)])];
    pages.push({
      id, route, sample: route.replace(/<[a-z][a-z0-9]*>/g, "sample"), layout, uses, copy, cites: [...uses, ...copy],
      params: segmentsOf(route).flatMap(part => PARAM.exec(part)?.[1] ?? []),
      ...(typeof slot!.collection === "string" ? { collection: slot!.collection } : {}),
      reserved: reservedValues(route, paths),
    });
  }
  if (!pages.length) throw new StarterPlanError(`the Publisher starter ${starter} names no routed page to seat`);
  const publication = `publication.${starter}`;
  const findings = publicationRootFindings(publication, manifest.root, pages.map(page => page.route), false);
  if (findings.length) throw new StarterPlanError(findings.join("; "));
  return { starter, publication, root: manifest.root, pages, held };
}

/** The consumer-side contract `clossys ia` places for one starter page: its archetype, key for key. */
function pageContract(plan: StarterPlan, page: StarterPage): Record<string, unknown> {
  return {
    kind: "page", publication: plan.starter, route: page.route, package: `publisher/${page.id}`, layout: `publisher/${page.layout}`,
    frame: "required", sections: "ordered", meta: "required",
    composes: page.uses.map(id => `designer/${id}`), copy: page.copy.map(id => `writer/${id}`),
    ...(page.params.length ? { routeFormat: { pattern: page.route, params: page.params, ...(page.collection ? { collection: page.collection } : {}), reserved: page.reserved } } : {}),
    requirements: [{ check: "page.assembled" }], fixture: { route: { path: page.sample } },
  };
}

/** The one contract `clossys init --starters` writes for starter slot `id` (a page or the starter's publication). */
export function starterContract(plan: StarterPlan, id: string): Record<string, unknown> {
  if (id === plan.publication) {
    return { kind: "publication", publication: plan.starter, root: plan.root, pages: plan.pages.map(page => page.id), requirements: [{ check: "publication.routes" }], fixture: { route: { path: plan.pages[0]!.route } } };
  }
  const page = plan.pages.find(each => each.id === id);
  if (!page) throw new StarterPlanError(`${id} is not a seated slot of the Publisher ${plan.starter} starter`);
  return pageContract(plan, page);
}
