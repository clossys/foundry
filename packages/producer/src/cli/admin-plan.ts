/**
 * The admin workspace plan (foundry-build-0048 Amendment 2026-11-18b, A1): the admin pages and publication `clossys
 * init` seats in every consumer and `publisher.admin-seated` holds it to, read from the installed Publisher package's
 * own `admin` starter (starters/admin/publication.json), its tree contracts and its page defaults, and from the
 * Designer section contracts (a data-bound admin section declares the clossys records it reads, `limits["reads.records"]`,
 * read-only, bound `host-injected` under a route scope, `limits["reads.scope"]`). Read-only; init-admin.ts places it.
 *
 * foundry-build-0048 U20: each page contract states its data binding (`reads`: per data-bound section, the port the host
 * fills, the record schemas and the route scope) and, for a dynamic route, its route format (`routeFormat`: the
 * pattern, its parameters, the collection they range over and the values a static sibling route reserves).
 * `adminPlanFindings` holds the plan to the rules `publisher.admin-seated` reports: every scope parameter a data-bound
 * section reads under is a parameter of its page's route, no agent id is a value a static admin route reserves
 * (`/admin/requests` wins over `/admin/<agent>`, so an agent named `requests` would have no gallery), and the admin
 * publication, being fixed, roots under its own static prefix with every page route under it (U20b).
 */
import { readFileSync } from "node:fs";
import { packagePath } from "../package-path.js";
import { slotFile } from "../records/slot-model/layout.js";
import { readSlotValue, type SlotRead } from "../records/slot-current.js";
import { modelExists, readModelText } from "../records/slots.js";
import { MODEL_AGENTS } from "../records/slot-model/types.js";
import { publicationRootFindings } from "../constitution/certify/route.js";

export const ADMIN_PUBLICATION_SLOT = "publication.admin";
/** The workspace Publisher IA tab (L1) the admin slots sit in. */
export const ADMIN_L1 = "admin";
/**
 * Where one admin slot sits in the workspace Publisher IA: tab `admin`, one group (L2) per slot (`admin/home`,
 * `admin/gallery`, ..., `admin/publication`). One group each, because in a workspace that holds no Designer slot yet
 * the pages cite no input, and the placement overlap check reads input-less slots of one group with equal
 * requirements as one material.
 */
export const adminUnder = (slot: string): string => `${ADMIN_L1}/${slot.startsWith("page.admin-") ? slot.slice("page.admin-".length) : slot === ADMIN_PUBLICATION_SLOT ? "publication" : slot.replace(/\./g, "-")}`;

export interface AdminPage {
  readonly id: string;
  /** The route the package contract declares (`/admin/<agent>/<slot>` is a dynamic route). */
  readonly route: string;
  /** A sample route the contract's fixture names. */
  readonly sample: string;
  readonly layout: string;
  /**
   * The Designer slot ids the page composes: its frame, the unit of each chrome its layout places (the admin sidebar,
   * `frames.app-sidebar`; foundry-build-0048 U20), then its sections in order.
   */
  readonly uses: readonly string[];
  /** The used sections that are data-bound: their contract names the clossys records they read, read-only. */
  readonly dataBound: readonly string[];
  /** Each data-bound section's binding, as its Designer contract states it. */
  readonly reads: readonly AdminRead[];
  /** The route's parameters, in order (`agent`, `slot`), the collection they range over and their reserved values. */
  readonly params: readonly string[];
  readonly collection?: string;
  readonly reserved: Readonly<Record<string, readonly string[]>>;
  /** The page's seeded clossys.page/1 record: its package default, translated (adminPageRecord). */
  readonly record: Readonly<Record<string, unknown>>;
}
export interface AdminRead { readonly section: string; readonly port: string; readonly records: string; readonly scope: string }
export interface AdminPlan {
  readonly pages: readonly AdminPage[]; readonly publication: string; readonly root: string;
  /** The admin publication's seeded clossys.publication/1 record (adminPublicationRecord). */
  readonly record: Readonly<Record<string, unknown>>;
}

