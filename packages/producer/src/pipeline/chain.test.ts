import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runNextCli } from "../cli/next.js";
import { runRunCli } from "../cli/run.js";
import { explainChain, nextPacket, openPackets, runChain } from "./chain.js";
import type { Exec } from "./chain.js";
import type { Step } from "./define.js";
import { PACKAGE_ROOT } from "./options.js";
import { runPipeline } from "./runner.js";
import { STEPS } from "./steps/index.js";
import { appendRecord, buildRecord, readStore, storeFile } from "./trace.js";

/** The foundry consumer this package ships beside: a real slot model to copy. */
const FOUNDRY = join(PACKAGE_ROOT, "..", "..", "clossys");
const dirs: string[] = [];
/** A scratch copy of the foundry consumer (never the real records), keeping run records. */
function workspace(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "chain-")));
  dirs.push(root);
  cpSync(FOUNDRY, join(root, "clossys"), { recursive: true });
  writeFileSync(join(root, ".gitignore"), "node_modules/\n/.clossys/runs/\n");
  return root;
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
/**
 * The copy with no Producer seat recorded: each seat slot's pin removed, as before the owner's Producer round 1
 * recorded the 18 seats (these cases need the seats step open and a fixture model the seats do not name).
 */
function unseated(root: string): string {
  const producer = join(root, "clossys", "agents", "producer");
  for (const slot of readdirSync(producer)) if (existsSync(join(producer, slot, "pin.json"))) rmSync(join(producer, slot, "pin.json"));
  return root;
}

const real = (id: string): Step => { const step = STEPS.find(each => each.id === id); if (!step) throw new Error(`no step ${id}`); return step; };
/** A plumb step `fx.<name>` that runs `clossys check --<name>` (the exec below serves it). */
const plumb = (name: string): Step => ({ ...real("workspace.check"), id: `fx.${name}`, run: `clossys check --${name}`, chain: undefined } as Step);
const INPUT = "clossys/fixture-input.txt";
const DESIGNER_SKILL = "packages/designer/actions/designer.candidates/skill.md";

/** An exec that records each fixture step as reading INPUT, and fails the steps named in `broken` without a record. */
function fixtureExec(root: string, broken: ReadonlySet<string> = new Set()): Exec & { calls: string[] } {
  const calls: string[] = [];
  const exec = ((argv: readonly string[]) => {
    const name = argv[1]!.slice(2);
    calls.push(name);
    if (broken.has(name)) return 1;
    const absolute = join(root, INPUT);
    const digest = createHash("sha256").update(readFileSync(absolute)).digest("hex");
    appendRecord(root, buildRecord({ root, step: `fx.${name}`, invocation: argv.join(" "), argv: [...argv], start: new Date(), end: new Date(), exit: 0, observation: { reads: new Map([[absolute, digest]]), writes: new Set() } }));
    return 0;
  }) as Exec & { calls: string[] };
  exec.calls = calls;
  return exec;
}

