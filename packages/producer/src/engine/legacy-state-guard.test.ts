import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../cli/main.js";
import { writeScorecard } from "../constitution/pin-gate.js";
import { createQueueEntry, withQueueEntryLock } from "../queue/entry.js";
import { writePinDoc } from "../records/pin.js";
import { withRequestLock } from "../records/request.js";
import { withDirLock } from "../records/slot-write.js";
import { appendRecord } from "../pipeline/trace.js";
import { EVENTS_FILE, readEventLines, sha256 } from "./chain.js";
import { runEngineCheck } from "./check.js";
import { appendEvent, rebuildIndex, recordEvent } from "./log.js";
import { applyStateMigration, isLockFile, pendingStateMigration, planStateMigration } from "./migrate-state.js";
import { LEGACY_STATE_DIR, LegacyStateError, STATE_DIR, legacyStateAt, refuseLegacyState, statePath } from "./state-dir.js";

let root: string;
const legacy = (...segments: string[]) => join(root, LEGACY_STATE_DIR, ...segments);
const RESULT = "{\"ok\":true}\n";
const MIGRATE = /clossys migrate state --apply/;

/** A workspace the engine left before ENGINE-ROOT: a logged record and a logged check result, all state in `.clossys/`. */
function legacyWorkspace(): void {
  const slot = join(root, "clossys", "agents", "writer", "copy.slot-1");
  mkdirSync(slot, { recursive: true });
  writeFileSync(join(slot, "pin.json"), "{\"v\":1}\n");
  recordEvent([join(slot, "pin.json")], { actor: "code:test", kind: "pin.write", subject: "writer/copy.slot-1" });
  mkdirSync(statePath(root, "checks", "director"), { recursive: true });
  writeFileSync(statePath(root, "checks", "director", "scorecard.json"), RESULT);
  appendEvent(root, { actor: "code:test", kind: "check.write", subject: "director/scorecard", inputs: [{ path: `${LEGACY_STATE_DIR}/checks/director/scorecard.json`, sha256: sha256(RESULT) }] });
  renameSync(join(root, STATE_DIR), legacy());
}
/** Everything under STATE_DIR, as workspace-relative paths; empty when the folder is absent. */
function stateTree(): string[] {
  const at = join(root, STATE_DIR);
  return existsSync(at) ? readdirSync(at, { recursive: true }).map(String).sort() : [];
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "engine-legacy-guard-")));
  mkdirSync(join(root, "clossys"), { recursive: true });
  writeFileSync(join(root, "clossys", "clossys.config.ts"), "export default {};\n");
  // The run store keeps records only where it is gitignored: ignore it, so a run that went ahead would show.
  writeFileSync(join(root, ".gitignore"), `${STATE_DIR}/\n`);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("a workspace whose engine state is still in the legacy root folder (state-dir.ts refuseLegacyState)", () => {
  it("refuses init, pin and check in the normal upgrade order, writes nothing in the state folder, and migrate state then moves it", async () => {
    legacyWorkspace();
    const logged = readFileSync(legacy("events.jsonl"), "utf8");

    for (const argv of [["init", "--root", root], ["pin", "writer/copy.slot-1", "copy-v1", "--by", "agent:test", "--root", root], ["status"], ["next"]]) {
      const result = await runCli(argv, root);
      expect(result.exitCode, argv.join(" ")).toBe(2);
      expect(result.message, argv.join(" ")).toMatch(MIGRATE);
      expect(result.message, argv.join(" ")).toContain(`${LEGACY_STATE_DIR}/`);
    }
    // `--root=<dir>` and a nested cwd name the same workspace.
    expect((await runCli([`pin`, "writer/copy.slot-1", "copy-v1", `--root=${root}`], "/")).exitCode).toBe(2);
    expect((await runCli(["status"], join(root, "clossys", "agents"))).exitCode).toBe(2);
    expect(stateTree()).toEqual([]);

    const check = await runCli(["check", "--engine", "--root", root], root);
    expect(check.exitCode).toBe(1);
    expect(check.message).toMatch(/layout: \.clossys\/ exists/);
    expect(stateTree()).toEqual([]);
    expect(readFileSync(legacy("events.jsonl"), "utf8")).toBe(logged);

    const dry = await runCli(["migrate", "state", "--root", root], root);
    expect(dry.exitCode).toBe(0);
    expect(stateTree()).toEqual([]);
    const moved = await runCli(["migrate", "state", "--apply", "--root", root], root);
    expect(moved.exitCode, moved.message).toBe(0);
    expect(existsSync(legacy())).toBe(false);
    expect(readEventLines(root).lines).toHaveLength(3);
    expect(runEngineCheck(root)).toMatchObject({ ok: true, layout: [], drift: [] });
    expect((await runCli(["check", "--engine", "--root", root], root)).exitCode).toBe(0);
    expect((await runCli(["status"], root)).message).not.toMatch(MIGRATE);
  });

  it("refuses at every engine writer before it writes, for callers that do not come through the CLI", () => {
    legacyWorkspace();
    const logged = readFileSync(legacy("events.jsonl"), "utf8");
    const nothing = () => { throw new Error("the body ran"); };
    const refusals: Array<[string, () => unknown]> = [
      ["appendEvent", () => appendEvent(root, { actor: "code:test", kind: "check.write", subject: "x", inputs: [] })],
      ["pin document", () => writePinDoc(join(root, "clossys", "agents", "writer", "copy.slot-1", "pin.json"), { kind: "pin" } as never)],
      ["queue entry", () => createQueueEntry(root, { queue: "queue.slot", id: "q-1" } as never)],
      ["rebuildIndex", () => rebuildIndex(root)],
      ["slot lock", () => withDirLock(join(root, "clossys", "agents", "writer", "copy.slot-1", ".slot-write.lock"), "busy", nothing)],
      ["agent lock", () => withDirLock(join(root, "clossys", "agents", "writer", ".agent-write.lock"), "busy", nothing)],
      ["queue lock", () => withQueueEntryLock(root, "queue.slot", "q-1", nothing)],
      ["request lock", () => withRequestLock(join(root, "clossys"), "k-1", nothing)],
      ["scorecard", () => writeScorecard(root, "writer", "copy.slot-1", { schema: "clossys.scorecard/1", slot: "writer/copy.slot-1", at: "2026-11-21T00:00:00Z", pick: "copy-v1", candidates: [] } as never)],
    ];
    for (const [name, write] of refusals) {
      let thrown: unknown;
      try { write(); } catch (error) { thrown = error; }
      expect(thrown, name).toBeInstanceOf(LegacyStateError);
      expect((thrown as Error).message, name).toMatch(MIGRATE);
    }
    expect(existsSync(join(root, "clossys", "agents", "writer", "copy.slot-1", ".slot-write.lock"))).toBe(false);
    expect(readFileSync(join(root, "clossys", "agents", "writer", "copy.slot-1", "pin.json"), "utf8")).toBe("{\"v\":1}\n");
    expect(appendRecord(root, { step: "check.pipeline" } as never)).toBeNull();
    expect(stateTree()).toEqual([]);
    expect(readFileSync(legacy("events.jsonl"), "utf8")).toBe(logged);
  });

  it("sees the legacy folder in any form and nothing once it is gone", () => {
    expect(legacyStateAt(root)).toBe(false);
    expect(() => refuseLegacyState(root)).not.toThrow();
    writeFileSync(legacy(), "not a folder\n");
    expect(legacyStateAt(root)).toBe(true);
    expect(() => refuseLegacyState(root)).toThrow(LegacyStateError);
  });
});

