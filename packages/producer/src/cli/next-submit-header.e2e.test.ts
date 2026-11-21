/**
 * foundry-build-0048 U37 (fix r1 blind B B2; U37c): `clossys next --submit`, run for real with the constitution write
 * guard on, on a temp copy of `test-fixtures/consumer` (clossys.slot/2 throughout; the fixture stays byte-identical),
 * writes each Markdown agent's candidate as a clossys.candidate/1 file: a Director brief and a Writer copy file. The
 * header is the one the slot/2 readers require (schema, id, agent and slot naming where the file sits, one source,
 * created by the submitting agent's skill, model and tier); the CHOOSE gate (`clossys pin`, guarded too) takes the
 * candidate and the slot/2 reader takes the pin (`pinBlocker`), so a verb-made pin satisfies CASCADE.
 *
 * Every write goes through a verb with the guard on, and every submission climbs a real rung: create after the slot's
 * create verdict and the craft stages (brief, diverge, render, critique; R15.7), or adopt of a candidate the slot
 * held. The fixture is the seeded pinned world (scripts/seed-pinned-world.mjs, made through the verbs and kept
 * byte-current by records/pinned-world.test.ts): it pins Director identity.brand.essence and identity.verbal.voice, and
 * the shared world places writer/page.u37c.meta with `clossys ia`, reading only those two. The Director case is
 * execution.roadmap.release, which the seeded world leaves unpinned and which reads the pinned
 * focus.lifecycle.acquisition. Each slot is first shown to hold no finding of a submit-guarded check, so a refusal here is
 * about the submitted file. The guard reads the candidate through the one candidate reader (records/slot-current.ts
 * readCandidateText): a source.ref the header carries is judged (R07.1, R06.4) as an int2 file's is, and an adopt is
 * verbatim when its content digest (the view and the header without its per-file provenance) equals the seed's, a
 * retired seed's bytes included (R03.2). Under clossys.slot/2 every submit writes a clossys.candidate/1 file, a Designer
 * element included (records/slot-write.ts submittedBytes, the one submit serializer); a Publisher page/1 or
 * publication/1 record is kept as the record it is (records/candidate-codec.ts; init-outputs-slot2.e2e.test.ts pins one).
 * No fixture Designer slot reaches a valid rung under the full guard, so the Designer case here is the guard's refusal
 * of an invalid one (next-submit-probe.test.ts covers the submit's identity probe on a Designer element).
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { guardCheckIds } from "../constitution/guard.js";
import { runConstitution } from "../constitution/run.js";
import { skillOf as stepSkill } from "../pipeline/chain.js";
import { STEPS } from "../pipeline/steps/index.js";
import { candidateHeaderOf, candidateHeaderReadIssues, candidateView } from "../records/slot-current.js";
import { jsonBytes } from "../records/slot-model/index.js";
import { pinBlocker, slotCandidateIssues } from "../records/slots.js";
import { runCli } from "./main.js";
import { runNextSubmitCli } from "./next.js";
import { runRetireCli } from "./owner.js";
import { runPinCli } from "./pin.js";
import { runReissueCli } from "./reissue.js";
import { slotCandidateCell } from "@clossys/director";
import { parseFrontmatter } from "../records/slot-model/index.js";
import { pinnedWriterRows, readWriter } from "../publish/site-source.js";
import { slotDetail } from "../server/slot-detail.js";
import { slotGallery } from "../server/slot-gallery.js";
import { certifyWorld, resultKey } from "../constitution/certify/index.js";
import { buildContext } from "../constitution/context.js";
import { NO_HISTORY } from "../constitution/__fixtures__/workspace.js";

// The temp worlds test the readers, not names: the fixture consumer retired writer/strings.names, so a slot's label is
// its id here, as in server/slot-gallery.test.ts (the pinned-names contract is slot-labels.test.ts).
vi.mock("../records/slot-labels.js", async original => {
  const real = await original<typeof import("../records/slot-labels.js")>();
  return { ...real, slotLabel: (_consumer: string, _agent: string, id: string) => id, slotLabels: () => (_agent: string, id: string) => id, iaLabel: (_consumer: string, _agent: string, id: string) => id };
});

const FIXTURE = fileURLToPath(new URL("../../test-fixtures/consumer/", import.meta.url));
const AT = "2026-11-17T12:00:00Z";
const RETIRE_ID = "20261117T1200Z-retire-meta-v1";
const MODEL = "fixture-model";
const PLANNER = "planner:next-submit-header";
const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); }, 120_000);

const stepOf = (agent: string) => STEPS.find(step => step.id === `${agent}.candidates`)!;
const skillOf = (agent: string) => stepOf(agent).command.skill!;
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const CRAFT = (agent: string) => ["--model", MODEL, "--tier", "mid", "--skill", skillOf(agent)];

/** A Director brief (Direction, Because, Watch) with the given keys, derived from `ref`. */
const brief = (slot: string, ref: string, keys: readonly (readonly [string, string])[], because: string, watch: string) => `---
slot: "${slot}"
source: {"kind":"derived","ref":["${ref}"]}
feeds: []
functions: []
note: "DRAFT fixture data for the test consumer; not owner research."
---
## Direction
${keys.map(([key, value]) => `- ${key}: ${value}`).join("\n")}

## Because
- ${because} (${ref}).

## Watch
- ${watch}
`;

