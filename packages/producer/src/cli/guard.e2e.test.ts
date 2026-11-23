/**
 * The write guards end to end (slot-constitution.md section 4, W2-E): on a fixture consumer,
 * `next --submit`, `pin` and `reissue` each refuse, and write nothing, when any check whose
 * rules.json guard lists the verb has a finding about the records the write leaves; a finding of a
 * check that does not guard the verb never refuses. The registry is the real rules.json joined to
 * the rule modules, each check's function replaced by one that reports the target, so every guarded
 * id is proven to refuse; the id lists are pinned here so a dropped guard entry fails this test.
 *
 * One format (foundry-build-0048 U13): `reissue` and `pin` write in a converted (clossys.slot/2) store only, so their
 * cases run after `clossys migrate slots`; `pin` on a clossys.slot/1 slot is refused before any guard runs. A slot/2
 * pin passes the CHOOSE gate (pinGate) and then the rules.json pin guard inside the one decision writer (U13 r4, B1):
 * a guarded finding refuses it and restores every file it wrote. The pin cases run on the Writer hero copy of the
 * fixture consumer (a slot/2 slot whose submitted candidate the CHOOSE gate certifies); one more case runs the real
 * guard on it and is refused by R20.2.
 */
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { applySlotsMigration, planSlotsMigration } from "../migrate/slots.js";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { guardCheckIds, type GuardVerb } from "../constitution/guard.js";
import { registeredRules, type RegisteredRule } from "../constitution/registry.js";
import type { Row } from "../constitution/types.js";
import { jsonBytes, slotPositions, type IaDoc } from "../records/slot-model/index.js";
import { sha256Hex } from "../records/hash.js";
import { STEPS } from "../pipeline/steps/index.js";
import { writeCandidate } from "../records/slot-write.js";
import "./main.js";
import { runNextSubmitCli } from "./next.js";
import { runPinCli } from "./pin.js";
import { runReissueCli } from "./reissue.js";

// U13 r4: each pin case copies the fixture consumer and runs one guarded pin per check id; at shared load that exceeds 5 s.
vi.setConfig({ testTimeout: 120_000 });

/** The check ids each verb's guard runs, as rules.json lists them (section 4). */
const GUARDED: Readonly<Record<"submit" | "pin" | "reissue", readonly string[]>> = {
  submit: ["R03.1", "R03.2", "R03.3", "R03.4", "R03.5", "R05.1", "R05.2", "R05.3", "R06.1", "R06.2", "R06.2-installed-bytes", "R06.3", "R06.4", "R06.5", "R06.6", "R06.7", "R07.1", "R07.2", "R07.3", "R07.4", "R07.5", "R07.6", "R08.1", "R08.2", "R08.3", "R13.1", "R13.2", "R13.3", "R14.1", "R14.2", "R14.3", "R15.1", "R15.2", "R15.3", "R15.4", "R15.5", "R15.6", "R15.7", "R15.8", "R15.9", "R20.1", "R20.2"],
  pin: ["R02.1", "R02.2", "R02.3", "R03.2", "R04", "R05.1", "R05.2", "R05.3", "R06.7", "R07.1", "R07.2", "R07.3", "R07.4", "R07.5", "R07.6", "R09", "R14.1", "R14.2", "R14.3", "R20.1", "R20.2"],
  reissue: ["R03.1", "R03.2", "R03.3", "R03.4", "R03.5", "R05.1", "R05.2", "R05.3", "R06.1", "R06.2", "R06.2-installed-bytes", "R06.3", "R06.4", "R06.5", "R06.6", "R06.7", "R08.1", "R08.2", "R08.3", "R14.1", "R14.2", "R14.3", "R20.1", "R20.2"],
};

const ID = "components.button";
const CARD = "components.card";
const AT = "2026-11-14T12:00:00.000Z";
const source = { kind: "registry", ref: ["shadcn-aria/button@4.23.0"] };
const OLD = jsonBytes({ name: "button", type: "registry:ui", dependencies: ["react"], registryDependencies: ["card"], files: [], meta: { source, preview: { fixtures: { file: "button.fixture.tsx", export: "Default", props: { label: "Go" } } } } });
const SUBMITTED = { name: "button", type: "registry:ui", dependencies: ["react@18.3.1"], registryDependencies: [], files: [], meta: { source, note: "submitted" } };

let workspace: string;
let slotDir: string;
let agentsDir: string;
let iaDoc: IaDoc;

