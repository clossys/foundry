import type { WriterLibrary, WriterShapeIssue } from "../model/types.js";
import type { WriterCheckFinding, WriterCheckOptions } from "./freeze.js";

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const prefixes = { string: "st", term: "lx", pattern: "pt" } as const;
const recordId = /^(st|lx|pt)\.[0123456789abcdefghjkmnpqrstvwxyz]{10}$/;

/** WR4 governs composition only: passages and chrome contain references to
 * strings, terms or pattern parts. Resolution and schema cardinality are later
 * checks. Page narratives may reuse any passage; no page binding is required.
 */
export function checkWriterPurity(library: WriterLibrary, _options: WriterCheckOptions = {}): WriterCheckFinding[] {
  const findings: WriterCheckFinding[] = [];
  for (const [locale, content] of Object.entries(library.locales)) for (const record of content.records) {
    const passage = record.leaf.startsWith("passages.");
    const chrome = record.leaf === "narratives.site-chrome" || record.leaf === "narratives.app-chrome";
    if (!passage && !chrome) continue;
    const value = record as unknown as Record<string, unknown>;
    const base = `locales.${locale}.records.${record.id}`;
    const fail = (path: string, field: string, message: string): void => {
      findings.push({ code: "WR4", severity: "error", path, locale, recordId: record.id, field, message: `WR4: ${message}` });
    };
    const ref = (reference: unknown, path: string, field: string): void => {
      if (!object(reference)) {
        fail(path, field, "Composition values must be string, term or pattern references; inline copy is not allowed.");
        return;
      }
      const kind = reference.ref;
      if (kind !== "string" && kind !== "term" && kind !== "pattern") {
        fail(`${path}.ref`, field, "Only string, term or pattern references are allowed; references to another passage or its fields are not allowed.");
        return;
      }
      const keys = kind === "pattern" ? ["ref", "id", "part"] : ["ref", "id"];
      for (const key of Object.keys(reference)) if (!keys.includes(key)) {
        fail(`${path}.${key}`, field, "Reference objects cannot contain inline copy or selectors into another passage's fields.");
      }
      if (typeof reference.id !== "string" || recordId.exec(reference.id)?.[0] !== reference.id || !reference.id.startsWith(`${prefixes[kind]}.`)) {
        fail(`${path}.id`, field, `A ${kind} reference requires its own ${prefixes[kind]} record ID; references to another passage or its fields are not allowed.`);
      }
      if (kind === "pattern" && Object.hasOwn(reference, "part") && typeof reference.part !== "string") {
        fail(`${path}.part`, field, "A pattern part selector must be a string.");
      }
    };
    const fields = (entries: unknown, path: string, region?: string): void => {
      if (!object(entries)) { fail(path, region ?? "fields", "Composition fields must be a map of references."); return; }
      for (const [name, reference] of Object.entries(entries)) {
        const field = region === undefined ? name : `${region}.${name}`;
        const fieldPath = `${path}.${name}`;
        if (Array.isArray(reference)) reference.forEach((item, index) => ref(item, `${fieldPath}[${index}]`, field));
        else ref(reference, fieldPath, field);
      }
    };
    if (passage) fields(value.fields, `${base}.fields`);
    else if (!object(value.regions)) fail(`${base}.regions`, "regions", "Chrome regions must contain maps of references.");
    else for (const [region, entries] of Object.entries(value.regions)) fields(entries, `${base}.regions.${region}`, region);
  }
  return findings;
}

/** WR1 rejects invalid references before returning a library. Translate only
 * its reference-grammar issues under passage fields or chrome regions, so CLI
 * callers can report WR4 without reparsing or weakening the safe loader.
 */
export function writerPurityShapeFindings(issues: readonly WriterShapeIssue[]): WriterCheckFinding[] {
  const findings: WriterCheckFinding[] = [];
  for (const issue of issues) {
    if (issue.code !== "WR1") continue;
    const scope = /^(?:(?:[^/]+\/)*passages\/[^/]+\.json(?:\[\d+\])?|record)\.fields(?:\.|\[|$)/.test(issue.path)
      || /^(?:(?:[^/]+\/)*narratives\/[^/]+\.json(?:\[\d+\])?|record)\.regions(?:\.|\[|$)/.test(issue.path);
    const grammar = /^(?:Expected a passage reference|Expected an object map|Unknown field|Required field|Expected one of string, term, pattern|Expected a (?:st|lx|pt|Writer) record ID with ten lowercase Crockford characters|Expected a string)$/.test(issue.message);
    if (scope && grammar) findings.push({ code: "WR4", severity: "error", path: issue.path, message: `WR4: Composition requires string, term or pattern references only. ${issue.message}` });
  }
  return findings;
}
