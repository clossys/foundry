/**
 * The page and publication certifiers (R05). A page fits its slot when its route is the contract
 * fixture's sample route (when the page names a path), its frame and sections are live pinned
 * Designer slots, and every copy ref `<writer-slot>#<key>` resolves to a key of that Writer slot's
 * pinned candidate, and every section serves the page's medium (its layout): the frame's medium is its pinned
 * candidate's `meta.element.media[0]`, else `slide` for a deck frame (`contract.surface: "deck"`), else `web`; a
 * section serves its pinned candidate's `meta.element.media`, else its slot contract's `media`, else `web`. A repin
 * of a section to a candidate that serves another medium breaks every page placing it (loop.cascade re-verdicts
 * them). A publication fits when its fixture is a sample route; its schema is
 * `validateCandidate`'s.
 */
import { candidateMeta, isObject, slotDoc, stringList } from "../checks/shared.js";
import type { CandidateRecord, SlotRecord } from "../types.js";
import { pinKey, type CertifyEnv } from "./env.js";
import { reason, type Reason } from "./types.js";

const copyRefs = (copy: unknown): string[] => (isObject(copy) ? Object.values(copy).filter((value): value is string => typeof value === "string") : []);

/** Every copy ref a page names (`copy` and `bindings.*.copy`). */
export function pageCopyRefs(doc: Record<string, unknown>): string[] {
  const refs = copyRefs(doc.copy);
  if (isObject(doc.bindings)) for (const binding of Object.values(doc.bindings)) if (isObject(binding)) refs.push(...copyRefs(binding.copy));
  return refs;
}

const mediaOf = (value: unknown): string[] | undefined => {
  const list = stringList(value);
  return Array.isArray(value) && list.length ? list : undefined;
};

/** The media a pinned Designer candidate declares (`meta.element.media`), if it narrows its slot's. */
function candidateMedia(pinned: { readonly candidate: CandidateRecord } | undefined): string[] | undefined {
  const meta = pinned ? candidateMeta(pinned.candidate) : undefined;
  const element = meta && isObject(meta.element) ? meta.element : undefined;
  return element ? mediaOf(element.media) : undefined;
}

function contractOf(slot: SlotRecord | undefined): Record<string, unknown> {
  const doc = slotDoc(slot);
  return doc && isObject(doc.contract) ? doc.contract : {};
}

/** The page's medium: the frame's pinned candidate's first medium, `slide` for a deck frame, else `web`. */
function pageMedium(frame: string, env: CertifyEnv): string {
  const pinned = env.pins.get(pinKey("designer", frame));
  return candidateMedia(pinned)?.[0] ?? (contractOf(pinned?.slot).surface === "deck" ? "slide" : "web");
}

/** The media a placed section serves: its pinned candidate's, else its slot contract's, else `web`. */
function sectionMedia(section: string, env: CertifyEnv): string[] {
  const pinned = env.pins.get(pinKey("designer", section));
  return candidateMedia(pinned) ?? mediaOf(contractOf(pinned?.slot).media) ?? ["web"];
}

function routeOf(contract: Readonly<Record<string, unknown>>): string | undefined {
  const fixture = isObject(contract.fixture) ? contract.fixture : undefined;
  return fixture && isObject(fixture.route) && typeof fixture.route.path === "string" ? fixture.route.path : undefined;
}

export function certifyPage(slot: SlotRecord, candidate: CandidateRecord, contract: Readonly<Record<string, unknown>>, env: CertifyEnv): Reason[] {
  if (contract.fixture === undefined) return [reason("no-fixture", `slot ${slot.id} declares no contract fixture (slot.json contract.fixture)`)];
  const doc = isObject(candidate.json) ? candidate.json : {};
  const out: Reason[] = [];
  const route = routeOf(contract);
  if (typeof doc.path === "string" && route !== undefined && doc.path !== route) out.push(reason("fixture", `routes ${doc.path}, not the contract fixture's ${route}`));
  const designer = (id: string) => env.live.get("designer")?.has(id) && env.pins.has(pinKey("designer", id));
  if (typeof doc.frame === "string" && !designer(doc.frame)) out.push(reason("frame", `frame ${doc.frame} is no live pinned Designer slot`));
  const medium = typeof doc.frame === "string" && designer(doc.frame) ? pageMedium(doc.frame, env) : undefined;
  for (const section of stringList(doc.sections)) {
    const id = section.split("#")[0]!;
    if (!designer(id)) { out.push(reason("section", `section ${id} is no live pinned Designer slot`)); continue; }
    const media = medium ? sectionMedia(id, env) : [];
    if (medium && !media.includes(medium)) out.push(reason("section", `section ${id} serves medium ${media.join(", ")}, not the page's ${medium} (frame ${String(doc.frame)}): the page's layout breaks`));
  }
  for (const ref of pageCopyRefs(doc)) {
    const hash = ref.indexOf("#");
    const owner = hash > 0 ? ref.slice(0, hash) : "", key = hash > 0 ? ref.slice(hash + 1) : "";
    const keys = env.writerKeys.get(owner);
    if (!keys) out.push(reason("copy", `copy ${ref} names no pinned Writer slot`));
    else if (!keys.has(key)) out.push(reason("copy", `copy ${ref}: ${owner}'s pinned candidate has no key ${key}`));
  }
  return out;
}

export function certifyPublication(slot: SlotRecord, _candidate: CandidateRecord, contract: Readonly<Record<string, unknown>>): Reason[] {
  if (contract.fixture === undefined) return [reason("no-fixture", `slot ${slot.id} declares no contract fixture (slot.json contract.fixture)`)];
  return [];
}
