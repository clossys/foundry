import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256Hex } from "./hash.js";
import { planSlotFill, recordInitialCandidate } from "./slot-fill.js";
import { serializeFrontmatter, slotPositions, type IaDoc, type SlotAgent } from "./slot-model/index.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const json = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value));
const brief = serializeFrontmatter({ slot: "identity.brand.core", source: { kind: "original", ref: ["msg:brief#U1"] }, feeds: [], functions: [] }, "## Direction\n- Name: Example\n## Because\n- Owner brief\n## Watch\n- Drift\n");

function addAgent(root: string, agent: SlotAgent, ids: string[], inputs: string[] = []) {
  const dir = join(root, "agents", agent);
  mkdirSync(dir, { recursive: true });
  const ia: IaDoc = { schema: "clossys.ia/1", source: "consumer#fixture", extensions: [], nodes: [{ id: "identity", label: "Identity", children: [{ id: "core", label: "Core", slots: ids }] }] };
  json(join(dir, "ia.json"), ia);
  for (const [id, position] of slotPositions(agent, ia)) {
    const folder = join(dir, position.l1, position.l2, id);
    mkdirSync(folder, { recursive: true });
    json(join(folder, "slot.json"), { schema: "clossys.slot/1", id, agent, ia: position, kind: agent === "director" ? "brief" : agent === "writer" ? "strings" : agent === "designer" ? "element" : "page", contract: {}, inputs, uses: [] });
  }
}
function folder(root: string, agent: SlotAgent, id: string) { return join(root, "agents", agent, "identity", "core", id); }
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "slot-fill-")); roots.push(root);
  addAgent(root, "director", ["identity.brand.core"]);
  addAgent(root, "writer", ["strings.common", "strings.labels"], ["identity.brand.core"]);
  const dir = folder(root, "director", "identity.brand.core");
  mkdirSync(join(dir, "candidates"));
  writeFileSync(join(dir, "candidates", "brief-v1.md"), brief);
  json(join(dir, "pin.json"), { candidate: "brief-v1.md", sha256: sha256Hex(brief), pinnedBy: "owner:brief-approved", at: "2026-10-31T00:00:00Z" });
  return { root, dir };
}
function draft(root: string, slot = "strings.common") {
  const row = planSlotFill(root, "writer").rows.find(row => row.slot === slot)!;
  return serializeFrontmatter({ slot, locales: ["en"], source: { kind: "derived", ref: row.inputs.map(input => input.ref) } }, '## en\n### example.action\n<!-- {"id":"example.action","bindings":[]} -->\nContinue\n');
}

