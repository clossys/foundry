import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "../records/hash.js";
import { jsonBytes, slotPositions, validatePin, type IaDoc } from "../records/slot-model/index.js";
import { checkSlotModel } from "../records/slot-check.js";
import { registerGuardRunner, writeCandidate } from "../records/slot-write.js";
import { writeTargetPin } from "../records/pin-map.js";
import { runCli } from "./main.js";

// One format (foundry-build-0048 U13): clossys pin writes clossys.slot/2 and clossys.pin/2 only. On this minimal
// clossys.slot/1 fixture every pin form (candidate, --not-needed, --confirm) and clossys pick refuse with the migrate
// message and write nothing; the slot/2 mechanics (deciders, CHOOSE gate, confirm, pin-map records) are proven in
// one-format.test.ts, records/pin.test.ts and the gate tests. What still reads the old records in an unconverted
// store (clossys decisions, the pin record check) is pinned here on hand-written pin/1 files.
// The guard registers its runner when constitution/guard.ts loads (through ./main.js); this file swaps in one that finds nothing.
beforeEach(() => registerGuardRunner({ run: () => [], messages: () => [] }));

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
const MIGRATE = /is a clossys\.slot\/1 slot; this verb writes clossys\.slot\/2 and clossys\.pin\/2 only: run clossys migrate slots --apply first/;
const REF = "clossys/workspace#46 issuecomment-1";
const AT = "2026-11-03T12:00:00.000Z";

/** Every file under the consumer with its bytes: what "writes nothing" compares. */
function tree(dir = join(workspace, "clossys")): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) Object.assign(out, tree(path));
    else out[path] = readFileSync(path, "utf8");
  }
  return out;
}

describe("clossys pin on a clossys.slot/1 slot (one format)", () => {
  it("refuses every pin form with the migrate message and writes nothing", async () => {
    const before = tree();
    for (const args of [
      ["example-v1.json", "--basis", "picked", "--at", AT],
      ["example-v1", "--by", "planner:G15"],
      ["example-v2", "--by", "owner:2026-11-03 go", "--basis", "bulk"],
      ["--not-needed", "--reason", "The site has no toolbar."],
      ["example-v1", "--confirm", "--ref", REF],
    ]) {
      const result = await pin(`designer/${ID}`, ...args);
      expect(result.exitCode, args.join(" ")).toBe(1);
      expect(result.message, args.join(" ")).toMatch(MIGRATE);
    }
    expect(tree()).toEqual(before);
    expect(existsSync(join(slotDir, "pin.json"))).toBe(false);
  });

  it("refuses an agent seat's pick through clossys pick the same way", async () => {
    const before = tree();
    const result = await runCli(["pick", `designer/${ID}`, "example-v1", "--by", "agent:designer"], workspace);
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(MIGRATE);
    expect(tree()).toEqual(before);
  });

  it("refuses an unknown agent and an unknown slot by name, not with the migrate message", async () => {
    const agent = await pin(`stylist/${ID}`, "example-v1.json", "--basis", "bulk");
    expect(agent).toMatchObject({ exitCode: 1, message: expect.stringMatching(/unknown agent stylist/) });
    const slot = await pin("designer/components.missing", "example-v1.json", "--basis", "bulk");
    expect(slot).toMatchObject({ exitCode: 1, message: expect.stringMatching(/unknown slot designer\/components\.missing/) });
    expect(existsSync(join(slotDir, "pin.json"))).toBe(false);
  });

  it("refuses a malformed target as a usage error", async () => {
    expect((await pin(ID, "example-v1.json", "--basis", "bulk")).exitCode).toBe(2);
  });
});

