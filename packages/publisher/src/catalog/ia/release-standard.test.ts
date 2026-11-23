/**
 * R5 (K2): a live release slot has no package default (its manifest is computed per consumer build), so it names the
 * release standard, and that standard is createOnly with a reason and no seeds. Without both, conform K2 reads the slot
 * as having no package default, no seed and no createOnly reason.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PUBLISHER_TREES, loadDefaults } from "./tree.js";

const standard = JSON.parse(readFileSync(fileURLToPath(new URL("../../../standards/release/requirements.json", import.meta.url)), "utf8")) as Record<string, unknown>;
const release = PUBLISHER_TREES.find(tree => tree.l0 === "release")!;
const live = Object.entries(release.slots as Record<string, Record<string, unknown>>).filter(([, slot]) => slot.kind === "release" && slot.parked !== true);

describe("release slots (K2)", () => {
  it("every live release slot names the release standard and has no package default", () => {
    expect(live.map(([id]) => id).sort()).toEqual(["release.admin", "release.app", "release.docs", "release.site", "release.slides"]);
    const defaults = new Set([...loadDefaults().keys()].map(key => key.split("/")[0]));
    for (const [id, slot] of live) {
      expect(slot.standard, id).toBe("release");
      expect(defaults.has(id), id).toBe(false);
    }
  });

  it("the release standard is createOnly with a reason and no seeds", () => {
    expect(standard.id).toBe("release");
    expect(standard.mode).toBe("craft");
    expect(standard.seeds).toEqual([]);
    expect(standard.createOnly).toBe(true);
    expect(typeof standard.createOnlyReason === "string" && standard.createOnlyReason.trim().length > 0).toBe(true);
  });
});