describe("initial fill preparation", () => {
  it("measures every current IA row in order without writing", () => {
    const { root } = fixture();
    const plan = planSlotFill(root, "writer");
    expect(plan).toMatchObject({ total: 2, withCandidate: 0, ready: 2, blocked: 0 });
    expect(plan.rows.map(row => row.slot)).toEqual(["strings.common", "strings.labels"]);
    expect(plan.rows[0]!.inputs[0]).toMatchObject({ bytes: brief });
    expect(readdirSync(folder(root, "writer", "strings.common")).sort()).toEqual(["slot.json"]);
  });

  it.each(["unpinned", "migration", "hash", "deleted"])("blocks an unclear input mutation: %s", mutation => {
    const { root, dir } = fixture();
    const bytes = draft(root);
    if (mutation === "unpinned") unlinkSync(join(dir, "pin.json"));
    if (mutation === "migration") {
      const pin = JSON.parse(readFileSync(join(dir, "pin.json"), "utf8"));
      json(join(dir, "pin.json"), { ...pin, pinnedBy: "migration:SLOT-MODEL" });
    }
    if (mutation === "hash") writeFileSync(join(dir, "candidates", "brief-v1.md"), `${brief}\nchanged`);
    if (mutation === "deleted") unlinkSync(join(dir, "candidates", "brief-v1.md"));
    expect(planSlotFill(root, "writer")).toMatchObject({ ready: 0, blocked: 2 });
    expect(() => recordInitialCandidate(root, "writer", "strings.common", "copy-v1.md", bytes)).toThrow(/WAITINPUT/);
    expect(readdirSync(folder(root, "writer", "strings.common")).sort()).toEqual(["slot.json"]);
  });

  it("records supplied copy once, unpinned, leaving all input bytes unchanged", () => {
    const { root, dir } = fixture();
    const pinBefore = readFileSync(join(dir, "pin.json"), "utf8"), bytes = draft(root);
    const path = recordInitialCandidate(root, "writer", "strings.common", "copy-v1.md", bytes);
    expect(readFileSync(path, "utf8")).toBe(bytes);
    expect(readdirSync(folder(root, "writer", "strings.common")).sort()).toEqual(["candidates", "slot.json"]);
    expect(readFileSync(join(dir, "pin.json"), "utf8")).toBe(pinBefore);
    expect(planSlotFill(root, "writer")).toMatchObject({ total: 2, withCandidate: 1, ready: 1 });
    expect(() => recordInitialCandidate(root, "writer", "strings.common", "copy-v2.md", bytes)).toThrow(/existing/);
    expect(readdirSync(join(folder(root, "writer", "strings.common"), "candidates")).sort()).toEqual(["copy-v1.md"]);
  });

  it("requires exact input citations and rejects candidate-side approval state", () => {
    const { root } = fixture();
    const bytes = draft(root);
    expect(() => recordInitialCandidate(root, "writer", "strings.common", "copy-v1.md", bytes.replace(/#sha256:[a-f0-9]+/, "#sha256:wrong"))).toThrow(/cite cleared input/);
    expect(() => recordInitialCandidate(root, "writer", "strings.common", "copy-v1.md", bytes.replace("locales:", 'status: "approved"\nlocales:'))).toThrow(/pin state/);
  });

  it("does not count an unknown file as candidate coverage", () => {
    const { root } = fixture();
    const dir = join(folder(root, "writer", "strings.common"), "candidates");
    mkdirSync(dir); writeFileSync(join(dir, "notes.txt"), "No candidate yet");
    expect(planSlotFill(root, "writer")).toMatchObject({ withCandidate: 0, ready: 1, blocked: 1 });
    expect(planSlotFill(root, "writer").rows[0]!.blockedBy).toEqual([{ slot: "strings.common", reason: "unexpected-candidate-file" }]);
  });

  it("records a Director root from supplied owner evidence without clearing it", () => {
    const root = mkdtempSync(join(tmpdir(), "slot-fill-")); roots.push(root);
    addAgent(root, "director", ["identity.brand.core"]);
    expect(planSlotFill(root, "director")).toMatchObject({ ready: 1, blocked: 0 });
    const path = recordInitialCandidate(root, "director", "identity.brand.core", "brief-v1.md", brief);
    expect(readFileSync(path, "utf8")).toBe(brief);
    expect(readdirSync(folder(root, "director", "identity.brand.core")).sort()).toEqual(["candidates", "slot.json"]);
  });

  it("blocks undeclared and unknown inputs instead of inferring from legacy stores", () => {
    const { root } = fixture();
    addAgent(root, "designer", ["components.button"]);
    expect(planSlotFill(root, "designer").rows[0]!.blockedBy).toEqual([{ slot: "components.button", reason: "inputs-undeclared" }]);
    addAgent(root, "designer", ["components.button"], ["identity.brand.absent"]);
    expect(planSlotFill(root, "designer").rows[0]!.blockedBy).toEqual([{ slot: "identity.brand.absent", reason: "missing" }]);
  });

  it("allows Designer options and Publisher assembly only from cleared input", () => {
    const { root } = fixture();
    addAgent(root, "designer", ["components.button"], ["identity.brand.core"]);
    const input = planSlotFill(root, "designer").rows[0]!.inputs[0]!;
    const bytes = JSON.stringify({ name: "button", type: "registry:ui", files: [{ path: "button.tsx", type: "registry:ui", content: "export const Button = () => null;" }], meta: { source: { kind: "registry", ref: ["registry:button", input.ref] } } });
    recordInitialCandidate(root, "designer", "components.button", "button-v1.json", bytes);
    addAgent(root, "publisher", ["page.home"], ["components.button", "strings.common"]);
    expect(planSlotFill(root, "publisher").rows[0]!.blockedBy.map(item => item.reason)).toEqual(["unpinned", "unpinned"]);
  });

  it("fails closed without a migrated IA, on duplicate slots, or misplaced metadata", () => {
    const { root } = fixture();
    expect(() => planSlotFill(root, "publisher")).toThrow(/WAITINPUT/);
    const path = join(root, "agents", "writer", "ia.json");
    const ia = JSON.parse(readFileSync(path, "utf8"));
    ia.nodes[0].children[0].slots.push("strings.common");
    json(path, ia);
    expect(() => planSlotFill(root, "writer")).toThrow(/IA invalid/);
    ia.nodes[0].children[0].slots.pop(); json(path, ia);
    const docPath = join(folder(root, "writer", "strings.common"), "slot.json");
    const doc = JSON.parse(readFileSync(docPath, "utf8"));
    json(docPath, { ...doc, ia: { ...doc.ia, order: 99 } });
    expect(() => planSlotFill(root, "writer")).toThrow(/does not match/);
  });
});