const RELEASE = brief("execution.roadmap.release", "director:focus.lifecycle.acquisition",
  [["Release", "DRAFT fixture release, the first public site"], ["Target date", "DRAFT fixture date, 2026-12-01"], ["Scope", "DRAFT fixture scope, the home page and the contact page"], ["Not in scope", "DRAFT fixture boundary, the pricing page waits"]],
  "The acquisition brief starts with referrals, so the first release ships the pages a referral lands on", "If fixture referral visits fall below 20 in any month, then revisit this release brief.");

/** The Writer slot the shared world places (`clossys ia`): it reads only the two Director slots the world pins. */
const META = "page.u37c.meta";
const COPY_SOURCE = { kind: "derived", ref: ["director:identity.verbal.voice", "director:identity.brand.essence"] };
const section = (locale: string, title: string) => `
## ${locale}
### title
<!-- {"id":"title","bindings":[]} -->
${title}
### description
<!-- {"id":"description","bindings":[]} -->
Publish changes in minutes between client jobs.
`;
/** The Writer copy; `locales` adds a section per extra locale (the reader requires one per locale, in order). */
const copy = (opts: { source?: unknown; locales?: readonly string[]; title?: string } = {}) => `---
slot: "${META}"
locales: ${JSON.stringify(opts.locales ?? ["en"])}
reason: "realises director:identity.verbal.voice for the deck metadata"
source: ${JSON.stringify(opts.source ?? COPY_SOURCE)}
---
${(opts.locales ?? ["en"]).map(locale => section(locale, opts.title ?? "Your site, handled")).join("")}`;
const COPY = copy();

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
  readonly bytes: string;
  /** The create verdict's gap (a requirement check of the slot's standard) and the critique's standard and taste id. */
  readonly gap: string;
  readonly standard: string;
  readonly taste: string;
  /** The candidate the create writes (the critique names it before the submit). */
  readonly name: string;
  /** The slot's int2 source, which the header carries. */
  readonly source: unknown;
  /** The pin target: `#meta` names the record (the candidate stem) a Writer copy slot pins per record. */
  readonly pin?: string;
}
const pinTarget = (c: Case) => `${c.agent}/${c.slot}${c.pin ?? ""}`;

const CASES: readonly Case[] = [
  {
    agent: "director", slot: "execution.roadmap.release", bytes: RELEASE, gap: "brief.keys", standard: "brief.list", taste: "decisive", name: "release-v1.md",
    source: { kind: "derived", ref: ["director:focus.lifecycle.acquisition"] },
  },
  { agent: "writer", slot: META, bytes: COPY, gap: "copy.entries", standard: "string", taste: "voice-fit", name: "meta-v1.md", source: COPY_SOURCE, pin: "#meta" },
];
const WRITER = CASES[1]!;

