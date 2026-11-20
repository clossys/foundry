/**
 * R-NO-HIDDEN-FALLBACKS on the owner and next verbs (cli/owner.ts, cli/next.ts): a broken record fails loudly with its
 * cause, never reads as absent. Each case builds its store through the real verbs on a temp copy of the repository
 * fixture consumer (clossys.slot/2 throughout, made by `clossys migrate recut` and `clossys pin`) or of the legacy-tree
 * consumer, corrupts one file, and asserts the refusal names that file and changes nothing.
 *
 * - `clossys retire --slot`: a pinned slot whose slot.json cannot be read, or whose pin.json does not parse, may take the
 *   target as an input; the dependents guard refuses instead of skipping it.
 * - `clossys retire <candidate>`: a pin.json that does not parse may pin the candidate; refused, never read as no pin.
 * - `clossys ia sync` and `clossys ia <slot>`: an unreadable slot.json is named, never read as "store not recut" or as
 *   a sibling of no kind.
 * - `clossys approve`: a candidates folder that cannot be listed is not "no candidate".
 * - `clossys next --submit`: a held candidate that cannot be read refuses the submission; a root that cannot be
 *   resolved fails with the root error, never as the argv unchanged.
 * - The owner refusals of an unreadable input file carry the read or parse error.
 */
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// Load the CLI first, as every caller does: owner.ts sits in an import cycle with the pipeline handlers.
import { runCli } from "./main.js";
import { STEPS } from "../pipeline/steps/index.js";
import { legacyTreeConsumer } from "./__fixtures__/flat-consumer.js";
import { runNextSubmitCli } from "./next.js";
import { runApproveCli, runEvidenceCli, runIaCli, runOwnerDecisionCli, runRetireCli } from "./owner.js";
import { RootDiscoveryError } from "./root.js";

const FIXTURE = fileURLToPath(new URL("../../test-fixtures/consumer/", import.meta.url));
const AT = "2026-11-20T12:00:00Z";
const MODEL = "fixture-model";
const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); }, 120_000);

function copyOf(from: string, prefix: string): { root: string; consumer: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), `broken-records-${prefix}-`)));
  roots.push(root);
  cpSync(from, root, { recursive: true });
  return { root, consumer: join(root, "clossys") };
}
/** Every file under `dir` with its bytes: a refused verb changes none of them. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (at: string) => { for (const name of readdirSync(at).sort()) { const path = join(at, name); if (statSync(path).isDirectory()) walk(path); else out[path] = readFileSync(path, "utf8"); } };
  walk(dir);
  return out;
}
function json(root: string, name: string, value: unknown): string {
  const path = join(root, name);
  writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value));
  return path;
}
async function verb(root: string, ...argv: string[]) {
  const result = await runCli([...argv, "--root", root], root);
  expect(result.exitCode, `${argv.slice(0, 2).join(" ")}: ${result.message}`).toBe(0);
  return result;
}
/** The truncated JSON a broken write leaves behind. */
const TRUNCATED = "{\"schema\": \"clossys.";

// ---------------------------------------------------------------- a pinned dependent, through the verbs
const DIRECTOR_SKILL = STEPS.find(step => step.id === "director.candidates")!.command.skill!;
const CRAFT = ["--model", MODEL, "--tier", "mid", "--skill", DIRECTOR_SKILL];
const CHANNEL_SLOT = "focus.reach.channel";
const CORE_SLOT = "focus.segment.core";
const CHANNEL = `---
slot: "${CHANNEL_SLOT}"
source: {"kind":"derived","ref":["director:${CORE_SLOT}"]}
feeds: []
functions: []
note: "DRAFT fixture data for the test consumer; not owner research."
---
## Direction
- Primary: DRAFT fixture channel, referrals from current clients
- Secondary: DRAFT fixture channel, local trade directories
- Not: DRAFT fixture boundary, never paid social campaigns

## Because
- The core segment edits its own site alone and hears of tools from peers (director:${CORE_SLOT}).

## Watch
- If fixture referrals fall below 2 in any quarter, then revisit this channel brief.
`;

/**
 * The fixture pins director/focus.segment.core only. The shared world creates and pins director/focus.reach.channel,
 * which takes focus.segment.core as an input, through the verbs with the write guard on: the create verdict, the craft
 * stages, the critique, `clossys next --submit` and `clossys pin`.
 */
