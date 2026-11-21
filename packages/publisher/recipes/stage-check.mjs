#!/usr/bin/env node
/**
 * stage-check (Publisher): the maker's own check of a craft stage's output, run before the stage is
 * recorded (slot-constitution.md section 5b; foundry-feedback-0015, -0018). Every recipe under
 * packages/publisher/recipes/ calls it.
 *
 *   clossys recipe check <recipe-id> brief   <slot> <brief.json>      [--root <dir>]
 *   clossys recipe check <recipe-id> diverge <slot> <directions.json> [--root <dir>]
 *   clossys recipe check <recipe-id> draft   <slot> <draft.json>      [--root <dir>]
 *
 * Publisher assembles and never writes or designs. brief and diverge: the shared rules of
 * stage-core.mjs, plus: a page briefs from its pinned Designer frame, and every page direction names
 * exactly one frame the slot lists; a publication's directions order the slot's own pinned pages.
 * draft: a page names a pinned frames.* frame and pinned sections the slot lists, binds Writer keys
 * only (its title and every display string resolve to a key of a pinned Writer slot the page uses),
 * and a publication's tree places exactly the slot's pinned pages (the 3S-ND worklist classes:
 * frame null, inline title).
 *
 * Mechanical only: it reads files, never the clock, the network or randomness, and runs no model.
 * Exit 0 clean, 1 with one line per issue (rule id, the issue, the fix), 2 on a usage error.
 * Nothing under the judge (src/constitution, certifiers, guards) imports this file (R16.1).
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { FINDING_REF, checkBriefWith, checkDivergeWith, checkDraftWith, excerpt, isRecord, issue, pinOf, runStageCli, strings } from "./stage-core.mjs";

const AGENT = "publisher";

const FRAME = /^frames\.[a-z0-9][a-z0-9.-]*$/;
const SECTION = /^sections\.[a-z0-9][a-z0-9.-]*$/;
const PAGE = /^page\.[a-z0-9][a-z0-9-]*$/;
/** A Writer copy key (dotted, no spaces) or a `<slot>#<key>` reference. */
const COPY_KEY = /^(?:[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*){1,3}#[a-z0-9][a-z0-9.-]*|[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+)$/;
const COPY_REF = /^[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*){1,3}#[a-z0-9][a-z0-9.-]*$/;
const ROUTE = /^\/(?:[a-z0-9][a-z0-9-]*|:[a-z][a-zA-Z0-9]*)?(?:\/(?:[a-z0-9][a-z0-9-]*|:[a-z][a-zA-Z0-9]*))*$/;
const DISPLAY = new Set(["label", "title", "description", "heading", "text", "prompt", "placeholder", "caption", "alt", "summary", "message", "cta", "tooltip", "empty"]);

const isPage = world => world.slotDoc.kind === "page";
/** The slots a page or publication draws on: its inputs and its uses. */
const nearOf = world => [...new Set([...world.inputs, ...strings(world.slotDoc.uses)])];
const framesOf = world => world.inputs.filter(id => FRAME.test(id));

const HOOKS = {
  brief(root, world, brief, out, inputs) {
    if (isPage(world)) {
      if (!framesOf(world).length) out.push(issue("R20", `${world.slot} lists no frames.* input`, "the slot must name its Designer frame in inputs before a page is assembled; request it from the Designer"));
    } else {
      const pages = world.inputs.filter(id => PAGE.test(id));
      if (!pages.length) out.push(issue("R20", `${world.slot} lists no page.* input`, "a publication orders pinned pages: name them in the slot inputs"));
    }
    for (const item of inputs) if (typeof item.slot === "string" && !nearOf(world).includes(item.slot)) out.push(issue("R20", `input ${item.slot} is not one the slot lists`, "assemble only what the slot names in inputs or uses; request a change upstream"));
  },
  direction(root, world, direction, at, out, traits) {
    const slots = traits.filter(id => typeof id === "string" && !FINDING_REF.test(id));
    for (const id of slots) if (!nearOf(world).includes(id)) out.push(issue("R20", `${at} cites ${id}, which the slot does not list`, "cite only the slot's inputs and uses"));
    if (isPage(world)) {
      const frames = slots.filter(id => FRAME.test(id));
      if (frames.length !== 1) out.push(issue("R20", `${at} names ${frames.length} frames`, `name exactly one frame of the slot: ${framesOf(world).join(", ") || "(none)"}`));
    } else if (!slots.some(id => PAGE.test(id))) out.push(issue("R20", `${at} orders no page`, "cite the pages the direction leads with"));
  },
};

export const checkBrief = (root, slot, brief) => checkBriefWith(root, AGENT, slot, brief, HOOKS);
export const checkDiverge = (root, slot, file) => checkDivergeWith(root, AGENT, slot, file, HOOKS);

// ---- draft --------------------------------------------------------------------------------------

/** Display strings: string values under a display key, outside the page's own notes and source. */
function displayStrings(value, path, out) {
  if (Array.isArray(value)) value.forEach((item, index) => displayStrings(item, [...path, String(index)], out));
  else if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      const next = [...path, key];
      if (next.join(".") === "meta.source" || next.join(".") === "meta.entry.fields.note") continue;
      if (typeof item === "string" && DISPLAY.has(key)) out.push({ path: next.join("."), value: item });
      else displayStrings(item, next, out);
    }
  }
  return out;
}
function treeCells(node, out = []) {
  if (Array.isArray(node)) for (const item of node) treeCells(item, out);
  else if (isRecord(node)) { out.push(...strings(node.cells)); treeCells(node.children, out); }
  return out;
}

