/**
 * Dogfood conformance assertions (foundry-build-0048 U1, planner input 2026-11-17): every RAN-FAILED,
 * RAN-WEAK or CANNOT-RUN row of the four agents' dogfood runs becomes one assertion, named after its row
 * (`DF.<agent>.<LOOP>`), judged by probes of the repo. Each probe reproduces the row's failure as a fact
 * the repo either still has (red) or no longer has. The empty-L2 probe runs the real constitution over a
 * temporary copy of the consumer with one empty L2 group added per agent, and the contract probe runs the
 * real `clossys ia --contract --dry` on a temporary copy, and the pin probe runs the real `clossys pin` on a
 * temporary copy with a hand-placed candidate; the rest read files.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { standardTastePath } from "../cli/critique.js";
import { runConstitution } from "../constitution/run.js";
import { ASSERTIONS, KIND_FAMILY, type Judgement } from "./assertions.js";
import type { AgentModel, ConformModel } from "./model.js";

export const EMPTY_L2 = "conform-probe-empty";

/** What the expensive probes found, computed once per run (or given by a test). */
export interface ProbeFacts {
  /** Per agent: did the strict constitution report an injected empty L2 group? */
  readonly emptyL2Detected: Readonly<Record<string, boolean | string>>;
  /** A request verb (head or step) exists. */
  readonly requestVerb: boolean;
  /** critique-packet cannot resolve a standard's taste.md from a consumer root (no packages/ folder). */
  readonly critiqueMonorepoPath: boolean;
  /** Per agent: what `clossys ia --contract` did with an invalid contract per held kind family, or why it could not run. */
  readonly iaContract?: Readonly<Record<string, readonly IaContractResult[] | string>>;
  /** Per agent: what `clossys pin` did with a hand-placed candidate (no submit record), or why it could not run. */
  readonly pinGate?: Readonly<Record<string, PinGateResult | string>>;
}

export interface PinGateResult { readonly target: string; readonly candidate: string; readonly accepted: boolean; readonly message: string }

export interface IaContractResult { readonly target: string; readonly contract: string; readonly accepted: boolean; readonly message: string }