const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;
const designerId = (ref: string) => ref.startsWith("designer/") ? ref.slice("designer/".length) : ref;
const SAMPLE: Readonly<Record<string, string>> = { "<agent>": "designer", "<slot>": "sections.hero" };

type TreeSlots = Record<string, Record<string, unknown>>;
interface Starter { pages: string[]; release: string; root: string }
interface SectionContract { slot: string; limits?: Record<string, string> }

const PARAM = /^<([a-z][a-z0-9]*)>$/;
const segmentsOf = (path: string): string[] => path === "/" ? [] : path.slice(1).split("/");
/**
 * The values each parameter of `path` never takes: the static segment, at that position, of every other route of the
 * same length whose other segments it matches (the Publisher route format's precedence: a static segment wins).
 */
export function reservedValues(path: string, others: readonly string[]): Record<string, string[]> {
  const mine = segmentsOf(path);
  const out: Record<string, string[]> = {};
  mine.forEach((part, at) => {
    const param = PARAM.exec(part);
    if (!param) return;
    const values = new Set<string>();
    for (const other of others) {
      const theirs = segmentsOf(other);
      if (other === path || theirs.length !== mine.length || PARAM.test(theirs[at]!)) continue;
      if (mine.every((segment, index) => index === at || PARAM.test(segment) || segment === theirs[index])) values.add(theirs[at]!);
    }
    out[param[1]!] = [...values].sort();
  });
  return out;
}

/** The Designer sections bound `host-injected` (the data-bound record sections), from the installed Designer contracts. */
const boundOf = (contracts: readonly SectionContract[]): Map<string, AdminRead> => new Map(contracts
  .filter(contract => contract.limits?.binding === "host-injected" && typeof contract.limits["reads.records"] === "string")
  .map(contract => [contract.slot, { section: contract.slot, port: String(contract.limits!["reads.port"]), records: contract.limits!["reads.records"]!, scope: String(contract.limits!["reads.scope"]) }]));
const readContracts = (root: string): SectionContract[] => readJson<SectionContract[]>(packagePath(root, "packages/designer/src/catalog/slot-contracts/sections.json"));