const dirOf = (consumer: string, c: Pick<Case, "agent" | "slot">) => join(consumer, "agents", c.agent, c.slot);
const filesOf = (dir: string) => existsSync(dir) ? readdirSync(dir).sort() : [];
const ledgerOf = (dir: string) => existsSync(join(dir, "ledger.json")) ? readFileSync(join(dir, "ledger.json"), "utf8") : null;

async function verb(root: string, ...argv: string[]) {
  const result = await runCli([...argv, "--root", root], root);
  expect(result.exitCode, `${argv.slice(0, 2).join(" ")}: ${result.message}`).toBe(0);
  return result;
}
function json(root: string, name: string, value: unknown) {
  const path = join(root, name);
  writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value));
  return path;
}

/** The axes of the recipe the open run's brief assembled (the recipe code chooses for the slot's standard). */
function briefAxes(dir: string): string[] {
  const events = (JSON.parse(readFileSync(join(dir, "ledger.json"), "utf8")) as { events: { op: string; assembled?: { recipe?: { axes?: string[] } } }[] }).events;
  return events.filter(event => event.op === "craft:brief").at(-1)?.assembled?.recipe?.axes ?? [];
}

/** P1 then the P2 craft path through the verbs: the create verdict, brief, diverge, render and a critique of `c.name`. */
async function craft(root: string, c: Case) {
  const target = `${c.agent}/${c.slot}`;
  await verb(root, "verdict", target, "--record", json(root, `verdict-${c.slot}.json`, { schema: "clossys.verdict/1", slot: c.slot, create: true, reason: "fixture: no held candidate answers the brief", gaps: [{ id: c.gap }] }), "--model", MODEL, "--tier", "high", "--by", `agent:${c.agent}.verdict`, "--at", AT);
  await verb(root, "next", target, "--stage", "brief", ...CRAFT(c.agent), "--file", json(root, `brief-${c.slot}.json`, { goal: "fixture" }));
  // Code chose the run's recipe at brief (its assembled recipe): every direction takes a distinct value on each of its axes.
  const axes = briefAxes(join(root, "clossys", "agents", c.agent, c.slot));
  await verb(root, "next", target, "--stage", "diverge", ...CRAFT(c.agent), "--file", json(root, `diverge-${c.slot}.json`, ["plain", "warm", "bold"].map((tone, i) => ({ id: `d${i + 1}`, idea: `a ${tone} take`, axes: { tone, ...Object.fromEntries(axes.map(axis => [axis, `${axis}-${tone}`])) } }))));
  await verb(root, "next", target, "--stage", "render", ...CRAFT(c.agent));
  json(root, `render-${c.slot}.png`, "fixture render");
  const manifest = [
    { role: "taste", ref: `packages/${c.agent}/standards/${c.standard}/taste.md` },
    { role: "contract", ref: `clossys/agents/${c.agent}/${c.slot}/slot.json#contract` },
    { role: "render", ref: `render-${c.slot}.png` },
  ];
  await verb(root, "critique", target, "--record", json(root, `critique-${c.slot}.json`, { schema: "clossys.critique/1", slot: c.slot, candidate: c.name, standard: c.standard, scores: { [c.taste]: 4 }, packet: { manifest } }), "--model", "fixture-critic", "--tier", "mid", "--at", AT);
}