describe("clossys decisions (an unconverted store still reads its pin/1 records)", () => {
  it("lists every slot as pinned, not-needed or open, with counts", async () => {
    writeFileSync(join(slotDir, "pin.json"), jsonBytes({ candidate: "example-v1.json", sha256: sha256Hex(good), decidedBy: "owner", basis: "picked", at: AT }));
    let result = await runCli(["decisions", "--json"], workspace);
    expect(result.exitCode).toBe(0);
    expect(result.decisions).toEqual({
      counts: { pinned: 1, "not-needed": 0, open: 1 },
      slots: [
        { slot: `designer/${ID}`, state: "pinned", candidate: "example-v1.json", decidedBy: "owner", basis: "picked" },
        { slot: `designer/${OTHER}`, state: "open", rejection: "no-pin" },
      ],
    });
    const other = join(workspace, "clossys", "agents", "designer", OTHER, "slot.json");
    writeFileSync(other, jsonBytes({ ...load(other), notNeeded: { reason: "Unused.", since: "2026-11-03", decidedBy: "owner" } }));
    result = await runCli(["decisions"], workspace);
    expect(result.message).toMatch(/decisions: 2 slots, 1 pinned, 1 not-needed, 0 open$/);
    expect(result.message).toMatch(/^not-needed designer\/components\.other \(Unused\.\)$/m);
  });
});

describe("one-shot migration writers name their consumer root", () => {
  it.each(["backfill-pin-basis", "migrate-pin-decided-by", "lift-writer-keys"])("%s refuses to run without --repo, writing nothing", (name) => {
    const script = fileURLToPath(new URL(`../../scripts/${name}.mjs`, import.meta.url));
    for (const args of [[], ["--repo"], ["--repo", "--dry-run"]]) {
      const result = spawnSync(process.execPath, [script, ...args], { cwd: workspace, encoding: "utf8" });
      expect(result.status, `${name} ${args.join(" ")}`).toBe(2);
      expect(result.stderr).toMatch(/name the consumer root: --repo/);
    }
  });
});

// The one-shot pin/1 rewriters write through clossys pin, which no longer writes a pin/1: each reports the refusal
// as a failure and leaves the pin as it was (clossys migrate slots converts the store instead).
describe("migrate-pin-decided-by", () => {
  it("fails through clossys pin on a clossys.slot/1 store and leaves the pin as it was", async () => {
    const pinPath = join(slotDir, "pin.json");
    const pinnedBy = "owner:2026-11-03 planner pins that pass the gate (SECTION-REPICK)";
    writeFileSync(pinPath, jsonBytes({ candidate: "example-v1.json", sha256: sha256Hex(good), pinnedBy, at: "2026-11-01T09:00:00Z" }));
    const git = (...args: string[]) => execFileSync("git", ["-C", workspace, ...args], { stdio: "pipe", encoding: "utf8" }).trim();
    git("init", "-q");
    git("add", "-A");
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "base");
    const base = git("rev-parse", "HEAD");
    writeFileSync(pinPath, jsonBytes({ candidate: "example-v1.json", sha256: sha256Hex(good), decidedBy: "migrated", at: "2026-11-01T09:00:00Z" }));
    const before = readFileSync(pinPath, "utf8");
    const script = fileURLToPath(new URL("../../scripts/migrate-pin-decided-by.mjs", import.meta.url));
    const { migratePins } = await import(script) as { migratePins: (options: object) => Promise<{ migrated: number; failures: string[] }> };
    const runPin = async (args: string[]) => { const result = await runCli(args, workspace); return { ok: result.exitCode === 0, output: result.message }; };
    const outcome = await migratePins({ repo: workspace, base, runPin });
    expect(outcome.migrated).toBe(0);
    expect(outcome.failures).toEqual([expect.stringMatching(MIGRATE)]);
    expect(readFileSync(pinPath, "utf8")).toBe(before);
  });
});

describe("backfill-pin-basis", () => {
  it("maps decidedBy to a basis deterministically; writing it through clossys pin fails on a clossys.slot/1 store", async () => {
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
    writeFileSync(pinPath, jsonBytes({ candidate: "example-v1.json", sha256: sha256Hex(good), decidedBy: "owner:2026-11-03 pin-if-agree", at: "2026-11-01T09:00:00Z" }));
    const before = readFileSync(pinPath, "utf8");
    const runPin = async (args: string[]) => { const result = await runCli(args, workspace); return { ok: result.exitCode === 0, output: result.message }; };
    const outcome = await backfill({ repo: workspace, runPin });
    expect(outcome.written).toBe(0);
    expect(outcome.failures).toEqual([expect.stringMatching(MIGRATE)]);
    expect(readFileSync(pinPath, "utf8")).toBe(before);
  });
});

