/**
 * The Producer seat tree regroups like any agent IA (IA-D5X-B): `clossys ia producer --add|--drop|
 * --reorder|--layers|--axes ...` and `clossys ia producer/<seat> --move --under`, each owner-authorized,
 * with every seat slot.json following producer ia.json. A NEW seat is placed only by `clossys seat
 * <step>`: `ia producer/<seat> --under` (with or without --contract) never creates one.
 */
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jsonBytes, slotPositions, type IaDoc } from "../records/slot-model/index.js";
import { checkSlotModel } from "../records/slot-check.js";
// Load the CLI first, as every caller does: owner.ts sits in an import cycle with the pipeline handlers.
import "./main.js";
import { runIaCli, runSeatCli } from "./owner.js";

const FIXTURE = fileURLToPath(new URL("../constitution/__fixtures__/standards/fixture-headline/", import.meta.url));
const AT = "2026-11-14T12:00:00.000Z";
const REF = "clossys/workspace#46 issuecomment-6881767482 (OWNER WORDS 2026-11-14 producer IA: workflows, not pipeline)";
const DECISIONS = { schema: "clossys.owner-decisions/1", decisions: [{ id: "6881767482", ref: REF, date: "2026-11-14", scope: ["ia"], summary: "Producer IA regroup." }] };
const PROCEDURE = ["--by", "owner", "--no-llm", "--procedure", "Compare each slot's candidates against its contract and pin one.", "--command", "clossys pin"];

let workspace: string;
let producer: string;
const load = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const iaDoc = () => load(join(producer, "ia.json")) as { nodes: { id: string; label: string; children: { id: string; slots: string[] }[] }[]; changes?: { op: string; ownerRef: string }[]; layers?: unknown };
const seatAt = (seat: string) => (load(join(producer, seat, "slot.json")) as { ia: Record<string, unknown> }).ia;
const seatEvents = (seat: string) => (load(join(producer, seat, "ledger.json")) as { events: Record<string, unknown>[] }).events;
/** Where producer ia.json places each seat: what every seat slot.json must say. */
function placements(): Map<string, { l1: string; l2: string; order: number }> {
  const rows = iaDoc().nodes.flatMap(node => node.children.flatMap(child => child.slots.map(id => ({ id, l1: node.id, l2: child.id }))));
  return new Map(rows.map((row, order) => [row.id, { l1: row.l1, l2: row.l2, order }]));
}
const followsIa = () => { for (const [seat, at] of placements()) expect(seatAt(seat), seat).toMatchObject(at); };
/** Every file under the workspace and its bytes: a refused or dry run must leave this unchanged. */
function tree(dir = workspace): Record<string, string> {
  const files: Record<string, string> = {};
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === ".clossys") continue;
    if (statSync(path).isDirectory()) Object.assign(files, tree(path));
    else files[relative(workspace, path)] = readFileSync(path, "utf8");
  }
  return files;
}
const ia = (...args: string[]) => runIaCli([...args, "--at", AT, "--root", workspace], workspace);
const owned = (...args: string[]) => ia(...args, "--owner-ref", "6881767482");
const seat = (step: string) => runSeatCli([step, ...PROCEDURE, "--root", workspace], workspace);

beforeEach(async () => {
  workspace = realpathSync(mkdtempSync(join(tmpdir(), "clossys-ia-producer-")));
  const consumer = join(workspace, "clossys");
  producer = join(consumer, "agents", "producer");
  mkdirSync(consumer, { recursive: true });
  writeFileSync(join(consumer, "clossys.config.ts"), "export default {};\n");
  writeFileSync(join(consumer, "owner-decisions.json"), jsonBytes(DECISIONS));
  // One slot agent, so the slot model check reads the whole consumer, producer seats included.
  const director = join(consumer, "agents", "director"), directorIa: IaDoc = { schema: "clossys.ia/1", source: "@clossys/director#leaf-freeze:fixture", extensions: [], nodes: [{ id: "context", label: "Context", children: [{ id: "context.market", label: "Market", slots: ["context.market.size"] }] }] };
  mkdirSync(join(director, "context.market.size"), { recursive: true });
  writeFileSync(join(director, "ia.json"), jsonBytes(directorIa));
  writeFileSync(join(director, "context.market.size", "slot.json"), jsonBytes({ schema: "clossys.slot/1", id: "context.market.size", agent: "director", ia: slotPositions("director", directorIa).get("context.market.size"), kind: "brief", contract: {}, inputs: [], uses: [] }));
  for (const step of ["owner.decisions", "pin.director", "reissue"]) {
    const result = await seat(step);
    expect(result.exitCode, result.message).toBe(0);
  }
  expect(checkSlotModel(consumer)).toEqual([]);
});
afterEach(() => rmSync(workspace, { recursive: true, force: true }));

