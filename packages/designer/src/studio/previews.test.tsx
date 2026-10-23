import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { DEMO_CATALOG, DEMO_LIBRARY, DEMO_SELECTION } from "./demo-data.js";
import { buildCandidates, type Candidate } from "./model.js";
import { PREVIEW_LIMIT, SlotPreview, isFontDeclared, type PreviewLabels } from "./previews.js";

const labels: PreviewLabels = { sampleText: "SAMPLE-TEXT", fontNotLoaded: "FONT-NOTE" };
const cards = (slotId: string): Candidate[] => buildCandidates({ catalog: DEMO_CATALOG, library: DEMO_LIBRARY, working: DEMO_SELECTION, slotId, scope: "slot", target: slotId });
const view = (card: Candidate, extra: { limit?: number; fontDeclared?: (family: string) => boolean } = {}) =>
  render(<SlotPreview members={card.members} labels={labels} {...extra} />).container;
const kinds = (container: HTMLElement): string[] => [...container.querySelectorAll("[data-preview-kind]")].map((node) => node.getAttribute("data-preview-kind") as string);

describe("SlotPreview", () => {
  it("uses the token preview for a bound member and names the member without the slot prefix", () => {
    const container = view(cards("tokens.accent-color")[0] as Candidate);
    expect([...container.querySelectorAll("li > code")].map((node) => node.textContent)).toEqual(["default", "hover"]);
    expect([...container.querySelectorAll("figure")].map((node) => node.getAttribute("aria-label"))).toEqual(["--color-accent", "--color-accent-hover"]);
    expect(container.textContent).toContain("SAMPLE-TEXT");
  });
  it("draws unbound colors as swatches fed by the card's own variable, with the css text beside them", () => {
    const container = view(cards("tokens.color-ramp")[0] as Candidate);
    expect(kinds(container)).toEqual(["swatch", "swatch", "swatch"]);
    const styles = [...container.querySelectorAll<HTMLElement>("[data-preview-kind=swatch]")].map((node) => node.style.background);
    expect(styles).toEqual(["var(--studio-m-0)", "var(--studio-m-1)", "var(--studio-m-2)"]);
    expect([...container.querySelectorAll("code")].map((node) => node.textContent)).toEqual(["slate.500", "#6E7781", "violet.400", "#A371F7", "violet.600", "#8250DF"]);
  });
  it("draws an unbound dimension as a ruler and an unbound number or duration as text", () => {
    expect(kinds(view(cards("tokens.region-width")[0] as Candidate))).toEqual(["ruler", "ruler"]);
    expect(kinds(view(cards("tokens.line-height")[0] as Candidate))).toEqual(["text", "text"]);
    const motion = view(cards("tokens.duration")[0] as Candidate);
    expect([...motion.querySelectorAll("[data-preview-kind=text]")].map((node) => node.textContent)).toEqual(["200ms", "100ms"]);
  });
  it("shows the not-loaded note for a font the page has not declared, and only for those", () => {
    const family = cards("tokens.typeface")[0] as Candidate;
    expect(view(family, { fontDeclared: () => false }).querySelectorAll("[data-preview-note=font]")).toHaveLength(3);
    expect(view(family, { fontDeclared: (name) => name === "Inter" }).querySelectorAll("[data-preview-note=font]")).toHaveLength(1);
    expect(view(family, { fontDeclared: () => true }).querySelectorAll("[data-preview-note=font]")).toHaveLength(0);
    expect(view(cards("tokens.typeface")[1] as Candidate, { fontDeclared: () => false }).querySelectorAll("[data-preview-note=font]")).toHaveLength(0);
  });
  it("reports no declared font where the page has none", () => {
    expect(isFontDeclared("Inter")).toBe(false);
  });
  it("caps the rows and counts the rest", () => {
    const card = cards("tokens.color-ramp")[0] as Candidate;
    const many = Array.from({ length: PREVIEW_LIMIT + 6 }, (_, at) => ({ id: `tokens.color-ramp.c.${String(at).padStart(2, "0")}`, member: card.members[0]!.member }));
    const container = render(<SlotPreview members={many} labels={labels} />).container;
    expect(container.querySelectorAll("li")).toHaveLength(24);
    expect(container.querySelector("[data-preview-more]")?.textContent).toBe("+6");
    expect(render(<SlotPreview members={many} labels={labels} limit={many.length} />).container.querySelector("[data-preview-more]")).toBeNull();
  });
  it("uses inline styles only and no class names", () => {
    const container = view(cards("tokens.region-width")[0] as Candidate);
    expect(container.querySelector("[class]")).toBeNull();
  });
});
