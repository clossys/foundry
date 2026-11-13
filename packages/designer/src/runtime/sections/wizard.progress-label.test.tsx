/** @vitest-environment jsdom */
/** sections.wizard names its stock Progress with the Progress's own ProgressLabel part (E2), never a dangling id. */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render as renderBare, screen } from "@testing-library/react";
import { importFoundryFrames, importFoundrySections, loadBuildCatalog, planSurfaceDefaults } from "../../catalog-core/index.js";
import type { SurfaceDefaultCandidateDocument, SurfaceDefaultsInput } from "../../catalog-core/index.js";
import { planSurfacePreviews } from "../../studio/planned-surface-previews.js";
import { hostedRender } from "../../frames/__fixtures__/shell-copy.js";

const render = hostedRender(renderBare);
afterEach(cleanup);

describe("sections.wizard progress", () => {
  it("labels the progressbar with its ProgressLabel text", () => {
    const slots = loadBuildCatalog().slots.filter(slot => slot.layer === "sections" || slot.layer === "frames") as SurfaceDefaultsInput["catalog"]["slots"];
    const fills: SurfaceDefaultCandidateDocument[] = [...importFoundrySections().fills, ...importFoundryFrames().fills];
    const plan = planSurfaceDefaults({ catalog: { slots, fills }, slots: slots.map(slot => slot.id), preference: ["foundry"] });
    const wizard = planSurfacePreviews({ plan, fills }).previews["sections.wizard"]!;
    render(<>{wizard.render()}</>);
    const bar = screen.getByRole("progressbar");
    const labelledBy = bar.getAttribute("aria-labelledby");
    expect(labelledBy && document.getElementById(labelledBy)?.textContent).toMatch(/Upload progress/);
    expect(screen.getByRole("progressbar", { name: /Upload progress/ })).toBe(bar);
  });
});