let pinnedWorld = "";
beforeAll(async () => {
  const { root } = copyOf(FIXTURE, "pinned-base");
  pinnedWorld = root;
  const target = `director/${CHANNEL_SLOT}`;
  await verb(root, "verdict", target, "--record", json(root, "verdict.json", { schema: "clossys.verdict/1", slot: CHANNEL_SLOT, create: true, reason: "fixture: no held candidate answers the brief", gaps: [{ id: "brief.keys" }] }), "--model", MODEL, "--tier", "high", "--by", "agent:director.verdict", "--at", AT);
  await verb(root, "next", target, "--stage", "brief", ...CRAFT, "--file", json(root, "brief.json", { goal: "fixture" }));
  await verb(root, "next", target, "--stage", "diverge", ...CRAFT, "--file", json(root, "diverge.json", ["plain", "warm", "bold"].map((tone, i) => ({ id: `d${i + 1}`, idea: `a ${tone} take`, axes: { tone } }))));
  await verb(root, "next", target, "--stage", "render", ...CRAFT);
  json(root, "render.png", "fixture render");
  const manifest = [
    { role: "taste", ref: "packages/director/standards/brief.list/taste.md" },
    { role: "contract", ref: `clossys/agents/director/${CHANNEL_SLOT}/slot.json#contract` },
    { role: "render", ref: "render.png" },
  ];
  await verb(root, "critique", target, "--record", json(root, "critique.json", { schema: "clossys.critique/1", slot: CHANNEL_SLOT, candidate: "channel-v1.md", standard: "brief.list", scores: { decisive: 4 }, packet: { manifest } }), "--model", "fixture-critic", "--tier", "mid", "--at", AT);
  const submitted = await runNextSubmitCli([target, "--submit", json(root, "channel.md", CHANNEL), ...CRAFT, "--basis", "agent", "--rung", "create", "--reason", "fixture: the create verdict found no seed that fits", "--root", root], root);
  expect(submitted.exitCode, submitted.message).toBe(0);
  await verb(root, "pin", target, "channel-v1.md", "--by", "planner:broken-records", "--at", AT);
}, 600_000);

const retireSlot = (root: string, slot: string) => runRetireCli([`director/${slot}`, "--slot", "--by", "agent:director", "--reason", "superseded: by a test", "--at", AT, "--root", root], root);

describe("clossys retire --slot: the dependents guard on a broken pinned slot", { timeout: 300_000 }, () => {
  it("refuses while a readable pinned slot takes the target as an input (the guard the broken cases must not pass)", async () => {
    const { root, consumer } = copyOf(pinnedWorld, "pinned");
    const before = snapshot(join(consumer, "agents", "director"));
    const result = await retireSlot(root, CORE_SLOT);
    expect(result).toMatchObject({ exitCode: 1, message: `retire refused: pinned slots take director/${CORE_SLOT} as an input: director/${CHANNEL_SLOT}; repin or change their inputs first` });
    expect(snapshot(join(consumer, "agents", "director"))).toEqual(before);
  });

  it("refuses naming a pinned slot whose slot.json cannot be read, and changes nothing", async () => {
    const { root, consumer } = copyOf(pinnedWorld, "pinned-no-slot");
    rmSync(join(consumer, "agents", "director", CHANNEL_SLOT, "slot.json"));
    const before = snapshot(join(consumer, "agents", "director"));
    const result = await retireSlot(root, CORE_SLOT);
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(new RegExp(`^retire refused: cannot read pinned slot director/${CHANNEL_SLOT.replace(/\./g, "\\.")} to find whether it takes director/${CORE_SLOT.replace(/\./g, "\\.")} as an input: .*ENOENT`));
    expect(snapshot(join(consumer, "agents", "director"))).toEqual(before);
    expect(existsSync(join(consumer, "agents", "director", "_retired", CORE_SLOT))).toBe(false);
  });

  it("counts a slot whose pin.json does not parse as pinned: the dependent is named, never skipped", async () => {
    const { root, consumer } = copyOf(pinnedWorld, "pinned-bad-pin");
    writeFileSync(join(consumer, "agents", "director", CHANNEL_SLOT, "pin.json"), TRUNCATED);
    const before = snapshot(join(consumer, "agents", "director"));
    const result = await retireSlot(root, CORE_SLOT);
    expect(result).toMatchObject({ exitCode: 1, message: expect.stringContaining(`pinned slots take director/${CORE_SLOT} as an input: director/${CHANNEL_SLOT}`) });
    expect(snapshot(join(consumer, "agents", "director"))).toEqual(before);
  });
});

