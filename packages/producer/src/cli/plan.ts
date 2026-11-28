/**
 * `clossys plan` (CP1-PLAN): the Publisher plans the content map from the Director's pinned next release. It reads the
 * pinned `director/execution.roadmap.release` brief through the criterion that certified it (brief.release-scope, with
 * the params the slot contract states), and proposes one `clossys ia publisher/...` placement per page a Scope row
 * asks for, drawn only from the menu: the seatable starters (`SEATABLE_STARTERS`) and their page archetypes
 * (`starterPlan`). Every proposed page and publication slot reads the release (`--inputs execution.roadmap.release`).
 * A row the menu cannot serve (a kind with no seatable starter, a page its starter has no archetype for, a held status
 * page) is reported, never invented; a publication no row names gets no placement.
 *
 * The proposal is ONE owner request (a kind change entry on the release, raised from the owner by producer): its detail
 * carries each command and, for a slot not yet placed, the contract to write to the file the command names. Nothing
 * else is written: the owner approves, and the Publisher applies the commands with the existing `ia` verb.
 */
import { join, resolve } from "node:path";
import { parseReleaseScope, releaseScopeParams, type ReleaseScope } from "../constitution/criteria/director/st-d/release.js";
import { candidateDocument, readPinned } from "../records/pinned.js";
import { producerVersion } from "../loop/route.js";
import { appendRaise, currentProposed, raiseWork, RequestError, type ProposedSteps, type SlotRequest } from "../records/request.js";
import { iaPath } from "../records/slot-model/layout.js";
import { listSlots, modelExists, readSlot } from "../records/slots.js";
import { SLOT_AGENTS } from "../records/slot-model/types.js";
import { CliUsageError } from "./args.js";
import type { CliResult } from "./main.js";
import { discoverRoot } from "./root.js";
import { SEATABLE_STARTERS, StarterPlanError, starterContract, starterPlan, starterUnder, type StarterPlan } from "./starter-plan.js";

export const RELEASE_SLOT = "execution.roadmap.release";
export const RELEASE_REF = `director/${RELEASE_SLOT}`;
const CRITERION = "brief.release-scope";

export const PLAN_USAGE = "Usage: clossys plan [--dry] [--at <iso>] [--root <dir>]\n"
  + "  Reads the pinned Director release (director/execution.roadmap.release: its Stage, its Scope rows\n"
  + "  <kind> (<page>, <page>): <use case>, its Not in scope) and proposes the Publisher content map: one\n"
  + "  clossys ia publisher/<slot> line per page a row asks for and one for its publication, each reading the\n"
  + "  release (--inputs execution.roadmap.release). Placements come only from the starters init seats\n"
  + `  (${SEATABLE_STARTERS.join(", ")}) and their page archetypes; a row they cannot serve is reported, never invented, and a\n`
  + "  kind no row names gets nothing.\n"
  + "  The proposal is filed as one owner request on the release (clossys request --list shows it), its ia lines and\n"
  + "  contracts as data; nothing else is written. The owner's approve answer re-runs clossys plan --dry, refuses if the\n"
  + "  plan changed, then runs the lines in order. --dry prints the proposal and files nothing. A re-plan while that request is open\n"
  + "  refreshes its proposal (one more raised event, the latest is current) and says filed, updated or unchanged.\n"
  + "  Loop order: Director release, then clossys plan, then the owner approves, then clossys ia.\n"
  + "  Refuses (exit 1) when the release is not pinned, its pin does not clear, or its slot contract states no\n"
  + `  ${CRITERION} requirement: the plan never falls back to a guess.`;

const VALUED = new Set(["--at", "--root"]);
const BARE = new Set(["--dry"]);

