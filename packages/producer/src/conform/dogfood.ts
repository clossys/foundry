/**
 * Dogfood conformance assertions (foundry-build-0048 U1, planner input 2026-11-17): every RAN-FAILED,
 * RAN-WEAK or CANNOT-RUN row of the four agents' dogfood runs becomes one assertion, named after its row
 * (`DF.<agent>.<LOOP>`), judged by probes of the repo. Each probe reproduces the row's failure as a fact
 * the repo either still has (red) or no longer has. The empty-L2 probe runs the real constitution over a
 * temporary copy of the consumer with one empty L2 group added per agent, and the contract probe runs the
 * real `clossys ia --contract --dry` on a temporary copy, and the pin probe runs every pin-writing verb (pin,
 * pick, verdict, and the Writer's owner pin) on a temporary copy with a hand-placed and a submitted, uncertified candidate; the rest
 * read files.
 */
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, posix } from "node:path";
import { standardTastePath } from "../cli/critique.js";
import { SCORECARD_REF_TO, SCORECARD_SCHEMA } from "../constitution/pin-gate.js";
import { CRITIQUES_DIR, critiqueFileName, critiqueRecordIssues } from "../records/critique-record.js";
import { candidateLineage, globMatch } from "../constitution/certify/source.js";
import { runConstitution } from "../constitution/run.js";
import { resolveAgent } from "../agents.js";
import { slotFamily } from "../records/slot-current.js";
import { readCandidate } from "../records/slots.js";
import { designerComposedSlots } from "../specimen/composed-slots.js";
import { CODE, exportedNames, referenceIndex, slotReferenceShips, type ReferenceIndex } from "../specimen/reference-fixtures.js";
import { draftCopyIssues, hasDefaultExport, type CopyField } from "../specimen/block-fixtures.js";
import { ASSERTIONS, KIND_FAMILY, type Judgement } from "./assertions.js";
import type { AgentModel, ConformModel, LiveSlot } from "./model.js";
import { probeRecipePages, type RecipePageFacts } from "./recipe-page.js";

export const EMPTY_L2 = "conform-probe-empty";

/** What the expensive probes found, computed once per run (or given by a test). */
export interface ProbeFacts {
  /** Per agent: did the strict constitution report an injected empty L2 group? */
  readonly emptyL2Detected: Readonly<Record<string, boolean | string>>;
  /** A request verb (head or step) exists. */
  readonly requestVerb: boolean;
  /** Per `<agent>:<recipe dir>`: the Publisher page check over each recipe's clossys.page/1 fixture (recipe-page.ts). */
  readonly recipePages?: RecipePageFacts;
  /** critique-packet cannot resolve a standard's taste.md from a consumer root (no packages/ folder). */
  readonly critiqueMonorepoPath: boolean;
  /** Per agent: what `clossys ia --contract` did with an invalid contract per held kind family, or why it could not run. */
  readonly iaContract?: Readonly<Record<string, readonly IaContractResult[] | string>>;
  /** Per agent: what `clossys pin` did with a hand-placed candidate (no submit record), or why it could not run. */
  readonly pinGate?: Readonly<Record<string, PinGateResult | string>>;
  /** Whether an adopted Designer reference ships a file with an export (default: the installed Designer package's references). */
  readonly referenceShips?: (slot: string, file: string, name: string) => boolean;
  /** The provenance rule's consumerAssets slot globs (default: the installed Designer package's src/catalog/rules/provenance.json). */
  readonly consumerAssets?: readonly string[];
  /** The raw bytes of a slot's pinned candidate file (default: the one slot-model reader, records/slots.ts readCandidate); throws when absent or unreadable. */
  readonly candidateText?: (slot: string, name: string) => string;
  /** FCR: the composed section and frame slots (default: the installed Designer package's derived gaps document). */
  readonly composedSlots?: ReadonlySet<string> | string;
  /** The bytes of a file under the consumer folder, by its consumer-relative path (default: read from disk); throws when absent. */
  readonly consumerText?: (path: string) => string;
}

export interface PinGateResult { readonly target: string; readonly candidate: string; readonly accepted: boolean; readonly message: string; readonly verbs?: readonly VerbProbe[] }

/** One pin-writing verb run by the pin probe on one candidate (hand-placed, or submitted and uncertified). */
export interface VerbProbe {
  readonly verb: "pin" | "pick" | "verdict" | "owner-pin";
  readonly case: "hand-placed" | "submitted-uncertified";
  readonly target: string;
  readonly candidate: string;
  readonly exit: number;
  /** Refused by the CHOOSE gate (GATE_REFUSAL), not for some other reason. */
  readonly gated: boolean;
  readonly message: string;
}

export interface IaContractResult { readonly target: string; readonly contract: string; readonly accepted: boolean; readonly message: string }

/** A contract no kind's contract may be: an unknown `kind` field and nothing else. */
export const INVALID_CONTRACT: Readonly<Record<string, unknown>> = { kind: "nonsense" };
const PROBE_SLOT = "conform.contract-probe";
const CONTRACT_PROBE_L2 = "conform-contract-probe";

