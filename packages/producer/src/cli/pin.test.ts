import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "../records/hash.js";
import { jsonBytes, slotPositions, type IaDoc } from "../records/slot-model/index.js";
import { runCli } from "./main.js";

let workspace: string;
let slotDir: string;
const ID = "components.synthetic";
const OTHER = "components.other";
const load = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const source = { kind: "original", ref: [] };
const good = jsonBytes({ name: "example", type: "registry:item", files: [], meta: { source } });
const second = jsonBytes({ name: "example", type: "registry:item", files: [], meta: { source, note: "second" } });
// Fails the unmodified pin rules: pin state on the candidate's own record.
const bad = jsonBytes({ name: "example", type: "registry:item", files: [], meta: { source }, status: "approved" });

beforeEach(() => {
  workspace = realpathSync(mkdtempSync(join(tmpdir(), "clossys-pin-")));
  const agents = join(workspace, "clossys", "agents", "designer");
  const ia: IaDoc = { schema: "clossys.ia/1", source: "synthetic#fixture", extensions: [], nodes: [{ id: "components", label: "Components", children: [{ id: "group", label: "Group", slots: [ID, OTHER] }] }] };
  mkdirSync(agents, { recursive: true });
  writeFileSync(join(workspace, "clossys", "clossys.config.ts"), "export default {};\n");
  writeFileSync(join(agents, "ia.json"), jsonBytes(ia));
  for (const id of [ID, OTHER]) {
    const dir = join(agents, id);
    mkdirSync(join(dir, "candidates"), { recursive: true });
    writeFileSync(join(dir, "slot.json"), jsonBytes({ schema: "clossys.slot/1", id, agent: "designer", ia: slotPositions("designer", ia).get(id), kind: "element", contract: {}, inputs: [], uses: [] }));
  }
  slotDir = join(agents, ID);
  writeFileSync(join(slotDir, "candidates", "example-v1.json"), good);
  writeFileSync(join(slotDir, "candidates", "example-v2.json"), second);
  writeFileSync(join(slotDir, "candidates", "broken-v1.json"), bad);
});
afterEach(() => rmSync(workspace, { recursive: true, force: true }));

const pin = (...args: string[]) => runCli(["pin", ...args], workspace);

