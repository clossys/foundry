import { readFileSync, readdirSync } from "node:fs";

/**
 * No live read of a retired id (foundry-build-0033; IA audit 2026-11-16 proposal 9). A Writer record bundle reads a
 * Designer id through its binding rows (cellId, target, parent, value), its need rows (cellId) and its records
 * (leaf, schema, frame and section ids, block Designer ids). Each such read must name a live id or carry
 * `status: "retired"`; retired rows stay in place as history until the surface that owns them is deleted. Provenance
 * fields (record context, usages, external declarations, reviews, scope labels) describe where copy came from and are
 * not reads.
 */
export interface RetiredReferenceBundle { path: string; value: unknown }
export interface RetiredReferenceFinding { path: string; id: string; message: string }

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);
const rows = (value: Obj, key: string): Obj[] => (Array.isArray(value[key]) ? (value[key] as unknown[]).filter(isObj) : []);

const BINDING_KEYS = ["cellId", "target", "parent", "value"] as const;
const RECORD_KEYS = new Set(["leaf", "schema", "frameId", "sectionId"]);

/** Every whole retired id named inside `text`; `sections.cards` does not match `sections.cards-grid`. */
export function retiredIdsIn(text: string, retired: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(/[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+/g)) {
    const parts = match[0].split(".");
    for (let start = 0; start < parts.length - 1; start++) {
      for (let end = start + 2; end <= parts.length; end++) {
        const id = parts.slice(start, end).join(".");
        if (retired.has(id) && !out.includes(id)) out.push(id);
      }
    }
  }
  return out;
}

function recordReads(record: Obj, retired: ReadonlySet<string>, path: string, out: RetiredReferenceFinding[]): void {
  const visit = (value: unknown, at: string, key: string | undefined, parent: string | undefined) => {
    if (typeof value === "string") {
      if ((key !== undefined && RECORD_KEYS.has(key)) || (key === "id" && parent === "designer")) {
        for (const id of retiredIdsIn(value, retired)) out.push({ path: at, id, message: `${at} reads retired ${id}; retire the record or re-point it` });
      }
      return;
    }
    if (Array.isArray(value)) { value.forEach((item, index) => visit(item, `${at}[${index}]`, undefined, key)); return; }
    if (isObj(value)) for (const [name, item] of Object.entries(value)) visit(item, `${at}.${name}`, name, key);
  };
  visit(record, path, undefined, undefined);
}

/** Findings for every live read of a retired id across the given Writer record bundles. */
export function checkRetiredReferences(bundles: readonly RetiredReferenceBundle[], retired: ReadonlySet<string>): RetiredReferenceFinding[] {
  const out: RetiredReferenceFinding[] = [];
  for (const bundle of bundles) {
    if (!isObj(bundle.value)) continue;
    const doc = bundle.value;
    rows(doc, "bindings").forEach((row, index) => {
      if (row.status === "retired") return;
      for (const key of BINDING_KEYS) {
        if (typeof row[key] !== "string") continue;
        const at = `${bundle.path}#bindings[${index}].${key}`;
        for (const id of retiredIdsIn(row[key] as string, retired)) out.push({ path: at, id, message: `${at} binds retired ${id}; mark the binding status retired or re-point it` });
      }
    });
    rows(doc, "needs").forEach((row, index) => {
      if (row.status === "retired" || typeof row.cellId !== "string") return;
      const at = `${bundle.path}#needs[${index}].cellId`;
      for (const id of retiredIdsIn(row.cellId, retired)) out.push({ path: at, id, message: `${at} asks for retired ${id}; mark the need status retired` });
    });
    rows(doc, "records").forEach((row, index) => {
      if (row.status === "retired") return;
      recordReads(row, retired, `${bundle.path}#records[${index}]`, out);
    });
  }
  return out;
}

/** Retired ids from the Designer IA registers (read as data) plus Writer's retired passages. */
export function loadRetiredIds(root = new URL("../../", import.meta.url)): Set<string> {
  const ids = new Set<string>();
  const add = (file: URL) => {
    const doc = JSON.parse(readFileSync(file, "utf8")) as { retired?: unknown };
    for (const entry of Array.isArray(doc.retired) ? doc.retired : []) {
      const id = typeof entry === "string" ? entry : isObj(entry) && typeof entry.id === "string" ? entry.id : undefined;
      if (id) ids.add(id);
    }
  };
  const designer = new URL("../designer/src/catalog/ia/", root);
  for (const name of readdirSync(designer).filter(file => /^[a-z]+\.json$/.test(file)).sort()) add(new URL(name, designer));
  add(new URL("src/catalog/ia/passages.json", root));
  return ids;
}

/** Every JSON record bundle under `src/catalog/records`, pending drafts included. */
export function loadRecordBundles(root = new URL("../../src/catalog/records/", import.meta.url)): RetiredReferenceBundle[] {
  const out: RetiredReferenceBundle[] = [];
  const visit = (dir: URL, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) visit(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`);
      else if (entry.name.endsWith(".json")) out.push({ path: `${prefix}${entry.name}`, value: JSON.parse(readFileSync(new URL(entry.name, dir), "utf8")) });
    }
  };
  visit(root, "");
  return out;
}
