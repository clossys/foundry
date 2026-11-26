/**
 * `clossys verdict`: records the P1 decider's verdict on one slot (slot-constitution.md section 5,
 * P1.3 and P1.4), run with the Producer's `actions/verdict/skill.md`.
 *
 *   clossys verdict <agent>/<slot> --record <verdict.json> --model <id> --tier low|mid|high --by agent:<seat> [--at <iso>] [--root <dir>] [--json]
 *
 * The record validates against pipeline/schemas/verdict.schema.json and names this slot. Every cited
 * id exists: a pick's `criteria` are taste criteria of the slot's standard (taste.md `## <id>`); a
 * create's `gaps` are taste criteria, requirement checks of the standard, or `brief:<key>` for a
 * top-level key of the slot contract. A slot with no standard is refused (nothing to judge by). A
 * create with zero gaps is refused by the schema; under an `adopt-first` standard every gap names a
 * `class` and at least one class is in the standard's `createGaps` (R03.5). A pick names an existing
 * candidate and is refused on a slot that holds an owner pin. A Producer seat slot
 * (`producer/seat.<step>`) takes a create verdict only: `clossys seat` writes and pins a seat.
 *
 * The verdict event lands in the slot ledger with the latest `options` event's inputsHash, so
 * `clossys next --stage` and `--submit` (P2) read it; a pick is pinned in the same slot lock with
 * basis agent. The verdict guard, then the pick guard, run on what the write leaves; any finding
 * undoes the write (records/slot-write.ts writeVerdict).
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DEFAULT_CREATE_GAPS } from "../constitution/rules/r03.js";
import "../constitution/guard.js"; // registers the write guard's runner
import { loadSchema, validateValue, type JsonSchema, type SchemaIssue } from "../pipeline/schema.js";
import { TIERS } from "../records/ledger.js";
import { pinStatus, SEAT_AGENT, SLOT_AGENTS, SLOT_ID, seatStepOf, type ModelAgent } from "../records/slot-model/index.js";
import { readSlot, readSlotEntry } from "../records/slots.js";
import { readStandard } from "../records/standards.js";
import { writeVerdict, type VerdictInput, type WriteGuard } from "../records/slot-write.js";
import { CliUsageError } from "./args.js";
import type { CliResult } from "./main.js";
import { resolveCandidate } from "./pin.js";
import { discoverRoot } from "./root.js";

/**
 * One complete, valid verdict file per rung, as `clossys verdict --help` prints them (verdict.test.ts proves each
 * validates against verdict.schema.json and holds for the fixture components.button slot's contract keys and its
 * component standard). Adopt needs no verdict; a pick is P1 on a held candidate; adapt and create
 * (P2) both need a create verdict before `clossys next --submit --rung adapt|create`.
 */
export const VERDICT_EXAMPLES = {
  pick: { schema: "clossys.verdict/1", slot: "components.button", pick: "button-v1.json", reason: "button-v1 meets every taste criterion of the standard.", criteria: ["fidelity", "polish"] },
  adapt: { schema: "clossys.verdict/1", slot: "components.button", create: true, reason: "No held candidate has the loading state; adapt the stock button seed to add it.", gaps: [{ id: "fidelity", class: "missing-behavior" }] },
  create: { schema: "clossys.verdict/1", slot: "components.button", create: true, reason: "No seed can be adapted: the contract's members are missing and the stock item fails keyboard focus.", gaps: [{ id: "brief:members", class: "missing-behavior" }, { id: "polish", class: "a11y-failure" }] },
} as const;

export const VERDICT_USAGE = "Usage: clossys verdict <agent>/<slot> --record <verdict.json> --model <id> --tier low|mid|high --by agent:<seat> [--at <iso>] [--root <dir>] [--json]\n"
  + "  Records the P1 verdict: {pick, reason, criteria} pins the picked candidate (basis agent); {create: true, reason, gaps}\n"
  + "  routes the slot to P2 (clossys next --stage). Ids must exist in the slot's standard or brief (brief:<key>); a create\n"
  + "  under an adopt-first standard names a gap whose class is in createGaps (R03.5). The verdict guard runs on the write.\n"
  + "  Every file has schema \"clossys.verdict/1\" and the slot id; add \"inputsHash\" when the latest clossys options packet names one.\n"
  + "  One complete example file per rung (here for designer/components.button):\n"
  + "  rung adopt (a stock seed, submitted with clossys next --submit --rung adopt --seed <id>): no verdict is needed.\n"
  + `  pick (P1, a held candidate fits): ${JSON.stringify(VERDICT_EXAMPLES.pick)}\n`
  + `  rung adapt (P2, then clossys next --submit --rung adapt --seed <id>): ${JSON.stringify(VERDICT_EXAMPLES.adapt)}\n`
  + `  rung create (P2, then clossys next --submit --rung create --reason <text>): ${JSON.stringify(VERDICT_EXAMPLES.create)}`;

