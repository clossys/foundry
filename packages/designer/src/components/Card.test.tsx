import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Card } from "./Card.js";

describe("Card", () => {
  it("renders its children as a <div>", () => {
    render(<Card>Content</Card>);
    const card = screen.getByText("Content");
    expect(card.tagName).toBe("DIV");
  });

  it("applies its raised elevation as a boxShadow reading the --ui-elevation-raised token, with a fallback", () => {
    render(<Card>Content</Card>);
    const card = screen.getByText("Content");
    expect(card.style.boxShadow).toContain("var(--ui-elevation-raised");
    expect(card.style.boxShadow).toContain(","); // has a fallback, not a bare var()
  });

  it("forwards className, and the consumer's conflicting class wins the merge", () => {
    render(<Card className="bg-surface-sunken p-xl">Content</Card>);
    const card = screen.getByText("Content");
    expect(card.className).toContain("bg-surface-sunken");
    expect(card.className).not.toContain("bg-surface-raised");
    expect(card.className).toContain("p-xl");
    expect(card.className).not.toContain("p-lg");
  });

  it("forwards a consumer style prop alongside its own boxShadow", () => {
    render(<Card style={{ marginTop: "8px" }}>Content</Card>);
    const card = screen.getByText("Content");
    expect(card.style.marginTop).toBe("8px");
    expect(card.style.boxShadow).toContain("var(--ui-elevation-raised");
  });
});

describe("Card variants", () => {
  it("keeps the raised default unchanged when no variant is given", () => {
    render(<Card>Content</Card>);
    const card = screen.getByText("Content");
    expect(card.className).toContain("rounded-control");
    expect(card.className).toContain("bg-surface-raised");
    expect(card).not.toHaveAttribute("data-variant");
  });

  it("renders a plate as the other ground: sunken fill on base, raised on sunken, inverse raised on inverse", () => {
    const { rerender } = render(<Card variant="plate">Content</Card>);
    let card = screen.getByText("Content");
    expect(card).toHaveAttribute("data-variant", "plate");
    expect(card.className).toContain("bg-surface-sunken");
    rerender(<Card variant="plate" ground="sunken">Content</Card>);
    card = screen.getByText("Content");
    expect(card.className).toContain("bg-surface-raised");
    expect(card.className).not.toContain("bg-surface-sunken");
    rerender(<Card variant="plate" ground="inverse">Content</Card>);
    card = screen.getByText("Content");
    expect(card.className).toContain("bg-surface-inverse-raised");
  });

  it("gives a plate the panel radius, no stroke and no shadow", () => {
    render(<Card variant="plate">Content</Card>);
    const card = screen.getByText("Content");
    expect(card.className).toContain("rounded-panel");
    expect(card.className).not.toContain("rounded-control");
    expect(card.className.split(/\s+/)).not.toContain("border");
    expect(card.style.boxShadow).toBe("");
  });

  it("renders an outline as raised fill with one panel edge read from the panel tokens, and no shadow", () => {
    render(<Card variant="outline">Content</Card>);
    const card = screen.getByText("Content");
    expect(card).toHaveAttribute("data-variant", "outline");
    expect(card.className).toContain("rounded-panel");
    expect(card.className).toContain("bg-surface-raised");
    expect(card.className).toContain("border-line-panel");
    expect(card.style.borderWidth).toBe("var(--ui-border-panel, var(--ui-border-hairline, 1px))");
    expect(card.style.boxShadow).toBe("");
  });

  it("switches an outline's edge and fill to the inverse pair on an inverse ground", () => {
    render(<Card variant="outline" ground="inverse">Content</Card>);
    const card = screen.getByText("Content");
    expect(card.className).toContain("border-line-on-inverse");
    expect(card.className).toContain("bg-surface-inverse-raised");
    expect(card.className).not.toContain("border-line-panel");
  });

  it("lets a consumer class win the merge on a plate", () => {
    render(<Card variant="plate" className="p-2xl">Content</Card>);
    const card = screen.getByText("Content");
    expect(card.className).toContain("p-2xl");
    expect(card.className).not.toContain("p-lg");
  });
});