export const DRAFT_CHECKS = Object.freeze({
  "page.assembled": draft => {
    const page = draft.json;
    if (!isRecord(page)) return [{ what: "the page is not a JSON object", fix: "write one clossys.page/1 JSON record" }];
    const out = [];
    if (page.schema !== "clossys.page/1") out.push({ what: `schema is ${JSON.stringify(page.schema)}`, fix: 'set "schema": "clossys.page/1"' });
    if (typeof page.path !== "string" || !ROUTE.test(page.path)) out.push({ what: `path ${JSON.stringify(page.path)} is not a route`, fix: 'set "path" to a route such as "/" or "/segment/:param"' });
    if (typeof page.frame !== "string" || !FRAME.test(page.frame)) out.push({ what: `frame ${JSON.stringify(page.frame)} is not a Designer frames.* id`, fix: "name the Designer frame the slot lists (frames.<id>); Publisher never designs a shell" });
    const sections = strings(page.sections);
    if (!Array.isArray(page.sections) || !sections.length) out.push({ what: "the page assembles no sections", fix: "list the Designer sections.* the page assembles" });
    for (const id of sections) if (!SECTION.test(id)) out.push({ what: `section "${id}" is not a Designer sections.* id`, fix: "list Designer sections.* ids only" });
    if (new Set(sections).size !== sections.length) out.push({ what: "a section is listed twice", fix: "list each section once" });
    if (typeof page.title !== "string" || !COPY_KEY.test(page.title)) out.push({ what: `title ${JSON.stringify(page.title)} is not a Writer key`, fix: "bind the title to a Writer key (for example studio.page.<id>); never inline text" });
    if (!isRecord(page.copy) || !Object.keys(page.copy).length) out.push({ what: "the page binds no copy", fix: 'bind copy as {"<field>": "<slot>#<key>"}' });
    else for (const [field, ref] of Object.entries(page.copy)) if (typeof ref !== "string" || !COPY_REF.test(ref)) out.push({ what: `copy ${field} is ${JSON.stringify(ref)}`, fix: "bind it as a <slot>#<key> reference" });
    return out;
  },
  "page.no-inline-copy": draft => {
    if (!isRecord(draft.json)) return [{ what: "the page is not a JSON object", fix: "write one clossys.page/1 JSON record" }];
    return displayStrings(draft.json, [], []).filter(item => !COPY_KEY.test(item.value)).map(item => ({ what: `${item.path} is inline text "${excerpt(item.value, 40)}"`, fix: "bind a Writer key; request the string from the Writer if none exists" }));
  },
  "publication.routes": draft => {
    const doc = draft.json;
    if (!isRecord(doc)) return [{ what: "the publication is not a JSON object", fix: "write one clossys.publication/1 JSON record" }];
    const out = [];
    if (doc.schema !== "clossys.publication/1") out.push({ what: `schema is ${JSON.stringify(doc.schema)}`, fix: 'set "schema": "clossys.publication/1"' });
    if (typeof doc.format !== "string" || !/^[a-z][a-z0-9.-]*$/.test(doc.format)) out.push({ what: "the publication names no format", fix: 'set "format", for example "web.page.responsive"' });
    const order = strings(doc.entryOrder);
    if (!order.length) out.push({ what: "entryOrder is empty", fix: "list the route ids in order" });
    if (new Set(order).size !== order.length) out.push({ what: "entryOrder lists a route twice", fix: "list each route once" });
    for (const id of order) if (!/^[a-z][a-z0-9-]*$/.test(id)) out.push({ what: `route id "${id}" is not kebab-case`, fix: "use kebab-case route ids" });
    const pack = isRecord(doc.routePack) ? doc.routePack : undefined;
    if (!pack || typeof pack.packId !== "string" || !pack.packId) out.push({ what: "routePack names no packId", fix: 'set "routePack": {"packId": "<id>", "homeRouteId": "<route>"}' });
    else if (typeof pack.homeRouteId !== "string" || !order.includes(pack.homeRouteId)) out.push({ what: `routePack homeRouteId ${JSON.stringify(pack.homeRouteId)} is not in entryOrder`, fix: "name a home route listed in entryOrder" });
    const meta = isRecord(doc.meta) ? doc.meta : {};
    const source = isRecord(meta.source) ? meta.source : undefined;
    if (source?.kind !== "derived" || !strings(source.ref).length) out.push({ what: "meta.source is not derived from cited records", fix: 'set meta.source to {"kind": "derived", "ref": [...]}' });
    const cells = treeCells(meta.tree);
    if (!cells.length) out.push({ what: "meta.tree places no page", fix: "place the pages in meta.tree cells" });
    for (const cell of cells) if (!PAGE.test(cell)) out.push({ what: `tree cell "${cell}" is not a page slot`, fix: "place page.* slots only" });
    if (new Set(cells).size !== cells.length) out.push({ what: "the tree places a page twice", fix: "place each page once" });
    return out;
  },
});