describe("clossys pin <agent>/<slot> <candidate-id>", () => {
  it("writes pin.json {candidate, sha256, decidedBy, basis, at} for a known candidate", async () => {
    const result = await pin(`designer/${ID}`, "example-v1.json", "--basis", "picked", "--at", "2026-11-03T12:00:00.000Z");
    expect(result.exitCode).toBe(0);
    expect(load(join(slotDir, "pin.json"))).toEqual({ candidate: "example-v1.json", sha256: sha256Hex(good), decidedBy: "owner", basis: "picked", at: "2026-11-03T12:00:00.000Z" });
  });

  it("records basis planner for --by planner:*, and refuses another basis with it", async () => {
    expect((await pin(`designer/${ID}`, "example-v1", "--by", "planner:G15")).exitCode).toBe(0);
    expect(load(join(slotDir, "pin.json")).basis).toBe("planner");
    expect((await pin(`designer/${ID}`, "example-v2", "--by", "planner:G15", "--basis", "picked")).exitCode).toBe(2);
    expect(load(join(slotDir, "pin.json")).candidate).toBe("example-v1.json");
  });

  it("requires an explicit --basis for an owner pin, and only picked, bulk or planner", async () => {
    const missing = await pin(`designer/${ID}`, "example-v1.json", "--by", "owner:2026-11-03 go");
    expect(missing).toMatchObject({ exitCode: 2, message: expect.stringMatching(/needs an explicit --basis/) });
    expect((await pin(`designer/${ID}`, "example-v1.json", "--basis", "maybe")).exitCode).toBe(2);
    expect((await pin(`designer/${ID}`, "--not-needed", "--reason", "x", "--basis", "bulk")).exitCode).toBe(2);
    expect(existsSync(join(slotDir, "pin.json"))).toBe(false);
    expect((await pin(`designer/${ID}`, "example-v1.json", "--by", "owner:2026-11-03 go", "--basis", "bulk")).exitCode).toBe(0);
    expect(load(join(slotDir, "pin.json"))).toMatchObject({ decidedBy: "owner:2026-11-03 go", basis: "bulk" });
  });

  it("takes the candidate id without its extension and a --by decider", async () => {
    const result = await pin(`designer/${ID}`, "example-v2", "--by", "planner:PIN-CLI");
    expect(result.exitCode).toBe(0);
    const written = load(join(slotDir, "pin.json"));
    expect(written).toMatchObject({ candidate: "example-v2.json", sha256: sha256Hex(second), decidedBy: "planner:PIN-CLI", basis: "planner" });
    expect(Date.parse(written.at)).not.toBeNaN();
  });

  it("refuses an unknown agent", async () => {
    const result = await pin(`stylist/${ID}`, "example-v1.json", "--basis", "bulk");
    expect(result).toMatchObject({ exitCode: 1, message: expect.stringMatching(/unknown agent stylist/) });
    expect(existsSync(join(slotDir, "pin.json"))).toBe(false);
  });

  it("refuses an unknown slot", async () => {
    const result = await pin("designer/components.missing", "example-v1.json", "--basis", "bulk");
    expect(result).toMatchObject({ exitCode: 1, message: expect.stringMatching(/unknown slot designer\/components\.missing/) });
  });

  it("refuses an unknown candidate", async () => {
    const result = await pin(`designer/${ID}`, "example-v9.json", "--basis", "bulk");
    expect(result).toMatchObject({ exitCode: 1, message: expect.stringMatching(/has no candidate example-v9\.json/) });
    expect(existsSync(join(slotDir, "pin.json"))).toBe(false);
  });

  it("refuses a candidate that fails the pin rules", async () => {
    const result = await pin(`designer/${ID}`, "broken-v1.json", "--basis", "bulk");
    expect(result).toMatchObject({ exitCode: 1, message: expect.stringMatching(/^pin refused: .*pin state/) });
    expect(existsSync(join(slotDir, "pin.json"))).toBe(false);
  });

  it("refuses a decider outside owner, planner or migrated", async () => {
    const result = await pin(`designer/${ID}`, "example-v1.json", "--by", "someone", "--basis", "bulk");
    expect(result).toMatchObject({ exitCode: 1, message: expect.stringMatching(/decidedBy must be/) });
    expect(existsSync(join(slotDir, "pin.json"))).toBe(false);
  });

  it("refuses a malformed target or a candidate together with --not-needed", async () => {
    expect((await pin(ID, "example-v1.json", "--basis", "bulk")).exitCode).toBe(2);
    expect((await pin(`designer/${ID}`, "example-v1.json", "--not-needed", "--reason", "x")).exitCode).toBe(2);
    expect((await pin(`designer/${ID}`)).exitCode).toBe(2);
  });

  it("replaces an earlier pin and clears a not-needed marker", async () => {
    await pin(`designer/${ID}`, "--not-needed", "--reason", "No toolbar.");
    expect((await pin(`designer/${ID}`, "example-v2.json", "--basis", "bulk")).exitCode).toBe(0);
    expect(load(join(slotDir, "slot.json")).notNeeded).toBeUndefined();
    expect(load(join(slotDir, "pin.json")).candidate).toBe("example-v2.json");
  });
});

describe("clossys pin <agent>/<slot> --not-needed --reason <text>", () => {
  it("writes slot.json notNeeded {reason, since, decidedBy} and removes the pin", async () => {
    await pin(`designer/${ID}`, "example-v1.json", "--basis", "bulk");
    const result = await pin(`designer/${ID}`, "--not-needed", "--reason", "The site has no toolbar.", "--at", "2026-11-03T08:00:00.000Z");
    expect(result.exitCode).toBe(0);
    expect(load(join(slotDir, "slot.json")).notNeeded).toEqual({ reason: "The site has no toolbar.", since: "2026-11-03", decidedBy: "owner" });
    expect(existsSync(join(slotDir, "pin.json"))).toBe(false);
  });

  it("refuses --not-needed without a reason, and on an unknown slot", async () => {
    expect((await pin(`designer/${ID}`, "--not-needed")).exitCode).toBe(2);
    expect((await pin(`designer/${ID}`, "--not-needed", "--reason", "  ")).exitCode).toBe(2);
    expect((await pin("designer/components.missing", "--not-needed", "--reason", "x")).exitCode).toBe(1);
    expect(load(join(slotDir, "slot.json")).notNeeded).toBeUndefined();
  });
});

