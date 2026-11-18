/**
 * The admin workspace plan (foundry-build-0048 Amendment 2026-11-18b, A1): the admin pages and publication `clossys
 * init` seats in every consumer and `publisher.admin-seated` holds it to, read from the installed Publisher package's
 * own `admin` starter (starters/admin/publication.json), its tree contracts and its page defaults, and from the
 * Designer section contracts (a data-bound admin section declares the clossys records it reads, `limits["reads.records"]`,
 * read-only). Read-only; init-admin.ts places it.
 */
import { readFileSync } from "node:fs";
import { packagePath } from "../package-path.js";
import { slotFile } from "../records/slot-model/layout.js";
import { readSlotValue, type SlotRead } from "../records/slot-current.js";
import { modelExists, readModelText } from "../records/slots.js";

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
  /** The Designer slot ids the page composes: its frame, then its sections in order. */
  readonly uses: readonly string[];
  /** The used sections that are data-bound: their contract names the clossys records they read, read-only. */
  readonly dataBound: readonly string[];
}
export interface AdminPlan { readonly pages: readonly AdminPage[]; readonly publication: string; readonly root: string }

const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;
const designerId = (ref: string) => ref.startsWith("designer/") ? ref.slice("designer/".length) : ref;
const SAMPLE: Readonly<Record<string, string>> = { "<agent>": "designer", "<slot>": "sections.hero" };

type TreeSlots = Record<string, Record<string, unknown>>;
interface Starter { pages: string[]; release: string; root: string }
interface SectionContract { slot: string; limits?: Record<string, string> }

/** The admin seat plan, as the installed Publisher (and Designer) packages state it for `root`. */
export function adminPlan(root: string): AdminPlan {
  const publisher = (rel: string) => packagePath(root, `packages/publisher/${rel}`);
  const starter = readJson<Starter>(publisher("starters/admin/publication.json"));
  const directory = readJson<{ slots: TreeSlots }>(publisher("src/catalog/ia/directory.json")).slots;
  const composition = readJson<{ slots: TreeSlots }>(publisher("src/catalog/ia/composition.json")).slots;
  const contracts = readJson<SectionContract[]>(packagePath(root, "packages/designer/src/catalog/slot-contracts/sections.json"));
  const bound = new Set(contracts.filter(contract => typeof contract.limits?.["reads.records"] === "string").map(contract => contract.slot));
  const pages = starter.pages.map((id): AdminPage => {
    const slot = directory[id];
    if (!slot) throw new Error(`the Publisher admin starter names ${id}, which the directory tree does not hold`);
    const layout = (slot.layouts as string[])[0]!.replace(/^publisher\//, "");
    const frame = designerId(String(composition[layout]?.frame ?? ""));
    const fill = readJson<{ content: { sections: { use: string }[] } }>(publisher(`defaults/${id}/starter-v1.json`)).content;
    const sections = fill.sections.map(section => designerId(section.use));
    const route = String(slot.path);
    return {
      id, route, sample: route.replace(/<[a-z]+>/g, part => SAMPLE[part] ?? "sample"), layout,
      uses: [...new Set([frame, ...sections])].filter(Boolean), dataBound: sections.filter(section => bound.has(section)),
    };
  });
  return { pages, publication: ADMIN_PUBLICATION_SLOT, root: starter.root };
}

/** The reader's view of the slot.json in one slot folder (either format), or undefined when it is missing or not valid. */
export function readAdminSlot(dir: string): SlotRead | undefined {
  const file = slotFile(dir);
  if (!modelExists(file)) return undefined;
  try { return readSlotValue(JSON.parse(readModelText(file)), file); } catch { return undefined; }
}

/** The refs one admin slot cites (its inputs and its uses, the same list): the composition units the workspace holds, in plan order. */
export const adminRefs = (wanted: readonly string[], held: ReadonlySet<string>): string[] => wanted.filter(id => held.has(id));