/** One proposed `clossys ia` line: a new placement (with its contract) or an input ref added to a placed slot. */
export interface PlanPlacement {
  readonly slot: string;
  readonly kind: "page" | "publication";
  readonly row: string;
  readonly placed: boolean;
  readonly inputs: readonly string[];
  readonly uses: readonly string[];
  readonly command: string;
  /** The line as the step the owner's approve runs (argv, no --contract: the contract rides as data). */
  readonly args: readonly string[];
  readonly contract?: Readonly<Record<string, unknown>>;
}
/** A Scope row, or a page of one, the menu cannot serve. */
export interface PlanUnserved { readonly row: string; readonly page?: string; readonly reason: string }
export interface ContentPlan {
  readonly release: string;
  readonly stage: string;
  readonly rows: ReleaseScope["rows"];
  readonly notInScope: readonly string[];
  readonly placements: readonly PlanPlacement[];
  readonly unserved: readonly PlanUnserved[];
}

export class PlanError extends Error {}

const bare = (ref: string) => ref.replace(/^[a-z]+[:/]/, "").replace(/@\d+$/, "");
const contractFile = (slot: string) => `<dir>/${slot}.json`;

/** The content map the pinned release asks for (pure over the workspace; throws PlanError when the release is absent). */
export function contentPlan(root: string): ContentPlan {
  const consumer = join(root, "clossys");
  const pinned = readPinned(consumer, "director");
  const issue = pinned.issues.find(item => item.slot === RELEASE_SLOT);
  if (issue) throw new PlanError(`${RELEASE_REF} does not clear (${issue.message}); fix its pin first`);
  const release = pinned.pinned.find(item => item.id === RELEASE_SLOT);
  if (!release) throw new PlanError(`${RELEASE_REF} is not pinned: the Director pins the next release (Stage, Scope rows, Not in scope) before the Publisher plans from it`);
  const requirements = Array.isArray(release.doc.contract.requirements) ? release.doc.contract.requirements as unknown[] : [];
  const entry = requirements.find((item): item is { check: string; params?: unknown } => typeof item === "object" && item !== null && (item as { check?: unknown }).check === CRITERION);
  const params = entry && typeof entry.params === "object" && entry.params !== null ? releaseScopeParams(entry.params as Record<string, unknown>) : `its slot contract states no ${CRITERION} requirement with params`;
  if (typeof params === "string") throw new PlanError(`${RELEASE_REF}: ${params}; refresh it from the Director package (clossys ia sync --agent director) and re-pin`);
  const scope = parseReleaseScope(candidateDocument(release).body, params);
  if (scope.issues.length || scope.stage === undefined) throw new PlanError(`${RELEASE_REF} (${release.name}) does not state a plannable scope: ${scope.issues.join("; ")}`);
  if (!modelExists(iaPath(consumer, "publisher"))) throw new PlanError("publisher has no ia.json: clossys init starts the Publisher IA; run it before planning");

  const known = new Map<string, string>();
  for (const agent of SLOT_AGENTS) for (const slot of listSlots(consumer, agent)) known.set(slot.id, agent);
  const publisher = new Map(listSlots(consumer, "publisher").map(slot => [slot.id, slot]));
  const placements: PlanPlacement[] = [], unserved: PlanUnserved[] = [];
  const propose = (plan: StarterPlan, row: string, slot: string, kind: "page" | "publication", refs: readonly string[]) => {
    const placed = publisher.has(slot);
    if (placed) {
      const doc = readSlot(consumer, "publisher", slot);
      const inputs = doc.inputs.map(bare);
      if (inputs.includes(RELEASE_SLOT)) return;
      const next = [...inputs, RELEASE_SLOT], uses = doc.uses.map(bare);
      const args = ["ia", `publisher/${slot}`, "--standard", doc.standard ?? kind, "--inputs", next.join(","), ...(uses.length ? ["--uses", uses.join(",")] : [])];
      placements.push({ slot, kind, row, placed, inputs: next, uses, args, command: `clossys ${args.join(" ")}` });
      return;
    }
    const inputs = [RELEASE_SLOT, ...refs];
    const args = ["ia", `publisher/${slot}`, "--standard", kind, "--under", starterUnder(plan, slot), "--kind", kind, "--inputs", inputs.join(","), ...(refs.length ? ["--uses", refs.join(",")] : [])];
    placements.push({ slot, kind, row, placed, inputs, uses: refs, args, contract: starterContract(plan, slot), command: `clossys ${args.slice(0, 2).join(" ")} --contract ${contractFile(slot)} ${args.slice(2).join(" ")}` });
  };
  for (const row of scope.rows) {
    if (!SEATABLE_STARTERS.includes(row.kind)) { unserved.push({ row: row.text, reason: `no seatable ${row.kind} starter: the menu seats ${SEATABLE_STARTERS.join(", ")}` }); continue; }
    let plan: StarterPlan;
    try { plan = starterPlan(root, row.kind); } catch (error) {
      if (error instanceof StarterPlanError) { unserved.push({ row: row.text, reason: `the ${row.kind} starter cannot be read (${error.message})` }); continue; }
      throw error;
    }
    const served: string[] = [];
    for (const name of row.pages) {
      const id = `page.${name}`;
      const held = plan.held.find(item => item.id === id);
      if (held) { unserved.push({ row: row.text, page: name, reason: `held: ${held.reason}` }); continue; }
      const page = plan.pages.find(item => item.id === id);
      if (!page) { unserved.push({ row: row.text, page: name, reason: `the ${row.kind} starter has no ${id} archetype (it has ${plan.pages.map(item => item.id.replace(/^page\./, "")).join(", ")})` }); continue; }
      propose(plan, row.text, id, "page", page.cites.filter(ref => known.has(ref)));
      served.push(id);
    }
    if (!served.length) continue;
    // The publication lists only the pages this release asks for (its routes check holds it to them).
    const publication = { ...plan, pages: plan.pages.filter(page => served.includes(page.id)) };
    propose(publication, row.text, plan.publication, "publication", served);
  }
  return { release: release.name, stage: scope.stage, rows: scope.rows, notInScope: scope.notInScope, placements, unserved };
}

