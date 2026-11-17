/**
 * Dogfood conformance assertions (foundry-build-0048 U1, planner input 2026-11-17): every RAN-FAILED,
 * RAN-WEAK or CANNOT-RUN row of the four agents' dogfood runs becomes one assertion, named after its row
 * (`DF.<agent>.<LOOP>`), judged by probes of the repo. Each probe reproduces the row's failure as a fact
 * the repo either still has (red) or no longer has. The empty-L2 probe runs the real constitution over a
 * temporary copy of the consumer with one empty L2 group added per agent; the rest read files.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { standardTastePath } from "../cli/critique.js";
import { runConstitution } from "../constitution/run.js";
import { ASSERTIONS, type Judgement } from "./assertions.js";
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
}

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

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

/** Reads the cheap probe facts and runs the empty-L2 probe. */
export function readProbeFacts(model: ConformModel): ProbeFacts {
  const producer = join(model.repo, "packages/producer");
  const runner = readFileSync(join(producer, "src/pipeline/runner.ts"), "utf8");
  const actions = JSON.parse(readFileSync(join(producer, "pipeline/actions.json"), "utf8")) as { actions?: { path?: string }[] };
  return {
    emptyL2Detected: probeEmptyL2(model.repo, model.consumer, model.agents.map(agent => agent.agent)),
    requestVerb: /head === "request"/.test(runner) || (actions.actions ?? []).some(action => /(^|\/)request(\/|$)/.test(action.path ?? "")),
    critiqueMonorepoPath: probeCritiquePath(model),
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
  "invalid-contract": (agent, model) => ASSERTIONS.L3!(agent, model),
  "critique-path": (_agent, _model, facts) => pass(facts.critiqueMonorepoPath ? ["critique-packet reads packages/<agent>/standards under the workspace root, absent from an install"] : []),
  "pin-verdict": (agent, model) => ASSERTIONS.C3!(agent, model),
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