describe("clossys decisions", () => {
  it("lists every slot as pinned, not-needed or open, with counts", async () => {
    await pin(`designer/${ID}`, "example-v1.json", "--basis", "picked");
    let result = await runCli(["decisions", "--json"], workspace);
    expect(result.exitCode).toBe(0);
    expect(result.decisions).toEqual({
      counts: { pinned: 1, "not-needed": 0, open: 1 },
      slots: [
        { slot: `designer/${ID}`, state: "pinned", candidate: "example-v1.json", decidedBy: "owner", basis: "picked" },
        { slot: `designer/${OTHER}`, state: "open", rejection: "no-pin" },
      ],
    });
    await pin(`designer/${OTHER}`, "--not-needed", "--reason", "Unused.");
    result = await runCli(["decisions"], workspace);
    expect(result.message).toMatch(/decisions: 2 slots, 1 pinned, 1 not-needed, 0 open$/);
    expect(result.message).toMatch(/^not-needed designer\/components\.other \(Unused\.\)$/m);
  });
});

describe("migrate-pin-decided-by", () => {
  it("carries the base pin's pinnedBy into decidedBy verbatim, through clossys pin", async () => {
    const pinPath = join(slotDir, "pin.json");
    const pinnedBy = "owner:2026-11-03 planner pins that pass the gate (SECTION-REPICK)";
    writeFileSync(pinPath, jsonBytes({ candidate: "example-v1.json", sha256: sha256Hex(good), pinnedBy, at: "2026-11-01T09:00:00Z" }));
    const git = (...args: string[]) => execFileSync("git", ["-C", workspace, ...args], { stdio: "pipe", encoding: "utf8" }).trim();
    git("init", "-q");
    git("add", "-A");
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "base");
    const base = git("rev-parse", "HEAD");
    // The earlier run dropped the provenance; the migration must recover it from the base commit.
    writeFileSync(pinPath, jsonBytes({ candidate: "example-v1.json", sha256: sha256Hex(good), decidedBy: "migrated", at: "2026-11-01T09:00:00Z" }));
    const script = fileURLToPath(new URL("../../scripts/migrate-pin-decided-by.mjs", import.meta.url));
    const { migratePins } = await import(script) as { migratePins: (options: object) => Promise<{ migrated: number; failures: string[] }> };
    const runPin = async (args: string[]) => { const result = await runCli(args, workspace); return { ok: result.exitCode === 0, output: result.message }; };
    const outcome = await migratePins({ repo: workspace, base, runPin });
    expect(outcome).toMatchObject({ migrated: 1, failures: [] });
    expect(load(pinPath)).toEqual({ candidate: "example-v1.json", sha256: sha256Hex(good), decidedBy: pinnedBy, basis: "planner", at: "2026-11-01T09:00:00Z" });
    expect(await migratePins({ repo: workspace, base, runPin })).toMatchObject({ migrated: 0, failures: [] });
  });
});

describe("backfill-pin-basis", () => {
  it("maps decidedBy to a basis deterministically and writes it through clossys pin", async () => {
    const script = fileURLToPath(new URL("../../scripts/backfill-pin-basis.mjs", import.meta.url));
    const { basisFor, backfill } = await import(script) as {
      basisFor: (decidedBy: string) => { basis: string };
      backfill: (options: object) => Promise<{ written: number; skipped: number; failures: string[] }>;
    };
    expect(basisFor("planner:CONVERGE-R2").basis).toBe("planner");
    expect(basisFor("owner:2026-11-03 planner pins that pass the gate (SECTION-REPICK)").basis).toBe("planner");
    expect(basisFor("owner:2026-11-03 planner-pin SPECIMEN-THEME").basis).toBe("planner");
    expect(basisFor("owner:2026-11-03 pin-if-agree").basis).toBe("bulk");
    expect(basisFor("owner:2026-11-03 GEN-DERIVED go").basis).toBe("bulk");
    expect(basisFor("owner:2026-11-03 one-brand clossys asterisk").basis).toBe("picked");
    expect(basisFor("owner:2026-11-03 fix-all").basis).toBe("bulk");
    const pinPath = join(slotDir, "pin.json");
    const before = { candidate: "example-v1.json", sha256: sha256Hex(good), decidedBy: "owner:2026-11-03 pin-if-agree", at: "2026-11-01T09:00:00Z" };
    writeFileSync(pinPath, jsonBytes(before));
    const runPin = async (args: string[]) => { const result = await runCli(args, workspace); return { ok: result.exitCode === 0, output: result.message }; };
    expect(await backfill({ repo: workspace, runPin })).toMatchObject({ written: 1, failures: [] });
    expect(load(pinPath)).toEqual({ ...before, basis: "bulk" });
    expect(await backfill({ repo: workspace, runPin })).toMatchObject({ written: 0, skipped: 1, failures: [] });
  });
});
