import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { loadCatalog } from "../catalog.js";

/**
 * Fictional flat slot-model records shared by the grounding, store and CLI tests. A Director
 * strategy root is `<base>/clossys/agents/director`; its slots are `<slot-id>/{slot.json,
 * candidates/<name>-v<n>.md, pin.json}` and its findings are the consumer's
 * `<base>/clossys/evidence/director/<id>.md`.
 */
export function strategyRoot(base: string): string {
  const root = join(base, "clossys", "agents", "director");
  mkdirSync(root, { recursive: true });
  return root;
}

/** The consumer evidence folder of a strategy root `<consumer>/agents/director`. */
export function evidenceDir(root: string): string {
  return join(dirname(dirname(root)), "evidence", "director");
}

export function findingFixture(id = "active-customers", value = 4200, aliases = ["4,200"]): string {
  return `---\nid: ${id}\nsource: evidence/count.csv\nobserved: 2026-10-29\nby: researcher\nvalue: ${value}\nunit: customers\naliases: ${JSON.stringify(aliases)}\n---\n- Observed in the count export.\n`;
}
export function stageFinding(root: string, id = "active-customers", text = findingFixture(id)): void {
  mkdirSync(evidenceDir(root), { recursive: true });
  writeFileSync(join(evidenceDir(root), `${id}.md`), text);
}

export interface SlotFixture {
  /** Candidate name stem; the file is `<name>-v<version>.md`. */
  name?: string;
  /** `finding:<id>` refs of the candidate source. */
  refs?: string[];
  feeds?: string[];
  functions?: string[];
  because?: string[];
  watch?: string[];
  /** Write the candidate without a pin (an open decision). */
  unpinned?: boolean;
  /** Who decided the pin and how; defaults to an owner pick, the decision every cell's decider accepts. */
  pin?: { decidedBy: string; basis: string };
}

/** The candidate bytes `stageSlot` writes, for tests that edit or hash them. */
export function candidateFixture(id: string, direction: readonly string[], options: SlotFixture = {}): string {
  const lines = [
    "---",
    `slot: ${JSON.stringify(id)}`,
    `source: ${JSON.stringify({ kind: "derived", ref: options.refs ?? [] })}`,
    `feeds: ${JSON.stringify(options.feeds ?? [])}`,
    `functions: ${JSON.stringify(options.functions ?? [])}`,
    "---",
    "",
    "## Direction",
    ...direction.map(line => `- ${line}`),
    "",
    "## Because",
    ...(options.because ?? ["Observed."]).map(line => `- ${line}`),
    "",
    "## Watch",
    ...(options.watch ?? ["Review."]).map(line => `- ${line}`),
    "",
  ];
  return lines.join("\n");
}

/** A pin for candidate bytes, as `clossys pin` records it. */
export function pinFixture(candidate: string, bytes: string, decision: { decidedBy: string; basis: string } = { decidedBy: "owner:fixture", basis: "picked" }): string {
  return `${JSON.stringify({ candidate, sha256: createHash("sha256").update(bytes).digest("hex"), ...decision, at: "2026-10-29T00:00:00Z" }, null, 2)}\n`;
}

/** Stages one slot folder with one candidate and (unless `unpinned`) the pin naming it. */
export function stageSlot(root: string, id: string, version: number, direction: string | readonly string[], options: SlotFixture = {}): { path: string; bytes: string } {
  const catalog = loadCatalog();
  const def = catalog.cells.find(cell => cell.id === id);
  const dir = join(root, id);
  mkdirSync(join(dir, "candidates"), { recursive: true });
  const [l1, l2] = id.split(".");
  writeFileSync(join(dir, "slot.json"), `${JSON.stringify({
    schema: "clossys.slot/1", id, agent: "director", ia: { l1, l2: `${l1}.${l2}`, order: Math.max(0, catalog.cells.findIndex(cell => cell.id === id)) },
    kind: "brief", contract: { question: def?.question ?? "Fixture question?", mustContain: (def?.mustContain ?? []).map(({ key }) => ({ key })) },
    inputs: [], uses: [], options: 1,
  }, null, 2)}\n`);
  const name = `${options.name ?? "fixture"}-v${version}.md`;
  const bytes = candidateFixture(id, typeof direction === "string" ? [direction] : direction, options);
  writeFileSync(join(dir, "candidates", name), bytes);
  if (!options.unpinned) writeFileSync(join(dir, "pin.json"), pinFixture(name, bytes, options.pin));
  return { path: `${id}/candidates/${name}`, bytes };
}

/** The cell a bare (non-consumer) root's passing fixtures cite: such a root reads no consumer evidence. */
export const PASSING_SUPPORT_CELL = "context.customer.buying";

/**
 * Stages a slot whose candidate passes the per-cell completion rule (Q1–Q7): one Direction bullet per
 * catalog key, a Because citing resolvable evidence (plus any extra `refs`), a testable Watch and, unless
 * `pin` says otherwise, an owner pick. Use it wherever a test needs a cell `complete` and handoffs accept.
 * Under a consumer root (`<consumer>/agents/director`) the evidence is a staged finding; a bare root reads
 * no consumer evidence, so there it is a pinned `PASSING_SUPPORT_CELL`, and nothing is written outside the root.
 */
export function stagePassingSlot(root: string, id: string, version = 1, options: SlotFixture & { text?: string } = {}): { path: string; bytes: string } {
  const def = loadCatalog().cells.find(cell => cell.id === id);
  const text = options.text ?? "Only Fictional studios with 20 bookings each week";
  const direction = (def?.mustContain ?? []).map(({ key }) => `${key}: ${key === "Date" ? "2027-01-01" : text}`);
  if (direction.length < 2) direction.push(`Not: Large factories with 900 sites`);
  let evidence: string;
  if (basename(root) === "director" && basename(dirname(root)) === "agents") {
    stageFinding(root, "fixture-passing", "---\nid: fixture-passing\nsource: user\nobserved: 2026-10-29\nby: researcher\n---\n- Five fictional studio interviews.\n");
    evidence = "finding:fixture-passing";
  } else {
    if (id === PASSING_SUPPORT_CELL) throw new Error(`${PASSING_SUPPORT_CELL} is the bare-root support cell; stage it under a consumer root`);
    if (!existsSync(join(root, PASSING_SUPPORT_CELL, "pin.json"))) stageSlot(root, PASSING_SUPPORT_CELL, 1, ["Decider: Studio owners.", "Process: One call."]);
    evidence = `${PASSING_SUPPORT_CELL}@1`;
  }
  const refs = [evidence, ...(options.refs ?? [])];
  return stageSlot(root, id, version, direction, {
    ...options, refs, because: [`Five interviews (${refs.join(", ")})`], watch: options.watch ?? ["If trial count > 10 each month, then review this choice."],
  });
}

export function stageWontClaimCells(root: string): void {
  stageSlot(root, "advantage.proposition.proof", 1, 'Never-claim: "guaranteed results"');
  stageSlot(root, "identity.verbal.voice", 1, "Never: “risk-free”");
}
