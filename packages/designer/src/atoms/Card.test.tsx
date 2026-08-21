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