const VALUED = ["--record", "--model", "--tier", "--by", "--at", "--root"] as const;
interface Flags { positional: string[]; values: Map<string, string>; help: boolean; json: boolean }
function parse(argv: readonly string[]): Flags {
  const flags: Flags = { positional: [], values: new Map(), help: false, json: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--help" || arg === "-h") flags.help = true;
    else if (arg === "--json") flags.json = true;
    else if ((VALUED as readonly string[]).includes(arg)) {
      const value = argv[++index];
      if (value === undefined || value.startsWith("--")) throw new CliUsageError(`${arg} needs a value\n${VERDICT_USAGE}`);
      if (flags.values.has(arg)) throw new CliUsageError(`${arg} is given once\n${VERDICT_USAGE}`);
      flags.values.set(arg, value);
    } else if (arg.startsWith("--")) throw new CliUsageError(`Unknown option: ${arg}\n${VERDICT_USAGE}`);
    else flags.positional.push(arg);
  }
  return flags;
}

const refused = (message: string): CliResult => ({ exitCode: 1, message: `verdict refused: ${message}` });
type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => value !== null && typeof value === "object" && !Array.isArray(value);

/** A schema field path (`/gaps/0/id`) as the field a person edits (`gaps[0].id`); the root is "the record". */
const fieldOf = (path: string): string => path === "/" || path === "" ? "the record"
  : path.slice(1).split("/").map((part, index) => /^\d+$/.test(part) ? `[${part}]` : `${index ? "." : ""}${part}`).join("");

/** What a schema node allows, in words: a const, an enum, a pattern, a list, a type. */
function allows(node: JsonSchema | undefined, defs: Record<string, JsonSchema> | undefined): string {
  if (!node) return "nothing (not a verdict field)";
  if (node.$ref?.startsWith("#/$defs/")) return allows(defs?.[node.$ref.slice(8)], defs);
  if (Object.hasOwn(node, "const")) return JSON.stringify(node.const);
  if (node.enum) return `one of ${node.enum.map(value => JSON.stringify(value)).join(", ")}`;
  if (node.type === "array") return `a list of at least ${node.minItems ?? 0} item(s), each ${allows(node.items, defs)}`;
  if (node.type === "object") return `an object with ${Object.keys(node.properties ?? {}).join(", ")}${node.required?.length ? ` (required ${node.required.join(", ")})` : ""}`;
  if (node.pattern !== undefined) return `a string matching ${node.pattern}`;
  if (node.type === "string") return node.minLength ? "a non-empty string" : "a string";
  return String(node.type ?? "any value");
}

/**
 * Why `record` is not a verdict, naming the failing field and what it allows (the refusal stays the schema's own:
 * this only explains it). The record is judged against the one shape it intends: a create when it has `create`, a
 * pick when it has `pick`, never the bare "/ must match exactly one of oneOf".
 */
