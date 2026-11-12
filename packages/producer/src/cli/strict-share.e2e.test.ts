/**
 * Mutation proofs, end to end through the built CLI: `design --check`, `write --check` and the bare `publish`
 * dry run carry their agent's share of the strict slot findings (`check --slots`). In a full copy of the
 * repository's `clossys/`, a slot-integrity defect in one of that agent's slots adds a strict finding and the verb
 * exits 1: an unpinned slot (`slots/no-pin` at `<agent>:<slot>`) for Designer and Writer; for the Publisher, whose
 * own dry run already refuses a page without a pin, a stray file in a page slot folder (a `slots/` finding under
 * `agents/publisher/<slot>/`), which the dry run alone does not see. A verb that could not run its strict checks
 * exits 2, never 0.
 */
import { existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { flatConsumer, runVerb, withBriefContracts } from "./__fixtures__/flat-consumer.js";

type Finding = { code?: string; rule?: string; subject?: string; slot?: string; page?: string };
const VERBS = {
  designer: { args: ["design", "--check"], findings: (value: any): Finding[] => value.checks.findings, code: (f: Finding) => f.code, where: (f: Finding) => f.subject },
  writer: { args: ["write", "--check"], findings: (value: any): Finding[] => value.checks.findings, code: (f: Finding) => f.rule, where: (f: Finding) => f.slot },
  publisher: { args: ["publish"], findings: (value: any): Finding[] => value.checks.findings, code: (f: Finding) => f.code, where: (f: Finding) => f.page },
} as const;

let root: string;
beforeAll(() => { root = withBriefContracts(flatConsumer(["director", "designer", "writer", "publisher"])); });
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** The first pinned slot of an agent whose id is accepted, in sorted order. */
function pinnedSlot(agent: keyof typeof VERBS, accept: (id: string) => boolean): string {
  const base = join(root, "clossys", "agents", agent);
  const id = readdirSync(base).sort().find(name => accept(name) && existsSync(join(base, name, "pin.json")));
  if (!id) throw new Error(`no pinned ${agent} slot`);
  return id;
}

describe("strict share, end to end (mutation)", () => {
  for (const agent of ["designer", "writer", "publisher"] as const) {
    it(`${VERBS[agent].args.join(" ")} turns red when one ${agent} slot loses its pin`, () => {
      const verb = VERBS[agent];
      const baseline = runVerb(verb.args, root);
      expect(baseline.value.checks.strict.limits).toEqual([]);
      expect(baseline.status).not.toBe(2);
      // Theme slots also feed the Designer's own theme compile; the mutation targets the strict share only.
      const id = pinnedSlot(agent, name => !name.startsWith("themes."));
      const folder = join(root, "clossys", "agents", agent, id);
      const hit = agent === "publisher"
        ? (f: Finding) => (verb.code(f) ?? "").startsWith("slots/") && (verb.where(f) ?? "").startsWith(`agents/publisher/${id}/`)
        : (f: Finding) => verb.code(f) === "slots/no-pin" && verb.where(f) === `${agent}:${id}`;
      expect(verb.findings(baseline.value).filter(hit)).toEqual([]);
      if (agent === "publisher") writeFileSync(join(folder, "stray-notes.txt"), "not a slot record\n");
      else rmSync(join(folder, "pin.json"));
      const mutated = runVerb(verb.args, root);
      expect(mutated.status).toBe(1);
      expect(mutated.value.exitCode).toBe(1);
      expect(verb.findings(mutated.value).filter(hit)).toHaveLength(1);
      // Compare findings as sets, not counts: an unpinned slot drops out of its verb's pinned checks, so the findings
      // about that slot's own pinned content can go away as the strict finding arrives (a red baseline can keep the
      // same count). Every baseline finding about any other slot stays, and the mutated run has one the baseline lacks.
      const key = (f: Finding) => `${verb.code(f)} ${verb.where(f)} ${JSON.stringify(f)}`;
      const about = (f: Finding) => (verb.where(f) ?? "").includes(id);
      const before = new Set(verb.findings(baseline.value).map(key)), after = new Set(verb.findings(mutated.value).map(key));
      expect(verb.findings(baseline.value).filter(f => !about(f) && !after.has(key(f))).map(key)).toEqual([]);
      expect([...after].filter(each => !before.has(each)).length).toBeGreaterThan(0);
    }, 600_000);
  }
});