beforeEach(() => {
  workspace = realpathSync(mkdtempSync(join(tmpdir(), "clossys-guard-e2e-")));
  const agents = agentsDir = join(workspace, "clossys", "agents", "designer");
  const ia: IaDoc = iaDoc = { schema: "clossys.ia/1", source: "synthetic#fixture", extensions: [], nodes: [{ id: "components", label: "Components", children: [{ id: "group", label: "Group", slots: [ID, CARD] }] }] };
  mkdirSync(agents, { recursive: true });
  writeFileSync(join(workspace, "clossys", "clossys.config.ts"), "export default {};\n");
  writeFileSync(join(workspace, "package-lock.json"), jsonBytes({ name: "fixture", lockfileVersion: 3, packages: { "": { name: "fixture" }, "node_modules/react": { version: "18.3.1" } } }));
  writeFileSync(join(agents, "ia.json"), jsonBytes(ia));
  for (const id of [ID, CARD]) {
    const dir = join(agents, id);
    mkdirSync(join(dir, "candidates"), { recursive: true });
    writeFileSync(join(dir, "slot.json"), jsonBytes({ schema: "clossys.slot/1", id, agent: "designer", ia: slotPositions("designer", ia).get(id), kind: "element", contract: {}, inputs: [], uses: [] }));
  }
  slotDir = join(agents, ID);
  writeFileSync(join(slotDir, "candidates", "button-v1.json"), OLD);
  writeFileSync(join(slotDir, "pin.json"), jsonBytes({ candidate: "button-v1.json", sha256: sha256Hex(OLD), decidedBy: "owner:2026-11-14 go", basis: "picked", at: AT }));
  writeFileSync(join(workspace, "submitted.json"), jsonBytes(SUBMITTED));
});
afterEach(() => rmSync(workspace, { recursive: true, force: true }));

/** Every file under the consumer with its bytes: what "writes nothing" compares. */
function tree(dir = join(workspace, "clossys")): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) Object.assign(out, tree(path));
    else out[relative(workspace, path)] = readFileSync(path, "utf8");
  }
  return out;
}

/**
 * The real registry with every check's function replaced: a check in `firing` reports every
 * candidate the slot could hold and its pin.json and slot.json; any other check reports nothing.
 */
type Target = { readonly agent: string; readonly slot: string; readonly candidate: (n: number) => string };
const BUTTON: Target = { agent: "designer", slot: ID, candidate: n => `button-v${n}.json` };
function registry(firing: (id: string) => boolean, target: Target): RegisteredRule[] {
  const { agent, slot } = target;
  return registeredRules().map(rule => ({
    ...rule,
    run: rule.run.map(check => ({
      ...check,
      fn: (): Row[] => !firing(check.id) ? [] : [
        ...[1, 2, 3].map(n => ({ rule: rule.id, check: check.id, agent, slot, candidate: target.candidate(n), reason: "synthetic finding", path: `clossys/agents/${agent}/${slot}/candidates/${target.candidate(n)}` })),
        ...["pin.json", "slot.json"].map(file => ({ rule: rule.id, check: check.id, agent, slot, reason: "synthetic finding", path: `clossys/agents/${agent}/${slot}/${file}` })),
      ],
    })),
  }));
}
const guard = (firing: (id: string) => boolean, target: Target = BUTTON) => ({ rules: registry(firing, target), history: () => ({ available: false, error: "fixture", changes: new Map(), dirty: new Set<string>() }) });

/**
 * What each verb's cases start from. A reissue needs a converted store, an unpinned old candidate (a slot/2 pin moves
 * only through the CHOOSE gate) and a slot that already uses the card (a slot/2 slot changes its refs through ia).
 */
const converted = () => {
    rmSync(join(slotDir, "pin.json"));
    writeFileSync(join(slotDir, "slot.json"), jsonBytes({ schema: "clossys.slot/1", id: ID, agent: "designer", ia: slotPositions("designer", iaDoc).get(ID), kind: "element", contract: {}, inputs: [], uses: [CARD] }));
    const plan = planSlotsMigration(workspace, { at: AT, version: "0.0.0-test" });
    expect(plan.findings).toEqual([]);
    applySlotsMigration(workspace, plan, { at: AT, version: "0.0.0-test" });
    expect(JSON.parse(readFileSync(join(agentsDir, ID, "slot.json"), "utf8")).schema).toBe("clossys.slot/2");
};
/**
 * A pin needs a slot/2 slot whose candidate the CHOOSE gate certifies: the Writer hero copy of the fixture consumer with
 * one submitted candidate. The workspace becomes a copy of that consumer; slotDir is the hero copy's folder.
 */