export function verdictSchemaIssues(record: unknown, schema: JsonSchema = loadSchema("verdict")): string[] {
  const raw = validateValue(record, schema);
  if (!raw.length) return [];
  const shapes = schema.oneOf ?? [];
  const pick = shapes.find(shape => shape.properties?.pick), create = shapes.find(shape => shape.properties?.create);
  const both = `a pick ${JSON.stringify(VERDICT_EXAMPLES.pick)} or a create ${JSON.stringify(VERDICT_EXAMPLES.create)} (clossys verdict --help)`;
  if (!isObject(record)) return [`the record must be a JSON object: ${both}`];
  const shape = Object.hasOwn(record, "create") ? create : Object.hasOwn(record, "pick") ? pick : undefined;
  if (!shape) return [`the record names neither pick nor create; a verdict is ${both}`];
  const kind = shape === create ? "create" : "pick";
  const nodeAt = (path: string): JsonSchema | undefined => {
    let node: JsonSchema | undefined = shape;
    for (const part of path.split("/").filter(Boolean)) {
      if (node?.$ref?.startsWith("#/$defs/")) node = schema.$defs?.[node.$ref.slice(8)];
      node = /^\d+$/.test(part) ? node?.items : node?.properties?.[part];
    }
    return node;
  };
  const explain = (issue: SchemaIssue): string => {
    const required = /^requires (.+)$/.exec(issue.message);
    if (required) return `${fieldOf(issue.path) === "the record" ? "" : `${fieldOf(issue.path)}: `}the ${kind} verdict requires field ${required[1]} (allowed: ${allows(nodeAt(`${issue.path}/${required[1]}`), schema.$defs)})`;
    const unknown = /^has unknown key (.+)$/.exec(issue.message);
    if (unknown) return `field ${fieldOf(`${issue.path === "/" ? "" : issue.path}/${unknown[1]}`)} is not a ${kind} verdict field (allowed fields: ${Object.keys(nodeAt(issue.path)?.properties ?? {}).join(", ")})`;
    return `field ${fieldOf(issue.path)} ${issue.message} (allowed: ${allows(nodeAt(issue.path), schema.$defs)})`;
  };
  const issues = validateValue(record, { ...shape, $defs: { ...schema.$defs, ...shape.$defs } });
  return issues.length ? issues.map(explain) : raw.map(issue => `${fieldOf(issue.path)} ${issue.message}`);
}

/** Why a schema-valid verdict does not hold for the slot, given its standard's ids and brief keys. */
export function verdictIssues(record: Json, ids: { readonly taste: ReadonlySet<string>; readonly requirements: ReadonlySet<string>; readonly brief: ReadonlySet<string> }, standard: { readonly id: string; readonly mode?: string; readonly createGaps?: readonly string[] }): string[] {
  const issues: string[] = [];
  if (record.create === true) {
    const gaps = record.gaps as { id: string; class?: string }[];
    for (const gap of gaps) {
      const known = gap.id.startsWith("brief:") ? ids.brief.has(gap.id.slice("brief:".length)) : ids.taste.has(gap.id) || ids.requirements.has(gap.id);
      if (!known) issues.push(`gap ${gap.id} is not a taste criterion or requirement of standard ${standard.id}, nor brief:<key> of the slot contract`);
    }
    if (standard.mode === "adopt-first") {
      const allowed = standard.createGaps?.length ? standard.createGaps : DEFAULT_CREATE_GAPS;
      const unclassed = gaps.filter(gap => gap.class === undefined).map(gap => gap.id);
      if (unclassed.length) issues.push(`${standard.id} is adopt-first: every gap names a class (${unclassed.join(", ")} name none)`);
      if (!gaps.some(gap => gap.class !== undefined && allowed.includes(gap.class))) issues.push(`${standard.id} is adopt-first: a create needs a gap of class ${allowed.join(", ")} (R03.5)`);
    }
  } else {
    for (const id of record.criteria as string[]) if (!ids.taste.has(id)) issues.push(`criterion ${id} is not a taste criterion of standard ${standard.id} (taste.md)`);
    if (new Set(record.criteria as string[]).size !== (record.criteria as string[]).length) issues.push("criteria repeat an id");
  }
  return issues;
}