// Each case copies the slot model; next --owner also reads every gap (a second or two), so cases get a minute.
describe("clossys run", { timeout: 60_000 }, () => {
  it("runs each plumb step, skips it while fresh, re-runs it when an input goes stale", () => {
    const root = workspace();
    writeFileSync(join(root, INPUT), "one\n");
    const steps = [plumb("a"), plumb("b")];
    const exec = fixtureExec(root);
    const first = runChain(root, { steps, exec });
    expect(first.rows.map(row => row.state)).toEqual(["ran", "ran"]);
    expect(first.failed).toBeNull();
    const second = runChain(root, { steps, exec });
    expect(second.rows.map(row => row.state)).toEqual(["fresh", "fresh"]);
    expect(exec.calls).toEqual(["a", "b"]);
    // Mutation: make an input stale; the dry walk reports it and the next run re-runs both steps.
    writeFileSync(join(root, INPUT), "two\n");
    const dry = runChain(root, { steps, exec, dry: true });
    expect(dry.rows.map(row => row.state)).toEqual(["would-run", "would-run"]);
    expect(dry.stale.map(entry => entry.step)).toEqual(["fx.a", "fx.b"]);
    expect(dry.stale[0]!.changed).toEqual([INPUT]);
    expect(runChain(root, { steps, exec }).rows.map(row => row.state)).toEqual(["ran", "ran"]);
    expect(exec.calls).toEqual(["a", "b", "a", "b"]);
  });

  it("re-measures for the stale list only the steps a later command could have changed", () => {
    const root = workspace();
    writeFileSync(join(root, INPUT), "one\n");
    const steps = [plumb("a"), plumb("b")];
    const base = fixtureExec(root);
    runChain(root, { steps, exec: base });
    writeFileSync(join(root, INPUT), "two\n");
    // b re-runs and then rewrites the input a read: a is stale again although it ran in this walk.
    const writes = ((argv: readonly string[], cwd: string) => { const exit = base(argv, cwd); if (argv[1] === "--b") writeFileSync(join(root, INPUT), "three\n"); return exit; }) as Exec;
    const result = runChain(root, { steps, exec: writes });
    expect(result.rows.map(row => row.state)).toEqual(["ran", "ran"]);
    expect(result.stale.map(entry => entry.step)).toEqual(["fx.a", "fx.b"]);
  });

  it("stops red at a broken plumb step with a failed run record", () => {
    const root = workspace();
    writeFileSync(join(root, INPUT), "one\n");
    const steps = [plumb("a"), plumb("broken"), plumb("c")];
    const result = runChain(root, { steps, exec: fixtureExec(root, new Set(["broken"])) });
    expect(result.rows.map(row => row.state)).toEqual(["ran", "failed", "not-reached"]);
    expect(result.failed).toMatchObject({ step: "fx.broken", exit: 1 });
    expect(result.failed!.store).toMatch(/fx\.broken\.jsonl:1$/);
    const [record] = readStore(root, storeFile("fx.broken"));
    expect(record!.record.exit).toBe(1);
  });

  it("stops cleanly, never red, at a plumb step whose first input matches no file", () => {
    const root = workspace();
    writeFileSync(join(root, INPUT), "one\n");
    const empty = { ...real("director.store"), inputs: [{ glob: "clossys/agents/nobody/*/pin.json", schema: "pin" }] } as Step;
    const exec = fixtureExec(root);
    const result = runChain(root, { steps: [plumb("a"), empty, plumb("c")], exec });
    expect(result.rows.map(row => row.state)).toEqual(["ran", "open", "not-reached"]);
    expect(result.failed).toBeNull();
    expect(result.stop).toMatchObject({ step: "director.store", decider: "owner", packet: { record: "clossys next --owner --agent director" } });
    expect(exec.calls).toEqual(["a"]);
  });

  it("stops at the first open decide step and prints its packet", async () => {
    const root = unseated(workspace());
    writeFileSync(join(root, INPUT), "one\n");
    const steps = [plumb("a"), real("seats"), plumb("after")];
    const result = runChain(root, { steps, exec: fixtureExec(root), dry: true });
    expect(result.rows.map(row => row.state)).toEqual(["would-run", "open", "not-reached"]);
    expect(result.stop).toMatchObject({ step: "seats" });
    expect(result.stop!.packet.skill.path).toBe("packages/producer/actions/seats/skill.md");
    expect(result.stop!.packet.skill.sha256).toMatch(/^[0-9a-f]{64}$/);
    const cli = await runRunCli(["--dry", "--root", root], root, steps, { exec: fixtureExec(root) });
    expect(cli.exitCode).toBe(0);
    expect(cli.message).toContain("run: stopped at seats");
  });

  it("explains the real graph with counts per kind", () => {
    const explain = explainChain(workspace());
    expect(explain.rows.map(row => row.step)).toEqual(STEPS.map(step => step.id));
    expect(Object.values(explain.counts).reduce((sum, count) => sum + count, 0)).toBe(STEPS.length);
    expect(explain.rows.filter(row => row.kind === "plumb").every(row => row.decider === "code")).toBe(true);
  });
});