const CREATE = ["--rung", "create", "--reason", "fixture: the create verdict found no seed that fits"];
const submit = (root: string, c: Pick<Case, "agent" | "slot">, file: string, rung: readonly string[] = CREATE) => runNextSubmitCli(
  [`${c.agent}/${c.slot}`, "--submit", file, ...CRAFT(c.agent), "--basis", "agent", ...rung, "--root", root],
  root,
);
async function submitBytes(root: string, c: Pick<Case, "agent" | "slot">, bytes: string, rung: readonly string[] = CREATE) {
  const input = join(root, `submitted-${sha(bytes).slice(0, 8)}.md`);
  writeFileSync(input, bytes);
  return submit(root, c, input, rung);
}
/** The full guarded create of `c` (craft, then submit), then the guarded pin. */
async function createAndPin(root: string, c: Case) {
  await craft(root, c);
  const result = await submitBytes(root, c, c.bytes);
  expect(result.exitCode, result.message).toBe(0);
  expect((result.output as { candidate: string }).candidate).toBe(c.name);
  await verb(root, "pin", pinTarget(c), c.name, "--by", PLANNER, "--at", AT);
}

/**
 * The shared Writer chain, built once through the verbs with the guard on: Director essence and voice created and
 * pinned, and writer/page.u37c.meta placed by `clossys ia` (the page.deck.meta copy contract as a string of at most 160 characters, its unit binding left
 * out, reading voice and essence). Each test copies it.
 */
let base = "";
beforeAll(async () => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "next-submit-header-base-")));
  roots.push(base);
  cpSync(FIXTURE, base, { recursive: true });
  // The workspace root lockfile `clossys reissue` reads for exact dependencies (a Writer candidate declares none).
  writeFileSync(join(base, "package-lock.json"), jsonBytes({ name: "fixture", lockfileVersion: 3, packages: { "": { name: "fixture" } } }));
  // The seeded world pins the two Director slots the Writer slot reads, and leaves the Director case unpinned.
  for (const slot of ["identity.brand.essence", "identity.verbal.voice"]) expect(existsSync(join(base, "clossys/agents/director", slot, "pin.json")), `the seeded fixture pins director/${slot}`).toBe(true);
  expect(existsSync(join(base, "clossys/agents/director", CASES[0]!.slot, "pin.json")), `the seeded fixture leaves director/${CASES[0]!.slot} unpinned`).toBe(false);
  const deck = JSON.parse(readFileSync(join(base, "clossys/agents/writer/page.deck.meta/slot.json"), "utf8")) as { contract: Record<string, unknown> };
  const { unit: _unit, records: _records, ...contract } = deck.contract;
  await verb(base, "ia", `writer/${META}`, "--under", "copy.page-metadata/slides", "--kind", "strings", "--standard", "string",
    "--contract", json(base, "meta-contract.json", { kind: "string", maxChars: 160, ...contract }), "--inputs", "identity.verbal.voice,identity.brand.essence", "--at", AT);
}, 600_000);

function world() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "next-submit-header-")));
  roots.push(root);
  cpSync(base, root, { recursive: true });
  return { root, consumer: join(root, "clossys") };
}

/** The slot holds no finding of a check the submit guard runs: a refusal below is about the submitted file. */
function expectNoSubmitFindings(root: string, consumer: string, c: Pick<Case, "agent" | "slot">) {
  const guarded = new Set(guardCheckIds("submit"));
  const rows = runConstitution({ root, consumer, focus: [{ agent: c.agent, slot: c.slot }] }).rows.filter(row => guarded.has(row.check));
  expect(rows.map(row => `${row.check} ${row.reason}`)).toEqual([]);
}

/** A guarded submit refused: the refusal names `check`, and the slot's candidates and ledger are as they were. */
async function expectRefused(root: string, consumer: string, c: Pick<Case, "agent" | "slot">, bytes: string, check: string, rung: readonly string[] = CREATE) {
  const dir = dirOf(consumer, c);
  const before = { candidates: filesOf(join(dir, "candidates")), ledger: ledgerOf(dir) };
  const result = await submitBytes(root, c, bytes, rung);
  expect(result.exitCode, result.message).toBe(1);
  const output = result.output as { schema: string; checks: string[]; findings: string[] } | undefined;
  expect(output?.schema, result.message).toBe("clossys.next-submit-refused/1");
  if (!output) throw new Error(result.message);
  expect(output.checks).toContain(check);
  expect(output.findings.some(finding => finding.startsWith(`${check} `))).toBe(true);
  expect({ candidates: filesOf(join(dir, "candidates")), ledger: ledgerOf(dir) }).toEqual(before);
  return output;
}