/** The `### <key>` keys of a pinned Writer slot. */
function writerKeys(root, slot) {
  const pin = pinOf(root, slot);
  if (!pin || pin.agent !== "writer") return [];
  const text = readFileSync(join(root, "clossys", "agents", "writer", slot, "candidates", pin.candidate), "utf8");
  return [...text.matchAll(/^###\s+(\S+)\s*$/gm)].map(match => match[1]);
}

/** Maker-only: what the page or publication cites is pinned and listed by the slot; bare keys resolve. */
function draftExtra(root, world, draft) {
  const doc = draft.json;
  if (!isRecord(doc)) return [];
  const out = [];
  const near = nearOf(world);
  if (isPage(world)) {
    if (typeof doc.frame === "string" && FRAME.test(doc.frame)) {
      const pin = pinOf(root, doc.frame);
      if (!pin || pin.agent !== "designer") out.push(issue("R07", `frame ${doc.frame} is not a pinned Designer frame`, `request ${doc.frame} from the Designer and pin it first`));
      else if (!near.includes(doc.frame)) out.push(issue("R20", `frame ${doc.frame} is not one the slot lists`, `use a frame the slot names: ${framesOf(world).join(", ") || "(none)"}`));
    }
    for (const id of strings(doc.sections).filter(item => SECTION.test(item))) {
      const pin = pinOf(root, id);
      if (!pin || pin.agent !== "designer") out.push(issue("R07", `section ${id} is not a pinned Designer section`, `request ${id} from the Designer and pin it first`));
      else if (!near.includes(id)) out.push(issue("R20", `section ${id} is not one the slot lists`, "add it to the slot's uses upstream, or assemble only listed sections"));
    }
    const keys = new Set(near.flatMap(id => writerKeys(root, id)));
    const bare = [...(typeof doc.title === "string" ? [{ path: "title", value: doc.title }] : []), ...displayStrings(doc, [], [])]
      .filter(item => COPY_KEY.test(item.value) && !COPY_REF.test(item.value));
    for (const item of new Map(bare.map(each => [`${each.path}=${each.value}`, each])).values()) {
      if (!keys.has(item.value)) out.push(issue("R20", `${item.path} binds ${item.value}, which no pinned Writer slot the page uses defines`, "request the key from the Writer (or add its Writer slot to the page's uses) before assembling"));
    }
  } else {
    const cells = treeCells(isRecord(doc.meta) ? doc.meta.tree : undefined);
    for (const cell of cells.filter(item => PAGE.test(item))) {
      if (!pinOf(root, cell)) out.push(issue("R07", `tree cell ${cell} is not pinned`, `pin ${cell} first`));
      else if (!world.inputs.includes(cell)) out.push(issue("R20", `tree cell ${cell} is not an input of ${world.slot}`, "place only the slot's input pages"));
    }
    for (const id of world.inputs.filter(item => PAGE.test(item))) if (!cells.includes(id)) out.push(issue("R20", `input page ${id} is not placed in meta.tree`, `place ${id} in a tree cell`));
  }
  return out;
}

export const checkDraft = (root, slot, draft) => checkDraftWith(root, AGENT, slot, draft, DRAFT_CHECKS, draftExtra);

export const main = (argv, cwd = process.cwd()) => runStageCli(AGENT, { brief: checkBrief, diverge: checkDiverge, draft: checkDraft }, argv, cwd);

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = main(process.argv.slice(2));
  (result.code === 0 ? process.stdout : process.stderr).write(result.text);
  process.exitCode = result.code;
}