describe("clossys seat places a new seat; ia never does", () => {
  it("places seat.reissue with clossys seat reissue (its stage publish.assemble is not a step)", async () => {
    expect(seatAt("seat.reissue")).toMatchObject({ l1: "publish", l2: "publish.assemble" });
    expect((await seat("publish.assemble")).message).toMatch(/publish\.assemble is not a decide step/);
  });

  it("refuses --under on a producer seat, with --contract or without, writing nothing", async () => {
    put("contract.json", { step: "migrate", fixture: { step: "migrate" } });
    const before = tree();
    await expect(owned("producer/seat.migrate", "--contract", join(workspace, "contract.json"), "--under", "publish/publish.assemble")).rejects.toThrow(/a new seat is placed by clossys seat migrate/);
    await expect(owned("producer/seat.migrate", "--under", "publish/publish.assemble")).rejects.toThrow(/a new seat is placed by clossys seat migrate/);
    await expect(owned("producer/seat.reissue", "--contract", join(workspace, "contract.json"), "--under", "direct/direct.pin")).rejects.toThrow(/a new seat is placed by clossys seat reissue/);
    // --move only moves a placed seat.
    expect(await owned("producer/seat.migrate", "--move", "--under", "publish/publish.assemble")).toMatchObject({ exitCode: 1, message: expect.stringMatching(/not placed in producer ia\.json; a new seat is placed by clossys seat migrate/) });
    await expect(owned("producer/seat.reissue", "--move", "--under", "direct/direct.pin", "--extension", "true")).rejects.toThrow(/never a consumer extension/);
    expect(tree()).toEqual(before);
  });
});

describe("clossys ia producer/<seat> --move --under", () => {
  it("moves a placed seat, owner-authorized; every seat slot.json follows ia.json and the moved seat's ledger records it", async () => {
    const before = tree();
    expect(await ia("producer/seat.reissue", "--move", "--under", "direct/direct.pin")).toMatchObject({ exitCode: 1, message: expect.stringMatching(/--owner-ref/) });
    expect(await owned("producer/seat.reissue", "--move", "--under", "direct/direct.pin", "--dry")).toMatchObject({ exitCode: 0, message: expect.stringMatching(/^ia --dry: producer moved seat\.reissue from publish\/publish\.assemble to direct\/direct\.pin/) });
    expect(tree()).toEqual(before);
    const moved = await owned("producer/seat.reissue", "--move", "--under", "direct/direct.pin");
    expect(moved.exitCode, moved.message).toBe(0);
    expect(iaDoc().nodes.find(node => node.id === "direct")!.children.find(child => child.id === "direct.pin")!.slots).toContain("seat.reissue");
    expect(seatAt("seat.reissue")).toMatchObject({ l1: "direct", l2: "direct.pin" });
    followsIa();
    expect(iaDoc().changes!.at(-1)).toMatchObject({ op: "move", ownerRef: REF });
    expect(seatEvents("seat.reissue").at(-1)).toMatchObject({ op: "slot", verb: "ia", by: "owner", at: AT });
    expect(checkSlotModel(join(workspace, "clossys"))).toEqual([]);
    expect(await owned("producer/seat.reissue", "--move", "--under", "direct/direct.pin")).toMatchObject({ exitCode: 0, message: expect.stringMatching(/already under direct\/direct\.pin; nothing written/) });
  });

  it("keeps the seat-position rule: clossys seat on a moved seat leaves it where the owner put it, and ia --standard records it there", async () => {
    expect((await owned("producer/seat.reissue", "--move", "--under", "direct/direct.pin")).exitCode).toBe(0);
    const where = seatAt("seat.reissue");
    const again = await seat("reissue");
    expect(again.exitCode, again.message).toBe(0);
    expect(seatAt("seat.reissue")).toEqual(where);
    followsIa();
    // A stale order is recorded at the ia.json position when the seat's standard is named (3S-ND c353c3ce6).
    const file = join(producer, "seat.reissue", "slot.json");
    writeFileSync(file, readFileSync(file, "utf8").replace(`"order": ${where.order as number}`, `"order": ${(where.order as number) + 5}`));
    const standard = join(workspace, "packages", "producer", "standards", "fixture-seat");
    cpSync(FIXTURE, standard, { recursive: true });
    const requirements = join(standard, "requirements.json");
    writeFileSync(requirements, readFileSync(requirements, "utf8").replace("\"fixture-headline\"", "\"fixture-seat\"").replace("[\"strings\"]", "[\"seat\"]"));
    const named = await ia("producer/seat.reissue", "--standard", "fixture-seat");
    expect(named.exitCode, named.message).toBe(0);
    expect(seatAt("seat.reissue")).toEqual(where);
  });
});