/** Adds the contract probe's empty L2 group under `l1` in a copied ia.json. */
function addProbeGroup(file: string, l1: string): void {
  const ia = JSON.parse(readFileSync(file, "utf8")) as { nodes?: { id?: unknown; children?: unknown[] }[] };
  const node = (ia.nodes ?? []).find(each => each.id === l1);
  if (!node) return;
  (node.children ??= []).push({ id: CONTRACT_PROBE_L2, label: "Probe", slots: [] });
  writeFileSync(file, `${JSON.stringify(ia, null, 2)}\n`);
}

/**
 * Whether an `ia` refusal is about the contract's content: a validation issue `contract $<path> ...`.
 * The target id (which itself holds "contract") and every path are stripped first, so a refusal such as
 * "<target> is already placed" or an unreadable `--contract <file>` never counts as a contract refusal.
 */
export function isContractRefusal(message: string, target: string, paths: readonly string[] = []): boolean {
  let text = message.replace(/^ia refused:\s*/, "");
  for (const literal of [...paths, target, target.split("/").slice(1).join("/")].filter(Boolean).sort((a, b) => b.length - a.length)) text = text.split(literal).join("<id>");
  text = text.replace(/(^|\s)\/[^\s;]+/g, "$1<path>");
  return /(?:^|; )contract \$[^\s;]* /.test(text);
}

/**
 * Runs the real `clossys ia <agent>/<probe> --under <l1>/<l2> --kind <family> --contract <file> --dry` on a
 * temporary copy of the consumer, once per kind family the agent holds. Accepted means exit 0; refused means
 * exit 1 naming the contract. Any other outcome is reported as the probe failing, never as a refusal.
 */