describe("clossys next --submit on a clossys.slot/2 slot writes a clossys.candidate/1 candidate (guard on)", () => {
  for (const c of CASES) {
    it(`${c.agent}: the header names the submitting agent, skill, model and tier; the gate pins it and the slot/2 reader takes the pin`, async () => {
      const { root, consumer } = world();
      expectNoSubmitFindings(root, consumer, c);
      await craft(root, c);
      const input = join(root, `${c.slot}.md`);
      writeFileSync(input, c.bytes);
      const result = await submit(root, c, input);
      expect(result.message).toMatch(/^next --submit: /);
      expect(result.exitCode).toBe(0);
      const name = (result.output as { candidate: string }).candidate;
      expect(name).toBe(c.name);
      const dir = dirOf(consumer, c);
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
      // The submit event records the written bytes and the create rung.
      const ledger = JSON.parse(readFileSync(join(dir, "ledger.json"), "utf8"));
      expect(ledger.events.at(-1)).toMatchObject({ op: "submit", name, sha256: sha(bytes), rung: "create" });
      const pin = await runPinCli([pinTarget(c), name, "--by", PLANNER, "--at", AT, "--root", root], root);
      expect(pin.message).toMatch(new RegExp(`pinned ${name.replace(".", "\\.")}`));
      expect(pin.exitCode).toBe(0);
      expect(pinBlocker(consumer, c.agent, c.slot)).toBeUndefined();
    }, 300_000);
  }

  // No fixture Designer slot reaches a valid rung under the full guard (each reads at least five unpinned inputs, and an
  // L1 adopt needs a vendored registry item the fixture does not hold), so the element is shown refused, not written.
  it("designer: an L1 adopt of an original element is refused by the guard (R03.2, ref-verbatim), writing nothing", async () => {
    const { root, consumer } = world();
    const dir = join(consumer, "agents", "designer", "sections.hero");
    const before = { candidates: filesOf(join(dir, "candidates")), ledger: ledgerOf(dir) };
    const input = join(root, "hero.json");
    writeFileSync(input, `${JSON.stringify(HERO, null, 2)}\n`);
    const result = await runNextSubmitCli(["designer/sections.hero", "--submit", input, ...CRAFT("designer"), "--basis", "agent", "--rung", "L1", "--seed", "shadcn-aria/hero", "--root", root], root);
    expect(result.exitCode, result.message).toBe(1);
    const output = result.output as { schema: string; checks: string[]; findings: string[] };
    expect(output.schema).toBe("clossys.next-submit-refused/1");
    expect(output.checks).toEqual(expect.arrayContaining(["R03.2", "ref-verbatim"]));
    expect(output.findings.find(finding => finding.startsWith("R03.2 "))).toMatch(/meta\.source\.kind is not registry/);
    expect({ candidates: filesOf(join(dir, "candidates")), ledger: ledgerOf(dir) }).toEqual(before);
  }, 300_000);

  it("director: a submission whose document equals a held candidate's without its header is refused as the same content, writing nothing", async () => {
    const { root, consumer } = world();
    const dir = join(consumer, "agents", "director", "focus.segment.core");
    // The fixture's pinned core-v1.md is a headered brief; its view is the int2 document that was submitted.
    const held = readFileSync(join(dir, "candidates", "core-v1.md"), "utf8");
    expect(candidateHeaderOf("core-v1.md", held)).toBeDefined();
    const input = join(root, "same.md");
    writeFileSync(input, candidateView("core-v1.md", held));
    const ledger = readFileSync(join(dir, "ledger.json"), "utf8");
    const result = await runNextSubmitCli(["director/focus.segment.core", "--submit", input, ...CRAFT("director"), "--basis", "agent", ...CREATE, "--root", root], root);
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/has the same content as director\/focus\.segment\.core candidate core-v1\.md \(it differs only in header provenance or JSON layout\)/);
    expect(readFileSync(join(dir, "ledger.json"), "utf8")).toBe(ledger);
  }, 300_000);
});