describe("clossys ia producer --add|--reorder|--drop|--layers|--axes", () => {
  it("regroups producer ia.json with an owner ref, refusing without one; seats follow every write", async () => {
    const before = tree();
    await expect(ia("director-not-an-agent", "--add", "x", "--label", "X")).rejects.toThrow(/director, designer, writer, publisher, producer/);
    expect(await ia("producer", "--add", "create", "--label", "Create")).toMatchObject({ exitCode: 1, message: expect.stringMatching(/--owner-ref/) });
    expect(tree()).toEqual(before);
    expect((await owned("producer", "--add", "create", "--label", "Create")).exitCode).toBe(0);
    expect((await owned("producer", "--add", "create/create.make", "--label", "Make")).exitCode).toBe(0);
    expect((await owned("producer/seat.pin.director", "--move", "--under", "create/create.make")).exitCode).toBe(0);
    followsIa();
    // The L2 groups of one L1 reorder; the seats in them renumber (order only).
    const groups = iaDoc().nodes.find(node => node.id === "direct")!.children.map(child => child.id);
    expect(groups.length).toBeGreaterThan(1);
    const reordered = await owned("producer", "--reorder", "direct", "--order", [...groups].reverse().join(","));
    expect(reordered.exitCode, reordered.message).toBe(0);
    expect(iaDoc().nodes.find(node => node.id === "direct")!.children.map(child => child.id)).toEqual([...groups].reverse());
    followsIa();
    // direct.pin is empty now: it drops; a group that still holds a seat does not.
    expect(await owned("producer", "--drop", "direct/direct.pin")).toMatchObject({ exitCode: 0 });
    expect(await owned("producer", "--drop", "create/create.make")).toMatchObject({ exitCode: 1, message: expect.stringMatching(/holds 1 leaves/) });
    expect(iaDoc().changes!.map(change => change.op)).toEqual(["add", "add", "move", "reorder", "drop"]);
    expect(checkSlotModel(join(workspace, "clossys"))).toEqual([]);
  });

  it("declares layers and axes on producer: every seat gains its L0", async () => {
    const l1 = iaDoc().nodes.map(node => node.id);
    put("layers.json", [{ id: "workflows", label: "Workflows", nodes: l1 }]);
    put("axes.json", { L0: { name: "area", values: ["Workflows"] }, L1: { workflows: { name: "workflow", values: iaDoc().nodes.map(node => node.label) } } });
    const layered = await owned("producer", "--layers", join(workspace, "layers.json"));
    expect(layered.exitCode, layered.message).toBe(0);
    expect(seatAt("seat.reissue").l0).toBeUndefined(); // layers are display-only until the axes are declared
    const axed = await owned("producer", "--axes", join(workspace, "axes.json"));
    expect(axed.exitCode, axed.message).toBe(0);
    for (const id of placements().keys()) expect(seatAt(id).l0, id).toBe("workflows");
    // With a layer, the L1 of that layer reorder too.
    const reordered = await owned("producer", "--reorder", "workflows", "--order", [...l1].reverse().join(","));
    expect(reordered.exitCode, reordered.message).toBe(0);
    expect(iaDoc().nodes.map(node => node.id)).toEqual([...l1].reverse());
    followsIa();
    expect(checkSlotModel(join(workspace, "clossys"))).toEqual([]);
  });
});

function put(path: string, value: unknown) {
  const file = join(workspace, path);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
}
