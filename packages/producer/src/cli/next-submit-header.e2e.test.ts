/**
 * foundry-build-0048 U37 fix r1 (blind B B2): `clossys next --submit`, run for real on a temp copy of
 * `test-fixtures/consumer` (clossys.slot/2 throughout; the fixture stays byte-identical), writes each Markdown
 * agent's candidate as a clossys.candidate/1 file: a Director brief and a Writer copy file. The header is the one the
 * slot/2 readers require (schema, id, agent and slot naming where the file sits, one source, created by the
 * submitting agent's skill, model and tier); the CHOOSE gate (`clossys pin`) takes the candidate and the slot/2
 * reader takes the pin (`pinBlocker`), so a verb-made pin satisfies CASCADE. A submission whose document equals a
 * held candidate's without its header is refused as identical. A Designer element is written as its int2 JSON with
 * no header (cli/next.ts HEADERED_KINDS: the submit guard's rules read the item's own `meta.source`); a Publisher
 * page/1 or publication/1 record carries none either (init-outputs-slot2.e2e.test.ts pins one).
 * The constitution write guard is off here (guard `false`, as pin-gate.test.ts runs `pin`): its checks judge the
 * content's ladder and citations (R03.2, R20.2) and are proven by guard.e2e.test.ts; this test's subject is the
 * file the verb writes and the readers' take on it.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { skillOf as stepSkill } from "../pipeline/chain.js";
import { STEPS } from "../pipeline/steps/index.js";
import { candidateHeaderOf, candidateHeaderReadIssues, candidateView } from "../records/slot-current.js";
import { pinBlocker, slotCandidateIssues } from "../records/slots.js";
import { runNextSubmitCli } from "./next.js";
import { runPinCli } from "./pin.js";

const FIXTURE = fileURLToPath(new URL("../../test-fixtures/consumer/", import.meta.url));
const AT = "2026-11-17T12:00:00Z";
const QUEUE_ID = "20261117T1200Z-next-submit-header";
const MODEL = "fixture-model";
const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

const stepOf = (agent: string) => STEPS.find(step => step.id === `${agent}.candidates`)!;
const skillOf = (agent: string) => stepOf(agent).command.skill!;
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");

const BRIEF = `---
slot: "focus.segment.core"
source: {"kind":"derived","ref":["finding:fixture-segment-draft"]}
feeds: []
functions: []
note: "DRAFT fixture data for the test consumer; not owner research."
---
## Direction
- Who: DRAFT fixture segment, small teams that have no developer on call
- Situation: DRAFT fixture situation, the team changes the site without technical help
- Not: DRAFT fixture boundary, not teams that already employ an in-house developer

## Because
- The fixture finding says the owner edits the site with no developer on call (finding:fixture-segment-draft).

## Watch
- If fixture teams with a developer rise above 2 in any quarter, then revisit this segment brief.
`;

const COPY = `---
slot: "sections.hero.copy"
locales: ["en"]
reason: "realises director:advantage.proposition.promise for the hero"
source: {"kind":"derived","ref":["director:identity.verbal.voice","director:advantage.proposition.promise","director:identity.naming.name"]}
---

## en
### header.heading
<!-- {"id":"header.heading","bindings":[]} -->
Ship your site this week
### actions.primary.label
<!-- {"id":"actions.primary.label","bindings":[]} -->
Get started
`;

const HERO = {
  $schema: "https://ui.shadcn.com/schema/registry-item.json",
  name: "hero",
  type: "registry:block",
  files: [{ path: "hero.tsx", type: "registry:block", content: "export function Hero() { return <section><h1>Hero</h1></section>; }\n" }],
  meta: { slot: "sections.hero", source: { kind: "original", ref: [], license: "MIT" } },
};

interface Case {
  readonly agent: "director" | "writer";
  readonly slot: string;
  readonly file: string;
  readonly bytes: string;
  readonly rung: readonly string[];
  /** The pin target (`#<record>` for a per-record slot) and the decider. */
  readonly pin: { readonly target: string; readonly by: string };
  /** The slot's int2 source, which the header carries. */
  readonly source: unknown;
}

const CASES: readonly Case[] = [
  {
    agent: "director", slot: "focus.segment.core", file: "brief.md", bytes: BRIEF,
    rung: ["--rung", "adopt", "--seed", "finding:fixture-segment-draft"],
    pin: { target: "director/focus.segment.core", by: "planner:fixture-data" },
    source: { kind: "derived", ref: ["finding:fixture-segment-draft"] },
  },
  {
    agent: "writer", slot: "sections.hero.copy", file: "copy.md", bytes: COPY,
    rung: ["--rung", "adopt", "--seed", "sections.hero.copy/copy-v1.md"],
    pin: { target: "writer/sections.hero.copy#copy", by: `owner:queue.pick#${QUEUE_ID}` },
    source: { kind: "derived", ref: ["director:identity.verbal.voice", "director:advantage.proposition.promise", "director:identity.naming.name"] },
  },
];