describe("the submit guard judges the source a clossys.candidate/1 header carries (T1)", () => {
  it("refuses a Writer copy whose source.ref names a Director slot the slot does not declare (R07.1), writing nothing", async () => {
    const { root, consumer } = world();
    expectNoSubmitFindings(root, consumer, WRITER);
    await craft(root, WRITER);
    const output = await expectRefused(root, consumer, WRITER, copy({ source: { kind: "derived", ref: [...COPY_SOURCE.ref, "director:aspiration.purpose.mission"] } }), "R07.1");
    expect(output.findings.find(finding => finding.startsWith("R07.1 "))).toMatch(/aspiration\.purpose\.mission/);
  }, 300_000);

  it("refuses a Writer copy whose source.ref names a candidate file (R06.4), writing nothing", async () => {
    const { root, consumer } = world();
    expectNoSubmitFindings(root, consumer, WRITER);
    await craft(root, WRITER);
    const output = await expectRefused(root, consumer, WRITER, copy({ source: { kind: "derived", ref: [...COPY_SOURCE.ref, "focus.segment.core/core-v1.md"] } }), "R06.4");
    expect(output.findings.find(finding => finding.startsWith("R06.4 "))).toMatch(/focus\.segment\.core\/core-v1\.md/);
  }, 300_000);
});

