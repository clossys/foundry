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
import { candidatesDir, pinFile, slotFile } from "../records/slot-model/index.js";
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

  describe("mutation proofs", () => {
    beforeEach(async () => { await migrate(); });

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
