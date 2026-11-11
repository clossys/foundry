import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runPipelineCli, uncitedStatusFields } from "../cli/pipeline.js";
import { runPipeline } from "./runner.js";
import { PACKAGE_ROOT } from "./options.js";
import { pipelineStatus } from "./status.js";
import { appendRecord, buildRecord, invocationOf, observe, readRuns, RUN_SCHEMA, sanitizeArgv, storeFile } from "./trace.js";
import type { RunRecord } from "./trace.js";
import { buildWiring, readStepGraph, RUN_STATES, wiringCitationIssues } from "./wiring.js";
import type { PipelineWiring, WiringNode } from "./wiring.js";

const dirs: string[] = [];
/** A workspace with one designer slot holding two candidates, one pinned. */
function workspace(): string {
  // Slot-model reads refuse symlinked ancestors (the macOS tmpdir is one), so use the real path.
  const root = realpathSync(mkdtempSync(join(tmpdir(), "wiring-")));
  dirs.push(root);
  const slot = join(root, "clossys", "agents", "designer", "hero");
  mkdirSync(join(slot, "candidates"), { recursive: true });
  writeFileSync(join(root, "clossys", "clossys.config.ts"), "export default {}\n");
  writeFileSync(join(slot, "slot.json"), "{}\n");
  for (const name of ["a.json", "b.json"]) writeFileSync(join(slot, "candidates", name), "{}\n");
  writeFileSync(join(slot, "pin.json"), JSON.stringify({ candidate: "a.json" }));
  return root;
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const node = (wiring: PipelineWiring, id: string): WiringNode | undefined => wiring.nodes.find(each => each.id === id);
const CANDIDATES = "clossys/agents/designer/hero/candidates/";

describe("run trace", () => {
  it("records every step run: what it read and wrote, with hashes, and how it exited", async () => {
    const root = workspace();
    const result = await runPipeline(["pipeline", "status", "--root", root], root);
    expect(result.exitCode).toBe(0);
    const runs = readRuns(root);
    expect(runs).toHaveLength(1);
    const { record, store, line } = runs[0]!;
    expect([store, line]).toEqual([storeFile("pipeline"), 1]);
    // The field list the step standard's `record` field names (W0s), in this order.
    expect(Object.keys(record)).toEqual(["schema", "run", "step", "invocation", "argv", "start", "end", "exit", "head", "tool", "inputs", "reads", "writes"]);
    expect(record).toMatchObject({ schema: RUN_SCHEMA, step: "pipeline", invocation: "pipeline status", argv: ["pipeline", "status", "--root", "."], exit: 0 });
    expect(record.reads.find(entry => entry.path === CANDIDATES)?.sha256).toMatch(/^[0-9a-f]{64}$/);
    // Git-friendly and portable: no absolute or home paths anywhere in the record.
    const text = readFileSync(join(root, store), "utf8");
    expect(text).not.toContain(root);
    expect(text).not.toContain(homedir());
  });

  it("keeps argv portable and secret-free", () => {
    const root = workspace();
    expect(sanitizeArgv(root, ["pin", "--root", root, `--out=${join(root, "x.json")}`, "--token", "abc", "--api-key=xyz", join(homedir(), "notes")], root))
      .toEqual(["pin", "--root", ".", "--out=x.json", "--token", "--api-key=<redacted>", "~/notes"]);
    expect(sanitizeArgv(root, ["/elsewhere/file"], root)).toEqual(["<outside>"]);
    expect(invocationOf(["design", "--check", "--json", "--root", "x"])).toBe("design --check");
    expect(invocationOf(["pin", "designer/hero", "a.json", "--by", "owner:me"], "designer")).toBe("pin designer");
  });

  it("observes reads and writes made through ESM named imports and fs.promises", async () => {
    const root = workspace();
    const watch = observe();
    readFileSync(join(root, "clossys", "agents", "designer", "hero", "slot.json"));
    writeFileSync(join(root, "out.txt"), "x");
    const { readFile } = await import("node:fs/promises");
    await readFile(join(root, "clossys", "clossys.config.ts"));
    const seen = watch.stop();
    const record = buildRecord({ root, step: "probe", invocation: "probe", argv: [], start: new Date(0), end: new Date(1), exit: 0, observation: seen });
    expect(record.reads.map(entry => entry.path)).toEqual(expect.arrayContaining(["clossys/agents/designer/hero/slot.json", "clossys/clossys.config.ts"]));
    expect(record.writes).toEqual([{ path: "out.txt", sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }]);
    // Deterministic: the same run gives the same record id.
    expect(buildRecord({ root, step: "probe", invocation: "probe", argv: [], start: new Date(0), end: new Date(1), exit: 0, observation: seen }).run).toBe(record.run);
  });
});

describe("wiring from run records (mutation proofs)", () => {
  it("shows a declared step with no record as never run, never ready", () => {
    const root = workspace();
    const wiring = buildWiring(root);
    expect(wiring.nodes.length).toBeGreaterThan(0);
    expect(wiring.nodes.every(each => each.state === "never-run" && each.citation === null)).toBe(true);
    expect(wiring.edges).toEqual([]);
    expect(wiring.nodes.every(each => (RUN_STATES as readonly string[]).includes(each.state))).toBe(true);
    // Steps that name no command (a skill, a module) are listed, not drawn; step fields come from the generated graph.
    const graph = readStepGraph();
    const commandless = graph.nodes.filter(step => !step.command.cli && step.command.script === undefined && step.command.npm === undefined);
    for (const step of commandless) expect(wiring.undrawn.map(row => row.step)).toContain(step.id);
  });

  it("delete a run record -> never run", async () => {
    const root = workspace();
    await runPipeline(["pipeline", "status", "--root", root], root);
    await runPipeline(["pipeline", "wiring", "--root", root], root);
    expect(node(buildWiring(root), "pipeline[status]")).toMatchObject({ state: "passed", citation: { store: storeFile("pipeline"), line: 1, exit: 0 } });
    // Drop the status record only: its node goes; the wiring record still stands.
    const file = join(root, storeFile("pipeline"));
    writeFileSync(file, readFileSync(file, "utf8").split("\n").filter(line => line && !line.includes('"invocation":"pipeline status"')).join("\n") + "\n");
    let wiring = buildWiring(root);
    expect(node(wiring, "pipeline[status]")).toBeUndefined();
    expect(node(wiring, "pipeline[wiring]")!.state).toBe("passed");
    unlinkSync(file);
    wiring = buildWiring(root);
    expect(node(wiring, "pipeline")).toMatchObject({ state: "never-run", citation: null });
    expect(pipelineStatus(root).steps.find(each => each.id === "pipeline")!.state).toBe("never-run");
  });

  it("a step exiting 1 -> failed", async () => {
    const root = workspace();
    const step = readStepGraph().nodes.find(each => each.command.script !== undefined)!.id;
    // One command; the exit code it reads decides how it exits, so both runs are the same invocation.
    const read = "const fs = require('node:fs'); fs.readFileSync('clossys/clossys.config.ts'); process.exit(Number(fs.readFileSync('exit.txt', 'utf8')))";
    writeFileSync(join(root, "exit.txt"), "1");
    const failed = await runPipelineCli(["trace", step, "--", process.execPath, "-e", read], root);
    expect(failed.exitCode).toBe(1);
    const wiring = buildWiring(root);
    const ran = wiring.nodes.filter(each => each.step === step);
    expect(ran).toHaveLength(1);
    expect(ran[0]).toMatchObject({ state: "failed", citation: { exit: 1 } });
    // The child's own read was observed through the preload.
    expect(readRuns(root).at(-1)!.record.reads.map(entry => entry.path)).toContain("clossys/clossys.config.ts");
    expect(wiringCitationIssues(root, wiring)).toEqual([]);
    // The same invocation passing later supersedes the failure.
    writeFileSync(join(root, "exit.txt"), "0");
    expect(buildWiring(root).nodes.find(each => each.step === step)!.state).toBe("failed");
    const passed = await runPipelineCli(["trace", step, "--", process.execPath, "-e", read], root);
    expect(passed.exitCode).toBe(0);
    expect(buildWiring(root).nodes.filter(each => each.step === step).map(each => each.state)).toEqual(["passed"]);
    expect((await runPipelineCli(["trace", "no.such.step", "--", process.execPath, "-e", ""], root)).exitCode).toBe(2);
  });

  it("a changed input -> stale, citing the files that changed", async () => {
    const root = workspace();
    await runPipeline(["pipeline", "status", "--root", root], root);
    expect(node(buildWiring(root), "pipeline[status]")!.state).toBe("passed");
    writeFileSync(join(root, CANDIDATES, "c.json"), "{}\n");
    const stale = node(buildWiring(root), "pipeline[status]")!;
    expect(stale).toMatchObject({ state: "stale", changed: expect.arrayContaining([CANDIDATES]) });
    unlinkSync(join(root, CANDIDATES, "c.json"));
    expect(node(buildWiring(root), "pipeline[status]")!.state).toBe("passed");
  });

  it("draws an edge only where one run wrote a file another run read", async () => {
    const root = workspace();
    await runPipeline(["pipeline", "graph", "--root", root, "--out", join(root, "graph.json")], root);
    const [writer, reader] = readStepGraph().nodes.filter(each => each.command.script !== undefined);
    await runPipelineCli(["trace", reader!.id, "--", process.execPath, "-e", "require('node:fs').readFileSync('graph.json')"], root);
    const wiring = buildWiring(root);
    expect(wiring.edges).toEqual([{ from: "pipeline[graph]", to: reader!.id, files: 1, sample: ["graph.json"], fresh: true }]);
    expect(node(wiring, writer!.id)!.state).toBe("never-run");
    writeFileSync(join(root, "graph.json"), "{}\n");
    expect(buildWiring(root).edges[0]!.fresh).toBe(true);
    expect(node(buildWiring(root), reader!.id)!.state).toBe("stale");
  });
});

describe("status citations", () => {
  it("finds every status that cites no record, or the wrong one", async () => {
    const root = workspace();
    await runPipeline(["pipeline", "status", "--root", root], root);
    const wiring = buildWiring(root);
    expect(wiringCitationIssues(root, wiring)).toEqual([]);
    const tamper = (change: Partial<WiringNode>): PipelineWiring => ({ ...wiring, nodes: wiring.nodes.map(each => each.id === "pipeline[status]" ? { ...each, ...change } : each) });
    expect(wiringCitationIssues(root, tamper({ citation: null }))).toEqual(["pipeline[status]: shows passed without a run record"]);
    expect(wiringCitationIssues(root, tamper({ citation: { ...node(wiring, "pipeline[status]")!.citation!, line: 9 } }))[0]).toMatch(/holds no run record/);
    expect(wiringCitationIssues(root, tamper({ state: "failed" }))).toEqual(["pipeline[status]: shows failed, but its record says passed"]);
    const ready = wiring.nodes.find(each => each.state === "never-run")!;
    expect(wiringCitationIssues(root, { ...wiring, nodes: [{ ...ready, state: "passed" }] })).toEqual([`${ready.id}: shows passed without a run record`]);
  });

  it("finds Studio section contracts that show a status with no citation field", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "contracts-")));
    dirs.push(dir);
    const section = (name: string, source: string) => { mkdirSync(join(dir, "studio", "sections", name), { recursive: true }); writeFileSync(join(dir, "studio", "sections", name, "index.tsx"), source); };
    section("cited", "export interface CitedInput { status: 'passed' | 'failed'; citation: string | null }\n");
    section("uncited", "export interface UncitedInput { label: string; statusTone?: 'ok' }\n");
    section("plain", "export interface PlainInput { label: string }\n");
    section("union", "export type CardInput = { name: string } & (\n  | { kind: 'a'; status?: { label: string }; empty: string }\n  | { kind: 'b'; status: 'ok'; citation: null }\n);\nexport interface RowsInput { rows: readonly { cells: readonly { text: string; statusLabel?: string }[] }[]; citation: string }\n");
    section("copy", "export interface FlowCopy { status: string; statuses: Record<string, string> }\n");
    expect(uncitedStatusFields(dir)).toEqual([
      "studio/sections/uncited: UncitedInput shows statusTone with no citation field",
      "studio/sections/union: CardInput shows status with no citation field",
      "studio/sections/union: RowsInput shows statusLabel with no citation field",
    ]);
  });

  it("runs the citation check through the pipeline verb", async () => {
    const root = workspace();
    const check = await runPipelineCli(["check", "--root", root], root);
    const output = check.output as { page: string[]; contracts: string[] };
    expect(output.page).toEqual([]);
    expect(check.exitCode).toBe(output.contracts.length ? 1 : 0);
  });

  it("appends and keeps the newest runs per invocation", () => {
    const root = workspace();
    const record = (end: number, exit = 0): RunRecord => buildRecord({ root, step: "probe", invocation: "probe", argv: [], start: new Date(end - 1), end: new Date(end), exit, observation: { reads: new Map(), writes: new Set() } });
    for (let end = 1; end <= 5; end++) appendRecord(root, record(end));
    const kept = readRuns(root);
    expect(kept.map(run => run.record.end)).toEqual([3, 4, 5].map(end => new Date(end).toISOString()));
    expect(kept.map(run => run.line)).toEqual([1, 2, 3]);
  });
  it("reads steps only from the generated graph file (drop a step from graph.json -> its node is gone)", () => {
    const root = workspace();
    const drawn = buildWiring(root).nodes.find(each => readStepGraph().nodes.some(step => step.id === each.step && step.command.cli))!;
    expect(drawn).toBeDefined();
    const pkg = realpathSync(mkdtempSync(join(tmpdir(), "wiring-pkg-")));
    dirs.push(pkg);
    mkdirSync(join(pkg, "pipeline"));
    writeFileSync(join(pkg, "package.json"), readFileSync(join(PACKAGE_ROOT, "package.json")));
    const graph = readStepGraph();
    writeFileSync(join(pkg, "pipeline", "graph.json"), JSON.stringify({ ...graph, nodes: graph.nodes.filter(step => step.id !== drawn.step) }));
    const without = buildWiring(root, { packageRoot: pkg });
    expect(without.nodes.some(each => each.step === drawn.step)).toBe(false);
    expect(without.nodes.length).toBeGreaterThan(0);
    writeFileSync(join(pkg, "pipeline", "graph.json"), JSON.stringify({ ...graph, schema: "clossys.pipeline-graph/0" }));
    expect(() => buildWiring(root, { packageRoot: pkg })).toThrow(/is not a clossys.pipeline-graph\/1 graph/);
  });
});