describe("clossys next", { timeout: 60_000 }, () => {
  it("lists the open owner packets as multiple choice, recommended first, each answer an exact verb", async () => {
    const root = unseated(workspace());
    const result = await runNextCli(["--owner", "--json", "--root", root], root);
    const output = result.output as { count: number; packets: { step: string; options: { id: string; recommended: boolean; argv: string[] | null }[] }[] };
    expect(output.count).toBeGreaterThan(0);
    expect(output.packets.every(packet => packet.options.length >= 3 && packet.options.length <= 5)).toBe(true);
    for (const packet of output.packets) {
      expect(packet.options[0]!.recommended).toBe(true);
      expect(packet.options.at(-1)).toMatchObject({ id: "other", argv: null });
      for (const option of packet.options.slice(0, -1)) expect(option.argv![0]).toBe("clossys");
    }
    // Dependency order: the packets follow the steps' pipeline order.
    const order = STEPS.map(step => step.id);
    const seen = output.packets.map(packet => order.indexOf(packet.step));
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(output.packets.some(packet => packet.step === "seats")).toBe(true);
  });

  it("refuses a submission that fails its schema and records nothing", async () => {
    const root = unseated(workspace());
    const slot = "assets.favicon";
    const dir = join(root, "clossys", "agents", "designer", slot, "candidates");
    const before = readdirSync(dir);
    const bad = join(root, "bad.json");
    writeFileSync(bad, JSON.stringify({ not: "a candidate" }));
    const result = await runPipeline(["next", `designer/${slot}`, "--submit", bad, "--model", "fixture-model", "--tier", "mid", "--basis", "agent", "--skill", DESIGNER_SKILL, "--rung", "L4", "--reason", "fixture: no stock or partner seed fits", "--root", root], root);
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("fails schema");
    expect(readdirSync(dir)).toEqual(before);
    expect(readStore(root, storeFile("designer.candidates"))).toEqual([]);
  });

  it("refuses a submission whose skill is not the contract's", async () => {
    const root = workspace();
    const slot = "assets.favicon";
    const good = join(root, "clossys", "agents", "designer", slot, "candidates", "favicon-v2.json");
    const result = await runPipeline(["next", `designer/${slot}`, "--submit", good, "--model", "fixture-model", "--tier", "mid", "--basis", "agent", "--skill", "skill/SKILL.md", "--rung", "L4", "--reason", "fixture: no stock or partner seed fits", "--root", root], root);
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("is not designer.candidates's skill");
    expect(readStore(root, storeFile("designer.candidates"))).toEqual([]);
  });

  it("records an accepted submission with its model, tier, basis and skill hash", async () => {
    const root = unseated(workspace());
    const slot = "assets.favicon";
    const dir = join(root, "clossys", "agents", "designer", slot, "candidates");
    const source = join(root, "favicon.json");
    // An adapted seed: favicon-v2 with another corner radius (an unchanged copy is refused below).
    const held = readFileSync(join(dir, "favicon-v2.json"), "utf8");
    expect(held).toContain('rx=\\"21.875\\"');
    writeFileSync(source, held.replace('rx=\\"21.875\\"', 'rx=\\"20\\"'));
    const result = await runPipeline(["next", `designer/${slot}`, "--submit", source, "--model", "fixture-model", "--tier", "mid", "--basis", "agent", "--skill", DESIGNER_SKILL, "--rung", "L3", "--seed", `${slot}/favicon-v2`, "--root", root], root);
    expect(result.exitCode, result.message).toBe(0);
    expect(existsSync(join(dir, "favicon-v3.json"))).toBe(true);
    const [stored] = readStore(root, storeFile("designer.candidates"));
    const skill = readFileSync(join(PACKAGE_ROOT, "..", "designer", "actions", "designer.candidates", "skill.md"));
    expect(stored!.record.decision).toMatchObject({
      model: "fixture-model", tier: "mid", basis: "agent", ladder: { rung: "L3", seed: `${slot}/favicon-v2` },
      skill: { path: DESIGNER_SKILL, sha256: createHash("sha256").update(skill).digest("hex") },
      output: { path: `clossys/agents/designer/${slot}/candidates/favicon-v3.json` },
    });
  });

  it("refuses a byte-identical candidate and a created candidate with no reason no seed fit", async () => {
    const root = unseated(workspace());
    const slot = "assets.favicon";
    const dir = join(root, "clossys", "agents", "designer", slot, "candidates");
    const before = readdirSync(dir);
    const held = join(dir, "favicon-v2.json");
    const submit = (file: string, ...ladder: string[]) => runPipeline(["next", `designer/${slot}`, "--submit", file, "--model", "fixture-model", "--tier", "mid", "--basis", "agent", "--skill", DESIGNER_SKILL, ...ladder, "--root", root], root);
    const copy = await submit(held, "--rung", "L1", "--seed", "shadcn@aria/avatar");
    expect(copy.exitCode).toBe(1);
    expect(copy.message).toContain("is byte-identical to designer/assets.favicon candidate favicon-v2");
    const varied = join(root, "favicon.json");
    writeFileSync(varied, readFileSync(held, "utf8").replace('rx=\\"21.875\\"', 'rx=\\"18\\"'));
    // Mutation proof (create-justification): the same submission without --reason is refused.
    const created = await submit(varied, "--rung", "L4");
    expect(created.exitCode).toBe(1);
    expect(created.message).toContain("create-justification");
    const unladdered = await submit(varied);
    expect(unladdered.message).toContain("missing-ladder");
    const generic = await submit(varied, "--rung", "create", "--reason", "x");
    expect(generic.message).toContain("rung must be one of L1, L2, L3, L4");
    expect(readdirSync(dir)).toEqual(before);
    expect(readStore(root, storeFile("designer.candidates"))).toEqual([]);
    expect((await submit(varied, "--rung", "L4", "--reason", "fixture: no stock or partner mark fits")).exitCode).toBe(0);
  });

  it("records owner answers through the owner verbs, refusing placeholders and unchecked rules", async () => {
    const root = workspace();
    const at = ["--root", root];
    const seat = (...args: string[]) => runPipeline(["seat", "writer.candidates", "--by", "agent:writer", ...args, "--prompt-file", "packages/writer/actions/writer.candidates/skill.md", "--procedure", "Draft candidates", "--command", "clossys next", ...at], root);
    expect((await seat("--model", "<model:mid>", "--tier", "mid")).exitCode).toBe(1);
    expect((await seat("--model", "fixture-model", "--tier", "mid")).exitCode).toBe(0);
    expect(existsSync(join(root, "clossys", "agents", "producer", "writer.candidates", "pin.json"))).toBe(true);
    // The seat now binds submissions: another model is refused.
    const refused = await runPipeline(["next", "writer/strings.statuses", "--submit", join(root, "clossys", "clossys.config.ts"), "--model", "other-model", "--tier", "mid", "--basis", "agent", "--skill", "packages/writer/actions/writer.candidates/skill.md", "--rung", "select", "--seed", "writer/strings.statuses", ...at], root);
    expect(refused.message).toContain("seat assigns fixture-model");
    expect((await runPipeline(["rule", "--init", ...at], root)).exitCode).toBe(0);
    expect((await runPipeline(["rule", "R-W6A-FIXTURE", "--quote", "records change only through verbs", "--date", "2026-11-11", "--status", "enforced", ...at], root)).exitCode).toBe(1);
    expect((await runPipeline(["rule", "R-W6A-FIXTURE", "--quote", "records change only through verbs", "--date", "2026-11-11", "--status", "unenforced", ...at], root)).exitCode).toBe(0);
    expect((await runPipeline(["ia", "designer/assets.favicon", "--remove", ...at], root)).exitCode).toBe(1);
    const approve = (await runNextCli(["--owner", "--json", ...at], root)).output as { packets: { step: string; options: { argv: string[] | null }[] }[] };
    const packet = approve.packets.find(each => each.step === "writer.approve");
    if (packet) {
      const argv = packet.options[0]!.argv!.slice(1);
      expect((await runPipeline([...argv, ...at], root)).exitCode).toBe(0);
      const after = (await runNextCli(["--owner", "--json", ...at], root)).output as { packets: { step: string; item: string }[] };
      expect(after.packets.some(each => each.step === "writer.approve" && each.item === argv[1])).toBe(false);
    }
  });

  it("nextPacket and openPackets agree on the first open step", () => {
    const root = workspace();
    const first = nextPacket(root);
    expect(first).not.toBeNull();
    expect(openPackets(root)[0]).toMatchObject({ step: first!.step, item: first!.item });
  });
});