describe("clossys retire <candidate>: a pin.json that does not parse or validate", { timeout: 300_000 }, () => {
  const retireCore = (root: string) => runRetireCli([`director/${CORE_SLOT}`, "core-v1", "--by", "agent:director", "--reason", "superseded: by a test", "--at", AT, "--root", root], root);
  const CORE_PIN = `clossys/agents/director/${CORE_SLOT}/pin.json`.replace(/\./g, "\\.");
  const pinOf = (dir: string) => JSON.parse(readFileSync(join(dir, "pin.json"), "utf8")) as Record<string, unknown>;

  it("refuses retiring the candidate a valid pin names (the guard the broken pins must not pass)", async () => {
    const { root, consumer } = copyOf(FIXTURE, "retire-candidate-healthy");
    const dir = join(consumer, "agents", "director", CORE_SLOT);
    const before = snapshot(dir);
    expect(await retireCore(root)).toMatchObject({ exitCode: 1, message: `retire refused: core-v1.md is the pinned candidate of director/${CORE_SLOT}; repin first (clossys pin director/${CORE_SLOT} <candidate>)` });
    expect(snapshot(dir)).toEqual(before);
  });

  it("refuses on a pin.json that does not parse, naming it and the parse error", async () => {
    const { root, consumer } = copyOf(FIXTURE, "retire-candidate");
    const dir = join(consumer, "agents", "director", CORE_SLOT);
    writeFileSync(join(dir, "pin.json"), TRUNCATED);
    const before = snapshot(dir);
    const result = await retireCore(root);
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(new RegExp(`^retire refused: ${CORE_PIN} cannot be read as JSON \\(.+\\); it may pin core-v1\\.md: repair the pin first$`));
    expect(snapshot(dir)).toEqual(before);
  });

  it("refuses retiring a candidate a later record of a valid pin map names, not only the first record", async () => {
    const { root, consumer } = copyOf(FIXTURE, "retire-candidate-pin-map");
    const dir = join(consumer, "agents", "director", CORE_SLOT);
    // A second held candidate, and a pin map pinning both: record aaa sorts first, so a first-record reading misses core.
    cpSync(join(dir, "candidates", "core-v1.md"), join(dir, "candidates", "aaa-v1.md"));
    const { candidate: _candidate, sha256, decidedBy, basis, at, ...common } = pinOf(dir);
    const record = { sha256, decidedBy, basis, at };
    writeFileSync(join(dir, "pin.json"), JSON.stringify({ ...common, schema: "clossys.pin-map/1", kind: "pin-map", records: { aaa: { candidate: "aaa-v1.md", ...record }, core: { candidate: "core-v1.md", ...record } } }));
    const before = snapshot(dir);
    expect(await retireCore(root)).toMatchObject({ exitCode: 1, message: `retire refused: core-v1.md is the pinned candidate of director/${CORE_SLOT}; repin first (clossys pin director/${CORE_SLOT} <candidate>)` });
    expect(snapshot(dir)).toEqual(before);
  });

  // Each parses but is no pin this store reads: the slot reader views no pin, so the retire must not read it as unpinned.
  for (const [label, broken] of [
    ["null", () => null],
    ["a pin-map shape under the pin/2 schema", (pin: Record<string, unknown>) => ({ ...pin, kind: "pin-map", records: { core: { candidate: "core-v1.md" } } })],
    ["a candidate id without its extension", (pin: Record<string, unknown>) => ({ ...pin, candidate: "core-v1" })],
  ] as const) {
    it(`refuses on a pin.json that parses but does not validate (${label}), naming it and the pin issues`, async () => {
      const { root, consumer } = copyOf(FIXTURE, "retire-candidate-invalid");
      const dir = join(consumer, "agents", "director", CORE_SLOT);
      writeFileSync(join(dir, "pin.json"), JSON.stringify(broken(pinOf(dir))));
      const before = snapshot(dir);
      const result = await retireCore(root);
      expect(result.exitCode).toBe(1);
      expect(result.message).toMatch(new RegExp(`^retire refused: ${CORE_PIN} is not a valid pin \\(.+\\); it may pin core-v1\\.md: repair the pin first$`));
      expect(snapshot(dir)).toEqual(before);
    });
  }
});

// A slot.json that does not parse, and one that parses to null (no slot of either format): each is named with its cause.
const BROKEN_SLOTS = [
  ["does not parse", TRUNCATED, "cannot be read as JSON: "],
  ["parses to null", "null", "is not a JSON object (null)"],
] as const;

