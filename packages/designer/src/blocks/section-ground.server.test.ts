import { describe, expect, it } from "vitest";
import { SECTION_GROUND_CLASSES } from "./server.js";
import type { SectionGround } from "./server.js";

describe("blocks/server section-ground export", () => {
  it("exports the same closed, server-safe mapping", () => {
    const ground: SectionGround = "inverse";
    expect(SECTION_GROUND_CLASSES[ground].surface).toBe("bg-surface-inverse");
  });
});