// A confirmation cites the ledger comment that holds the owner's words; e144bec93 cited a launch instruction.
describe("a pin/1 confirmation's ref (the record rule, read in an unconverted store)", () => {
  it("validates a ledger-comment ref, and the record check fails a confirmation written without one", () => {
    const agentPick = { candidate: "example-v1.json", sha256: sha256Hex(good), decidedBy: "agent:designer", basis: "agent", at: "2026-11-11T10:00:00.000Z" };
    for (const ref of [REF, "https://github.com/clossys/workspace/issues/46#issuecomment-6811506269", `${REF} (OWNER WORDS r9, option a)`]) {
      expect(validatePin({ ...agentPick, confirmed: { by: "owner", ref, at: "2026-11-11T23:30:00.000Z" } }), ref).toEqual([]);
    }
    const forged = { ...agentPick, confirmed: { by: "owner", ref: "owner standing instruction 2026-11-12", at: "2026-11-12T00:00:00.000Z" } };
    expect(validatePin(forged).map(issue => issue.message)).toEqual([expect.stringContaining("must cite the ledger comment")]);
    writeFileSync(join(slotDir, "pin.json"), jsonBytes(forged));
    expect(checkSlotModel(join(workspace, "clossys")).filter(issue => issue.code === "pin-invalid").map(issue => issue.message)).toEqual([expect.stringContaining("must cite the ledger comment")]);
  });
});

describe("a Writer pin that would record a key another pinned slot holds (CP1-COPYKEY)", () => {
  const FIXTURE = fileURLToPath(new URL("../../test-fixtures/consumer/", import.meta.url));
  const HEADER = "frames.site-header.copy";
  const FOOTER = "frames.site-footer.copy";
  const row = (id: string, text: string) => `### ${id}\n<!-- {"id":${JSON.stringify(id)},"bindings":[]} -->\n${text}\n`;
  /** Every file under `dir` with its bytes, sorted: the tree a refused pin must leave as it was. */
  const snapshot = (dir: string): string[] => readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name))
    .map(path => `${path}\t${sha256Hex(readFileSync(path))}`).sort();

  it("pin refuses a duplicate global id and writes nothing", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "clossys-pin-copykey-")));
    try {
      cpSync(FIXTURE, root, { recursive: true });
      const clossys = join(root, "clossys");
      const header = readFileSync(join(clossys, "agents/writer", HEADER, "candidates/copy-v1.md"), "utf8");
      const split = header.indexOf("## en");
      // The footer holds the authored global id `site.brand.name`, which no contract declares, pinned through the record writers.
      const footer = writeCandidate(clossys, "writer", FOOTER, "copy", `${header.slice(0, split).replaceAll(HEADER, FOOTER)}## en\n\n${row("navigation.label", "Footer navigation")}\n${row("site.brand.name", "Clossys")}`);
      writeTargetPin(root, { agent: "writer", slotId: FOOTER, record: "copy", candidate: footer.name, decidedBy: "planner", basis: "planner", at: "2026-11-26T00:00:00Z", createdBy: { actor: "code", cli: "clossys pin", version: "0.1.0" } });
      // A new header candidate repeats it: its contract keys stay its own, the global id would be recorded twice.
      const next = writeCandidate(clossys, "writer", HEADER, "copy", `${header.slice(0, split).replace(`${HEADER}/copy-v1.md`, `${HEADER}/copy-v2.md`)}${header.slice(split).trimEnd()}\n\n${row("site.brand.name", "Clossys")}`);
      const before = snapshot(clossys);
      const result = await runCli(["pin", `writer/${HEADER}#copy`, next.name, "--by", "planner", "--at", "2026-11-26T00:00:00Z", "--root", root], root);
      expect(result.exitCode).toBe(1);
      expect(result.message).toContain(`pin refused: writer/${HEADER}#copy ${next.name} would record a Writer key another pinned slot holds`);
      expect(result.message).toContain(`site.brand.name: ${FOOTER} already records this key`);
      expect(result.message).toContain(`rename the row in ${next.name}, or drop it and cite ${FOOTER}#site.brand.name`);
      // The contract key both slots hold (`navigation.label`) is no clash: each slot's own key.
      expect(result.message).not.toContain("navigation.label");
      expect(snapshot(clossys)).toEqual(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