describe("clossys ia: an unreadable slot.json in a store-wide scan", { timeout: 300_000 }, () => {
  for (const [label, bytes, cause] of BROKEN_SLOTS) {
    it(`ia sync names a slot.json that ${label} instead of reading the store as not recut`, async () => {
      const { root, consumer } = copyOf(join(legacyTreeConsumer, ".."), "sync-legacy");
      // The healthy legacy store gets the recut hint.
      const healthy = await runIaCli(["sync", "--agent", "writer", "--dry"], root);
      expect(healthy.exitCode).toBe(1);
      expect(healthy.message).toContain("this store is not recut to the current trees: run clossys migrate recut first");
      const director = readdirSync(join(consumer, "agents", "director")).find(name => existsSync(join(consumer, "agents", "director", name, "slot.json")))!;
      writeFileSync(join(consumer, "agents", "director", director, "slot.json"), bytes);
      const before = snapshot(join(consumer, "agents"));
      const result = await runIaCli(["sync", "--agent", "writer", "--dry"], root);
      expect(result.exitCode).toBe(1);
      expect(result.message).toContain(`the store format cannot be judged: clossys/agents/director/${director}/slot.json ${cause}`);
      expect(result.message).not.toContain("this store is not recut");
      expect(snapshot(join(consumer, "agents"))).toEqual(before);
    });

    it(`ia <slot> refuses a new slot whose kind its agent's slots decide while one of their slot.json ${label}`, async () => {
      const { root, consumer } = copyOf(FIXTURE, "placed-kind");
      const contract = json(root, "contract.json", { purpose: "An owner rule beside the package's own.", requirements: [{ check: "text.nonempty" }] });
      // The healthy store: the new slot takes the kind of the Writer slots under its L1 (a dry run writes nothing).
      await verb(root, "ia", "writer/owner.house-rule", "--under", "voice.tone/attitude", "--kind", "strings", "--contract", contract, "--dry");
      // A Writer slot folder the IA does not place (every placed slot.json is read first, by the position follow): its
      // slot.json may hold the L1's kind, so the kind is unknown while it cannot be read.
      mkdirSync(join(consumer, "agents", "writer", "owner.stray"));
      writeFileSync(join(consumer, "agents", "writer", "owner.stray", "slot.json"), bytes);
      const before = snapshot(join(consumer, "agents", "writer"));
      const result = await runIaCli(["writer/owner.house-rule", "--under", "voice.tone/attitude", "--kind", "strings", "--contract", contract, "--root", root], root);
      expect(result.exitCode).toBe(1);
      expect(result.message).toContain(`clossys/agents/writer/owner.stray/slot.json ${cause}`);
      expect(snapshot(join(consumer, "agents", "writer"))).toEqual(before);
    });
  }
});

describe("clossys approve: a candidates folder that cannot be listed", { timeout: 300_000 }, () => {
  // A mode-000 folder is readable by root: the case holds only for an unprivileged run.
  it.skipIf(process.getuid?.() === 0)("refuses with the listing error, not as a slot holding no candidate", async () => {
    const { root, consumer } = copyOf(FIXTURE, "approve");
    const writer = JSON.parse(readFileSync(join(consumer, "agents", "writer", "ia.json"), "utf8")) as { nodes: { children: { slots: string[] }[] }[] };
    const slot = writer.nodes[0]!.children[0]!.slots[0]!;
    const candidates = join(consumer, "agents", "writer", slot, "candidates");
    mkdirSync(candidates, { recursive: true });
    const before = snapshot(consumer);
    chmodSync(candidates, 0o000);
    try {
      const result = await runApproveCli([`writer/${slot}`, "copy-v1", "--by", "owner:queue.approve#20261120T1200Z-approve", "--at", AT, "--root", root], root);
      expect(result.exitCode).toBe(1);
      expect(result.message).toMatch(new RegExp(`^approve refused: cannot list writer/${slot.replace(/\./g, "\\.")} candidates: .*EACCES`));
    } finally { chmodSync(candidates, 0o755); }
    expect(snapshot(consumer)).toEqual(before);
  });
});

