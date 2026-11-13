import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Icon } from "./preview-runtime/components/icon/icon.js";
import * as Glyphs from "../icons/index.js";
import { ICON_ENTRIES } from "../catalog/icons.js";

it("honours the catalog mirroring flag in RTL without mirroring other glyphs or losing caller classes", () => {
  for (const entry of ICON_ENTRIES) {
    const view = render(<div dir="rtl"><Icon glyph={entry.nodes} mirrorInRtl={entry.mirrorInRtl} decorative className="text-ink-primary" /></div>);
    const svg = view.container.querySelector("svg")!;
    expect(svg.closest('[dir="rtl"]')).not.toBeNull();
    expect(svg.classList.contains("rtl:-scale-x-100")).toBe(entry.mirrorInRtl);
    expect(svg).toHaveClass("text-ink-primary"); expect(svg).not.toHaveAttribute("mirrorInRtl");
    view.unmount();
  }
  const view = render(<div dir="rtl"><Icon glyph={Glyphs.ArrowRight} decorative /></div>);
  expect(view.container.querySelector("svg")).not.toHaveClass("rtl:-scale-x-100");
});

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

    it("renders every one of the 40 shipped @clossys/designer/icons glyphs without throwing, each carrying real markup", () => {
      const glyphEntries = Object.entries(Glyphs) as [string, (typeof CIRCLE_GLYPH)][];
      expect(glyphEntries.length).toBe(41);
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
    it("renders the stock shadcn Lucide sizes: size-4 by default, size-6 for md, size-8 for lg", () => {
      const { rerender, container } = render(<Icon glyph={CIRCLE_GLYPH} decorative />);
      const svg = () => container.querySelector("svg")!;
      expect(svg()).toHaveClass("lucide", "shrink-0", "size-4");
      rerender(<Icon glyph={CIRCLE_GLYPH} decorative size="md" />);
      expect(svg()).toHaveClass("size-6"); expect(svg()).not.toHaveClass("size-4");
      rerender(<Icon glyph={CIRCLE_GLYPH} decorative size="lg" />);
      expect(svg()).toHaveClass("size-8");
      expect(svg()).not.toHaveAttribute("style");
    });

    it("lets a caller's own size-* class replace the default step", () => {
      const { container } = render(<Icon glyph={CIRCLE_GLYPH} decorative className="size-3 text-status-danger" />);
      const svg = container.querySelector("svg")!;
      expect(svg).toHaveClass("size-3", "text-status-danger"); expect(svg).not.toHaveClass("size-4");
    });
  });

  it("strokes at the stock 2px weight on the 24px Lucide grid", () => {
    const { container } = render(<Icon glyph={CIRCLE_GLYPH} decorative />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("stroke-width", "2");
    expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
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
});
