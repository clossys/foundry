import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recutCandidateBytes } from "../migrate/recut.js";
import { sha256Hex } from "../records/hash.js";
import { buildPin, pinIssues } from "../records/pin.js";
import { storeFormatPath } from "../records/store-format.js";
import { SLOT_AGENTS, serializeFrontmatter, validateCandidate, validatePin } from "../records/slot-model/index.js";
import { agentSlotCensus } from "../server/slot-census.js";
import { runStatusCli } from "../cli/status.js";
import { validateAgainst, type JsonSchema } from "../records/schema.js";
import { agentCensus, SLOT_STATES, STATUS_AGENTS, statusView } from "./status.js";

/**
 * Both fixture consumers: the current one (recut, clossys.slot/2) and the old-tree one (slot/1, before the recut).
 * The Studio server census judges a pinned candidate as the slot/2 readers do (U37), so the current fixture's own
 * pinned clossys.candidate/1 brief is in parity; the pin-adding parity cases below still run on the old-tree store only.
 */
const FIXTURES = [
  ["the current fixture consumer", fileURLToPath(new URL("../../test-fixtures/consumer", import.meta.url)), false],
  ["the old-tree fixture consumer", fileURLToPath(new URL("../../test-fixtures/consumer-legacy-tree", import.meta.url)), true],
] as const;
const SLOT = "advantage.defensibility.moat";
let root: string;