export async function runVerdictCli(argv: readonly string[], cwd: string, guard: WriteGuard = true): Promise<CliResult> {
  const flags = parse(argv);
  if (flags.help) return { exitCode: 0, message: VERDICT_USAGE };
  const [given, ...extra] = flags.positional;
  if (!given || extra.length) throw new CliUsageError(`verdict takes one <agent>/<slot>\n${VERDICT_USAGE}`);
  const slash = given.indexOf("/");
  const agent = given.slice(0, slash) as ModelAgent, slot = given.slice(slash + 1);
  const seat = agent === SEAT_AGENT && seatStepOf(slot) !== undefined;
  if (slash < 1 || !(seat || (SLOT_AGENTS as readonly string[]).includes(agent)) || !SLOT_ID.test(slot)) throw new CliUsageError(`verdict target must be <agent>/<slot> or producer/seat.<step>, got ${given}\n${VERDICT_USAGE}`);
  const file = flags.values.get("--record");
  if (!file) throw new CliUsageError(`verdict needs --record <verdict.json>\n${VERDICT_USAGE}`);
  const model = flags.values.get("--model"), tier = flags.values.get("--tier");
  if (!model || !tier) throw new CliUsageError(`verdict runs an LLM: --model and --tier are required\n${VERDICT_USAGE}`);
  if (!(TIERS as readonly string[]).includes(tier)) throw new CliUsageError(`--tier must be ${TIERS.join(", ")}, got ${tier}\n${VERDICT_USAGE}`);
  const by = flags.values.get("--by");
  if (!by || !/^agent:\S+$/.test(by)) throw new CliUsageError(`verdict requires --by agent:<seat>; owners pin with clossys pin\n${VERDICT_USAGE}`);
  const at = flags.values.get("--at") ?? new Date().toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T/.test(at) || Number.isNaN(Date.parse(at))) throw new CliUsageError(`--at must be an ISO timestamp\n${VERDICT_USAGE}`);

  const root = discoverRoot(resolve(cwd, flags.values.get("--root") ?? ".")), consumer = join(root, "clossys");
  const entry = readSlotEntry(consumer, agent, slot);
  if (!entry) return refused(`unknown slot ${agent}/${slot} (not in ${agent} ia.json)`);
  let record: unknown;
  try { record = JSON.parse(readFileSync(resolve(cwd, file), "utf8")); } catch { return refused(`cannot read ${file} as JSON`); }
  const schemaIssues = verdictSchemaIssues(record);
  if (schemaIssues.length) return refused(`${file} is not a verdict (verdict.schema.json): ${schemaIssues.slice(0, 5).join("; ")}`);
  const doc = record as Json;
  if (doc.slot !== slot) return refused(`the record names slot ${String(doc.slot)}, not ${slot}`);

  const slotDoc = readSlot(consumer, agent, slot);
  if (typeof slotDoc.standard !== "string") return refused(`${agent}/${slot} names no standard: a verdict is judged against the slot's standard`);
  const standard = readStandard(root, agent, slotDoc.standard);
  if (!standard.doc || !standard.taste) return refused(`standard ${slotDoc.standard} does not read (${standard.issues.slice(0, 3).join("; ") || "no requirements.json or taste.md"})`);
  const ids = {
    taste: new Set(standard.taste.criteria.map(criterion => criterion.id)),
    requirements: new Set((standard.doc.requirements ?? []).map(requirement => (requirement as { check: string }).check)),
    brief: new Set(isObject(slotDoc.contract) ? Object.keys(slotDoc.contract) : []),
  };
  const issues = verdictIssues(doc, ids, { id: standard.id, ...(standard.doc.mode ? { mode: standard.doc.mode } : {}), ...(standard.doc.createGaps ? { createGaps: standard.doc.createGaps } : {}) });
  if (issues.length) return refused(issues.join("; "));

  let verdict: VerdictInput;
  if (doc.create === true) verdict = { verdict: "create", reason: doc.reason as string, gaps: doc.gaps as { id: string; class?: string }[] };
  else if (seat) return refused(`${agent}/${slot} is a Producer seat: a seat is pinned by clossys seat ${seatStepOf(slot)}, so its verdict is create (P2) or none`);
  else {
    const pick = resolveCandidate(entry.candidates, doc.pick as string);
    if (!pick) return refused(`${agent}/${slot} has no candidate ${String(doc.pick)}`);
    if (entry.pin && pinStatus(entry.pin.basis) === "pinned") return refused(`${agent}/${slot} holds an owner pick (${entry.pin.candidate} by ${entry.pin.decidedBy}); only the owner changes it with clossys pin`);
    verdict = { verdict: "pick", pick, reason: doc.reason as string, criteria: doc.criteria as string[] };
  }
  try {
    const written = writeVerdict(consumer, agent, slot, verdict, { by, at, ...(typeof doc.inputsHash === "string" ? { inputsHash: doc.inputsHash } : {}) }, { model, tier }, { guard });
    const outcome = written.pin ? `picked ${written.pin.candidate} (${written.pin.sha256.slice(0, 12)}), pinned basis agent` : `create (${(doc.gaps as unknown[]).length} gap(s)): P2 next (clossys next --stage brief)`;
    return {
      exitCode: 0, root,
      output: { schema: "clossys.verdict-recorded/1", slot: `${agent}/${slot}`, event: written.event, ...(written.pin ? { pin: written.pin } : {}) },
      message: `verdict: ${agent}/${slot} ${outcome} by ${model} (${tier})`,
      ...(written.pin ? { decision: { slot: `${agent}/${slot}`, state: "pinned", ...written.pin } } : {}),
    };
  } catch (error) { return refused((error instanceof Error ? error.message : String(error)).replace(/^verdict refused: /, "")); }
}