function world() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "next-submit-header-")));
  roots.push(root);
  cpSync(FIXTURE, root, { recursive: true });
  const consumer = join(root, "clossys");
  const entry = join(consumer, "agents", "producer", "queue.pick", "entries", `${QUEUE_ID}.json`);
  mkdirSync(join(entry, ".."), { recursive: true });
  writeFileSync(entry, JSON.stringify({ id: QUEUE_ID, kind: "queue-entry" }));
  return { root, consumer };
}

const submit = (root: string, c: Case, file: string) => runNextSubmitCli(
  [`${c.agent}/${c.slot}`, "--submit", file, "--model", MODEL, "--tier", "mid", "--basis", "agent", "--skill", skillOf(c.agent), ...c.rung, "--root", root],
  root, undefined, undefined, false,
);

describe("clossys next --submit on a clossys.slot/2 slot writes a clossys.candidate/1 candidate", () => {
  for (const c of CASES) {
    it(`${c.agent}: the header names the submitting agent, skill, model and tier; the gate pins it and the slot/2 reader takes the pin`, async () => {
      const { root, consumer } = world();
      const input = join(root, c.file);
      writeFileSync(input, c.bytes);
      const result = await submit(root, c, input);
      expect(result.message).toMatch(/^next --submit: /);
      expect(result.exitCode).toBe(0);
      const name = (result.output as { candidate: string }).candidate;
      const dir = join(consumer, "agents", c.agent, c.slot);
      const bytes = readFileSync(join(dir, "candidates", name), "utf8");
      const header = candidateHeaderOf(name, bytes);
      expect(header).toMatchObject({
        schema: "clossys.candidate/1", id: `${c.agent}/${c.slot}/${name}`, agent: c.agent, slot: `${c.agent}/${c.slot}`, status: "submitted",
        createdBy: { actor: "agent", agent: c.agent, skill: skillOf(c.agent), skillSha256: stepSkill(stepOf(c.agent)).sha256, model: MODEL, tier: "mid" },
        source: c.source,
      });
      expect(candidateHeaderReadIssues(c.agent, c.slot, name, bytes)).toEqual([]);
      // The view (the document without its header) is the submitted int2 document: the source moved, nothing else.
      expect(candidateView(name, bytes).split("\n---\n")[1]).toBe(c.bytes.split("\n---\n")[1]);
      expect(slotCandidateIssues(consumer, c.agent, c.slot, name, bytes)).toEqual([]);
      // The submit event records the written bytes.
      const ledger = JSON.parse(readFileSync(join(dir, "ledger.json"), "utf8"));
      expect(ledger.events.at(-1)).toMatchObject({ op: "submit", name, sha256: sha(bytes) });
      const pin = await runPinCli([c.pin.target, name, "--by", c.pin.by, "--at", AT, "--root", root], root, false);
      expect(pin.message).toMatch(new RegExp(`pinned ${name.replace(".", "\\.")}`));
      expect(pin.exitCode).toBe(0);
      expect(pinBlocker(consumer, c.agent, c.slot)).toBeUndefined();
    });
  }

  it("designer: a clossys.slot/2 element is written as its int2 JSON, with no clossys.candidate/1 header", async () => {
    const { root, consumer } = world();
    const input = join(root, "hero.json");
    writeFileSync(input, `${JSON.stringify(HERO, null, 2)}\n`);
    const skill = skillOf("designer");
    const result = await runNextSubmitCli(["designer/sections.hero", "--submit", input, "--model", MODEL, "--tier", "mid", "--basis", "agent", "--skill", skill, "--rung", "L1", "--seed", "shadcn-aria/hero", "--root", root], root, undefined, undefined, false);
    expect(result.exitCode).toBe(0);
    const name = (result.output as { candidate: string }).candidate;
    const bytes = readFileSync(join(consumer, "agents", "designer", "sections.hero", "candidates", name), "utf8");
    expect(candidateHeaderOf(name, bytes)).toBeUndefined();
    expect(JSON.parse(bytes)).toEqual(HERO);
  });

  it("director: a submission whose document equals a held candidate's without its header is refused as identical, writing nothing", async () => {
    const { root, consumer } = world();
    const c = CASES[0]!;
    const dir = join(consumer, "agents", c.agent, c.slot);
    // The fixture's pinned core-v1.md is a headered brief; its view is the int2 document that was submitted.
    const held = readFileSync(join(dir, "candidates", "core-v1.md"), "utf8");
    expect(candidateHeaderOf("core-v1.md", held)).toBeDefined();
    const input = join(root, "same.md");
    writeFileSync(input, candidateView("core-v1.md", held));
    const ledger = readFileSync(join(dir, "ledger.json"), "utf8");
    const result = await submit(root, c, input);
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/is byte-identical to director\/focus\.segment\.core candidate core-v1\.md/);
    expect(readFileSync(join(dir, "ledger.json"), "utf8")).toBe(ledger);
  });
});
