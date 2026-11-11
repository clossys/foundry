import { createHash } from "node:crypto";
import { basename, dirname, resolve } from "node:path";
import { loadCatalog, type StrategyCatalog } from "./catalog.js";
import { ARCHETYPE_RECORD_ID, recordedArchetype } from "./archetype.js";
import { parseFinding, RUN_CITATION_PATTERN } from "./format/finding.js";
import { RECORD_ID_PATTERN } from "./format/ref.js";
import { parseSlotPin, slotCandidateCell, slotCandidateVersion } from "./format/slot.js";
import { validateTree } from "./format/tree.js";
import type { StrategyModel, StrategyRootIssue, StrategyTree } from "./format/types.js";
import { storeFault, type DirectorStoreReader } from "./store-io.js";

/**
 * Director evidence lives beside the agent tree, at `<consumer>/evidence/director/<id>.md`.
 * From the strategy root `<consumer>/agents/director` it is reported as this root-relative prefix.
 */
export const EVIDENCE_PREFIX = "../../evidence/director";

type Issue = [StrategyRootIssue["reason"], string];
/** One fault vocabulary for every reader, so messages stay stable whoever reads. */
function faultIssue(error: unknown, operation: "list" | "read"): Issue {
  switch (storeFault(error)) {
    case "symlink": return ["outside-root", "Symlink paths are not followed"];
    case "outside": return ["outside-root", "Path resolves outside the strategy root"];
    case "changed": return ["outside-root", "File changed during confinement checks"];
    case "not-directory": return ["invalid-path", "Expected a directory"];
    case "not-file": return ["invalid-path", "Expected a regular file"];
    case "io": return ["unreadable", operation === "list" ? "Directory could not be listed" : "File could not be read"];
    default: return ["unreadable", "Path could not be read"];
  }
}

/** The consumer folder holding Director evidence, when the root is `<consumer>/agents/director`. */
export function evidenceBase(root: string): string | undefined {
  return basename(root) === "director" && basename(dirname(root)) === "agents" ? dirname(dirname(root)) : undefined;
}

/** Where the Director's generated files are written and read: store paths under `base`. */
export interface DirectorOutput { readonly base: string; readonly briefs: string; readonly reports: string; readonly citations: string }

/**
 * The Director's generated files (compiled briefs, reports, the citation index). With the flat-store
 * root `<consumer>/agents/director` they live with Director evidence, under
 * `<consumer>/evidence/director/{briefs,reports}/`, never inside the slot tree (an agent folder holds
 * only ia.json and slot folders). Any other root keeps them under itself.
 */
export function directorOutput(root: string): DirectorOutput {
  const strategy = resolve(root), consumer = evidenceBase(strategy);
  if (consumer === undefined) return { base: strategy, briefs: "briefs", reports: "reports", citations: "citations.json" };
  return { base: consumer, briefs: "evidence/director/briefs", reports: "evidence/director/reports", citations: "evidence/director/reports/citations.json" };
}

/**
 * Re-reads one file the model recorded, by the same root-relative path the model reports:
 * a slot file under the root, or Director evidence under `EVIDENCE_PREFIX`.
 */
export function readStrategyFile(root: string, store: DirectorStoreReader, path: string): string | undefined {
  const base = path.startsWith(`${EVIDENCE_PREFIX}/`) ? evidenceBase(resolve(root)) : undefined;
  if (base !== undefined) return store.read(base, path.slice("../../".length));
  return store.read(resolve(root), path);
}

/**
 * Builds the strategy model from the flat slot model, through the injected store reader:
 * `<root>/<slot-id>/pin.json` names the active candidate of each slot by file name and sha256,
 * and `<root>/<slot-id>/candidates/<name>-v<n>.md` is read as that slot's active cell by the
 * one candidate parser (format/slot.ts). An unpinned slot has no active cell. The active
 * pointers are the pins, and every candidate's version is recorded in `candidateVersions`
 * so a citation of a superseded candidate is stale, not dangling. The grouping is the root's `ia.json` when it places every catalog
 * leaf exactly once. Findings are the consumer's Director evidence
 * (`<consumer>/evidence/director/*.md`, top-level files) when the root is
 * `<consumer>/agents/director`; any other root has no reachable evidence and no findings.
 * The slot model records no sessions or requests: pins carry who decided and why.
 *
 * Symlink files and directories are refused by the reader; references never cause reads.
 * Broken records produce path/line issues while valid records remain available.
 */