interface PageDefault { path?: string; sections: { use: string; copy?: string }[]; meta?: { copy?: string } }
const unprefixed = (ref: string) => ref.replace(/^(?:designer|writer|publisher)\//, "");

/**
 * The clossys.page/1 record `clossys init` seeds for one admin page: the Publisher package default, translated
 * mechanically (Publisher assembles, never writes): the default's route, the frame of its layout, its sections in
 * order, each non-record section's Writer copy as its binding, the default's Writer meta record as the title (and the
 * page's `meta-title` copy), and a derived source citing the default. A data-bound record section binds no copy.
 */
export function adminPageRecord(id: string, route: string, frame: string, fill: PageDefault, dataBound: ReadonlySet<string>): Record<string, unknown> {
  const sections = fill.sections.map(section => designerId(section.use));
  const bindings: Record<string, { copy: Record<string, string> }> = {};
  for (const section of fill.sections) {
    const use = designerId(section.use);
    if (section.copy === undefined || dataBound.has(use)) continue;
    const ref = unprefixed(section.copy);
    bindings[use] = { copy: { [ref.slice(0, ref.indexOf("#"))]: ref } };
  }
  const title = fill.meta?.copy ? unprefixed(fill.meta.copy) : undefined;
  return {
    schema: "clossys.page/1", path: route, ...(title ? { title } : {}), frame, sections,
    copy: title ? { "meta-title": title } : {}, ...(Object.keys(bindings).length ? { bindings } : {}),
    meta: {
      source: { kind: "derived", ref: [`@clossys/publisher:defaults/${id}/starter-v1.json`] },
      // The native entry the pinned projection reads: the page's route metadata (its sections, active), under the admin publication.
      entry: { fields: { kind: "page" }, blocks: { Route: { slots: sections.map(section => ({ section, state: "active" })) } }, publication: "admin", entryId: id.replace(/^page\./, "") },
    },
  };
}

/**
 * The clossys.publication/1 record `clossys init` seeds for the admin publication: its pages in plan order, home first.
 * Each entry id is its page cell less the `page.` prefix (`admin-home` is cell `page.admin-home`), so the pinned
 * projection finds every placed page by a stable entryOrder identity.
 */
export function adminPublicationRecord(pages: readonly string[]): Record<string, unknown> {
  const routeId = (page: string) => page.replace(/^page\./, "");
  return {
    schema: "clossys.publication/1", format: "web.page.responsive", entryOrder: pages.map(routeId),
    routePack: { packId: "admin", homeRouteId: routeId(pages[0] ?? "page.admin-home") },
    meta: { source: { kind: "derived", ref: ["@clossys/publisher:starters/admin/publication.json"] }, tree: { id: "admin", name: "admin.publication", children: [{ id: "admin.pages", name: "admin.pages", cells: [...pages] }] } },
  };
}

/** The data-bound record section ids the installed Designer package declares (they bind no Writer copy on a page). */
export const dataBoundSections = (root: string): ReadonlySet<string> => new Set(boundOf(readContracts(root)).keys());
/** Each data-bound record section's binding (port, records, scope), as the installed Designer contracts state it (U20b: the bound install injects by it). */
export const dataBoundReads = (root: string): ReadonlyMap<string, AdminRead> => boundOf(readContracts(root));
/** The route scope parameters a `reads.scope` names (`workspace` names none). */
export const scopeParams = (scope: string): string[] => scope === "workspace" ? [] : scope.split(",").map(part => part.trim()).filter(Boolean);

/** The admin seat plan, as the installed Publisher (and Designer) packages state it for `root`. */
export function adminPlan(root: string): AdminPlan {
  const publisher = (rel: string) => packagePath(root, `packages/publisher/${rel}`);
  const starter = readJson<Starter>(publisher("starters/admin/publication.json"));
  const directory = readJson<{ slots: TreeSlots }>(publisher("src/catalog/ia/directory.json")).slots;
  const composition = readJson<{ slots: TreeSlots }>(publisher("src/catalog/ia/composition.json")).slots;
  const bound = boundOf(readContracts(root));
  const paths = Object.values(directory).filter(slot => slot.kind === "page" && typeof slot.path === "string").map(slot => String(slot.path));
  const pages = starter.pages.map((id): AdminPage => {
    const slot = directory[id];
    if (!slot) throw new Error(`the Publisher admin starter names ${id}, which the directory tree does not hold`);
    const layout = (slot.layouts as string[])[0]!.replace(/^publisher\//, "");
    const frame = designerId(String(composition[layout]?.frame ?? ""));
    // The layout's chrome renders its own Designer unit on every page of the layout, so the page composes it too.
    const chrome = ((composition[layout]?.chrome as string[] | undefined) ?? [])
      .map(ref => designerId(String(composition[ref.replace(/^publisher\//, "")]?.unit ?? ""))).filter(Boolean);
    const fill = readJson<{ content: PageDefault }>(publisher(`defaults/${id}/starter-v1.json`)).content;
    const sections = fill.sections.map(section => designerId(section.use));
    const route = String(slot.path);
    const dataBound = sections.filter(section => bound.has(section));
    return {
      id, route, sample: route.replace(/<[a-z]+>/g, part => SAMPLE[part] ?? "sample"), layout,
      uses: [...new Set([frame, ...chrome, ...sections])].filter(Boolean), dataBound, reads: dataBound.map(section => bound.get(section)!),
      params: segmentsOf(route).flatMap(part => PARAM.exec(part)?.[1] ?? []),
      ...(typeof slot.collection === "string" ? { collection: slot.collection } : {}),
      reserved: reservedValues(route, paths),
      record: adminPageRecord(id, route, frame, fill, new Set(dataBound)),
    };
  });
  return { pages, publication: ADMIN_PUBLICATION_SLOT, root: starter.root, record: adminPublicationRecord(pages.map(page => page.id)) };
}

/** The consumer-side contract `clossys ia` places for one admin page (free-form besides its fixture and requirements). */
function pageContract(page: AdminPage): Record<string, unknown> {
  return {
    kind: "page", publication: "admin", route: page.route, package: `publisher/${page.id}`, layout: `publisher/${page.layout}`,
    frame: "required", sections: "ordered", meta: "required", composes: page.uses.map(id => `designer/${id}`),
    ...(page.reads.length ? { reads: { access: "read-only", binding: "host-injected", sections: page.reads.map(read => ({ section: `designer/${read.section}`, port: read.port, records: read.records, scope: read.scope })) } } : {}),
    ...(page.params.length ? { routeFormat: { pattern: page.route, params: page.params, ...(page.collection ? { collection: page.collection } : {}), reserved: page.reserved } } : {}),
    requirements: [{ check: "page.assembled" }], fixture: { route: { path: page.sample } },
  };
}

/**
 * The one contract `clossys init` writes for admin slot `id` (a page or the admin publication) and
 * `publisher.admin-seated` holds the seat to, key for key.
 */
export function adminContract(plan: AdminPlan, id: string): Record<string, unknown> {
  if (id === plan.publication) {
    return { kind: "publication", publication: "admin", root: plan.root, pages: plan.pages.map(page => page.id), requirements: [{ check: "publication.routes" }], fixture: { route: { path: plan.pages[0]?.route ?? "/admin" } } };
  }
  const page = plan.pages.find(each => each.id === id);
  if (!page) throw new Error(`${id} is not an admin slot of the Publisher admin plan`);
  return pageContract(page);
}


/**
 * The plan's own rule findings (`publisher.admin-seated` reports them): a data-bound section reads under route
 * parameters its page supplies, and no agent id is a value a static admin route reserves for `<agent>`.
 */
export function adminPlanFindings(plan: AdminPlan, agents: readonly string[] = MODEL_AGENTS): { subject: string; detail: string }[] {
  const findings: { subject: string; detail: string }[] = [];
  for (const page of plan.pages) {
    for (const read of page.reads) {
      const missing = scopeParams(read.scope).filter(param => !page.params.includes(param));
      if (missing.length) findings.push({ subject: `publisher/${page.id}`, detail: `places data-bound section ${read.section}, read under scope "${read.scope}", but route ${page.route} supplies no ${missing.map(param => `<${param}>`).join(", ")}; the host cannot scope its records` });
    }
    const clash = agents.filter(agent => (page.reserved.agent ?? []).includes(agent));
    if (clash.length) findings.push({ subject: `publisher/${page.id}`, detail: `agent ${clash.join(", ")} is a value static admin routes reserve for <agent> (${(page.reserved.agent ?? []).join(", ")}): ${page.route.replace("<agent>", clash[0]!)} would never reach this page` });
  }
  // The admin publication is fixed (every consumer holds it): it roots under /admin and every page route sits there.
  for (const detail of publicationRootFindings(plan.publication, plan.root, plan.pages.map(page => page.route), true)) findings.push({ subject: `publisher/${plan.publication}`, detail });
  return findings;
}

/** The reader's view of the slot.json in one slot folder (either format), or undefined when it is missing or not valid. */
export function readAdminSlot(dir: string): SlotRead | undefined {
  const file = slotFile(dir);
  if (!modelExists(file)) return undefined;
  try { return readSlotValue(JSON.parse(readModelText(file)), file); } catch { return undefined; }
}

/** The refs one admin slot cites (its inputs and its uses, the same list): the composition units the workspace holds, in plan order. */
export const adminRefs = (wanted: readonly string[], held: ReadonlySet<string>): string[] => wanted.filter(id => held.has(id));