const FIXTURE = fileURLToPath(new URL("../../test-fixtures/consumer/", import.meta.url));
const HERO = "sections.hero.copy";
const HERO_TARGET: Target = { agent: "writer", slot: HERO, candidate: n => `copy-v${n}.md` };
const HERO_COPY = `---
slot: "${HERO}"
locales: ["en"]
reason: "realises director:advantage.proposition.promise for the hero"
source: {"kind":"derived","ref":["director:identity.verbal.voice","director:advantage.proposition.promise","director:identity.naming.name"]}
provenance: {"voice":"director:identity.verbal.voice"}
---

## en
### header.heading
<!-- {"id":"header.heading","bindings":[]} -->
Ship your site this week
### actions.primary.label
<!-- {"id":"actions.primary.label","bindings":[]} -->
Get started
`;
let heroCandidate = "";
const hero = () => {
  rmSync(workspace, { recursive: true, force: true });
  workspace = realpathSync(mkdtempSync(join(tmpdir(), "clossys-guard-e2e-pin-")));
  cpSync(FIXTURE, workspace, { recursive: true });
  slotDir = join(workspace, "clossys", "agents", "writer", HERO);
  heroCandidate = writeCandidate(join(workspace, "clossys"), "writer", HERO, "copy", HERO_COPY, { at: AT, provenance: { by: "agent:writer", model: "fixture-llm", tier: "high" } }).name;
};
const prepare: Readonly<Record<"submit" | "reissue" | "pin", () => void>> = { submit: () => undefined, reissue: converted, pin: hero };

const skill = STEPS.find(step => step.id === "designer.candidates")!.command.skill!;
const run: Readonly<Record<"submit" | "pin" | "reissue", (firing: (id: string) => boolean) => ReturnType<typeof runPinCli>>> = {
  submit: firing => runNextSubmitCli([`designer/${ID}`, "--submit", "submitted.json", "--model", "fixture-llm", "--tier", "high", "--basis", "agent", "--skill", skill, "--rung", "L1", "--seed", "shadcn-aria/button"], workspace, undefined, undefined, guard(firing)),
  pin: firing => runPinCli([`writer/${HERO}#copy`, heroCandidate, "--by", "planner:guard-e2e", "--at", AT, "--root", workspace], workspace, guard(firing, HERO_TARGET)),
  reissue: firing => runReissueCli([`designer/${ID}`, "button-v1.json", "--by", "agent:designer.reissue", "--at", AT], workspace, guard(firing)),
};

describe("write guards on a fixture consumer", () => {
  it("guard the verbs with exactly the check ids rules.json lists", () => {
    for (const verb of ["submit", "pin", "reissue"] as const) expect(guardCheckIds(verb as GuardVerb)).toEqual(GUARDED[verb]);
  });

  it("pin refuses a clossys.slot/1 slot with the migrate message before any guard runs, and writes nothing", async () => {
    const before = tree();
    const result = await runPinCli([`designer/${ID}`, "button-v1.json", "--by", "planner:guard-e2e", "--at", AT], workspace, guard(() => true));
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/run clossys migrate slots --apply first/);
    expect(result.output).toBeUndefined();
    expect(tree()).toEqual(before);
  });

  for (const verb of ["submit", "reissue", "pin"] as const) {
    it(`${verb} refuses on every guarded check id, one at a time, and writes nothing`, async () => {
      prepare[verb]();
      const before = tree();
      for (const id of GUARDED[verb]) {
        const result = await run[verb](check => check === id);
        expect(result.exitCode, `${verb} with ${id} firing`).toBe(1);
        expect((result.output as { checks: string[] }).checks, `${verb} with ${id} firing`).toEqual([id]);
        expect(tree(), `${verb} with ${id} firing`).toEqual(before);
      }
    });

    it(`${verb} refuses naming every guarded check id at once`, async () => {
      prepare[verb]();
      const before = tree();
      const result = await run[verb](() => true);
      expect(result.exitCode).toBe(1);
      expect([...(result.output as { checks: string[] }).checks].sort()).toEqual([...GUARDED[verb]].sort());
      expect(tree()).toEqual(before);
    });

    it(`${verb} writes when only checks that do not guard it have findings`, async () => {
      prepare[verb]();
      const before = tree();
      const result = await run[verb](id => !GUARDED[verb].includes(id));
      expect(result.exitCode, result.message).toBe(0);
      expect(tree()).not.toEqual(before);
      const ledger = JSON.parse(readFileSync(join(slotDir, "ledger.json"), "utf8")) as { events: { op: string; verb: string }[] };
      expect(ledger.events.at(-1)!.verb).toBe(verb);
    });
  }

  it("pin under the real guard refuses a candidate whose reason cites an unpinned Director slot (R20.2) and restores every file", async () => {
    hero();
    const before = tree();
    const result = await runPinCli([`writer/${HERO}#copy`, heroCandidate, "--by", "planner:guard-e2e", "--at", AT, "--root", workspace], workspace);
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/refused by the constitution guard: .*R20\.2 copy-v1\.md: frontmatter reason cites director:advantage\.proposition\.promise, which is not a pinned Director slot/);
    expect(tree()).toEqual(before);
  });
});
