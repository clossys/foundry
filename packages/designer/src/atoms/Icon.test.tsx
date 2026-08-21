import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Icon } from "./Icon.js";
import * as Glyphs from "../icons/index.js";

const CIRCLE_GLYPH = [["circle", { cx: "12", cy: "12", r: "10" }]] as const;

describe("Icon", () => {
  describe("accessibility", () => {
    it("is hidden from assistive tech and carries no role/label when decorative", () => {
      const { container } = render(<Icon glyph={CIRCLE_GLYPH} decorative data-testid="probe" />);
      const svg = container.querySelector("svg");
      expect(svg).toHaveAttribute("aria-hidden", "true");
      expect(svg).not.toHaveAttribute("role");
      expect(svg).not.toHaveAttribute("aria-label");
    });

    it("carries an accessible name (role=img + aria-label) when label is given", () => {
      render(<Icon glyph={CIRCLE_GLYPH} label="A circle" />);
      const svg = screen.getByRole("img", { name: "A circle" });
      expect(svg).not.toHaveAttribute("aria-hidden");
    });
  });

  describe("content: glyph vs children", () => {
    it("renders glyph tuple data as real SVG child elements", () => {
      render(<Icon glyph={CIRCLE_GLYPH} decorative data-testid="probe" />);
      const svg = screen.getByTestId("probe");
      const circle = svg.querySelector("circle");
      expect(circle).toHaveAttribute("cx", "12");
      expect(circle).toHaveAttribute("r", "10");
    });

    it("renders children as-is when supplied instead of glyph", () => {
      render(
        <Icon decorative data-testid="probe">
          <rect x="3" y="3" width="18" height="18" />
        </Icon>,
      );
      const svg = screen.getByTestId("probe");
      const rect = svg.querySelector("rect");
      expect(rect).toHaveAttribute("width", "18");
    });

    it("renders every one of the 32 shipped @vespeneventures/designer/icons glyphs without throwing, each carrying real markup", () => {
      const glyphEntries = Object.entries(Glyphs) as [string, (typeof CIRCLE_GLYPH)][];
      expect(glyphEntries.length).toBe(32);
      for (const [name, glyph] of glyphEntries) {
        const { unmount } = render(<Icon glyph={glyph} decorative data-testid={name} />);
        const svg = screen.getByTestId(name);
        expect(svg.tagName.toLowerCase()).toBe("svg");
        expect(svg.children.length).toBeGreaterThan(0);
        unmount();
      }
    });
  });

  describe("colour", () => {
    it("strokes with currentColor and fills with none — never a hardcoded colour", () => {
      const { container } = render(<Icon glyph={CIRCLE_GLYPH} decorative />);
      const svg = container.querySelector("svg");
      expect(svg).toHaveAttribute("stroke", "currentColor");
      expect(svg).toHaveAttribute("fill", "none");
    });

    // There is no `color`/`fill`/`stroke` prop to test omitting at runtime —
    // that's a COMPILE-time guarantee (`Omit<SVGProps<...>, "color" | ...>`),
    // proven in `internal/icon-contract.check.tsx`, not here. A
    // `@ts-expect-error` written in this file would be inert: this
    // package's `tsconfig.json` excludes `*.test.tsx` from the real `tsc`
    // run, so vitest would transpile past it without ever checking it —
    // see that file's own header comment and issue #24.
  });

  describe("size", () => {
    it("defaults to size=md and reads the --ui-icon-md token, with a literal fallback", () => {
      const { container } = render(<Icon glyph={CIRCLE_GLYPH} decorative />);
      const svg = container.querySelector("svg");
      expect(svg?.style.width).toBe("var(--ui-icon-md, var(--spacing-xl, 24px))");
      expect(svg?.style.height).toBe("var(--ui-icon-md, var(--spacing-xl, 24px))");
    });

    it("maps size=sm and size=lg to their own distinct --ui-icon-* tokens", () => {
      const { rerender, container } = render(<Icon glyph={CIRCLE_GLYPH} decorative size="sm" />);
      expect(container.querySelector("svg")?.style.width).toBe("var(--ui-icon-sm, var(--spacing-lg, 16px))");

      rerender(<Icon glyph={CIRCLE_GLYPH} decorative size="lg" />);
      expect(container.querySelector("svg")?.style.width).toBe("var(--ui-icon-lg, var(--spacing-2xl, 32px))");
    });

    it("shrinks to 0 in a flex layout by default (an icon never grows to fill space)", () => {
      const { container } = render(<Icon glyph={CIRCLE_GLYPH} decorative />);
      expect(container.querySelector("svg")?.style.flexShrink).toBe("0");
    });
  });

  describe("stroke weight", () => {
    it("reads the --ui-icon-stroke token, with a literal fallback, never a hardcoded stroke-width attribute", () => {
      const { container } = render(<Icon glyph={CIRCLE_GLYPH} decorative />);
      const svg = container.querySelector("svg");
      expect(svg?.style.strokeWidth).toBe("var(--ui-icon-stroke, 2)");
      expect(svg).not.toHaveAttribute("stroke-width");
    });

    // No `strokeWidth` prop exists to test omitting at runtime — that's a
    // compile-time guarantee, proven in `internal/icon-contract.check.tsx`
    // for the same "inert in a .test.tsx file" reason noted above.
  });

  describe("className / style merging", () => {
    it("forwards className, and a consumer's own class is present", () => {
      const { container } = render(<Icon glyph={CIRCLE_GLYPH} decorative className="text-status-danger" />);
      expect(container.querySelector("svg")).toHaveClass("text-status-danger");
    });

    it("merges a consumer's style on top of this component's own, with the consumer's values winning", () => {
      const { container } = render(
        <Icon glyph={CIRCLE_GLYPH} decorative style={{ width: "40px", opacity: 0.5 }} />,
      );
      const svg = container.querySelector("svg");
      // Consumer's width wins over the token-driven default.
      expect(svg?.style.width).toBe("40px");
      // Consumer's own, unrelated style property is preserved.
      expect(svg?.style.opacity).toBe("0.5");
      // This component's own non-overridden style is still present.
      expect(svg?.style.flexShrink).toBe("0");
    });
  });

  describe("ref forwarding", () => {
    it("forwards a ref to the underlying <svg>", () => {
      let node: SVGSVGElement | null = null;
      render(
        <Icon
          glyph={CIRCLE_GLYPH}
          decorative
          ref={(el) => {
            node = el;
          }}
        />,
      );
      expect(node).not.toBeNull();
      expect((node as unknown as SVGSVGElement)?.tagName).toBe("svg");
    });
  });

  it("sets a stable displayName", () => {
    expect(Icon.displayName).toBe("Icon");
  });
});