export function readStrategyRoot(root: string, store: DirectorStoreReader, options: { catalog?: StrategyCatalog } = {}): StrategyModel {
  const model: StrategyModel = { root: resolve(root), catalog: options.catalog ?? loadCatalog(), tree: undefined, cells: [], sessions: [], findings: [], requests: [], files: Object.create(null), issues: [], candidateVersions: Object.create(null) };
  const issue = (path: string, reason: StrategyRootIssue["reason"], message: string, line = 1) => model.issues.push({ path, line, reason, message });
  try {
    const entry = store.stat(model.root, ".");
    if (entry?.type === "symlink") { issue(".", "outside-root", "Symlink roots are not followed"); return model; }
    if (entry?.type !== "directory") throw new Error("Root must be a directory");
  } catch (error) {
    if (storeFault(error) === "root-symlink") issue(".", "outside-root", "Symlink roots are not followed");
    else issue(".", "unreadable", "Strategy root is unreadable or is not a directory");
    return model;
  }
  function entries(base: string, path: string, reported = path): string[] | undefined {
    try { return store.list(base, path); }
    catch (error) { issue(reported, ...faultIssue(error, "list")); return []; }
  }
  function read(base: string, path: string, reported = path): string | undefined {
    try {
      const text = store.read(base, path);
      if (text === undefined) { issue(reported, "unreadable", "Path could not be read"); return undefined; }
      model.files[reported] = text; return text;
    } catch (error) { issue(reported, ...faultIssue(error, "read")); return undefined; }
  }
  function json(path: string): unknown {
    const text = read(model.root, path); if (text === undefined) return undefined;
    try { return JSON.parse(text); } catch (error) {
      const position = /position (\d+)/.exec(String(error));
      const line = position ? text.slice(0, Number(position[1])).split("\n").length : Number(/line (\d+)/.exec(String(error))?.[1] ?? 1);
      issue(path, "invalid-json", "Invalid JSON", line); return undefined;
    }
  }

  const active: Record<string, number | null> = Object.fromEntries(model.catalog.cells.map(c => [c.id, null]));
  const candidateVersions: Record<string, number[]> = Object.create(null);
  // Slots are addressed by catalog id; the root itself is never listed.
  for (const id of model.catalog.cells.map(c => c.id)) {
    const names = entries(model.root, id);
    if (names?.includes("candidates")) {
      const versions = (entries(model.root, `${id}/candidates`) ?? []).map(slotCandidateVersion).filter((v): v is number => v !== undefined);
      if (versions.length) candidateVersions[id] = [...new Set(versions)].sort((a, b) => a - b);
    }
    if (!names?.includes("pin.json")) continue;
    const pinPath = `${id}/pin.json`;
    const value = json(pinPath); if (value === undefined) continue;
    const pin = parseSlotPin(value);
    if (!pin.ok) { issue(pinPath, "invalid-format", pin.message); continue; }
    const version = slotCandidateVersion(pin.value.candidate)!;
    const path = `${id}/candidates/${pin.value.candidate}`;
    const bytes = read(model.root, path); if (bytes === undefined) continue;
    if (createHash("sha256").update(bytes).digest("hex") !== pin.value.sha256) { issue(path, "invalid-format", "Pinned candidate bytes disagree with pin.json sha256"); continue; }
    try { model.cells.push({ ...slotCandidateCell({ id, version, updated: pin.value.at.slice(0, 10), path, bytes }), pin: { decidedBy: pin.value.decidedBy, basis: pin.value.basis } }); active[id] = version; }
    catch (error) { issue(path, "invalid-format", error instanceof Error ? error.message : String(error)); }
  }

  model.candidateVersions = candidateVersions;
  const tree: StrategyTree = { schemaVersion: 1, catalog: "@clossys/director#strategy-v1", archetype: "default", core: "archetype", active };
  let hasIa = false;
  try { hasIa = store.stat(model.root, "ia.json") !== undefined; } catch (error) { issue("ia.json", ...faultIssue(error, "read")); }
  const ia = hasIa ? json("ia.json") as { nodes?: unknown } | undefined : undefined;
  if (ia !== undefined) {
    const nodes = Array.isArray(ia?.nodes) ? ia.nodes as { id?: unknown; label?: unknown; children?: unknown }[] : undefined;
    const grouping = nodes?.map(node => ({
      id: node?.id, name: node?.label,
      children: Array.isArray(node?.children) ? (node.children as { id?: unknown; label?: unknown; slots?: unknown }[]).map(child => ({ id: child?.id, name: child?.label, cells: child?.slots })) : node?.children,
    }));
    const checked = validateTree({ ...tree, tree: grouping }, model.catalog);
    if (checked.ok) model.tree = checked.value;
    else { model.tree = tree; for (const error of checked.issues) issue("ia.json", "invalid-format", `${error.path}: ${error.message}`, error.line); }
  } else model.tree = tree;

  const base = evidenceBase(model.root);
  if (base !== undefined) {
    for (const name of entries(base, "evidence/director", EVIDENCE_PREFIX) ?? []) {
      const path = `${EVIDENCE_PREFIX}/${name}`;
      let type: string | undefined;
      try { type = store.stat(base, `evidence/director/${name}`)?.type; }
      catch (error) { issue(path, ...faultIssue(error, "read")); continue; }
      if (type === "directory") continue;
      const id = name.endsWith(".md") ? name.slice(0, -3) : "";
      if (!RECORD_ID_PATTERN.test(id)) { issue(path, "invalid-path", "Expected a finding-id.md filename"); continue; }
      const text = read(base, `evidence/director/${name}`, path);
      if (text === undefined) continue;
      const result = parseFinding(text, path);
      if (!result.ok) { for (const error of result.issues) issue(path, "invalid-format", `${error.path}: ${error.message}`, error.line); continue; }
      if (result.value.id !== id) issue(path, "invalid-path", "Finding id disagrees with its filename"); else model.findings.push(result.value);
    }
    const archetype = recordedArchetype(model.findings, model.catalog);
    if (archetype?.ok === false) issue(`${EVIDENCE_PREFIX}/${ARCHETYPE_RECORD_ID}.md`, "invalid-format", `Archetype record: ${archetype.message}`);
    else if (archetype && model.tree) model.tree = { ...model.tree, archetype: archetype.archetype };
    model.runs = citedRuns(dirname(base), store, model.findings);
  }
  return model;
}

