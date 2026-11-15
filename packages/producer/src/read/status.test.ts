import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "../records/hash.js";
import { SLOT_AGENTS, serializeFrontmatter, validateCandidate, validatePin } from "../records/slot-model/index.js";
import { agentSlotCensus } from "../server/slot-census.js";
import { runStatusCli } from "../cli/status.js";
import { agentCensus, SLOT_STATES, statusView } from "./status.js";

const FIXTURE = fileURLToPath(new URL("../../test-fixtures/consumer", import.meta.url));
const SLOT = "advantage.defensibility.moat";
let root: string;

beforeEach(() => {
  // A copy of the int2 fixture consumer, so the mutations below never touch the committed files.
  root = join(realpathSync(mkdtempSync(join(tmpdir(), "status-read-"))), "fixture-consumer");
  cpSync(FIXTURE, root, { recursive: true });
});
afterEach(() => rmSync(join(root, ".."), { recursive: true, force: true }));

const slotPath = (agent: string, id: string, ...parts: string[]) => join(root, "clossys", "agents", agent, id, ...parts);
function brief(version: number) {
  return serializeFrontmatter({ slot: SLOT, source: { kind: "original", ref: [] }, feeds: [], functions: [] },
    `## Direction\nSynthetic ${version}\n## Because\nEvidence\n## Watch\nSignals\n`);
}
/** A valid candidate plus pin on one Director slot (synthetic test data, never an owner decision). */
function pin(version: number, basis: "picked" | "agent" = "picked") {
  const bytes = brief(version);
  const name = `moat-v${version}.md`;
  expect(validateCandidate("brief", SLOT, name, bytes)).toEqual([]);
  mkdirSync(slotPath("director", SLOT, "candidates"), { recursive: true });
  writeFileSync(slotPath("director", SLOT, "candidates", name), bytes);
  const doc = { candidate: name, sha256: sha256Hex(bytes), decidedBy: basis === "picked" ? "owner:synthetic-test-only:status" : "agent:synthetic-test-only", basis, at: `2026-01-0${version}T00:00:00Z` };
  expect(validatePin(doc)).toEqual([]);
  writeFileSync(slotPath("director", SLOT, "pin.json"), JSON.stringify(doc));
  return doc;
}
function queueEntry(id: string, status: "open" | "answered", queue = "queue.approve") {
  const dir = join(root, "clossys", "agents", "producer", queue, "entries");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.json`), JSON.stringify({
    schema: "clossys.queue-entry/1", id, agent: "producer", kind: "queue-entry", status, queue,
    ask: "Confirm the synthetic moat brief", subject: `director/${SLOT}`, decider: "owner", default: "keep moat-v1.md",
    createdAt: "2026-01-03T00:00:00Z", refs: [], events: [{ at: "2026-01-03T00:00:00Z", op: "raised", by: "agent:director" }],
  }));
}
const row = (view: ReturnType<typeof statusView>, ref: string) => view.slots.find(slot => slot.ref === ref);

describe("clossys status: parity with the Studio server slot census on the int2 fixture", () => {
  it.todo("FOLD-TODO (after foundry-build-0001): output validates against schemas/status-1.json");
  it.todo("FOLD-TODO (after foundry-build-0001): golden output for test-fixtures/tallyhouse");

  function expectParity() {
    const view = statusView(root);
    for (const agent of SLOT_AGENTS) {
      const server = agentSlotCensus(join(root, "clossys"), agent);
      const ours = agentCensus(join(root, "clossys"), agent);
      expect(server.state).toBe("ready");
      if (server.state !== "ready" || ours.state !== "ready") throw new Error(`census ${agent} not ready`);
      // Row for row the same census, then the same counts in the read model.
      expect(ours.rows).toEqual(server.rows);
      expect({ total: ours.total, withCandidate: ours.withCandidate, pinned: ours.pinned, confirm: ours.confirm })
        .toEqual({ total: server.total, withCandidate: server.withCandidate, pinned: server.pinned, confirm: server.confirm });
      const counts = view.agents[agent]!;
      expect(counts.slots).toBe(server.total);
      expect(SLOT_STATES.reduce((sum, state) => sum + counts.byState[state], 0)).toBe(server.total);
      expect(counts.byState.pinned + counts.byState.confirm).toBe(server.rows.filter(r => r.pin === "valid").length);
      expect(counts.byState.confirm).toBe(server.rows.filter(r => r.pin === "valid" && r.status === "confirm").length);
      const rows = view.slots.filter(slot => slot.ref.startsWith(`${agent}/`));
      expect(rows.map(slot => slot.ref)).toEqual(server.rows.map(r => `${agent}/${r.id}`));
      expect(rows.map(slot => slot.candidates)).toEqual(server.rows.map(r => r.candidates.length));
    }
    return view;
  }

  it("counts every IA slot per agent exactly as slot-census does", () => {
    const view = expectParity();
    expect(view.schema).toBe("clossys.status/1");
    expect(view.workspace).toBe("fixture-consumer");
    expect(Object.keys(view.agents)).toEqual([...SLOT_AGENTS]);
    expect(view.agents.director!.slots).toBeGreaterThan(0);
  });

  it("stays in parity after pins of both review states are added", () => {
    pin(1, "agent");
    const view = expectParity();
    expect(row(view, `director/${SLOT}`)).toMatchObject({ state: "confirm", pinned: "moat-v1.md" });
    pin(2, "picked");
    expect(row(expectParity(), `director/${SLOT}`)).toMatchObject({ state: "pinned", pinned: "moat-v2.md" });
  });
});

describe("clossys status: states, queue and stateSha256", () => {
  it("reports a pinned slot as pinned, never open", () => {
    const before = statusView(root).agents.director!.byState;
    pin(1);
    const view = statusView(root);
    expect(row(view, `director/${SLOT}`)).toMatchObject({ state: "pinned", pinned: "moat-v1.md" });
    expect(view.agents.director!.byState.pinned).toBe(before.pinned + 1);
    expect(view.agents.director!.byState.unresolved).toBe(before.unresolved - 1);
  });

  it("reports a pin whose candidate bytes drifted as failing", () => {
    pin(1);
    writeFileSync(slotPath("director", SLOT, "candidates", "moat-v1.md"), "changed bytes");
    expect(row(statusView(root), `director/${SLOT}`)!.state).toBe("failing");
  });

  it("reads check results: a failing check fails, a result for other bytes needs refresh", () => {
    const doc = pin(1);
    const checks = join(root, ".clossys", "checks", "director", SLOT);
    mkdirSync(checks, { recursive: true });
    writeFileSync(join(checks, "moat-v1.md.json"), JSON.stringify({ status: "fail", subjectSha256: doc.sha256 }));
    expect(row(statusView(root), `director/${SLOT}`)!.state).toBe("failing");
    writeFileSync(join(checks, "moat-v1.md.json"), JSON.stringify({ status: "pass", subjectSha256: "0".repeat(64) }));
    expect(row(statusView(root), `director/${SLOT}`)!.state).toBe("needsRefresh");
  });

  it("lists every open queue entry, and answered ones only with --queue all", () => {
    queueEntry("20260103T0000Z-moat", "open");
    queueEntry("20260102T0000Z-old", "answered", "queue.pick");
    const open = statusView(root);
    expect(open.queue).toEqual([{
      id: "20260103T0000Z-moat", queue: "queue.approve", decider: "owner", subject: `director/${SLOT}`,
      ask: "Confirm the synthetic moat brief", default: "keep moat-v1.md", raisedAt: "2026-01-03T00:00:00Z", status: "open",
    }]);
    expect(statusView(root, { queue: "all" }).queue.map(item => item.id).sort()).toEqual(["20260102T0000Z-old", "20260103T0000Z-moat"]);
    expect(statusView(root, { agent: "writer" }).queue).toEqual([]);
  });

  it("changes stateSha256 when a pin changes or a queue entry opens, and only then", () => {
    const empty = statusView(root).stateSha256;
    expect(statusView(root).stateSha256).toBe(empty);
    pin(1);
    const one = statusView(root).stateSha256;
    expect(one).not.toBe(empty);
    pin(2);
    const two = statusView(root).stateSha256;
    expect(two).not.toBe(one);
    queueEntry("20260103T0000Z-moat", "open");
    expect(statusView(root).stateSha256).not.toBe(two);
    // The filters never change the digest.
    expect(statusView(root, { agent: "writer" }).stateSha256).toBe(statusView(root).stateSha256);
  });

  it("orders ledger runs newest first and caps them", () => {
    const dir = join(root, "clossys", "agents", "producer", "ledger.fill", "entries");
    mkdirSync(dir, { recursive: true });
    for (const day of [1, 2, 3]) writeFileSync(join(dir, `run-${day}.json`), JSON.stringify({ id: `run-${day}`, loop: "loop.fill", status: "done", outcome: `outcome ${day}`, createdAt: `2026-01-0${day}T00:00:00Z` }));
    const view = statusView(root, { ledger: 2 });
    expect(view.ledger.map(run => run.id)).toEqual(["run-3", "run-2"]);
    expect(view.at).toBe("2026-01-03T00:00:00Z");
  });
});

describe("clossys status verb", () => {
  it("prints the same read model twice, filtered by --agent, with gaps and options folded in", async () => {
    const first = await runStatusCli(["--json", "--agent", "director"], root);
    const second = await runStatusCli(["--json", "--agent", "director"], root);
    expect(first.exitCode).toBe(0);
    expect(JSON.stringify(first.output)).toBe(JSON.stringify(second.output));
    const view = first.output as ReturnType<typeof statusView>;
    expect(Object.keys(view.agents)).toEqual(["director"]);
    expect(view.slots.every(slot => slot.ref.startsWith("director/"))).toBe(true);
    expect(view.gaps).toHaveProperty("counts");
    expect(view.options).toHaveProperty("short");
    expect((view.options as { short: { agent: string }[] }).short.every(slot => slot.agent === "director")).toBe(true);
  }, 120_000);

  it("refuses an unknown agent or flag", async () => {
    await expect(runStatusCli(["--agent", "nobody"], root)).rejects.toThrow(/--agent must be/);
    await expect(runStatusCli(["--queue", "some"], root)).rejects.toThrow(/--queue must be/);
    await expect(runStatusCli(["--bogus"], root)).rejects.toThrow(/Unknown argument/);
  });

  it("the read model reaches nothing under src/server or src/studio, even transitively", () => {
    const seen = new Set<string>(), reached: string[] = [];
    const walk = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      let source: string;
      try { source = readFileSync(file, "utf8"); } catch { return; }
      for (const [, spec] of source.matchAll(/(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g)) {
        let target = join(dirname(file), spec!).replace(/\.js$/, ".ts");
        if (!target.endsWith(".ts")) target = existsSync(`${target}.ts`) ? `${target}.ts` : join(target, "index.ts");
        if (/[/\\]src[/\\](server|studio)[/\\]/.test(target)) reached.push(`${file} -> ${target}`);
        walk(target);
      }
    };
    walk(fileURLToPath(new URL("status.ts", import.meta.url)));
    expect(seen.size).toBeGreaterThan(5);
    expect(reached).toEqual([]);
    // The verb itself names no server or Studio module (its gaps fold reads the int2 pipeline, cut in 14.4 step 6).
    expect(readFileSync(fileURLToPath(new URL("../cli/status.ts", import.meta.url)), "utf8")).not.toMatch(/from\s+["'][^"']*\/(server|studio)\//);
  });
});
