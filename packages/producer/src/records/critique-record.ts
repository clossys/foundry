/**
 * A slot's critique records (`<slot>/critiques/<leaf>-v<n>.json`, slot-constitution.md section 5b stage 4; R16.2):
 * the one validation `clossys critique` applies before it writes a record, shared by the slot check that reads the
 * folder back (foundry-build-0048 CHECK-FIX P1), so the check accepts exactly what the writer writes.
 */
import { loadSchema, validateValue } from "../pipeline/schema.js";

/** A slot's critique records folder. */
export const CRITIQUES_DIR = "critiques";

/** Maker files a packet never lists: a recipe, its craft notes or generator, a ledger, direction notes, briefs or prompts. */
const MAKER = /(?:^|\/)(?:recipes\/|craft\.md$|generate\.mjs$|ledger\.json$|directions?(?:\/|\.|$)|notes?(?:\/|\.|$)|prompts?(?:\/|\.|$)|brief\.md$)/i;
/** The issues of one critique record's manifest for a slot of `agent` judged by `standard`. */
export function manifestIssues(doc: { standard: string; packet: { manifest: readonly { role: string; ref: string }[] } }, agent: string, slotDir: string): string[] {
  const issues: string[] = [];
  const base = `packages/${agent}/standards/${doc.standard}/`;
  const roles = new Set(doc.packet.manifest.map(item => item.role));
  for (const role of ["taste", "render"]) if (!roles.has(role)) issues.push(`packet manifest lists no ${role}`);
  for (const item of doc.packet.manifest) {
    const ref = item.ref;
    if (MAKER.test(ref)) { issues.push(`packet manifest lists ${ref}: never a recipe file, direction notes or the maker`); continue; }
    if (item.role === "taste" && ref !== `${base}taste.md`) issues.push(`taste ref ${ref} is not ${base}taste.md`);
    if (item.role === "exemplar" && !ref.startsWith(`${base}exemplars/`) && !/^https?:\/\//.test(ref)) issues.push(`exemplar ref ${ref} is not under ${base}exemplars/ or a link`);
    if (item.role === "contract" && ref !== `${slotDir}/slot.json` && ref !== `${slotDir}/slot.json#contract`) issues.push(`contract ref ${ref} is not ${slotDir}/slot.json#contract`);
  }
  return issues;
}

/** Where a critique record belongs: its slot id, the slot's agent, the slot folder as packets cite it and, when given, the candidate. */
export interface CritiqueTarget { readonly slot: string; readonly agent: string; readonly slotDir: string; readonly candidate?: string }

/**
 * The writer's validation of one critique record: critique.schema.json, then the slot it names, the candidate when
 * one is given, and the packet manifest (only the standard, the contract and the render, R16.2). Empty when valid.
 */
export function critiqueRecordIssues(value: unknown, target: CritiqueTarget): string[] {
  const issues = validateValue(value, loadSchema("critique")).map(issue => `${issue.path} ${issue.message}`);
  if (issues.length) return issues;
  const doc = value as { slot: string; candidate: string; standard: string; packet: { manifest: { role: string; ref: string }[] } };
  if (doc.slot !== target.slot) issues.push(`the record names slot ${doc.slot}, not ${target.slot}`);
  if (target.candidate !== undefined && doc.candidate !== target.candidate) issues.push(`the record names candidate ${doc.candidate}, not ${target.candidate}`);
  issues.push(...manifestIssues(doc, target.agent, target.slotDir));
  return issues;
}

/** The file a critique of `candidate` is written to under critiques/: the candidate's stem, `.json` (`<leaf>-v<n>.json`). */
export const critiqueFileName = (candidate: string): string => `${candidate.replace(/\.[^.]+$/, "")}.json`;
