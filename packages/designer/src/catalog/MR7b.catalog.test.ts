import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import slots from "./slots/sections.json" with { type: "json" };
import { generatedFoundrySectionFiles } from "../importers/foundry-sections.js";

const ids = ["status-list", "link-index", "consent"] as const;
const sourceRoot = resolve(import.meta.dirname, "../../../..");

describe("MR-7b trust and consent catalog composition", () => {
  for (const id of ids) {
    it(`keeps sections.${id} composition and source pins current`, () => {
      const file = `sections.${id}.json`;
      const bytes = readFileSync(resolve(import.meta.dirname, "fills/foundry", file), "utf8");
      const fill = JSON.parse(bytes).sections[id];
      const slot = slots.find(row => row.id === `sections.${id}`)!;
      expect(fill.composes).toContain("components.semantic-content");
      expect(slot.contract.allowedComposes).toContain("components.semantic-content");
      expect(bytes).toBe(generatedFoundrySectionFiles()[file]);
      for (const source of fill.consumption.sourceFiles) {
        const content = readFileSync(resolve(sourceRoot, source.path));
        expect(source.sha256, source.path).toBe(createHash("sha256").update(content).digest("hex"));
      }
    });
  }
});