/** The proposal as the request's detail: the rows, every ia line with its contract, and every unserved row. */
/** The plan as the steps its owner request proposes: each ia line, with its contract as data. */
export const planSteps = (plan: ContentPlan): ProposedSteps | undefined =>
  plan.placements.length ? { steps: plan.placements.map(item => ({ args: [...item.args], ...(item.contract ? { contract: item.contract } : {}) })) } : undefined;

export function planDetail(plan: ContentPlan): string {
  const lines = [
    `Content plan from ${RELEASE_REF} (${plan.release}), stage ${plan.stage}: ${plan.rows.length} row${plan.rows.length === 1 ? "" : "s"}, ${plan.placements.length} ia line${plan.placements.length === 1 ? "" : "s"}, ${plan.unserved.length} unserved.`,
    "Approving runs each line in order (clossys request <id> --answer approve); a <dir>/<slot>.json is the contract shown under its line, written for you.",
    ...plan.placements.flatMap(item => [`- ${item.command}`, ...(item.contract ? [`  contract ${item.slot}: ${JSON.stringify(item.contract)}`] : [])]),
    ...plan.unserved.map(item => `- unserved: ${item.page ? `page ${item.page} of ` : ""}"${item.row}": ${item.reason}`),
    `Not in scope: ${plan.notInScope.join(", ")}.`,
  ];
  return lines.join("\n");
}

interface Flags { values: Map<string, string>; bare: Set<string> }
function parse(argv: readonly string[]): Flags | "help" {
  const flags: Flags = { values: new Map(), bare: new Set() };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--help") return "help";
    if (VALUED.has(arg)) {
      const value = argv[++index];
      if (value === undefined || value.startsWith("--")) throw new CliUsageError(`${arg} requires a value\n${PLAN_USAGE}`);
      flags.values.set(arg, value);
    } else if (BARE.has(arg)) flags.bare.add(arg);
    else throw new CliUsageError(`Unknown ${arg.startsWith("--") ? "option" : "argument"} ${arg}\n${PLAN_USAGE}`);
  }
  return flags;
}

