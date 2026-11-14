/**
 * `clossys ia sync` writes (SOURCE-MIGRATE step 3): the consumer IA is refreshed from the package IA.
 * Declared extensions, candidates, pins and ledger history stay; an unadopted package leaf is adopted;
 * a second run writes nothing; a placed leaf that is neither packaged nor declared refuses the sync.
 */
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// Load the CLI first, as every caller does: owner.ts sits in an import cycle with the pipeline handlers.
import "./main.js";
import { runIaCli } from "./owner.js";
import { FIXTURE_CONSUMER_ROOT } from "../records/slot-model/fixture-consumer.test.js";
import { SYNC_AGENTS, syncDrift } from "../records/slot-model/ia-sync.js";

const temps: string[] = [];
afterEach(() => { for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function copy(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ia-sync-cli-")));
  temps.push(root);
  cpSync(join(FIXTURE_CONSUMER_ROOT, "clossys"), join(root, "clossys"), { recursive: true });
  return root;
}
function tree(dir: string, base = dir, out: Record<string, string> = {}): Record<string, string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) tree(path, base, out); else out[relative(base, path)] = readFileSync(path, "utf8");
  }
  return out;
}
const iaFile = (root: string, agent: string) => join(root, "clossys", "agents", agent, "ia.json");
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const writeJson = (path: string, doc: unknown) => writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
const consumerOf = (root: string) => join(root, "clossys");

describe("ia sync (write)", () => {
  it("adopts an unadopted package leaf, keeps a declared extension and its records, and a re-run writes nothing", async () => {
    const root = copy();
    const ia = readJson(iaFile(root, "writer"));
    const group = ia.nodes[0].children[0];
    const dropped: string = group.slots[0];
    // The leaf is unadopted: neither placed nor on disk.
    group.slots = group.slots.slice(1);
    // A declared extension placed at the end of the group, with its own slot.json and a pin record.
    const extension = "lexicon.fixture-extension";
    group.slots.push(extension);
    ia.extensions = [...(ia.extensions ?? []), extension];
    writeJson(iaFile(root, "writer"), ia);
    rmSync(join(root, "clossys", "agents", "writer", dropped), { recursive: true, force: true });
    const template = readJson(join(root, "clossys", "agents", "writer", group.slots[0], "slot.json"));
    const extDir = join(root, "clossys", "agents", "writer", extension);
    cpSync(join(root, "clossys", "agents", "writer", group.slots[0]), extDir, { recursive: true });
    writeJson(join(extDir, "slot.json"), { ...template, id: extension, contract: { ...template.contract, slot: extension, purpose: "A consumer-declared extension." } });
    const extensionBefore = tree(extDir);

    const sync = await runIaCli(["sync", "--root", root], root);
    expect(sync.exitCode, sync.message).toBe(0);
    expect(sync.message).toContain(`adopted ${dropped}`);
    for (const agent of SYNC_AGENTS) expect(syncDrift(consumerOf(root), agent), agent).toEqual([]);
    expect(existsSync(join(root, "clossys", "agents", "writer", dropped, "slot.json"))).toBe(true);
    const after = readJson(iaFile(root, "writer"));
    expect(after.extensions).toContain(extension);
    expect(after.nodes[0].children[0].slots).toContain(extension);
    // The extension keeps its own contract; only its ledger may gain a position event.
    const extensionAfter = tree(extDir);
    expect(extensionAfter["slot.json"] && JSON.parse(extensionAfter["slot.json"]).contract).toEqual(JSON.parse(extensionBefore["slot.json"]!).contract);
    for (const [file, bytes] of Object.entries(extensionBefore)) if (file !== "slot.json" && file !== "ledger.json") expect(extensionAfter[file], file).toBe(bytes);

    const before = tree(consumerOf(root));
    const again = await runIaCli(["sync", "--root", root], root);
    expect(again.exitCode, again.message).toBe(0);
    expect(again.message).toMatch(/nothing written/);
    expect(tree(consumerOf(root))).toEqual(before);
  }, 60_000);

  it("refuses a placed leaf that is neither a package leaf nor a declared extension, writing nothing", async () => {
    const root = copy();
    const ia = readJson(iaFile(root, "writer"));
    ia.nodes[0].children[0].slots.push("lexicon.not-a-package-leaf");
    writeJson(iaFile(root, "writer"), ia);
    const before = tree(consumerOf(root));
    const result = await runIaCli(["sync", "--root", root], root);
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/neither package leaves nor declared extensions/);
    expect(tree(consumerOf(root))).toEqual(before);
  }, 60_000);

  it("--dry lists the writes and writes nothing", async () => {
    const root = copy();
    const ia = readJson(iaFile(root, "designer"));
    ia.layers = [{ id: "hand", label: "Hand", nodes: [ia.nodes[0].id] }];
    writeJson(iaFile(root, "designer"), ia);
    const before = tree(consumerOf(root));
    const result = await runIaCli(["sync", "--dry", "--root", root], root);
    expect(result.exitCode, result.message).toBe(0);
    expect(result.message).toMatch(/would write 1 file/);
    expect(tree(consumerOf(root))).toEqual(before);
  }, 60_000);
});
