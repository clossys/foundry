/**
 * Specimen element trees: the sample children a candidate's preview fixture declares.
 *
 * A compound component (Tabs with a list, triggers and panels; Card with a header, content and
 * footer) is empty at rest, and plain fixture props cannot express its parts. Its preview fixture
 * declares them as a small element tree in `fixtures.props.children` (or `fixtures.children` when
 * the fixtures are the props themselves):
 *
 *   node     = text | { "$copy": "<writer key>" } | { "$component": "<export>", "props"?: {…}, "children"?: node | node[] }
 *   text     = string | number
 *
 * `$component` names only an export of the candidate's own mounted module, and `$copy` only a
 * Writer key the specimen copy holds; anything else is rejected before the page is written, so a
 * specimen never imports a name its candidate does not export. The page module renders the tree
 * (`resolve`/`part` in publish/install.ts) with the same module the item mounts from.
 */

import { parseWriterSlotBody } from "@clossys/writer/slot-body";
import { listSlots, readCandidate } from "../records/slots.js";
import { parseFrontmatter } from "../records/slot-model/index.js";

const IDENT = /^[A-Za-z_$][\w$]*$/;
const NODE_KEYS = new Set(["$component", "props", "children"]);

/** The value names a module source exports (declarations, export lists and re-exports; types excluded). */
export function moduleExports(source: string): Set<string> {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
  const names = new Set<string>();
  for (const match of code.matchAll(/\bexport\s+(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g)) names.add(match[1]!);
  for (const match of code.matchAll(/\bexport\s+(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(match[1]!);
  for (const match of code.matchAll(/\bexport\s+(type\s+)?\{([^}]*)\}/g)) {
    if (match[1]) continue;
    for (const raw of match[2]!.split(",")) {
      const spec = raw.trim();
      if (!spec || spec.startsWith("type ")) continue;
      const name = spec.split(/\s+as\s+/).at(-1)!.trim();
      if (IDENT.test(name) && name !== "default") names.add(name);
    }
  }
  return names;
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** The sample children a preview fixture declares, if any. */
export function fixtureChildren(fixtures: unknown): unknown {
  if (!isRecord(fixtures)) return undefined;
  if (typeof fixtures.file === "string") return isRecord(fixtures.props) ? fixtures.props.children : undefined;
  return fixtures.children;
}

/**
 * Why a fixture tree cannot render: `$component` names that `exports` lacks, `$copy` keys that
 * `copy` lacks, and values that are not text, copy or element nodes in a child position.
 */
export function specimenTreeIssues(tree: unknown, exports: ReadonlySet<string>, copy: Readonly<Record<string, string>>): string[] {
  const issues: string[] = [];
  const copyRef = (node: Record<string, unknown>, at: string): void => {
    if (typeof node.$copy !== "string" || Object.keys(node).length !== 1) issues.push(`${at}: a copy node is exactly { "$copy": "<writer key>" }`);
    else if (!Object.hasOwn(copy, node.$copy)) issues.push(`${at}: Writer has no copy key ${node.$copy}`);
  };
  const value = (input: unknown, at: string): void => {
    if (Array.isArray(input)) { input.forEach((item, index) => value(item, `${at}[${index}]`)); return; }
    if (!isRecord(input)) return;
    if ("$copy" in input) { copyRef(input, at); return; }
    if ("$component" in input) { element(input, at); return; }
    if ("$element" in input || "$asset" in input) { issues.push(`${at}: a specimen tree mounts no other slot or asset`); return; }
    for (const [key, item] of Object.entries(input)) value(item, `${at}.${key}`);
  };
  const child = (input: unknown, at: string): void => {
    if (Array.isArray(input)) { input.forEach((item, index) => child(item, `${at}[${index}]`)); return; }
    if (typeof input === "string" || typeof input === "number") return;
    if (isRecord(input) && "$copy" in input) { copyRef(input, at); return; }
    if (isRecord(input) && "$component" in input) { element(input, at); return; }
    issues.push(`${at}: a child is text, { "$copy" } or { "$component" }`);
  };
  const element = (node: Record<string, unknown>, at: string): void => {
    const name = node.$component;
    if (typeof name !== "string" || !IDENT.test(name)) { issues.push(`${at}: $component is an export name`); return; }
    if (!exports.has(name)) issues.push(`${at}: the candidate exports no component ${name}`);
    for (const key of Object.keys(node)) if (!NODE_KEYS.has(key)) issues.push(`${at}: unknown element field ${key}`);
    if (node.props !== undefined) {
      if (!isRecord(node.props)) issues.push(`${at}.props: props is an object`);
      else {
        if ("children" in node.props) issues.push(`${at}.props: children go in the element's children field`);
        value(node.props, `${at}.props`);
      }
    }
    if (node.children !== undefined) child(node.children, `${at}.children`);
  };
  child(tree, "children");
  return issues;
}

/**
 * Writer copy by key from the consumer's pinned Writer slots (`locale` rows), for a consumer whose
 * Writer has no compiled locale or declarations yet. A candidate whose bytes differ from its pin,
 * or that does not parse, contributes nothing.
 */
export function pinnedWriterCopy(consumer: string, locale = "en"): Record<string, string> {
  const copy: Record<string, string> = {};
  for (const entry of listSlots(consumer, "writer")) {
    if (!entry.pin) continue;
    try {
      const candidate = readCandidate(consumer, "writer", entry.id, entry.pin.candidate);
      if (candidate.sha256 !== entry.pin.sha256) continue;
      const parsed = parseFrontmatter(candidate.bytes);
      if (!parsed.ok) continue;
      for (const row of parseWriterSlotBody(parsed.value.body, parsed.value.fields.locales as readonly string[])) {
        if (row.locale === locale && typeof row.record.text === "string") copy[row.record.id] = row.record.text;
      }
    } catch { /* an unreadable Writer slot binds nothing */ }
  }
  return copy;
}