export async function probeIaContract(consumer: string, agents: readonly AgentModel[], contract: Readonly<Record<string, unknown>> = INVALID_CONTRACT): Promise<Record<string, IaContractResult[] | string>> {
  // Load the CLI first, as every caller does: owner.ts sits in an import cycle with the pipeline handlers.
  await import("../cli/main.js");
  // The probe runs `ia` as its step, through the pipeline runner (its step events and record), never by its entry.
  const { runStep } = await import("../pipeline/runner.js");
  const temp = realpathSync(mkdtempSync(join(tmpdir(), "conform-contract-")));
  const out: Record<string, IaContractResult[] | string> = {};
  try {
    cpSync(consumer, join(temp, "clossys"), { recursive: true });
    const file = join(temp, "contract.json");
    writeFileSync(file, JSON.stringify(contract));
    for (const agent of agents) {
      const families = [...new Set((agent.adapter?.kinds ?? []).map(kind => KIND_FAMILY[kind]).filter((family): family is string => family !== undefined))];
      const results: IaContractResult[] = [];
      // The probe's leaf goes in an empty L2 group the copy adds under the first placed L1 (its kind decided as before):
      // with no siblings the placement's overlap gate lists nothing, so the verdict is the contract gate's alone.
      const l1 = agent.placedTree.find(node => node.l2.length);
      if (l1) addProbeGroup(join(temp, "clossys", "agents", agent.agent, "ia.json"), l1.id);
      for (const family of families) {
        const target = `${agent.agent}/${PROBE_SLOT}-${family}`;
        // Under the added group when the agent has a placed L1 (ia places under an existing group), else a new conform/probe group.
        const under = l1 ? `${l1.id}/${CONTRACT_PROBE_L2}` : "conform/probe";
        const result = await runStep(["ia", target, "--under", under, "--kind", family, "--contract", file, "--dry"], temp);
        const message = (result.message ?? "").split("\n")[0]!;
        // An "already placed" refusal is the probe hitting a live slot, never a contract verdict: a failure, whatever else it says.
        const placed = /\balready placed\b/.test(message);
        if (placed || (result.exitCode !== 0 && !(result.exitCode === 1 && isContractRefusal(message, target, [temp, file])))) { out[agent.agent] = `ia --contract probe failed for ${target}: exit ${result.exitCode}: ${message}`; break; }
        results.push({ target, contract: JSON.stringify(contract), accepted: result.exitCode === 0, message });
      }
      out[agent.agent] ??= results;
    }
  } catch (error) {
    const message = `ia --contract probe failed: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`;
    for (const agent of agents) out[agent.agent] ??= message;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  return out;
}

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The name of the hand-placed candidate the pin probe writes. */
export const PIN_PROBE_NAME = "conform-probe";

/** The CHOOSE gate's refusals: no submit record, no passing verdict, or a non-gate verb refused on a slot/2 slot. */
export const GATE_REFUSAL = /no submit record|no passing verdict|pinned only through the CHOOSE gate/;

/** A schema-valid candidate that certifies against no contract (no keys, no derived source): submitted, never passing. */
function uncertifiedBytes(slot: { readonly id: string; readonly kind?: string }, ext: string): unknown {
  // A Publisher page record for every slot the page record rules judge: the reader's kind family `page` (page, layout and
  // chrome; records/slot-current.ts slotFamily, the kind the candidate validator applies). Schema-valid, but no frame, no
  // sections and an inline title (page.assembled), so it reaches the CHOOSE gate and certifies against nothing.
  if (ext === "json" && slotFamily(slot.kind) === "page") return { schema: "clossys.page/1", path: `/${PIN_PROBE_NAME}`, title: "Conform probe page", frame: null, sections: [], copy: {}, meta: { source: { kind: "original", ref: [] } } };
  if (ext === "json") return { name: PIN_PROBE_NAME, type: "registry:file", files: [{ path: `${PIN_PROBE_NAME}.svg`, type: "registry:file", content: "<svg/>" }], meta: { source: { kind: "original", ref: [] } } };
  const head = `---\nslot: "${slot.id}"\n`;
  return slot.kind === "brief"
    ? `${head}source: {"kind":"original","ref":[]}\nfeeds: []\nfunctions: []\n---\n## Direction\n- Probe: probe\n\n## Because\n- probe\n\n## Watch\n- probe\n`
    : `${head}locales: ["en"]\nsource: {"kind":"original","ref":[]}\n---\n\n## en\n`;
}

/**
 * Runs every verb that writes a pin on a temporary copy of the consumer, once per agent, against its first live slot/2
 * slot (one with a candidate first): the real `clossys pin --by planner`, `clossys pick --by agent:<agent>`,
 * `clossys verdict --record` (a pick) and, for Writer, the owner's approval:
 * `clossys pin --basis picked --by owner:queue.approve#<id>`. Each runs on two candidates: one
 * placed by hand (a copy of the slot's newest candidate under a new name, so it has no submit record) and one submitted
 * through the candidates write that certifies against nothing (a submit record, no passing verdict). The first pin
 * result is the cell's headline; `verbs` holds every run. A run counts as gated only when it exits non-zero with the
 * CHOOSE gate's refusal (GATE_REFUSAL); exit 0 is an accepted pin, and any other refusal means the probe never reached
 * the pin write, which is a failed probe, not a pass.
 */
export async function probePinGate(consumer: string, agents: readonly AgentModel[]): Promise<Record<string, PinGateResult | string>> {
  await import("../cli/main.js");
  // Each probed verb runs as its step, through the pipeline runner (its step events and record), never by its entry.
  const { runStep } = await import("../pipeline/runner.js");
  const { readStandard } = await import("../records/standards.js");
  const { writeCandidate } = await import("../records/slot-write.js");
  const { isRecordSlot } = await import("../records/resolve.js");
  const temp = realpathSync(mkdtempSync(join(tmpdir(), "conform-pin-")));
  const out: Record<string, PinGateResult | string> = {};
  const AT = "2026-11-17T12:00:00Z";
  try {
    cpSync(consumer, join(temp, "clossys"), { recursive: true });
    // An owner approval names the typed queue entry the owner answered for that candidate (U13 r4, B2): the owner pin writes
    // one answered clossys.queue-entry/1 bound to the slot and candidate before each run, so it reaches the CHOOSE gate.
    const { ownerEntry } = await import("../pipeline/owner-entry.js");
    for (const agent of agents) {
      const slots = agent.live.filter(slot => slot.schema === "clossys.slot/2" && slot.kind !== "release")
        .map(slot => ({ slot, dir: join(temp, "clossys", "agents", agent.agent, slot.id, "candidates") }))
        .map(item => ({ ...item, names: existsSync(item.dir) ? readdirSync(item.dir).filter(name => /-v\d+\.(md|json|svg)$/.test(name)).sort() : [] }));
      let pick: { slot: { readonly id: string; readonly kind?: string; readonly standard?: string }; dir: string; names: string[] } | undefined = slots.find(item => item.names.length) ?? slots[0];
      if (!pick) {
        // No live slot/2 slot of its own (Publisher's are package slots): place one on the copy through the real
        // `clossys ia`, of the agent's first held kind with a standard, so the same verbs reach the CHOOSE gate.
        const placedSlot = await placePinProbeSlot(temp, agent);
        if (typeof placedSlot === "string") { out[agent.agent] = placedSlot; continue; }
        pick = { slot: placedSlot, dir: join(temp, "clossys", "agents", agent.agent, placedSlot.id, "candidates"), names: [] };
      }
      const source = pick.names.at(-1);
      const ext = source?.split(".").pop() ?? (["director", "writer"].includes(agent.agent) ? "md" : "json");
      const placed = `${PIN_PROBE_NAME}-v1.${ext}`;
      mkdirSync(pick.dir, { recursive: true });
      writeFileSync(join(pick.dir, placed), source ? readFileSync(join(pick.dir, source)) : ext === "json" ? "{}\n" : "---\n---\n");
      let submitted: string;
      try {
        submitted = writeCandidate(join(temp, "clossys"), agent.agent as never, pick.slot.id, PIN_PROBE_NAME, uncertifiedBytes(pick.slot, ext), { at: AT, provenance: { by: `agent:${agent.agent}`, model: "conform-probe", tier: "high" } }).name;
      } catch (error) { out[agent.agent] = `pin probe could not submit an uncertified candidate to ${agent.agent}/${pick.slot.id}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`; continue; }
      const record = isRecordSlot(temp, agent.agent as never, pick.slot.id) ? `#${PIN_PROBE_NAME}` : "";
      const target = `${agent.agent}/${pick.slot.id}${record}`;
      const slotTarget = `${agent.agent}/${pick.slot.id}`;
      const standardId = pick.slot.standard;
      const criterion = standardId ? readStandard(temp, agent.agent as never, standardId).taste?.criteria[0]?.id : undefined;
      const verbs: VerbProbe[] = [];
      for (const [kind, candidate] of [["hand-placed", placed], ["submitted-uncertified", submitted]] as const) {
        const runs: [VerbProbe["verb"], () => Promise<{ exitCode: number; message?: string }>][] = [
          ["pin", () => runStep(["pin", target, candidate, "--by", "planner", "--root", temp], temp)],
          ["pick", () => runStep(["pick", slotTarget, candidate, "--by", `agent:${agent.agent}`, "--at", AT, "--root", temp], temp)],
          ["verdict", async () => {
            const file = join(temp, `verdict-${agent.agent}.json`);
            writeFileSync(file, JSON.stringify({ schema: "clossys.verdict/1", slot: pick.slot.id, pick: candidate, reason: "conform probe", criteria: [criterion ?? "conform-probe"] }));
            return runStep(["verdict", slotTarget, "--record", file, "--model", "conform-probe", "--tier", "high", "--by", `agent:${agent.agent}`, "--at", AT, "--root", temp], temp);
          }],
          // The Writer's owner approval: a pin citing the owner's answered queue.approve entry.
          ...(agent.agent === "writer" ? [["owner-pin", () => runStep(["pin", slotTarget, candidate, "--basis", "picked", "--by", ownerEntry(join(temp, "clossys"), { id: `20261117T1200Z-${PIN_PROBE_NAME}-${kind}`, queue: "approve", about: slotTarget, answer: { candidate }, at: AT }), "--at", AT, "--root", temp], temp)]] as [VerbProbe["verb"], () => Promise<{ exitCode: number; message?: string }>][] : []),
        ];
        for (const [verb, run] of runs) {
          let result: { exitCode: number; message?: string };
          try { result = await run(); } catch (error) { result = { exitCode: 2, message: error instanceof Error ? error.message : String(error) }; }
          const message = (result.message ?? "").split("\n").slice(0, 2).join(" ").trim();
          verbs.push({ verb, case: kind, target: verb === "pin" ? target : slotTarget, candidate, exit: result.exitCode, gated: result.exitCode !== 0 && GATE_REFUSAL.test(result.message ?? ""), message });
        }
      }
      const head = verbs[0]!;
      out[agent.agent] = { target, candidate: placed, accepted: head.exit === 0, message: head.message, verbs };
    }
  } catch (error) {
    const message = `pin probe failed: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`;
    for (const agent of agents) out[agent.agent] ??= message;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  return out;
}

/** The slot the pin probe places on the copy for an agent that holds no live clossys.slot/2 slot: `<kind>.conform-probe`. */
export const PIN_PROBE_SLOT = "conform-probe";
const PIN_PROBE_UNDER = "conform/pin-probe";

/**
 * Places `<agent>/<kind>.conform-probe` on the probe's copy (cwd `temp`, consumer `temp/clossys`) with the real `clossys ia`:
 * the first held kind (not release) that one of the agent's standards covers, that standard, and a contract carrying the
 * standard's requirements (and, for a routed kind, a sample route fixture). A refusal is the probe failing, reported as such, never as a gated pin.
 */
async function placePinProbeSlot(temp: string, agent: AgentModel): Promise<{ id: string; kind: string; standard: string } | string> {
  const { runStep } = await import("../pipeline/runner.js");
  const kinds = (agent.adapter?.kinds ?? []).filter(kind => kind !== "release");
  const kind = kinds.find(each => agent.standards.some(standard => standard.doc?.kinds.includes(each)));
  const standard = kind === undefined ? undefined : agent.standards.find(each => each.doc?.kinds.includes(kind));
  if (kind === undefined || standard?.doc === undefined) return `pin probe: ${agent.agent} has no live clossys.slot/2 slot and no held kind with a standard to place one`;
  const id = `${kind}.${PIN_PROBE_SLOT}`;
  const file = join(temp, `pin-probe-contract-${agent.agent}.json`);
  // A routed kind's fixture is its sample route (../constitution/certify/page.ts), so the probe's refusal is about the candidate, not a missing fixture.
  const fixture = kind === "page" || kind === "publication" ? { fixture: { route: { path: `/${PIN_PROBE_NAME}` } } } : {};
  writeFileSync(file, JSON.stringify({ requirements: standard.doc.requirements.map(item => ({ check: item.check })), ...fixture }));
  const result = await runStep(["ia", `${agent.agent}/${id}`, "--under", PIN_PROBE_UNDER, "--kind", kind, "--standard", standard.id, "--contract", file], temp);
  if (result.exitCode !== 0) return `pin probe could not place ${agent.agent}/${id} (exit ${result.exitCode}): ${(result.message ?? "").split("\n")[0]}`;
  return { id, kind, standard: standard.id };
}

/** Runs the real constitution over a copy of the consumer with one empty L2 group per agent. */
export function probeEmptyL2(repo: string, consumer: string, agents: readonly string[]): Record<string, boolean | string> {
  // The real path: the slot model follows no symbolic link, and the OS temp folder is often one.
  const temp = realpathSync(mkdtempSync(join(tmpdir(), "conform-probe-")));
  try {
    const copy = join(temp, "clossys");
    cpSync(consumer, copy, { recursive: true });
    for (const agent of agents) {
      const file = join(copy, "agents", agent, "ia.json");
      const ia = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
      const nodes = Array.isArray(ia.nodes) ? ia.nodes.filter(object) : [];
      if (nodes.length) (nodes[0]!.children as unknown[] ?? (nodes[0]!.children = [])).push({ id: EMPTY_L2, label: "Probe", slots: [] });
      else ia.nodes = [{ id: `${agent}.conform-probe`, label: "Probe", children: [{ id: EMPTY_L2, label: "Probe", slots: [] }] }];
      writeFileSync(file, `${JSON.stringify(ia, null, 2)}\n`);
    }
    const report = runConstitution({ root: repo, consumer: copy, strict: true });
    return Object.fromEntries(agents.map(agent => [agent, report.rows.some(row => row.agent === agent && JSON.stringify(row).includes(EMPTY_L2))]));
  } catch (error) {
    const message = `constitution probe failed: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`;
    return Object.fromEntries(agents.map(agent => [agent, message]));
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

/**
 * Resolves each agent's first standard's taste.md the way critique-packet does, from a consumer root with
 * no packages/ folder (a temp folder outside this repository, real path). Red (true) when any resolves under
 * that consumer root or to no file: a consumer cannot build the packet.
 */
export function probeCritiquePath(model: ConformModel): boolean {
  const temp = realpathSync(mkdtempSync(join(tmpdir(), "conform-critique-")));
  try {
    const judged = model.agents.flatMap(agent => agent.standards.slice(0, 1).map(standard => ({ agent: agent.agent, id: standard.id })));
    if (!judged.length) return true;
    return judged.some(({ agent, id }) => {
      const path = standardTastePath(temp, agent, id);
      return path.startsWith(temp) || !existsSync(path);
    });
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

/** Reads the cheap probe facts and runs the empty-L2 and ia --contract probes. */
export async function readProbeFacts(model: ConformModel): Promise<ProbeFacts> {
  const producer = join(model.repo, "packages/producer");
  const runner = readFileSync(join(producer, "src/pipeline/runner.ts"), "utf8");
  const actions = JSON.parse(readFileSync(join(producer, "pipeline/actions.json"), "utf8")) as { actions?: { path?: string }[] };
  return {
    emptyL2Detected: probeEmptyL2(model.repo, model.consumer, model.agents.map(agent => agent.agent)),
    requestVerb: /head === "request"/.test(runner) || (actions.actions ?? []).some(action => /(^|\/)request(\/|$)/.test(action.path ?? "")),
    recipePages: await probeRecipePages(model),
    critiqueMonorepoPath: probeCritiquePath(model),
    iaContract: await probeIaContract(model.consumer, model.agents),
    pinGate: await probePinGate(model.consumer, model.agents),
  };
}

export type Probe = (agent: AgentModel, model: ConformModel, facts: ProbeFacts) => Judgement;
const pass = (rows: string[], evidence = 1): Judgement => ({ rows, evidence });

/** The Designer package's adopted references, read once per process. */
let designerReferences: ReferenceIndex | string | undefined;
function defaultReferenceShips(): ((slot: string, file: string, name: string) => boolean) | string {
  if (designerReferences === undefined) {
    try { designerReferences = referenceIndex(resolveAgent("designer").packageRoot); }
    catch (error) { designerReferences = `the Designer references cannot be read: ${error instanceof Error ? error.message : String(error)}`; }
  }
  const index = designerReferences;
  return typeof index === "string" ? index : (slot, file, name) => slotReferenceShips(index, slot, file, name);
}

/** The Designer package's provenance rule, relative to the package root (it ships in the package's `files`). */
const PROVENANCE_RULE_FILE = "src/catalog/rules/provenance.json";

/** The Designer package's provenance rule consumerAssets slot globs, read once per process. */
let designerConsumerAssets: readonly string[] | string | undefined;
function defaultConsumerAssets(): readonly string[] | string {
  if (designerConsumerAssets === undefined) {
    try {
      const rule = JSON.parse(readFileSync(join(resolveAgent("designer").packageRoot, PROVENANCE_RULE_FILE), "utf8")) as { consumerAssets?: { slots?: unknown } };
      const slots = rule.consumerAssets?.slots;
      designerConsumerAssets = Array.isArray(slots) && slots.every(entry => typeof entry === "string") ? slots as string[] : `the Designer provenance rule ${PROVENANCE_RULE_FILE} lists no consumerAssets.slots`;
    } catch (error) { designerConsumerAssets = `the Designer provenance rule ${PROVENANCE_RULE_FILE} cannot be read: ${error instanceof Error ? error.message : String(error)}`; }
  }
  return designerConsumerAssets;
}

/**
 * The layers whose live Designer fixtures must mount what the slot's own adopted reference ships (U27 components, U28
 * sections and frames). The one carve-out is the provenance rule's own (CPE): a component slot in its consumerAssets
 * ("no registry ships them") may instead mount what its accepted pinned consumer-owned candidate ships.
 */
const REFERENCED_FIXTURE_LAYERS = ["components.", "sections.", "frames."] as const;

/**
 * Why a consumer-asset component slot's accepted pinned candidate does not ship `file` and its value export `name` from
 * a consumer-owned source (candidateLineage original, which includes derived from the consumer's own asset slots, or
 * npm); undefined when it does. The pin counts only when the slot/2 reader takes it (pinRejection absent), and the
 * source is read from the candidate's clossys.source header, never from anything else.
 */
function pinnedConsumerMiss(slot: LiveSlot, file: string, name: string, read: (slot: string, name: string) => string): string | undefined {
  if (slot.pin === undefined) return "it has no pin";
  if (slot.pinRejection !== undefined) return `the slot/2 reader refuses its pin (${slot.pinRejection})`;
  const candidate = slot.pin.candidate;
  if (typeof candidate !== "string") return "its pin names no candidate";
  let doc: { clossys?: { source?: { kind?: unknown; ref?: unknown; hash?: unknown } }; content?: { files?: unknown } };
  try { doc = JSON.parse(read(slot.id, candidate)) as typeof doc; }
  catch (error) { return `its pinned candidate ${candidate} cannot be read: ${error instanceof Error ? error.message : String(error)}`; }
  const source = doc?.clossys?.source;
  const owned = source?.kind === "npm" || candidateLineage(slot.id, { meta: { ...(source !== undefined ? { source } : {}) } })?.mode === "original";
  if (!owned) return `its pinned candidate ${candidate} has source ${JSON.stringify(source?.kind ?? null)}, which is not consumer-owned (original, derived from the consumer's own asset slots, or npm)`;
  const files = Array.isArray(doc?.content?.files) ? doc.content.files as { path?: unknown; content?: unknown }[] : [];
  const shipped = files.find(entry => typeof entry?.path === "string" && posix.normalize(entry.path) === posix.normalize(file));
  if (!shipped) return `its pinned candidate ${candidate} ships no file ${file}`;
  if (!CODE.test(shipped.path as string)) return `its pinned candidate's ${file} is not a code file`;
  if (typeof shipped.content !== "string" || !exportedNames(shipped.content).includes(name)) return `its pinned candidate's ${file} has no value export ${name}`;
  return undefined;
}

/** The Designer package's composed slots (FCR), read once per process, or why they cannot be read. */
function defaultComposedSlots(): ReadonlySet<string> | string {
  try { return designerComposedSlots(); }
  catch (error) { return `the Designer composed slots cannot be read: ${error instanceof Error ? error.message : String(error)}`; }
}

const sha256 = (bytes: string) => createHash("sha256").update(bytes).digest("hex");

/**
 * FCR: why a composed section or frame slot's fixture (no reference row adoptable in the selected style and engine,
 * the Designer package's derived `composed` list) is not the file and value export of its own pinned, certified
 * candidate; undefined when it is. Certified means all of: the slot/2 reader takes the pin (pinRejection absent);
 * the pin went through the CHOOSE gate, so it cites the scorecard the gate wrote and that file is the one cited
 * (sha256); the scorecard picks the pinned candidate and its row is submitted and certified (`certify` verdict) at
 * the pinned bytes; a valid critique record (critique-record.ts, the writer's own validation) critiques it; and the
 * candidate ships `file` as a code file with the value export `name`. Nothing else stands in for any of these.
 */
function composedPinMiss(slot: LiveSlot, file: string, name: string, read: (slot: string, name: string) => string, consumerText: (path: string) => string, consumerName: string): string | undefined {
  if (slot.pin === undefined) return "it has no pin";
  if (slot.pinRejection !== undefined) return `the slot/2 reader refuses its pin (${slot.pinRejection})`;
  const candidate = slot.pin.candidate;
  if (typeof candidate !== "string") return "its pin names no candidate";
  const refs = Array.isArray(slot.pin.refs) ? slot.pin.refs : [];
  const cite = refs.find(ref => object(ref) && ref.to === SCORECARD_REF_TO) as Record<string, unknown> | undefined;
  if (!cite) return `its pin cites no scorecard (${SCORECARD_REF_TO}), so it was not pinned through the CHOOSE gate`;
  const scorecardPath = `.state/checks/designer/${slot.id}/scorecard.json`;
  let bytes: string;
  try { bytes = consumerText(scorecardPath); }
  catch (error) { return `its scorecard ${scorecardPath} cannot be read: ${error instanceof Error ? error.message : String(error)}`; }
  if (typeof cite.sha256 !== "string" || sha256(bytes) !== cite.sha256) return `its scorecard ${scorecardPath} is not the one its pin cites (sha256 ${sha256(bytes).slice(0, 12)}, cited ${String(cite.sha256).slice(0, 12)})`;
  let card: { schema?: unknown; slot?: unknown; pick?: unknown; candidates?: unknown };
  try { card = JSON.parse(bytes) as typeof card; }
  catch (error) { return `its scorecard ${scorecardPath} cannot be read: ${error instanceof Error ? error.message : String(error)}`; }
  if (!object(card) || card.schema !== SCORECARD_SCHEMA || card.slot !== `designer/${slot.id}`) return `its scorecard ${scorecardPath} is no ${SCORECARD_SCHEMA} scorecard of designer/${slot.id}`;
  if (card.pick !== candidate) return `its scorecard picks ${JSON.stringify(card.pick ?? null)}, not its pinned candidate ${candidate}`;
  const row = (Array.isArray(card.candidates) ? card.candidates : []).find(entry => object(entry) && entry.candidate === candidate) as Record<string, unknown> | undefined;
  if (!row || row.verdict !== "certify" || row.certified !== true || row.submitted !== true) return `its pinned candidate ${candidate} has no passing verdict (submitted and certified) on its scorecard`;
  if (typeof slot.pin.sha256 !== "string" || row.sha256 !== slot.pin.sha256) return `its scorecard judged ${candidate} at other bytes than its pin names`;
  const critiquePath = `agents/designer/${slot.id}/${CRITIQUES_DIR}/${critiqueFileName(candidate)}`;
  let critique: unknown;
  try { critique = JSON.parse(consumerText(critiquePath)); }
  catch (error) { return `its pinned candidate ${candidate} has no readable critique record ${critiquePath}: ${error instanceof Error ? error.message : String(error)}`; }
  const issues = critiqueRecordIssues(critique, { slot: slot.id, agent: "designer", slotDir: `${consumerName}/agents/designer/${slot.id}`, candidate });
  if (issues.length) return `its critique record ${critiquePath} is invalid (${issues.join("; ")})`;
  let doc: { content?: { files?: unknown } };
  try { doc = JSON.parse(read(slot.id, candidate)) as typeof doc; }
  catch (error) { return `its pinned candidate ${candidate} cannot be read: ${error instanceof Error ? error.message : String(error)}`; }
  const files = Array.isArray(doc?.content?.files) ? doc.content.files as { path?: unknown; content?: unknown }[] : [];
  const shipped = files.find(entry => typeof entry?.path === "string" && posix.normalize(entry.path) === posix.normalize(file));
  if (!shipped) return `its pinned candidate ${candidate} ships no file ${file}`;
  if (!CODE.test(shipped.path as string)) return `its pinned candidate's ${file} is not a code file`;
  const content = typeof shipped.content === "string" ? shipped.content : "";
  if (!(name === "default" ? hasDefaultExport(content) : exportedNames(content).includes(name))) return `its pinned candidate's ${file} has no value export ${name}`;
  return undefined;
}

/**
 * Live Designer component, section and frame fixtures that mount a file or export none of the slot's own adopted
 * references ships, and, for a consumer-asset component slot (provenance consumerAssets), that its accepted pinned
 * consumer-owned candidate does not ship either, and, for a composed section or frame slot (FCR), that is not its own
 * pinned, certified candidate's (`composedPinMiss`); and section fixtures whose `props.copy` does not satisfy the
 * contract's copy fields (U28).
 */
function unshippedComponentFixtures(agent: AgentModel, model: ConformModel, facts: ProbeFacts): string[] {
  const live = agent.live.filter(slot => REFERENCED_FIXTURE_LAYERS.some(prefix => slot.id.startsWith(prefix)) && slot.contract.fixture !== undefined);
  if (!live.length) return [];
  const ships = facts.referenceShips ?? defaultReferenceShips();
  if (typeof ships === "string") return [ships];
  const assets = facts.consumerAssets ?? defaultConsumerAssets();
  if (typeof assets === "string") return [assets];
  const read = facts.candidateText ?? ((slot: string, name: string) => readCandidate(model.consumer, "designer", slot, name).raw);
  const composed = facts.composedSlots ?? defaultComposedSlots();
  if (typeof composed === "string") return [composed];
  const consumerText = facts.consumerText ?? ((path: string) => readFileSync(join(model.consumer, path), "utf8"));
  const rows: string[] = [];
  for (const slot of live) {
    const fixture = slot.contract.fixture as { fixtures?: { file?: unknown; export?: unknown } } | undefined;
    const file = fixture?.fixtures?.file, name = fixture?.fixtures?.export;
    if (typeof file !== "string" || typeof name !== "string" || !ships(slot.id, file, name)) {
      const consumerAsset = slot.id.startsWith("components.") && assets.some(pattern => globMatch(pattern, slot.id));
      const composition = (slot.id.startsWith("sections.") || slot.id.startsWith("frames.")) && composed.has(slot.id);
      if (composition) {
        const miss = typeof file !== "string" || typeof name !== "string" ? "the fixture names no file or export" : composedPinMiss(slot, file, name, read, consumerText, basename(model.consumer ?? "clossys"));
        if (miss !== undefined) rows.push(`${slot.id}: contract.fixture mounts ${String(file)}#${String(name)}, which neither its adopted references ship in the selected style nor its pinned, certified composition ships (${miss})`);
      } else if (!consumerAsset) rows.push(`${slot.id}: contract.fixture mounts ${String(file)}#${String(name)}, which none of its adopted references ships in the selected style`);
      else {
        const miss = typeof file !== "string" || typeof name !== "string" ? "the fixture names no file or export" : pinnedConsumerMiss(slot, file, name, read);
        if (miss !== undefined) rows.push(`${slot.id}: contract.fixture mounts ${String(file)}#${String(name)}, which neither its adopted references ship in the selected style nor its accepted pinned consumer-owned candidate ships (${miss})`);
      }
    }
    if (slot.id.startsWith("sections.")) {
      const copy = slot.contract.copy as { fields?: unknown } | undefined;
      const fields = Array.isArray(copy?.fields) ? copy.fields as CopyField[] : [];
      const props = (fixture as { fixtures?: { props?: Record<string, unknown> } } | undefined)?.fixtures?.props;
      for (const issue of draftCopyIssues(fields, props?.copy)) rows.push(`${slot.id}: contract.fixture ${issue}`);
    }
  }
  return rows;
}

export const PROBES: Readonly<Record<string, Probe>> = {
  "empty-l2": (agent, _model, facts) => {
    const found = facts.emptyL2Detected[agent.agent];
    return pass(found === true ? [] : [typeof found === "string" ? found : `an empty L2 group (${EMPTY_L2}) is reported by no constitution check`]);
  },
  "request-path": (_agent, model, facts) => pass([
    ...(facts.requestVerb ? [] : ["no request verb: a missing slot cannot be requested (feedback needs an existing slot folder)"]),
    ...(model.machinery.slotRequestSchema ? [] : ["no clossys.queue-entry/2 schema"]),
  ]),
  "invalid-contract": (agent, model, facts) => ASSERTIONS.L3!(agent, model, facts),
  "critique-path": (_agent, _model, facts) => pass(facts.critiqueMonorepoPath ? ["critique-packet reads packages/<agent>/standards under the workspace root, absent from an install"] : []),
  "pin-verdict": (agent, model, facts) => ASSERTIONS.C3!(agent, model, facts),
  "repin-stale": (agent, model) => ASSERTIONS.X1!(agent, model),
  "skill-craft": agent => {
    if (agent.skillText === undefined) return pass([`${agent.adapter?.skill ?? "skill"} is missing`]);
    const missing = ["verdict", "critique", "craft"].filter(word => !agent.skillText!.toLowerCase().includes(word));
    return pass(missing.length ? [`${agent.adapter!.skill} never mentions ${missing.join(", ")}`] : []);
  },
  "skill-basis": agent => {
    if (agent.skillText === undefined) return pass([`${agent.adapter?.skill ?? "skill"} is missing`]);
    return pass(/--basis picked/.test(agent.skillText) ? [`${agent.adapter!.skill} teaches \`--basis picked\`, which pin refuses (it needs owner:queue.<kind>#<id>)`] : []);
  },
  "contract-fixture": (agent, model, facts) => {
    const fixtures = agent.live.filter(slot => slot.contract.fixture !== undefined).length;
    const rows = fixtures ? [] : [`none of ${agent.live.length} live slot contracts carries contract.fixture`];
    // U27: a Designer component fixture must mount a file and an export its own adopted reference ships in the
    // selected style, so a stock candidate copied from that reference can certify; any other path or name is red.
    // CPE: a provenance consumerAssets component slot (no registry ships it) may instead mount what its accepted
    // pinned consumer-owned candidate ships.
    if (agent.agent === "designer") rows.push(...unshippedComponentFixtures(agent, model, facts));
    return pass(rows, agent.live.length);
  },
  "upstream-pinned": (agent, model) => {
    const upstream = agent.edges.map(edge => edge.to);
    const reaches = (id: string, ids: readonly string[]) => ids.includes(id) || ids.includes(id.split("/")[1] ?? "");
    // U37: a pin counts only when the slot/2 readers take it as intact (LiveSlot.pinRejection absent), not when a pin
    // file merely exists: a pinned candidate the readers refuse feeds no cascade.
    const others = model.agents.filter(other => other.agent !== agent.agent).flatMap(other => other.live.filter(slot => slot.pin !== undefined));
    const pinned = others.filter(slot => slot.pinRejection === undefined).map(slot => slot.id);
    const refused = others.filter(slot => slot.pinRejection !== undefined && upstream.some(id => reaches(id, [slot.id])));
    const hit = upstream.filter(id => reaches(id, pinned));
    const why = refused.length ? `; pinned but refused by the slot/2 reader: ${[...new Set(refused.map(slot => `${slot.id} (${slot.pinRejection})`))].join(", ")}` : "";
    return pass(hit.length ? [] : [`none of ${new Set(upstream).size} upstream inputs is pinned with a pin the slot/2 reader takes, so no upstream cascade can reach ${agent.agent}${why}`], upstream.length);
  },
  "current-format": agent => {
    const old = agent.live.filter(slot => slot.schema === "clossys.slot/1");
    return pass(old.length ? [`${old.length} of ${agent.live.length} live slots are clossys.slot/1, an old format every pin refuses`] : [], agent.live.length);
  },
};

export interface DogfoodRow { readonly id: string; readonly agent: string; readonly loop: string; readonly result: string; readonly finding: string; readonly probes: readonly string[] }

/** One dogfood assertion: red when any probe is red or judged nothing. */
export function judgeDogfood(row: DogfoodRow, agent: AgentModel, model: ConformModel, facts: ProbeFacts): Judgement {
  const results = row.probes.map(name => {
    const probe = PROBES[name];
    if (!probe) return { rows: [`unknown probe ${name}`], evidence: 0 };
    const result = probe(agent, model, facts);
    return { rows: result.rows.map(text => `[${name}] ${text}`).concat(result.evidence ? [] : [`[${name}] vacuous: judged nothing`]), evidence: result.evidence };
  });
  return { rows: results.flatMap(result => result.rows), evidence: results.length && results.every(result => result.evidence > 0) ? results.reduce((sum, result) => sum + result.evidence, 0) : 0 };
}
