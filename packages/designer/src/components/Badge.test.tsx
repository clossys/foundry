import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "./Badge.js";

describe("Badge", () => {
  it("renders its children as a <span>", () => {
    render(<Badge>New</Badge>);
    const badge = screen.getByText("New");
    expect(badge.tagName).toBe("SPAN");
  });

  it("defaults to the neutral variant", () => {
    render(<Badge>New</Badge>);
    expect(screen.getByText("New").className).toContain("bg-surface-sunken");
  });

  it("applies distinct classes per variant", () => {
    const variants = ["neutral", "success", "warning", "danger", "info"] as const;
    const classNames = variants.map((variant) => {
      const { unmount } = render(<Badge variant={variant}>{variant}</Badge>);
      const className = screen.getByText(variant).className;
      unmount();
      return className;
    });
    expect(new Set(classNames).size).toBe(variants.length);
  });

  it("forwards className, and the consumer's conflicting class wins the merge", () => {
    render(<Badge className="bg-status-danger-tint">New</Badge>);
    const badge = screen.getByText("New");
    expect(badge.className).toContain("bg-status-danger-tint");
    expect(badge.className).not.toContain("bg-surface-sunken");
  });
});
