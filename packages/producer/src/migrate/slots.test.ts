/**
 * F4 on a synthetic consumer: the producer agents-workspace fixture plus the
 * Designer receipted-cells fixture. No product content.
 */
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listSlots, readiness, slotIndex, usedBy } from "../records/slots.js";
import { candidatesDir, designerIa, jsonBytes, parseFrontmatter, pinFile, slotFile, withExtensions } from "../records/slot-model/index.js";
import { hashFiles } from "../records/hash.js";
import { inventory } from "../server/cells.js";
import { checkSlotModel, compareSlotModel } from "./slot-check.js";
import { planMigration, writePlan } from "./slots.js";

const here = dirname(fileURLToPath(import.meta.url));
const workspaceFixture = join(here, "../server/__fixtures__/agents-workspace/clossys");
const designerFixture = join(here, "../../../designer/src/library-cli/__fixtures__/agent-receipted-cells/clossys/agents/designer");

let root: string, consumer: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "slot-migrate-")));
  consumer = join(root, "clossys");
  cpSync(workspaceFixture, consumer, { recursive: true });
  cpSync(designerFixture, join(consumer, "agents/designer"), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (path: string) => {
    for (const name of readdirSync(path).sort()) {
      const full = join(path, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.set(relative(dir, full), readFileSync(full, "utf8"));
    }
  };
  walk(dir);
  return out;
}
const migrate = async () => writePlan(await planMigration(consumer));
const issueCodes = () => checkSlotModel(consumer).map(issue => issue.code);
const pinnedSlot = (agent: "publisher" | "designer" | "director") => {
  const entry = listSlots(consumer, agent).find(slot => slot.pin);
  if (!entry) throw new Error(`no pinned ${agent} slot`);
  return entry;
};

describe("clossys migrate slots", () => {
  it("is idempotent, validates and re-derives the old projections", async () => {
    const first = await migrate();
    expect(first.written.length).toBeGreaterThan(0);
    const before = snapshot(consumer);
    const second = await migrate();
    expect(second.written).toEqual([]);
    expect(second.kept).toEqual([]);
    expect(snapshot(consumer)).toEqual(before);
    expect(checkSlotModel(consumer)).toEqual([]);
    expect(await compareSlotModel(consumer)).toEqual([]);
  });

  it("accepts the Writer key declarations file beside ia.json, while another agent-level file is an orphan", async () => {
    await migrate();
    writeFileSync(join(consumer, "agents", "writer", "declarations.json"), jsonBytes({ keys: [] }));
    expect(checkSlotModel(consumer)).toEqual([]);
    writeFileSync(join(consumer, "agents", "writer", "stray.json"), jsonBytes({}));
    expect(checkSlotModel(consumer)).toEqual([expect.objectContaining({ code: "orphan", path: "agents/writer/stray.json" })]);
  });

  it("preserves later declared wiring while refreshing generated metadata on rerun", async () => {
    await migrate();
    const entry = pinnedSlot("publisher");
    const path = slotFile(entry.dir);
    const original = JSON.parse(readFileSync(path, "utf8"));
    const wiring = { inputs: ["identity.brand.essence"], uses: ["strings.common"] };
    const candidatePath = join(candidatesDir(entry.dir), entry.pin!.candidate);
    const candidate = readFileSync(candidatePath, "utf8");
    const pin = readFileSync(pinFile(entry.dir), "utf8");
    writeFileSync(path, jsonBytes({ ...original, ...wiring, contract: { stale: true }, ia: { ...original.ia, order: original.ia.order + 1 } }));
    const plan = await planMigration(consumer);
    const planned = JSON.parse(plan.files.get(relative(consumer, path))!);
    expect(planned).toEqual({ ...original, ...wiring });
    writePlan(plan);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ ...original, ...wiring });
    expect(readFileSync(candidatePath, "utf8")).toBe(candidate);
    expect(readFileSync(pinFile(entry.dir), "utf8")).toBe(pin);
    const before = snapshot(consumer);
    expect((await migrate()).written).toEqual([]);
    expect(snapshot(consumer)).toEqual(before);
  });

  it("preserves explicitly cleared wiring instead of restoring legacy links", async () => {
    await migrate();
    const entry = pinnedSlot("publisher");
    const path = slotFile(entry.dir);
    const original = JSON.parse(readFileSync(path, "utf8"));
    expect([...original.inputs, ...original.uses].length).toBeGreaterThan(0);
    writeFileSync(path, jsonBytes({ ...original, inputs: [], uses: [] }));
    expect((await migrate()).written).toEqual([]);
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ inputs: [], uses: [] });
  });

  it("keeps unresolved declared refs visible to model checks on rerun", async () => {
    await migrate();
    const entry = pinnedSlot("publisher");
    const path = slotFile(entry.dir);
    const original = JSON.parse(readFileSync(path, "utf8"));
    const edited = { ...original, inputs: ["identity.brand.essence"], uses: ["strings.unknown"] };
    writeFileSync(path, jsonBytes(edited));
    expect((await migrate()).written).toEqual([]);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(edited);
    expect(issueCodes()).toEqual(["ref-unknown"]);
  });

  it.each(["id", "agent", "kind", "ia", "schema", "refs", "malformed"])("does not retain wiring from a stale or invalid %s", async field => {
    await migrate();
    const entry = pinnedSlot("publisher");
    const path = slotFile(entry.dir);
    const original = JSON.parse(readFileSync(path, "utf8"));
    const edited = { ...original, inputs: ["identity.brand.essence"], uses: ["strings.common"] };
    if (field === "id") edited.id = "page.other";
    if (field === "agent") edited.agent = "designer";
    if (field === "kind") edited.kind = "publication";
    if (field === "ia") edited.ia = { ...edited.ia, l2: "other" };
    if (field === "schema") edited.schema = "clossys.slot/0";
    if (field === "refs") edited.uses = ["invalid ref"];
    writeFileSync(path, field === "malformed" ? "{" : jsonBytes(edited));
    await migrate();
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(original);
  });

  it("migrates the active brief, page and strings with pins", async () => {
    await migrate();
    const brief = listSlots(consumer, "director").find(slot => slot.id === "identity.brand.essence");
    expect(brief?.pin?.pinnedBy).toMatch(/^owner:/);
    expect(listSlots(consumer, "publisher").find(slot => slot.id === "page.about")?.pin?.candidate).toBe("page-v1.json");
    const strings = listSlots(consumer, "writer").find(slot => slot.id === "strings.common");
    expect(strings?.candidates).toContain("migrated-v1.md");
    expect(strings?.candidates).toContain("draft-v1.md");
    expect(readiness(consumer, "director", "identity.brand.essence")).toEqual({ ready: true, blockedBy: [] });
    expect(slotIndex(consumer).get("strings.common")?.agent).toBe("writer");
    expect(usedBy(consumer, "sections.hero")).toContainEqual({ agent: "publisher", id: "page.about" });
  });

  it("switches the Studio inventory to the slot model once ia.json exists", async () => {
    const old = await inventory(root, "publisher");
    expect(old.cells.map(cell => cell.id)).toEqual(["page.about"]);
    await migrate();
    const next = await inventory(root, "publisher");
    expect(next.state).toBe("ready");
    expect(next.cells.find(cell => cell.id === "page.about")).toMatchObject({ status: "active", version: 1, fields: { path: "/about" } });
    expect((next.tree as { active: Record<string, number> }).active["page.about"]).toBe(1);
  });

  describe("Designer consumer extensions", () => {
    const id = "sections.consumer.sample";
    const contract = { schema: "clossys.slot-contract/1", slot: id, package: "producer", layer: "sections", purpose: "Recorded sample section", inputs: [], limits: {}, references: [], checkSuite: "sample", specimenKind: "visual" };
    const source = { registry: "sample", item: "card", version: "1.0.0", hash: "sha256:" + "a".repeat(64), url: "https://example.com/card.json" };
    const parent = { version: 1, hash: "sha256:" + "b".repeat(64) };
    const prepare = (admit: boolean) => {
      const dir = join(consumer, "library", id, "sample", "v2");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "index.tsx"), "export const Sample = () => null;\n");
      const hash = hashFiles(dir, ["index.tsx"]);
      writeFileSync(join(dir, "element.json"), jsonBytes({ id: "sample", slot: id, kind: "registry:block", payload: ["index.tsx"], hash, lineage: { mode: "customized", source, parent }, deps: { elements: [{ slot: "sections.hero", element: "hero", version: 1, hash }] } }));
      const contracts = join(consumer, "agents/designer/slot-contracts");
      mkdirSync(contracts, { recursive: true });
      writeFileSync(join(contracts, "consumer.json"), jsonBytes([contract]));
      writeFileSync(join(consumer, "selection.json"), jsonBytes({ pins: { [id]: { element: "sample", version: 2, hash, event: "selected" } }, history: [{ id: "selected", at: "2026-10-20T10:30:00Z" }] }));
      if (admit) writeFileSync(join(consumer, "agents/designer/ia.json"), jsonBytes(withExtensions("designer", designerIa().ia, [id])));
      return hash;
    };

    it("preserves admitted contracts, structured provenance, dependencies and original pin time", async () => {
      const hash = prepare(true);
      await migrate();
      expect(JSON.parse(readFileSync(join(consumer, "agents/designer/ia.json"), "utf8")).extensions).toEqual([id]);
      const slot = listSlots(consumer, "designer").find(entry => entry.id === id)!;
      const doc = JSON.parse(readFileSync(slotFile(slot.dir), "utf8"));
      expect(doc.contract).toEqual(contract);
      expect(doc.uses).toContain("sections.hero");
      expect(usedBy(consumer, "sections.hero")).toContainEqual({ agent: "designer", id });
      expect(slot.pin).toMatchObject({ candidate: "sample-v2.json", at: "2026-10-20T10:30:00Z", pinnedBy: "migration:SLOT-MODEL" });
      const candidate = JSON.parse(readFileSync(join(candidatesDir(slot.dir), "sample-v2.json"), "utf8"));
      expect(candidate.files[0].content).toBe("export const Sample = () => null;\n");
      expect(candidate.meta.source.hash).toBe(hash);
      expect(candidate.meta.source.kind).toBe("derived");
      expect(candidate.meta.source.ref.map((ref: string) => JSON.parse(ref))).toEqual(expect.arrayContaining([source, parent]));
      expect(await compareSlotModel(consumer)).toEqual([]);
      const before = snapshot(consumer);
      expect((await migrate()).written).toEqual([]);
      expect(snapshot(consumer)).toEqual(before);
    });

    it("does not admit a contract or pin without an owner-signed IA extension", async () => {
      prepare(false);
      const plan = await planMigration(consumer);
      expect(plan.agents.designer.offIa).toContain(id);
      expect(plan.agents.designer.slots.has(id)).toBe(false);
      expect(plan.agents.designer.ia.extensions).toEqual([]);
      writePlan(plan);
      expect(listSlots(consumer, "designer").some(slot => slot.id === id)).toBe(false);
    });

    it.each(["malformed JSON", "nonstring extension", "unplaced extension", "invalid IA node"])("rejects %s before writing consumer files", async invalid => {
      prepare(true);
      const path = join(consumer, "agents/designer/ia.json");
      const ia = JSON.parse(readFileSync(path, "utf8"));
      if (invalid === "nonstring extension") ia.extensions.push(42);
      if (invalid === "unplaced extension") ia.extensions.push("sections.consumer.unplaced");
      if (invalid === "invalid IA node") ia.nodes[0].children = null;
      writeFileSync(path, invalid === "malformed JSON" ? "{" : jsonBytes(ia));
      const before = snapshot(consumer);
      await expect(planMigration(consumer)).rejects.toThrow();
      expect(snapshot(consumer)).toEqual(before);
    });

    it("preserves actual registry theme variables and font metadata without files", async () => {
      const records = [
        { slot: "themes.consumer-fixture", path: join(here, "../specimen/__fixtures__/library/themes.preset/neutral/v1/theme.json") },
        { slot: "assets.consumer-font", path: join(here, "../../../designer/references/shadcn/font-inter@4.23.0/font-inter.json") },
      ];
      writeFileSync(join(consumer, "agents/designer/ia.json"), jsonBytes(withExtensions("designer", designerIa().ia, records.map(row => row.slot))));
      const originals = records.map(({ slot, path }) => {
        const raw = readFileSync(path, "utf8"), item = JSON.parse(raw);
        const dir = join(consumer, "library", slot, item.name, "v1");
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "item.json"), raw);
        writeFileSync(join(dir, "element.json"), jsonBytes({ id: item.name, slot, kind: item.type, payload: ["item.json"], hash: hashFiles(dir, ["item.json"]), lineage: { mode: "original" } }));
        return { slot, item };
      });
      await migrate();
      for (const { slot: id, item } of originals) {
        const slot = listSlots(consumer, "designer").find(entry => entry.id === id)!;
        const migrated = JSON.parse(readFileSync(join(candidatesDir(slot.dir), `${item.name}-v1.json`), "utf8"));
        expect(migrated.type).toBe(item.type);
        expect(migrated.cssVars).toEqual(item.cssVars);
        expect(migrated.font).toEqual(item.font);
        expect(migrated.files).toEqual(item.files ?? []);
      }
    });

    it("refuses malformed or duplicate source contracts", async () => {
      prepare(true);
      const path = join(consumer, "agents/designer/slot-contracts/consumer.json");
      writeFileSync(path, jsonBytes([contract, contract]));
      await expect(planMigration(consumer)).rejects.toThrow("duplicate Designer contract");
      writeFileSync(path, jsonBytes([{ ...contract, layer: "frames" }]));
      await expect(planMigration(consumer)).rejects.toThrow("invalid Designer contract");
    });
  });

  describe("Writer source history", () => {
    const sourcePath = (version: number) => join(consumer, "agents/writer/cells/site.about", `v${version}.md`);
    const addNewest = () => {
      const prior = readFileSync(sourcePath(2), "utf8");
      writeFileSync(sourcePath(3), prior.replace("version: 2", "version: 3").replace("About us", "Newest draft"));
      return prior;
    };
    const historyPath = () => {
      const slot = listSlots(consumer, "writer").find(entry => entry.id === "strings.common")!;
      return join(candidatesDir(slot.dir), "history.site.about-v2.md");
    };

    it("preserves intermediate versions, their source hashes and the existing active pin", async () => {
      const prior = addNewest();
      const before = snapshot(join(consumer, "agents/writer/cells"));
      await migrate();
      const slot = listSlots(consumer, "writer").find(entry => entry.id === "strings.common")!;
      expect(slot.candidates).toEqual(expect.arrayContaining(["history.site.about-v1.md", "history.site.about-v2.md", "history.site.about-v3.md", "migrated-v1.md", "draft-v1.md"]));
      expect(slot.pin?.candidate).toBe("migrated-v1.md");
      const history = parseFrontmatter(readFileSync(historyPath(), "utf8"));
      expect(history.ok).toBe(true);
      if (!history.ok) throw new Error("history candidate did not parse");
      expect(history.value.body).toContain("About us");
      expect(history.value.fields.source).toEqual({ kind: "derived", ref: ["director:identity.brand.essence@1"], hash: createHash("sha256").update(prior).digest("hex") });
      expect(readFileSync(join(candidatesDir(slot.dir), "draft-v1.md"), "utf8")).toContain("Newest draft");
      expect(snapshot(join(consumer, "agents/writer/cells"))).toEqual(before);
      expect(checkSlotModel(consumer)).toEqual([]);
      expect(await compareSlotModel(consumer)).toEqual([]);
      const after = snapshot(consumer);
      expect((await migrate()).written).toEqual([]);
      expect(snapshot(consumer)).toEqual(after);
    });

    it("adds history on rerun without replacing a consumer's edited candidate or pin", async () => {
      await migrate();
      const slot = listSlots(consumer, "writer").find(entry => entry.id === "strings.common")!;
      const path = join(candidatesDir(slot.dir), "draft-v1.md");
      const edited = readFileSync(path, "utf8").replace("About us", "Consumer edit");
      writeFileSync(path, edited);
      const pin = readFileSync(pinFile(slot.dir), "utf8");
      addNewest();
      const result = await migrate();
      expect(result.kept.some(path => path.endsWith("/draft-v1.md"))).toBe(true);
      expect(result.written.some(path => path.endsWith("/history.site.about-v3.md"))).toBe(true);
      expect(readFileSync(path, "utf8")).toBe(edited);
      expect(readFileSync(pinFile(slot.dir), "utf8")).toBe(pin);
      expect(await compareSlotModel(consumer)).toEqual([]);
    });

    it("fails comparison when a historical candidate is removed", async () => {
      addNewest(); await migrate(); rmSync(historyPath());
      expect((await compareSlotModel(consumer)).map(row => row.message)).toContain("site.about@2: historical candidate missing from strings.common");
    });

    it("fails comparison when unpinned history text changes", async () => {
      addNewest(); await migrate();
      writeFileSync(historyPath(), readFileSync(historyPath(), "utf8").replace("About us", "About us changed"));
      expect((await compareSlotModel(consumer)).map(row => row.message)).toContain("site.about@2: historical record bytes or multiplicity differ in strings.common");
    });

    it("fails comparison when history source evidence changes", async () => {
      addNewest(); await migrate();
      const bytes = readFileSync(historyPath(), "utf8");
      writeFileSync(historyPath(), bytes.replace(/"hash":"[a-f0-9]{64}"/, `"hash":"${"0".repeat(64)}"`));
      expect((await compareSlotModel(consumer)).map(row => row.message)).toContain("site.about@2: historical source bytes or references differ in strings.common");
    });

    it("preserves historical locales, Unicode, bindings and repeated records", async () => {
      addNewest();
      const prior = readFileSync(sourcePath(2), "utf8");
      const repeated = '\n### site.about.extra\n<!-- {"id":"st.sample0003","leaf":"strings.common","bindings":[{"target":"sections.hero","kind":"CopyRef","cellId":"sample.extra"}]} -->\nCafé — a second line.\n';
      writeFileSync(sourcePath(2), prior.replace("locales: [en]", "locales: [en, fr]") + `\n## fr\n${repeated}${repeated}`);
      await migrate();
      const bytes = readFileSync(historyPath(), "utf8");
      expect(bytes.match(/Café — a second line\./g)).toHaveLength(2);
      const parsed = parseFrontmatter(bytes);
      expect(parsed.ok && parsed.value.fields.locales).toEqual(["en", "fr"]);
      expect(bytes).toContain('"cellId":"sample.extra"');
      expect(await compareSlotModel(consumer)).toEqual([]);
      const marker = '\n### site.about.extra\n';
      const first = bytes.indexOf(marker), second = bytes.indexOf(marker, first + 1);
      writeFileSync(historyPath(), bytes.slice(0, first) + bytes.slice(second));
      expect((await compareSlotModel(consumer)).map(row => row.message)).toContain("site.about@2: historical record bytes or multiplicity differ in strings.common");
    });

    it("keeps unknown historical leaves visible as a migration coverage failure", async () => {
      addNewest();
      writeFileSync(sourcePath(2), readFileSync(sourcePath(2), "utf8").replaceAll('"leaf":"strings.common"', '"leaf":"strings.unknown"'));
      const plan = await planMigration(consumer);
      expect(plan.agents.writer.offIa).toContain("strings.unknown");
      writePlan(plan);
      expect((await compareSlotModel(consumer)).map(row => row.message)).toContain("site.about@2: historical record has no declared Writer slot");
    });
  });

  describe("mutation proofs", () => {
    beforeEach(async () => { await migrate(); });

    it("retains code-written Director requests and reports while unknown entries still fail", () => {
      for (const name of ["requests", "reports"]) mkdirSync(join(consumer, "agents/director", name), { recursive: true });
      expect(checkSlotModel(consumer)).toEqual([]);
      mkdirSync(join(consumer, "agents/director", "unknown-support-store"));
      expect(checkSlotModel(consumer)).toContainEqual(expect.objectContaining({ code: "orphan", path: "agents/director/unknown-support-store" }));
    });

    it("does not infer support-entry exceptions for other agents", () => {
      mkdirSync(join(consumer, "agents/writer/reports"));
      expect(checkSlotModel(consumer)).toContainEqual(expect.objectContaining({ code: "orphan", path: "agents/writer/reports" }));
    });

    it("pin-candidate: the pinned candidate is gone", () => {
      const entry = pinnedSlot("publisher");
      rmSync(join(candidatesDir(entry.dir), entry.pin!.candidate));
      expect(issueCodes()).toContain("pin-candidate");
    });

    it("pin-hash: one byte flipped", () => {
      const entry = pinnedSlot("publisher");
      const path = join(candidatesDir(entry.dir), entry.pin!.candidate);
      writeFileSync(path, readFileSync(path, "utf8").replace("/about", "/abous"));
      expect(issueCodes()).toEqual(["pin-hash"]);
    });

    it("compare-publisher: a pin.json dropped", async () => {
      rmSync(pinFile(pinnedSlot("publisher").dir));
      expect((await compareSlotModel(consumer)).map(diff => diff.code)).toContain("compare-publisher");
    });

    it("orphan: a folder the IA does not name", () => {
      const entry = pinnedSlot("publisher");
      mkdirSync(join(dirname(entry.dir), "page.bogus"));
      expect(issueCodes()).toEqual(["orphan"]);
    });

    it("ia-path / slot-missing: a slot moved to the wrong L2", () => {
      const entry = pinnedSlot("publisher");
      const target = join(dirname(dirname(entry.dir)), "wrong-l2", entry.id);
      mkdirSync(dirname(target), { recursive: true });
      cpSync(entry.dir, target, { recursive: true });
      rmSync(entry.dir, { recursive: true });
      const found = issueCodes();
      expect(found).toContain("slot-missing");
      expect(found.some(code => code === "ia-path" || code === "orphan")).toBe(true);
    });

    it("candidate-status: status on a candidate, pin hash updated so it is isolated", () => {
      const entry = pinnedSlot("publisher");
      const path = join(candidatesDir(entry.dir), entry.pin!.candidate);
      const bytes = JSON.stringify({ ...JSON.parse(readFileSync(path, "utf8")), status: "active" }, null, 2) + "\n";
      writeFileSync(path, bytes);
      writeFileSync(pinFile(entry.dir), JSON.stringify({ ...entry.pin, sha256: createHash("sha256").update(bytes).digest("hex") }, null, 2) + "\n");
      expect(issueCodes()).toEqual(["candidate-status"]);
    });

    it("ref-unknown: uses names a slot that does not exist", () => {
      const entry = pinnedSlot("publisher");
      const doc = JSON.parse(readFileSync(slotFile(entry.dir), "utf8"));
      writeFileSync(slotFile(entry.dir), JSON.stringify({ ...doc, uses: [...doc.uses, "sections.does-not-exist"] }, null, 2) + "\n");
      expect(issueCodes()).toEqual(["ref-unknown"]);
    });
  });
});