describe("an adopt of a retired headered candidate is verbatim by content digest (T3)", () => {
  /** A headered v1 through create, retired through `clossys retire` on the owner's answer; returns its name and raw sha. */
  async function retiredV1() {
    const { root, consumer } = world();
    expectNoSubmitFindings(root, consumer, WRITER);
    await craft(root, WRITER);
    const v1 = await submitBytes(root, WRITER, COPY);
    expect(v1.exitCode, v1.message).toBe(0);
    const name = (v1.output as { candidate: string }).candidate;
    const dir = dirOf(consumer, WRITER);
    const bytes = readFileSync(join(dir, "candidates", name), "utf8");
    expect(candidateHeaderOf(name, bytes)).toBeDefined();
    const approvals = join(consumer, "agents", "producer", "queue.approve", "entries");
    mkdirSync(approvals, { recursive: true });
    const raised = { at: AT, op: "raised", by: "code:clossys test" };
    const answered = { at: AT, op: "answered", by: "owner", via: "chat", answer: "retire", quote: "retire it" };
    writeFileSync(join(approvals, `${RETIRE_ID}.json`), jsonBytes({
      schema: "clossys.queue-entry/1", id: RETIRE_ID, agent: "producer", kind: "queue-entry", status: "answered", createdBy: { actor: "code", cli: "clossys test", version: "0.0.0" },
      createdAt: AT, refs: [], queue: "queue.approve", ask: "Retire it?", subject: { to: `writer/${WRITER.slot}`, rel: "input" }, decider: "owner",
      options: [{ id: "retire", summary: "retire", candidate: name }, { id: "keep", summary: "keep it" }], default: null, events: [raised, answered],
    }));
    const retired = await runRetireCli([`writer/${WRITER.slot}`, name, "--by", `owner:queue.approve#${RETIRE_ID}`, "--reason", "superseded: by the adopt", "--at", AT, "--root", root], root);
    expect(retired.exitCode, retired.message).toBe(0);
    expect(existsSync(join(dir, "candidates", name))).toBe(false);
    expect(readFileSync(join(dir, "retired", name), "utf8")).toBe(bytes);
    return { root, consumer, dir, name, sha256: sha(bytes) };
  }
  const adopt = (seed: string) => ["--rung", "adopt", "--seed", seed];

  it("takes the same content adopted from the retired seed with its recorded @sha: exit 0, no R03.2 row", async () => {
    const { root, consumer, dir, name, sha256 } = await retiredV1();
    const result = await submitBytes(root, WRITER, COPY, adopt(`${WRITER.slot}/${name}@${sha256}`));
    expect(result.message).toMatch(/^next --submit: /);
    expect(result.exitCode).toBe(0);
    const adopted = (result.output as { candidate: string }).candidate;
    const bytes = readFileSync(join(dir, "candidates", adopted), "utf8");
    // A new file with its own header provenance (id, createdAt): the raw bytes differ, the content does not.
    expect(sha(bytes)).not.toBe(sha256);
    const rows = runConstitution({ root, consumer, rule: "R03", focus: [{ agent: "writer", slot: WRITER.slot, candidate: adopted }] }).rows;
    expect(rows.filter(row => row.check === "R03.2")).toEqual([]);
  }, 300_000);

  it("refuses an adopt from the retired seed whose content differs by one body byte, one locales value or the source.ref, or names a wrong @sha (R03.2)", async () => {
    const { root, consumer, name, sha256 } = await retiredV1();
    const seed = adopt(`${WRITER.slot}/${name}@${sha256}`);
    await expectRefused(root, consumer, WRITER, copy({ title: "Your site, handled!" }), "R03.2", seed);
    await expectRefused(root, consumer, WRITER, copy({ locales: ["en", "fr"] }), "R03.2", seed);
    await expectRefused(root, consumer, WRITER, copy({ source: { kind: "derived", ref: ["director:identity.verbal.voice"] } }), "R03.2", seed);
    await expectRefused(root, consumer, WRITER, COPY, "R03.2", adopt(`${WRITER.slot}/${name}@${"0".repeat(64)}`));
  }, 300_000);

  // A pinned clossys.slot/2 candidate is repinned only through the CHOOSE gate, so the verb reissues the submitted,
  // unpinned headered candidate, and refuses the pinned one unchanged (refuseTargetPin, untouched here).
  it("reissues a headered Writer candidate through the verb: the new file is headered and adopts the old one verbatim", async () => {
    const { root, consumer } = world();
    expectNoSubmitFindings(root, consumer, WRITER);
    await craft(root, WRITER);
    const v1 = await submitBytes(root, WRITER, WRITER.bytes);
    expect(v1.exitCode, v1.message).toBe(0);
    const name = (v1.output as { candidate: string }).candidate;
    expect(name).toBe(WRITER.name);
    const result = await runReissueCli([`writer/${WRITER.slot}`, name, "--by", "agent:writer.reissue", "--at", AT, "--root", root], root);
    expect(result.message).toMatch(/^reissue: /);
    expect(result.exitCode).toBe(0);
    const next = (result.decision as { candidate: string }).candidate;
    const bytes = readFileSync(join(dirOf(consumer, WRITER), "candidates", next), "utf8");
    expect(candidateHeaderOf(next, bytes)).toMatchObject({ schema: "clossys.candidate/1", id: `writer/${WRITER.slot}/${next}`, createdBy: { actor: "code", cli: "clossys reissue" }, source: COPY_SOURCE });
    expect(candidateHeaderReadIssues("writer", WRITER.slot, next, bytes)).toEqual([]);
    const rows = runConstitution({ root, consumer, rule: "R03", focus: [{ agent: "writer", slot: WRITER.slot, candidate: next }] }).rows;
    expect(rows.filter(row => row.check === "R03.2")).toEqual([]);
  }, 300_000);

  it("refuses to reissue a pinned headered Writer candidate under slot/2 and writes nothing", async () => {
    const { root, consumer } = world();
    await createAndPin(root, WRITER);
    const dir = dirOf(consumer, WRITER);
    const state = () => ({ candidates: filesOf(join(dir, "candidates")), retired: existsSync(join(dir, "retired")), ledger: ledgerOf(dir), pin: readFileSync(join(dir, "pin.json"), "utf8") });
    const before = state();
    const result = await runReissueCli([`writer/${WRITER.slot}`, WRITER.name, "--by", "agent:writer.reissue", "--at", AT, "--root", root], root);
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/pinned only through the CHOOSE gate/);
    expect(state()).toEqual(before);
  }, 300_000);
});

