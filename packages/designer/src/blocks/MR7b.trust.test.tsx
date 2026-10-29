import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { StatusList } from "./StatusList.js";
import { NavGrid } from "./NavGrid.js";
import { SECTION_GROUND_CLASSES } from "./section-ground.js";

const labels = { available: "Ready", partial: "Limited", planned: "Upcoming", dispositions: { "not-offered": "Excluded" } };

describe("MR-7b trust composition", () => {
  it("composes content and interactions through design-system components", () => {
    const sources = new Map<string, string>();
    for (const file of ["StatusList.tsx", "NavGrid.tsx"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      sources.set(file, source);
      expect(source).not.toMatch(/<(?:section|div|dl|dt|dd|ul|li|p|span|a|button|input)\b/);
      expect(source).toContain("SemanticContent");
    }
    expect(sources.get("NavGrid.tsx")).not.toContain("CompatNavGrid");
  });

  it.each(["base", "sunken", "inverse"] as const)("retains every visible status label and semantic token on %s", ground => {
    const items = [
      { id: "a", label: "Item A", state: "available" as const },
      { id: "b", label: "Item B", state: "partial" as const },
      { id: "c", label: "Item C", state: "planned" as const },
      { id: "d", label: "Item D", disposition: "not-offered" as const },
    ];
    const { container } = render(<StatusList items={items} labels={labels} legendLabel="Readiness" ground={ground} />);
    const values = [...container.querySelectorAll("dl dd")];
    expect(values.map(value => value.textContent)).toEqual(["Ready", "Limited", "Upcoming", "Excluded"]);
    const tokens = SECTION_GROUND_CLASSES[ground];
    for (const [index, tone] of ["success", "warning", "info"].entries()) {
      const mark = values[index].querySelector('[aria-hidden="true"]')!;
      expect(mark).not.toBeNull();
      expect(mark.className).toContain(tokens.status[tone as "success" | "warning" | "info"]);
    }
  });

  it("suppresses tile transitions under the reduced-motion policy", () => {
    const { container } = render(<NavGrid items={[{ id: "r", title: "Reference", href: "/reference" }]} />);
    const tile = container.querySelector("[data-nav-grid-card]")!;
    expect(tile.classList.contains("transition-colors")).toBe(true);
    expect(tile.classList.contains("motion-reduce:transition-none")).toBe(true);
  });

  it("retains caller copy and the link-index heading", () => {
    const { container } = render(<NavGrid heading="Resources" items={[{ id: "r", title: "Reference", href: "/reference" }]} />);
    expect(container.querySelector("h2")?.textContent).toBe("Resources");
    expect(container.querySelector('a[href="/reference"]')?.textContent).toContain("Reference");
  });
});
