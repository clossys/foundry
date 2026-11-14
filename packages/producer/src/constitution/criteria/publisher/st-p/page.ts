/**
 * Publisher criteria (ST-P, slot-constitution.md section 5a): a page assembles a Designer frame and
 * sections with Writer copy and never writes or designs; a publication orders pinned pages into
 * routes. Pure.
 */
import { excerpt, isRecord, strings } from "../../core/lib.js";
import type { Criterion } from "../../core/types.js";

const FRAME = /^frames\.[a-z0-9][a-z0-9.-]*$/;
const SECTION = /^sections\.[a-z0-9][a-z0-9.-]*$/;
/** A Writer copy key (dotted, no spaces) or a `<slot>#<key>` reference. */
const COPY_KEY = /^(?:[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*){1,3}#[a-z0-9][a-z0-9.-]*|[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+)$/;
const COPY_REF = /^[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*){1,3}#[a-z0-9][a-z0-9.-]*$/;
const ROUTE = /^\/(?:[a-z0-9][a-z0-9-]*|:[a-z][a-zA-Z0-9]*)?(?:\/(?:[a-z0-9][a-z0-9-]*|:[a-z][a-zA-Z0-9]*))*$/;

/** page.assembled: a clossys.page/1 record with a route path, a `frames.*` frame, unique `sections.*` sections, a Writer title key and `<slot>#<key>` copy references. */
export const assembled: Criterion = subject => {
  const page = subject.json;
  if (!isRecord(page)) return ["the page is not a JSON object"];
  const failures: string[] = [];
  if (page.schema !== "clossys.page/1") failures.push(`schema is ${JSON.stringify(page.schema)}, not clossys.page/1`);
  if (typeof page.path !== "string" || !ROUTE.test(page.path)) failures.push(`path ${JSON.stringify(page.path)} is not a route (/segment/...)`);
  if (typeof page.frame !== "string" || !FRAME.test(page.frame)) failures.push(`frame ${JSON.stringify(page.frame)} is not a Designer frames.* id`);
  const sections = strings(page.sections);
  if (!Array.isArray(page.sections) || !sections.length) failures.push("the page assembles no sections");
  for (const id of sections) if (!SECTION.test(id)) failures.push(`section "${id}" is not a Designer sections.* id`);
  if (new Set(sections).size !== sections.length) failures.push("a section is listed twice");
  if (typeof page.title !== "string" || !COPY_KEY.test(page.title)) failures.push(`title ${JSON.stringify(page.title)} is not a Writer key`);
  if (!isRecord(page.copy) || !Object.keys(page.copy).length) failures.push("the page binds no copy");
  else for (const [slot, ref] of Object.entries(page.copy)) if (typeof ref !== "string" || !COPY_REF.test(ref)) failures.push(`copy ${slot} is ${JSON.stringify(ref)}, not a <slot>#<key> reference`);
  return failures;
};

const DISPLAY = new Set(["label", "title", "description", "heading", "text", "prompt", "placeholder", "caption", "alt", "summary", "message", "cta", "tooltip", "empty"]);
/** Display strings: string values under a display key, outside the page's own notes and source. */
function displayStrings(value: unknown, path: string[], out: { path: string; value: string }[]): void {
  if (Array.isArray(value)) value.forEach((item, index) => displayStrings(item, [...path, String(index)], out));
  else if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      const next = [...path, key];
      if (next.join(".") === "meta.source" || next.join(".") === "meta.entry.fields.note") continue;
      if (typeof item === "string" && DISPLAY.has(key)) out.push({ path: next.join("."), value: item });
      else displayStrings(item, next, out);
    }
  }
}

/** page.no-inline-copy: every display string the page carries (label, title, description, prompt ...) is a Writer key, never inline text: Publisher assembles and never writes. */
export const noInlineCopy: Criterion = subject => {
  if (!isRecord(subject.json)) return ["the page is not a JSON object"];
  const found: { path: string; value: string }[] = [];
  displayStrings(subject.json, [], found);
  return found.filter(item => !COPY_KEY.test(item.value)).map(item => `${item.path} is inline text "${excerpt(item.value, 40)}"; bind a Writer key`);
};

/** The cells of a publication tree, depth first. */
function treeCells(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) for (const item of node) treeCells(item, out);
  else if (isRecord(node)) { out.push(...strings(node.cells)); treeCells(node.children, out); }
  return out;
}

/** publication.routes: a clossys.publication/1 record with a format, a unique entry order, a route pack whose home is in it, a derived source, and a tree whose cells are page slots. */
export const routes: Criterion = subject => {
  const doc = subject.json;
  if (!isRecord(doc)) return ["the publication is not a JSON object"];
  const failures: string[] = [];
  if (doc.schema !== "clossys.publication/1") failures.push(`schema is ${JSON.stringify(doc.schema)}, not clossys.publication/1`);
  if (typeof doc.format !== "string" || !/^[a-z][a-z0-9.-]*$/.test(doc.format)) failures.push("the publication names no format");
  const order = strings(doc.entryOrder);
  if (!order.length) failures.push("entryOrder is empty");
  if (new Set(order).size !== order.length) failures.push("entryOrder lists a route twice");
  for (const id of order) if (!/^[a-z][a-z0-9-]*$/.test(id)) failures.push(`route id "${id}" is not kebab-case`);
  const pack = isRecord(doc.routePack) ? doc.routePack : undefined;
  if (!pack || typeof pack.packId !== "string" || !pack.packId) failures.push("routePack names no packId");
  else if (typeof pack.homeRouteId !== "string" || !order.includes(pack.homeRouteId)) failures.push(`routePack homeRouteId ${JSON.stringify(pack.homeRouteId)} is not in entryOrder`);
  const meta = isRecord(doc.meta) ? doc.meta : {};
  const source = isRecord(meta.source) ? meta.source : undefined;
  if (source?.kind !== "derived" || !strings(source.ref).length) failures.push("meta.source is not derived from cited records");
  const cells = treeCells(meta.tree);
  if (!cells.length) failures.push("meta.tree places no page");
  for (const cell of cells) if (!/^page\.[a-z0-9][a-z0-9-]*$/.test(cell)) failures.push(`tree cell "${cell}" is not a page slot`);
  if (new Set(cells).size !== cells.length) failures.push("the tree places a page twice");
  return failures;
};