describe("the candidate readers read a verb-made headered pin through its view (T4)", () => {
  it("site-source, slot detail and the gallery read the pinned headered Writer candidate", async () => {
    const { root, consumer } = world();
    await createAndPin(root, WRITER);
    const bytes = readFileSync(join(dirOf(consumer, WRITER), "candidates", WRITER.name), "utf8");
    expect(candidateHeaderOf(WRITER.name, bytes)).toMatchObject({ schema: "clossys.candidate/1", source: COPY_SOURCE });

    const { rows, locales } = await pinnedWriterRows(consumer);
    expect(locales).toContain("en");
    expect(rows).toContainEqual(expect.objectContaining({ locale: "en", record: expect.objectContaining({ text: "Your site, handled" }) }));
    const writer = await readWriter(root);
    expect(writer.native?.rows).toEqual(rows);

    const detail = slotDetail(root, "writer", META);
    const shown = detail?.candidates.find(candidate => candidate.name === WRITER.name);
    expect(shown).toMatchObject({ source: COPY_SOURCE, issues: [] });

    const card = slotGallery(consumer, "writer").sections.flatMap(section => section.cards).find(candidate => candidate.id === META);
    expect(card).toMatchObject({ candidate: WRITER.name, state: { state: "pinned" } });
    expect(card!.status).not.toBe("failing");
  }, 300_000);

  it("the Director cell reader cites the headered core-v1.md source as candidateView reads it", () => {
    const path = join(FIXTURE, "clossys/agents/director/focus.segment.core/candidates/core-v1.md");
    const bytes = readFileSync(path, "utf8");
    expect(candidateHeaderOf("core-v1.md", bytes)).toBeDefined();
    const view = parseFrontmatter(candidateView("core-v1.md", bytes));
    expect(view.ok).toBe(true);
    const viewRefs = ((view as { value: { fields: { source: { ref: string[] } } } }).value.fields.source.ref);
    expect(viewRefs).toContain("finding:fixture-segment-draft");
    const cell = slotCandidateCell({ id: "focus.segment.core", version: 1, updated: "2026-11-17", path, bytes });
    expect(cell.cites).toContainEqual({ kind: "finding", id: "fixture-segment-draft" });
    const findings = viewRefs.filter(ref => ref.startsWith("finding:")).map(ref => ({ kind: "finding", id: ref.slice("finding:".length) }));
    expect(cell.cites.filter(ref => ref.kind === "finding")).toEqual(findings);
  });
});

describe("the certify cache keys on the bytes as written (T5)", () => {
  it("judges a header-only edit (a wrong id) of a certified headered candidate again and refuses it", () => {
    const { root, consumer } = world();
    const cache = join(root, "certify-cache.json");
    const key = resultKey("director", "identity.brand.essence", "essence-v1.md");
    const certified = (world: ReturnType<typeof certifyWorld>) => world.results.get(key)!.certification;
    const cold = certifyWorld(buildContext(root, consumer, { history: () => NO_HISTORY }), { cache });
    expect(certified(cold)).toMatchObject({ certified: true });
    expect(certifyWorld(buildContext(root, consumer, { history: () => NO_HISTORY }), { cache }).misses).toBe(0);

    const path = join(consumer, "agents/director/identity.brand.essence/candidates/essence-v1.md");
    const bytes = readFileSync(path, "utf8");
    const edited = bytes.replace('"id":"director/identity.brand.essence/essence-v1.md"', '"id":"director/identity.brand.essence/essence-v9.md"');
    expect(edited).not.toBe(bytes);
    expect(candidateView("essence-v1.md", edited)).toBe(candidateView("essence-v1.md", bytes));
    writeFileSync(path, edited);
    const warm = certifyWorld(buildContext(root, consumer, { history: () => NO_HISTORY }), { cache });
    expect(warm.misses).toBeGreaterThan(0);
    expect(certified(warm).certified).toBe(false);
    expect(certified(warm).reasons.map(reason => JSON.stringify(reason)).join("\n")).toMatch(/clossys header/);
  }, 300_000);
});
