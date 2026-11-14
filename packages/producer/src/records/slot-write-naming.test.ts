import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jsonBytes, serializeFrontmatter, slotPositions, type IaDoc } from "./slot-model/index.js";
import { nextVersion, writeCandidate } from "./slot-write.js";

const ID = "identity.brand.essence";
const source = { kind: "original", ref: [] };
const brief = (essence: string) => serializeFrontmatter({ slot: ID, source, feeds: [], functions: [] }, `## Direction\n- Essence: ${essence}\n\n## Because\n- y\n\n## Watch\n- z\n`);
let root: string, consumer: string, dir: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "slot-write-naming-")));
  consumer = join(root, "clossys");
  const ia: IaDoc = { schema: "clossys.ia/1", source: "synthetic#fixture", extensions: [], nodes: [
    { id: "identity", label: "Identity", children: [{ id: "identity.brand", label: "Brand", slots: [ID] }] },
  ] };
  mkdirSync(join(consumer, "agents", "director"), { recursive: true });
  writeFileSync(join(consumer, "agents", "director", "ia.json"), jsonBytes(ia));
  dir = join(consumer, "agents", "director", ID);
  mkdirSync(join(dir, "candidates"), { recursive: true });
  writeFileSync(join(dir, "slot.json"), jsonBytes({ schema: "clossys.slot/1", id: ID, agent: "director", ia: slotPositions("director", ia).get(ID), kind: "brief", contract: {}, inputs: [], uses: [] }));
  writeFileSync(join(consumer, "clossys.config.ts"), "export default {};\n");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const seed = (file: string, essence = file) => writeFileSync(join(dir, "candidates", file), brief(essence));
const write = (name: string, essence: string) => writeCandidate(consumer, "director", ID, name, brief(essence)).name;

describe("candidate versions are numbered per slot, across every stem (constitution R08.1)", () => {
  it("gives an empty slot v1", () => {
    expect(write("essence", "first")).toBe("essence-v1.md");
  });

  it("continues the same stem's numbering", () => {
    seed("essence-v1.md");
    seed("essence-v2.md");
    expect(write("essence", "third")).toBe("essence-v3.md");
  });

  it("numbers a new stem after the slot's highest version, never restarting at v1", () => {
    for (let version = 1; version <= 24; version += 1) seed(`studio-v${version}.md`);
    expect(write("essence", "renamed")).toBe("essence-v25.md");
    expect(existsSync(join(dir, "candidates", "essence-v1.md"))).toBe(false);
    // Existing files are never renamed.
    expect(readdirSync(join(dir, "candidates")).filter(file => file.startsWith("studio-"))).toHaveLength(24);
  });

  it("counts retired candidates, so a retired version number is not reused", () => {
    seed("studio-v1.md");
    mkdirSync(join(dir, "retired"), { recursive: true });
    writeFileSync(join(dir, "retired", "studio-v7.md"), brief("retired"));
    writeFileSync(join(dir, "retired", "studio-v7.md.json"), "{}\n");
    expect(nextVersion(dir, ["studio-v1.md"])).toBe(8);
    expect(write("essence", "after retired")).toBe("essence-v8.md");
  });
});