describe.each(FIXTURES)("on %s", (_name, FIXTURE, pinnedParity) => {
  beforeEach(() => {
    // A copy of the fixture consumer, so the mutations below never touch the committed files.
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
    const name = `moat-v${version}.md`;
    expect(validateCandidate("brief", SLOT, name, brief(version))).toEqual([]);
    // A recut store (clossys.slot/2) holds candidates in the current format: the same brief, as clossys migrate recut writes it.
    const current = JSON.parse(readFileSync(slotPath("director", SLOT, "slot.json"), "utf8")).schema === "clossys.slot/2";
    const bytes = current ? recutCandidateBytes(name, brief(version), { agent: "director", slotId: SLOT, at: "2026-01-01T00:00:00Z", version: "0.0.0", sourceRef: `agents/director/${SLOT}/candidates/${name}` }) : brief(version);
    mkdirSync(slotPath("director", SLOT, "candidates"), { recursive: true });
    writeFileSync(slotPath("director", SLOT, "candidates", name), bytes);
    // The pin format the store declares: a migrated store (store-format.json) reads clossys.pin/2 only, so an owner
    // pick there cites the queue answer it records; an unmarked store still reads the bare pin.
    if (existsSync(storeFormatPath(join(root, "clossys")))) {
      const answer = `20260101T000${version}Z-status-moat`;
      const record = { candidate: name, sha256: sha256Hex(bytes), decidedBy: basis === "picked" ? `owner:queue.pick#${answer}` : "agent:synthetic-test-only", basis, at: `2026-01-0${version}T00:00:00Z` } as const;
      const doc = buildPin({ agent: "director", slotId: SLOT, record, refs: basis === "picked" ? [{ to: "producer/queue.pick", record: answer, rel: "answers" }] : [], createdBy: { actor: "code", cli: "clossys pin", version: "0.0.0-test" } });
      expect(pinIssues(doc, { agent: "director", slotId: SLOT })).toEqual([]);
      writeFileSync(slotPath("director", SLOT, "pin.json"), JSON.stringify(doc));
      return doc;
    }
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
  const row = (view: ReturnType<typeof statusView>, ref: string) => view.detail!.slots.find(slot => slot.ref === ref);
  const detailed = (options: Parameters<typeof statusView>[1] = {}) => statusView(root, { ...options, detail: true });
  const STATUS_SCHEMA_FILE = fileURLToPath(new URL("../../schemas/status.json", import.meta.url));
  const schemaIssues = (value: unknown) => validateAgainst(JSON.parse(readFileSync(STATUS_SCHEMA_FILE, "utf8")) as JsonSchema, value);

  describe("clossys status: parity with the Studio server slot census", () => {
    it.todo("FOLD-TODO (after foundry-build-0001): golden output for test-fixtures/tallyhouse");

    function expectParity() {
      const view = detailed();
      const { detail: _detail, ...core } = view;
      expect(schemaIssues(core)).toEqual([]);
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
        const rows = view.detail!.slots.filter(slot => slot.ref.startsWith(`${agent}/`));
        expect(rows.map(slot => slot.ref)).toEqual(server.rows.map(r => `${agent}/${r.id}`));
        expect(rows.map(slot => slot.candidates)).toEqual(server.rows.map(r => r.candidates.length));
      }
      return view;
    }

    it("counts every IA slot per agent exactly as slot-census does", () => {
      const view = expectParity();
      expect(view.schema).toBe("clossys.status/1");
      expect(view.workspace).toBe("fixture-consumer");
      expect(Object.keys(view.agents)).toEqual([...STATUS_AGENTS]);
      expect(view.agents.producer).toEqual({ slots: 0, byState: { pinned: 0, confirm: 0, sample: 0, unresolved: 0, failing: 0, needsRefresh: 0 } });
      expect(view.agents.director!.slots).toBeGreaterThan(0);
    });

    it.runIf(pinnedParity)("stays in parity after pins of both review states are added", () => {
      pin(1, "agent");
      const view = expectParity();
      expect(row(view, `director/${SLOT}`)).toMatchObject({ state: "confirm", pinned: "moat-v1.md" });
      pin(2, "picked");
      expect(row(expectParity(), `director/${SLOT}`)).toMatchObject({ state: "pinned", pinned: "moat-v2.md" });
    });
  });

  describe("clossys status: states, queue and stateSha256", () => {
    it("reports a pinned slot as pinned, never open", () => {
      const before = detailed().agents.director!.byState;
      pin(1);
      const view = detailed();
      expect(row(view, `director/${SLOT}`)).toMatchObject({ state: "pinned", pinned: "moat-v1.md" });
      expect(view.agents.director!.byState.pinned).toBe(before.pinned + 1);
      expect(view.agents.director!.byState.unresolved).toBe(before.unresolved - 1);
    });

    it("reports a pin whose candidate bytes drifted as failing", () => {
      pin(1);
      writeFileSync(slotPath("director", SLOT, "candidates", "moat-v1.md"), "changed bytes");
      expect(row(detailed(), `director/${SLOT}`)!.state).toBe("failing");
    });

    it("reads check results: a failing check fails, a result for other bytes needs refresh", () => {
      const doc = pin(1);
      const checks = join(root, "clossys", ".state", "checks", "director", SLOT);
      mkdirSync(checks, { recursive: true });
      writeFileSync(join(checks, "moat-v1.md.json"), JSON.stringify({ status: "fail", subjectSha256: doc.sha256 }));
      expect(row(detailed(), `director/${SLOT}`)!.state).toBe("failing");
      writeFileSync(join(checks, "moat-v1.md.json"), JSON.stringify({ status: "pass", subjectSha256: "0".repeat(64) }));
      expect(row(detailed(), `director/${SLOT}`)!.state).toBe("needsRefresh");
    });

    it("lists every open queue entry, and answered ones only with --queue all", () => {
      // The fixture's own open entries: the queue.change entries the interview filed (none on the old tree).
      const changeDir = join(root, "clossys", "agents", "producer", "queue.change", "entries");
      const filed = (existsSync(changeDir) ? readdirSync(changeDir) : []).filter(file => file.endsWith(".json")).map(file => file.slice(0, -".json".length)).sort();
      const fixture = statusView(root).queue;
      expect(fixture.map(item => item.id).sort()).toEqual(filed);
      expect(fixture.every(item => item.queue === "queue.change" && item.decider === "owner" && item.subject.startsWith("director/"))).toBe(true);
      queueEntry("20260103T0000Z-moat", "open");
      queueEntry("20260102T0000Z-old", "answered", "queue.pick");
      const open = statusView(root);
      expect(open.queue).toEqual([{
        id: "20260103T0000Z-moat", queue: "queue.approve", decider: "owner", subject: `director/${SLOT}`,
        ask: "Confirm the synthetic moat brief", default: "keep moat-v1.md", raisedAt: "2026-01-03T00:00:00Z",
      }, ...fixture]);
      expect(schemaIssues(open)).toEqual([]);
      expect(detailed({ queue: "all" }).queue.map(item => item.id).sort()).toEqual(["20260102T0000Z-old", "20260103T0000Z-moat", ...filed].sort());
      expect(detailed({ agent: "writer" }).queue).toEqual([]);
    });

    it("changes stateSha256 when a pin changes or a queue entry opens, and only then", () => {
      const empty = detailed().stateSha256;
      expect(detailed().stateSha256).toBe(empty);
      pin(1);
      const one = detailed().stateSha256;
      expect(one).not.toBe(empty);
      pin(2);
      const two = detailed().stateSha256;
      expect(two).not.toBe(one);
      queueEntry("20260103T0000Z-moat", "open");
      expect(detailed().stateSha256).not.toBe(two);
      // The filters never change the digest.
      expect(detailed({ agent: "writer" }).stateSha256).toBe(detailed().stateSha256);
    });

    it("G8: hashes the slot states and candidates, so a store with no pin never hashes the empty string", () => {
      const EMPTY = sha256Hex("");
      const before = detailed().stateSha256;
      expect(before).not.toBe(EMPTY);
      // A new candidate (no pin yet) moves the hash: the state is more than its pins.
      mkdirSync(slotPath("director", SLOT, "candidates"), { recursive: true });
      writeFileSync(slotPath("director", SLOT, "candidates", "moat-v1.md"), brief(1));
      expect(detailed().stateSha256).not.toBe(before);
    });

    it("orders ledger runs newest first and caps them", () => {
      const dir = join(root, "clossys", "agents", "producer", "ledger.fill", "entries");
      mkdirSync(dir, { recursive: true });
      // Dated after every record the fixture consumer holds (its pins included), so the newest run is the view's `at`.
      for (const day of [1, 2, 3]) writeFileSync(join(dir, `run-${day}.json`), JSON.stringify({ id: `2030010${day}T0000Z-run`, loop: "loop.fill", status: "done", outcome: `outcome ${day}`, createdAt: `2030-01-0${day}T00:00:00Z` }));
      const view = statusView(root, { ledger: 2 });
      expect(view.ledger.map(run => run.id)).toEqual(["20300103T0000Z-run", "20300102T0000Z-run"]);
      expect(schemaIssues(view)).toEqual([]);
      expect(view.at).toBe("2030-01-03T00:00:00Z");
    });
  });

  describe("clossys status verb", () => {
    it("prints the same read model twice, filtered by --agent, with gaps and options folded in", async () => {
      const first = await runStatusCli(["--json", "--detail", "--agent", "director"], root);
      const second = await runStatusCli(["--json", "--detail", "--agent", "director"], root);
      expect(first.exitCode).toBe(0);
      expect(JSON.stringify(first.output)).toBe(JSON.stringify(second.output));
      const view = first.output as ReturnType<typeof statusView>;
      expect(Object.keys(view.agents)).toEqual([...STATUS_AGENTS]);
      expect(view.detail!.slots.length).toBeGreaterThan(0);
      expect(view.detail!.slots.every(slot => slot.ref.startsWith("director/"))).toBe(true);
      expect(view.detail!.gaps).toHaveProperty("counts");
      expect(view.detail!.options).toHaveProperty("short");
      expect((view.detail!.options as { short: { agent: string }[] }).short.every(slot => slot.agent === "director")).toBe(true);
      const plain = await runStatusCli(["--json"], root);
      expect(plain.output).not.toHaveProperty("detail");
      expect(schemaIssues(plain.output)).toEqual([]);
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
});