describe("clossys next --submit: a broken candidate or root", { timeout: 300_000 }, () => {
  const DESIGNER_SKILL = STEPS.find(step => step.id === "designer.candidates")!.command.skill!;
  const SOURCE = { kind: "original", ref: [], license: "MIT" };
  const hero = (title: string) => ({
    $schema: "https://ui.shadcn.com/schema/registry-item.json", name: "hero", type: "registry:block",
    files: [{ path: "hero.tsx", type: "registry:block", content: `export function Hero() { return <section><h1>${title}</h1></section>; }\n` }],
    meta: { slot: "sections.hero", source: SOURCE },
  });
  // The constitution registry is left empty (`{ rules: [] }`): no fixture Designer slot reaches a valid rung under the
  // full guard (next-submit-probe.test.ts); the identity check under test runs before the guard.
  const submit = (root: string, element: unknown) => runNextSubmitCli(["designer/sections.hero", "--submit", json(root, `hero-${Math.random().toString(36).slice(2, 8)}.json`, `${JSON.stringify(element, null, 2)}\n`),
    "--model", MODEL, "--tier", "mid", "--skill", DESIGNER_SKILL, "--basis", "agent", "--rung", "L1", "--seed", "shadcn-aria/hero", "--root", root], root, undefined, undefined, { rules: [] });

  // A mode-000 file is readable by root: the case holds only for an unprivileged run.
  it.skipIf(process.getuid?.() === 0)("refuses a submission while a held candidate cannot be read, naming it and the cause, and writes nothing", async () => {
    const { root, consumer } = copyOf(FIXTURE, "submit-held");
    const first = await submit(root, hero("Hero"));
    expect(first.exitCode, first.message).toBe(0);
    const name = (first.output as { candidate: string }).candidate;
    const dir = join(consumer, "agents", "designer", "sections.hero");
    const held = join(dir, "candidates", name);
    const before = snapshot(consumer);
    chmodSync(held, 0o000);
    try {
      const again = await submit(root, hero("Other"));
      expect(again.exitCode).toBe(1);
      expect(again.message).toMatch(new RegExp(`^next --submit refused: designer/sections\\.hero candidate ${name.replace(".", "\\.")} cannot be read: .*EACCES`));
    } finally { chmodSync(held, 0o644); }
    expect(snapshot(consumer)).toEqual(before);
  });

  it("a bare next --submit whose root cannot be resolved fails with the root error, not as a slot-less submission", async () => {
    const { root, consumer } = copyOf(FIXTURE, "submit-root");
    rmSync(join(consumer, "clossys.config.ts"));
    const file = json(root, "hero.json", hero("Hero"));
    await expect(runCli(["next", "--submit", file, "--model", MODEL, "--tier", "mid", "--skill", DESIGNER_SKILL, "--basis", "agent", "--root", root], root)).rejects.toThrow(RootDiscoveryError);
  });
});

describe("the owner and next refusals of an unreadable input carry the cause", { timeout: 300_000 }, () => {
  it("owner-decision add on a registry that is not JSON names it and the parse error", async () => {
    const { root, consumer } = copyOf(FIXTURE, "owner-decision");
    rmSync(join(consumer, "owner-decisions.json"), { force: true });
    await verb(root, "owner-decision", "init");
    writeFileSync(join(consumer, "owner-decisions.json"), TRUNCATED);
    const quote = json(root, "quote.txt", "Keep it.");
    const before = snapshot(consumer);
    const result = await runOwnerDecisionCli(["add", "--ref", "example/site#1 issuecomment-1000000001", "--scope", "ia", "--quote-file", quote, "--root", root], root);
    expect(result).toMatchObject({ exitCode: 1, message: expect.stringMatching(/^owner-decision refused: clossys\/owner-decisions\.json is not JSON: .+/) });
    expect(snapshot(consumer)).toEqual(before);
  });

  it("each unreadable input file's refusal names the read error", async () => {
    const { root } = copyOf(FIXTURE, "inputs");
    const missing = join(root, "missing.json");
    for (const [result, prefix] of [
      [await runIaCli(["writer/owner.house-rule", "--under", "voice.tone/attitude", "--kind", "strings", "--contract", missing, "--root", root], root), `ia refused: --contract ${missing} is not a readable JSON file: `],
      [await runEvidenceCli(["fixture-evidence", "--source", "fixture", "--observed", "2026-11-20", "--by", "owner", "--body", missing, "--root", root], root), `evidence refused: cannot read --body ${missing}: `],
      [await runOwnerDecisionCli(["add", "--ref", "example/site#1 issuecomment-1000000001", "--scope", "ia", "--quote-file", missing, "--root", root], root), `owner-decision refused: cannot read --quote-file ${missing}: `],
    ] as const) {
      expect(result.exitCode, result.message).toBe(1);
      expect(result.message.startsWith(prefix), result.message).toBe(true);
      expect(result.message).toContain("ENOENT");
    }
  });

  it("next --stage --file that is not JSON names the parse error", async () => {
    const { root } = copyOf(pinnedWorld, "stage-file");
    // The channel slot's latest verdict is create (P2), so the stage reads --file.
    const result = await runCli(["next", `director/${CHANNEL_SLOT}`, "--stage", "brief", ...CRAFT, "--file", json(root, "bad.json", TRUNCATED), "--root", root], root);
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/^next --stage refused: cannot read .*bad\.json as JSON: .+/);
  });
});