describe("clossys migrate state, round 2 (engine/migrate-state.ts)", () => {
  it("moves a generated/compile.lock.json, which is not a lock: only `.lock` files and their recovery markers refuse", () => {
    mkdirSync(legacy("generated", "site"), { recursive: true });
    writeFileSync(legacy("generated", "site", "compile.lock.json"), "{\"files\":{}}\n");
    writeFileSync(legacy("generated", "compile.lock.json"), "{\"files\":{}}\n");
    expect(isLockFile("generated/compile.lock.json")).toBe(false);
    expect(isLockFile("engine.lock")).toBe(true);
    expect(isLockFile("engine.lock.recover-abc.recover-def")).toBe(true);
    expect(isLockFile("locks/queue/queue.slot/k.lock")).toBe(true);
    expect(planStateMigration(root)).toEqual({ legacy: true, moves: ["generated"], refusals: [] });
    applyStateMigration(root);
    expect(readFileSync(statePath(root, "generated", "site", "compile.lock.json"), "utf8")).toBe("{\"files\":{}}\n");
    expect(existsSync(legacy())).toBe(false);
  });

  it("resumes a run stopped after the moves and before its event: the event is pending until --apply logs it", async () => {
    legacyWorkspace();
    // The moves of a run that stopped there: the folder is gone, the log has no state.migrate event.
    mkdirSync(join(root, STATE_DIR), { recursive: true });
    for (const name of readdirSync(legacy())) renameSync(legacy(name), statePath(root, name));
    rmdirSync(legacy());
    expect(readEventLines(root).lines).toHaveLength(2);
    expect(runEngineCheck(root).ok).toBe(false);
    expect(pendingStateMigration(root).filter(input => input.sha256 === null)).toHaveLength(1);

    const check = await runCli(["migrate", "state", "--check", "--root", root], root);
    expect(check.exitCode).toBe(1);
    expect(check.message).toMatch(/pending/);
    const applied = await runCli(["migrate", "state", "--apply", "--root", root], root);
    expect(applied.exitCode, applied.message).toBe(0);
    expect(readEventLines(root).lines).toHaveLength(3);
    expect(runEngineCheck(root)).toMatchObject({ ok: true, drift: [], layout: [] });
    expect(pendingStateMigration(root)).toEqual([]);
    expect((await runCli(["migrate", "state", "--check", "--root", root], root)).exitCode).toBe(0);
    expect(existsSync(join(root, EVENTS_FILE))).toBe(true);
  });
});
