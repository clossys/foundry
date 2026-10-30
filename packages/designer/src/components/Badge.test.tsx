import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "./preview-runtime/components/badge/badge.js";

describe("Badge", () => {
  it("renders its children as a <span>", () => {
    render(<Badge>New</Badge>);
    const badge = screen.getByText("New");
    expect(badge.tagName).toBe("SPAN");
  });

  it("defaults to the native default variant", () => {
    render(<Badge>New</Badge>);
    expect(screen.getByText("New")).toHaveAttribute("data-variant", "default");
    expect(screen.getByText("New")).toHaveClass("cn-badge-variant-default");
  });

  it("applies distinct classes per variant", () => {
    const variants = ["default", "secondary", "outline", "destructive", "ghost", "link"] as const;
    const classNames = variants.map((variant) => {
      const { unmount } = render(<Badge variant={variant}>{variant}</Badge>);
      const className = screen.getByText(variant).className;
      unmount();
      return className;
    });
    expect(new Set(classNames).size).toBe(variants.length);
  });

  it("forwards className, and the consumer's conflicting class wins the merge", () => {
    render(<Badge className="bg-red-500 bg-blue-500">New</Badge>);
    const badge = screen.getByText("New");
    expect(badge.className).toContain("bg-blue-500");
    expect(badge.className).not.toContain("bg-red-500");
  });
});
