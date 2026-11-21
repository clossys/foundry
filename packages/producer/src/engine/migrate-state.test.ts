import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseArgs } from "../cli/args.js";
import { runCheck } from "../cli/check.js";
import { runMigrateCli as runMigrate } from "../cli/migrate.js";
import { EVENTS_FILE, readEventLines, sha256 } from "./chain.js";
import { runEngineCheck } from "./check.js";
import { appendEvent, recordEvent } from "./log.js";
import { STATE_MIGRATE_ACTOR, STATE_MIGRATE_KIND, applyStateMigration, planStateMigration } from "./migrate-state.js";
import { LEGACY_STATE_DIR, STATE_DIR, statePath } from "./state-dir.js";

let root: string;
const legacy = (...segments: string[]) => join(root, LEGACY_STATE_DIR, ...segments);
const RESULT = "{\"ok\":true}\n";

/**
 * A workspace as the engine left it before ENGINE-ROOT: a record event and a check result logged under the legacy
 * root folder, with the log, its index and the check result all living in `.clossys/`.
 */
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

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "engine-migrate-state-")));
  mkdirSync(join(root, "clossys"), { recursive: true });
  writeFileSync(join(root, "clossys", "clossys.config.ts"), "export default {};\n");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("clossys migrate state (engine/migrate-state.ts)", () => {
  it("fails the engine check on a legacy root folder, moves it into the state folder and passes after", async () => {
    legacyWorkspace();
    const before = runEngineCheck(root);
    expect(before.ok).toBe(false);
    expect(before.layout).toEqual([expect.stringMatching(/^\.clossys\/ exists at the workspace root.*clossys\/\.state\/.*clossys migrate state --apply/)]);
    const cli = await runCheck(parseArgs(["check", "--engine", "--root", root]), root);
    expect(cli.exitCode).toBe(1);
    expect(cli.message).toMatch(/\n {2}layout: \.clossys\/ exists/);

    expect(planStateMigration(root)).toEqual({ legacy: true, moves: ["checks", "events.jsonl", "index.json"], refusals: [] });
    const { plan, event } = applyStateMigration(root);
    expect(plan.moves).toEqual(["checks", "events.jsonl", "index.json"]);
    expect(existsSync(legacy())).toBe(false);
    expect(readFileSync(statePath(root, "checks", "director", "scorecard.json"), "utf8")).toBe(RESULT);
    expect(event).toMatchObject({
      seq: 2, actor: STATE_MIGRATE_ACTOR, kind: STATE_MIGRATE_KIND, subject: `state:${STATE_DIR}`,
      inputs: [
        { path: `${LEGACY_STATE_DIR}/checks/director/scorecard.json`, sha256: null },
        { path: `${STATE_DIR}/checks/director/scorecard.json`, sha256: sha256(RESULT) },
      ],
    });
    expect(readEventLines(root).lines).toHaveLength(3);
    const after = runEngineCheck(root);
    expect(after).toMatchObject({ ok: true, events: 3, chain: [], index: [], drift: [], layout: [] });
    expect((await runCheck(parseArgs(["check", "--engine", "--root", root]), root)).exitCode).toBe(0);

    expect(planStateMigration(root)).toEqual({ legacy: false, moves: [], refusals: [] });
    expect(applyStateMigration(root)).toEqual({ plan: { legacy: false, moves: [], refusals: [] } });
    expect(readEventLines(root).lines).toHaveLength(3);
  });

  it("appends no event when the log logs no legacy record path", () => {
    mkdirSync(legacy("runs"), { recursive: true });
    writeFileSync(legacy("runs", "check.pipeline.jsonl"), "{}\n");
    const { event } = applyStateMigration(root);
    expect(event).toBeUndefined();
    expect(existsSync(legacy())).toBe(false);
    expect(readFileSync(statePath(root, "runs", "check.pipeline.jsonl"), "utf8")).toBe("{}\n");
    expect(existsSync(join(root, EVENTS_FILE))).toBe(false);
    expect(runEngineCheck(root).layout).toEqual([]);
  });

  it("refuses, moving nothing, on a lock, a waiting or running loop run and a name the state folder holds", () => {
    legacyWorkspace();
    mkdirSync(legacy("locks", "queue"), { recursive: true });
    writeFileSync(legacy("locks", "queue", "queue.slot.lock"), "{}");
    writeFileSync(legacy("engine.lock.recover-abc"), "");
    mkdirSync(legacy("runs", "loops"), { recursive: true });
    writeFileSync(legacy("runs", "loops", "a.json"), JSON.stringify({ status: "waiting" }));
    writeFileSync(legacy("runs", "loops", "b.json"), JSON.stringify({ status: "running" }));
    writeFileSync(legacy("runs", "loops", "c.json"), JSON.stringify({ status: "done" }));
    mkdirSync(statePath(root, "checks"), { recursive: true });
    const plan = planStateMigration(root);
    expect(plan.refusals).toEqual([
      ".clossys/engine.lock.recover-abc is a lock: a writer may hold it; let it finish, then run again",
      ".clossys/locks/queue/queue.slot.lock is a lock: a writer may hold it; let it finish, then run again",
      expect.stringMatching(/^\.clossys\/runs\/loops\/a\.json is a waiting run/),
      expect.stringMatching(/^\.clossys\/runs\/loops\/b\.json is a running run/),
      "clossys/.state/checks already exists: .clossys/checks is not merged into it; nothing was moved",
    ]);
    expect(() => applyStateMigration(root)).toThrow(/^migrate state: \.clossys\/engine\.lock\.recover-abc is a lock/);
    expect(existsSync(legacy("events.jsonl"))).toBe(true);
    expect(existsSync(legacy("checks", "director", "scorecard.json"))).toBe(true);
    expect(existsSync(statePath(root, "events.jsonl"))).toBe(false);
  });

  it("refuses a legacy path that is not a plain folder", () => {
    writeFileSync(join(root, "elsewhere"), "");
    symlinkSync(join(root, "elsewhere"), legacy());
    expect(planStateMigration(root)).toEqual({ legacy: true, moves: [], refusals: [expect.stringMatching(/^\.clossys is not a folder/)] });
    expect(() => applyStateMigration(root)).toThrow(/not a folder/);
    expect(runEngineCheck(root).layout).toHaveLength(1);
  });

  it("is a dry run by default and --check fails while a legacy folder exists (cli)", async () => {
    legacyWorkspace();
    const dry = await runMigrate(["state", "--root", root], root);
    expect(dry.exitCode).toBe(0);
    expect(existsSync(legacy())).toBe(true);
    expect((await runMigrate(["state", "--check", "--root", root], root)).exitCode).toBe(1);
    expect((await runMigrate(["state", "--apply", "--check", "--root", root], root)).exitCode).toBe(2);
    const applied = await runMigrate(["state", "--apply", "--root", root], root);
    expect(applied.exitCode).toBe(0);
    expect(existsSync(legacy())).toBe(false);
    expect((await runMigrate(["state", "--check", "--root", root], root)).exitCode).toBe(0);
  });
});