/** A contract no kind's contract may be: an unknown `kind` field and nothing else. */
export const INVALID_CONTRACT: Readonly<Record<string, unknown>> = { kind: "nonsense" };
const PROBE_SLOT = "conform.contract-probe";

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
  const { runIaCli } = await import("../cli/owner.js");
  const temp = realpathSync(mkdtempSync(join(tmpdir(), "conform-contract-")));
  const out: Record<string, IaContractResult[] | string> = {};
  try {
    cpSync(consumer, join(temp, "clossys"), { recursive: true });
    const file = join(temp, "contract.json");
    writeFileSync(file, JSON.stringify(contract));
    for (const agent of agents) {
      const families = [...new Set((agent.adapter?.kinds ?? []).map(kind => KIND_FAMILY[kind]).filter((family): family is string => family !== undefined))];
      const results: IaContractResult[] = [];
      for (const family of families) {
        const target = `${agent.agent}/${PROBE_SLOT}-${family}`;
        // Under the first placed L2 when there is one (ia places under an existing group), else a new conform/probe group.
        const l1 = agent.placedTree.find(node => node.l2.length);
        const under = l1 ? `${l1.id}/${l1.l2[0]!.id}` : "conform/probe";
        const result = await runIaCli([target, "--under", under, "--kind", family, "--contract", file, "--dry"], temp);
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

/**
 * Runs the real `clossys pin <agent>/<slot>[#<record>] <conform-probe-v1.ext> --by planner` on a temporary copy of
 * the consumer, once per agent, against its first live slot/2 slot (one with a candidate first): the probe copies that
 * slot's newest candidate under a new name by hand, so the file has no submit record. Accepted means exit 0; a refusal
 * counts only when it is the CHOOSE gate's (no submit record, no passing verdict); any other outcome is the probe failing.
 */
export async function probePinGate(consumer: string, agents: readonly AgentModel[]): Promise<Record<string, PinGateResult | string>> {
  await import("../cli/main.js");
  const { runPinCli } = await import("../cli/pin.js");
  const { isRecordSlot } = await import("../records/resolve.js");
  const temp = realpathSync(mkdtempSync(join(tmpdir(), "conform-pin-")));
  const out: Record<string, PinGateResult | string> = {};
  try {
    cpSync(consumer, join(temp, "clossys"), { recursive: true });
    for (const agent of agents) {
      const slots = agent.live.filter(slot => slot.schema === "clossys.slot/2" && slot.kind !== "release")
        .map(slot => ({ slot, dir: join(temp, "clossys", "agents", agent.agent, slot.id, "candidates") }))
        .map(item => ({ ...item, names: existsSync(item.dir) ? readdirSync(item.dir).filter(name => /-v\d+\.(md|json|svg)$/.test(name)).sort() : [] }));
      const pick = slots.find(item => item.names.length) ?? slots[0];
      if (!pick) { out[agent.agent] = `pin probe: ${agent.agent} has no live clossys.slot/2 slot`; continue; }
      const source = pick.names.at(-1);
      const ext = source?.split(".").pop() ?? (["director", "writer"].includes(agent.agent) ? "md" : "json");
      const candidate = `${PIN_PROBE_NAME}-v1.${ext}`;
      mkdirSync(pick.dir, { recursive: true });
      writeFileSync(join(pick.dir, candidate), source ? readFileSync(join(pick.dir, source)) : ext === "json" ? "{}\n" : "---\n---\n");
      const record = isRecordSlot(temp, agent.agent as never, pick.slot.id) ? `#${PIN_PROBE_NAME}` : "";
      const target = `${agent.agent}/${pick.slot.id}${record}`;
      const result = await runPinCli([target, candidate, "--by", "planner", "--root", temp], temp);
      const message = (result.message ?? "").split("\n").slice(0, 2).join(" ").trim();
      if (result.exitCode !== 0 && !(result.exitCode === 1 && /no submit record|no passing verdict/.test(result.message ?? ""))) { out[agent.agent] = `pin probe failed for ${target}: exit ${result.exitCode}: ${message}`; continue; }
      out[agent.agent] = { target, candidate, accepted: result.exitCode === 0, message };
    }
  } catch (error) {
    const message = `pin probe failed: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`;
    for (const agent of agents) out[agent.agent] ??= message;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  return out;
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
 * no packages/ folder (a temp folder outside the monorepo, real path). Red (true) when any resolves under
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
    critiqueMonorepoPath: probeCritiquePath(model),
    iaContract: await probeIaContract(model.consumer, model.agents),
    pinGate: await probePinGate(model.consumer, model.agents),
  };
}

export type Probe = (agent: AgentModel, model: ConformModel, facts: ProbeFacts) => Judgement;
const pass = (rows: string[], evidence = 1): Judgement => ({ rows, evidence });

export const PROBES: Readonly<Record<string, Probe>> = {
  "empty-l2": (agent, _model, facts) => {
    const found = facts.emptyL2Detected[agent.agent];
    return pass(found === true ? [] : [typeof found === "string" ? found : `an empty L2 group (${EMPTY_L2}) is reported by no constitution check`]);
  },
  "request-path": (_agent, model, facts) => pass([
    ...(facts.requestVerb ? [] : ["no request verb: a missing slot cannot be requested (feedback needs an existing slot folder)"]),
    ...(model.machinery.slotRequestSchema ? [] : ["no clossys.slot-request/1 schema"]),
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
  "contract-fixture": agent => {
    const fixtures = agent.live.filter(slot => slot.contract.fixture !== undefined).length;
    return pass(fixtures ? [] : [`none of ${agent.live.length} live slot contracts carries contract.fixture`], agent.live.length);
  },
  "upstream-pinned": (agent, model) => {
    const upstream = agent.edges.map(edge => edge.to);
    const pinned = model.agents.filter(other => other.agent !== agent.agent).flatMap(other => other.live.filter(slot => slot.pin !== undefined).map(slot => slot.id));
    const hit = upstream.filter(id => pinned.includes(id) || pinned.includes(id.split("/")[1] ?? ""));
    return pass(hit.length ? [] : [`none of ${new Set(upstream).size} upstream inputs is pinned, so no upstream cascade can reach ${agent.agent}`], upstream.length);
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