/** The run store file of one step, as the clossys CLI names it: `check:pipeline` -> `.clossys/runs/check.pipeline.jsonl`. */
export function runStoreFile(step: string): string { return `.clossys/runs/${step.replace(/[^a-z0-9.-]/gi, ".")}.jsonl`; }

/**
 * Resolves the run citations of the model's findings against the local run store under `repo`
 * (`<repo>/.clossys/runs/<step>.jsonl`, gitignored, one clossys.pipeline-run/1 record per line).
 * Only records of the cited step with the cited run id resolve; an absent store resolves nothing.
 */
export function citedRuns(repo: string, store: DirectorStoreReader, findings: readonly { run?: string }[]): Record<string, { step: string; run: string; exit: number }> {
  const runs: Record<string, { step: string; run: string; exit: number }> = Object.create(null);
  const cited = [...new Set(findings.map(finding => finding.run).filter((run): run is string => run !== undefined))];
  const byStep = new Map<string, string[]>();
  for (const citation of cited) {
    const match = RUN_CITATION_PATTERN.exec(citation); if (!match) continue;
    byStep.set(match[1]!, [...byStep.get(match[1]!) ?? [], match[2]!]);
  }
  for (const [step, ids] of byStep) {
    let text: string | undefined;
    try { text = store.read(repo, runStoreFile(step)); } catch { text = undefined; }
    for (const line of (text ?? "").split("\n")) {
      if (!line.trim()) continue;
      let record: { schema?: unknown; run?: unknown; step?: unknown; exit?: unknown };
      try { record = JSON.parse(line); } catch { continue; }
      if (record.schema !== "clossys.pipeline-run/1" || record.step !== step || typeof record.run !== "string" || !ids.includes(record.run) || typeof record.exit !== "number") continue;
      runs[`${step}#${record.run}`] = { step, run: record.run, exit: record.exit };
    }
  }
  return runs;
}