export async function runPlanCli(argv: readonly string[], cwd: string): Promise<CliResult> {
  const flags = parse(argv);
  if (flags === "help") return { exitCode: 0, message: PLAN_USAGE };
  const at = flags.values.get("--at") ?? new Date().toISOString().replace(/\.\d+Z$/, "Z");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(at)) throw new CliUsageError(`--at must be an ISO timestamp with seconds, ending in Z\n${PLAN_USAGE}`);
  const root = discoverRoot(resolve(cwd, flags.values.get("--root") ?? "."));
  let plan: ContentPlan;
  try { plan = contentPlan(root); } catch (error) {
    if (error instanceof PlanError) return { exitCode: 1, root, output: { error: "PlanError" }, message: `plan refused: ${error.message}` };
    throw error;
  }
  const detail = planDetail(plan), proposed = planSteps(plan);
  const placed = plan.placements.length;
  const why = `Approve the content map the ${plan.stage} release asks for: ${placed} Publisher ia line${placed === 1 ? "" : "s"}${plan.unserved.length ? `, ${plan.unserved.length} row or page the menu cannot serve` : ""}.`;
  const dry = flags.bare.has("--dry");
  const consumer = join(root, "clossys");
  let request: SlotRequest;
  let outcome: PlanOutcome;
  try {
    const raised = raiseWork(consumer, {
      kind: "change", target: RELEASE_REF, from: "owner", want: "contract", why, detail, source: "cli", by: "producer", at,
      createdBy: { actor: "code", cli: PLAN_CLI, version: producerVersion() }, ...(proposed ? { proposed } : {}),
    }, { dry });
    request = raised.request;
    if (raised.created) outcome = "filed";
    else if (request.createdBy?.actor !== "code" || request.createdBy.cli !== PLAN_CLI) {
      // The open owner change on the release slot is someone else's: the plan is never merged into it.
      return { exitCode: 1, root, output: { error: "RequestError", request: request.id }, message: `plan refused: ${request.id} is an open owner change on ${RELEASE_REF} that clossys plan did not file; answer or close it, then plan again` };
    } else if (currentProposal(request) === detail && JSON.stringify(currentProposed(request)) === JSON.stringify(proposed)) outcome = "unchanged";
    else {
      // A re-plan (the release was re-pinned, or the IA moved): the fresh proposal is one more raised event on the open
      // entry, through the record writer, and it replaces every earlier one (proposalOf reads the latest).
      ({ request } = appendRaise(consumer, request.id, { at, by: "producer", detail: `${REPLANNED(at)}\n${detail}`, ...(proposed ? { proposed } : {}) }, { dry }));
      outcome = "updated";
    }
  } catch (error) {
    if (error instanceof RequestError) return { exitCode: 1, root, output: { error: "RequestError" }, message: `plan refused: ${error.message}` };
    throw error;
  }
  const said = dry ? { filed: "would file", updated: "would update", unchanged: "unchanged" }[outcome] : outcome;
  return {
    exitCode: 0, root, output: { plan, request: dry && outcome === "filed" ? undefined : request.id, outcome, ...(proposed ? { proposed } : {}) },
    message: [`plan: ${said} ${request.id} for the owner (${outcome === "unchanged" ? "its proposal is already this plan" : why})`, detail].join("\n"),
  };
}

/** What a plan run did to the owner's request: filed it, refreshed its proposal on the open entry, or found it current. */
export type PlanOutcome = "filed" | "updated" | "unchanged";
const PLAN_CLI = "clossys plan";
const REPLANNED = (at: string) => `Re-planned at ${at}: this proposal replaces every earlier one on this request.`;
/** The proposal a plan request holds now: its latest raised event's detail, without the re-plan line. */
export function currentProposal(request: Pick<SlotRequest, "events">): string | undefined {
  const raised = request.events.filter(event => event.op === "raised").at(-1)?.detail;
  return raised?.replace(/^Re-planned at \S+: this proposal replaces every earlier one on this request\.\n/, "");
}
