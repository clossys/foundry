import { describe, expect, it } from "vitest";
import { TOKENS } from "../tokens/tokens.js";

const OWNER = "../blocks/canvas/CanvasLod.js";
const owner = (): Promise<typeof import("../blocks/canvas/CanvasLod.js")> => import(/* @vite-ignore */ OWNER);
const sweep = Array.from({ length: 189 }, (_, index) => Math.round((.12 + index * .01) * 100) / 100);

describe("canvas level-of-detail owner", () => {
  it("defines exactly three tiers, every one reachable between the Studio zoom limits", async () => {
    const { CANVAS_LOD_TIERS, canvasLodTier } = await owner();
    expect(CANVAS_LOD_TIERS).toHaveLength(3);
    expect(new Set(sweep.map(canvasLodTier))).toEqual(new Set(CANVAS_LOD_TIERS));
    expect(canvasLodTier(.12)).toBe(CANVAS_LOD_TIERS.at(-1)); expect(canvasLodTier(2)).toBe(CANVAS_LOD_TIERS[0]);
  });
  it("switches by on-screen legibility of each tier's text token, not by fixed zoom numbers", async () => {
    const { CANVAS_LOD_TIERS, CANVAS_LOD_TEXT, CANVAS_LEGIBLE_TEXT_PX, canvasLodTier } = await owner();
    const px = (token: string) => Number.parseFloat(TOKENS[token]!.value);
    for (const zoom of sweep) {
      // The most detailed tier whose own smallest text stays legible at this zoom.
      const legible = CANVAS_LOD_TIERS.find(tier => px(CANVAS_LOD_TEXT[tier]) * zoom >= CANVAS_LEGIBLE_TEXT_PX) ?? CANVAS_LOD_TIERS.at(-1);
      expect(canvasLodTier(zoom), `zoom ${zoom}`).toBe(legible);
    }
  });
});
