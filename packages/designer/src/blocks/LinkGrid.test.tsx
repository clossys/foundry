import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { LinkGrid, type LinkGridItem } from "./LinkGrid.js";
import { LinkGrid as ServerLinkGrid } from "./server.js";

const items = (count = 3): LinkGridItem[] => Array.from({ length: count }, (_, index) => ({
  id: `route-${index}`, title: `Topic ${index + 1}`, description: `Details for topic ${index + 1}.`, href: `/topics/${index + 1}`,
}));

describe("LinkGrid", () => {
  for (const count of [2, 3, 4, 5, 6]) {
    it(`renders ${count} list items, each with one link named by its title alone`, () => {
      const { container } = render(<LinkGrid items={items(count)} />);
      const list = screen.getByRole("list");
      expect(list.tagName).toBe("UL");
      expect(list).toHaveAttribute("data-link-grid");
      expect(list).toHaveAttribute("data-count", String(count));
      expect(list).toHaveAttribute("data-surface", "plate");
      expect(within(list).getAllByRole("listitem")).toHaveLength(count);
      items(count).forEach((item, index) => {
        const tile = within(list).getAllByRole("listitem")[index]!;
        const link = within(tile).getByRole("link", { name: item.title as string });
        expect(tile.tagName).toBe("LI");
        expect(within(tile).getAllByRole("link")).toHaveLength(1);
        expect(link).toHaveAttribute("href", item.href);
        expect(link).not.toHaveTextContent(item.description as string);
        expect(tile).toHaveTextContent(item.description as string);
        expect(tile).toHaveClass("relative", "isolate", "min-w-0");
        const span = count === 2 || count === 4 || (count === 5 && index >= 3) ? "tablet:col-span-3" : "tablet:col-span-2";
        expect(tile).toHaveClass(span);
      });
      expect(container.querySelectorAll("a")).toHaveLength(count);
      expect(list).toHaveClass("grid-cols-1", "tablet:grid-cols-6", "gap-lg");
      expect(list).toHaveClass("m-0", "p-0", "list-none");
      expect(screen.getByRole("link", { name: "Topic 1" }).parentElement).toHaveClass("m-0");
      expect(container.querySelector("[data-link-grid-description]")).toHaveClass("m-0");
    });
  }

  for (const count of [0, 1, 7]) {
    it(`refuses ${count} items`, () => {
      expect(() => render(<LinkGrid items={items(count)} />)).toThrow(RangeError);
    });
  }

  for (const surface of ["plate", "rule"] as const) {
    for (const ground of ["base", "sunken", "inverse"] as const) {
      it(`uses the ${surface} frame and ${ground} ground for its hit target, ring and copy`, () => {
        const { container } = render(<LinkGrid items={items()} surface={surface} ground={ground} />);
        const link = screen.getByRole("link", { name: "Topic 1" });
        const tile = link.closest("li")!;
        expect(link).toHaveClass("after:absolute", "after:rounded-panel", "focus-visible:after:outline-2", "focus-visible:after:outline-offset-2");
        expect(link).toHaveClass("active:decoration-current", "link-grid-active");
        expect(link).toHaveClass(ground === "inverse" ? "focus-visible:after:outline-accent-on-inverse" : "focus-visible:after:outline-accent");
        expect(link.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
        expect(link.parentElement).toHaveClass(ground === "inverse" ? "text-ink-on-inverse" : "text-ink-primary");
        expect(container.querySelector("[data-link-grid-description]")).toHaveClass(ground === "inverse" ? "text-ink-on-inverse-muted" : "text-ink-secondary");
        if (surface === "plate") {
          expect(link).toHaveClass("after:inset-0");
          expect(tile).toHaveClass("rounded-panel", "p-lg", "tablet-lg:p-xl");
          expect(tile).toHaveClass(ground === "base" ? "bg-surface-sunken" : ground === "sunken" ? "bg-surface-base" : "bg-surface-inverse-raised");
          if (ground !== "inverse") expect(tile).toHaveClass("hover:bg-surface-raised", "active:bg-surface-raised");
          else expect(tile.className).not.toMatch(/(?:hover|active):bg-/);
        } else {
          expect(link).toHaveClass("after:-inset-x-sm", "tablet:after:-inset-x-md", "after:top-0", "after:-bottom-sm", "tablet:after:-bottom-md");
          expect(tile).toHaveClass("border-t", "pt-lg", "before:-inset-x-sm", "tablet:before:-inset-x-md");
          expect((tile as HTMLElement).style.borderBlockStartWidth).toBe("var(--ui-border-hairline)");
          const fill = ground === "base" ? "surface-sunken" : ground === "sunken" ? "surface-base" : "surface-inverse-raised";
          expect(tile).toHaveClass(`hover:before:bg-${fill}`, `has-focus-visible:before:bg-${fill}`, `active:before:bg-${fill}`);
          if (ground === "sunken") expect(tile).not.toHaveClass("hover:before:bg-surface-raised");
          expect(screen.getByRole("list")).toHaveClass("tablet:gap-2xl");
        }
      });
    }
  }

  for (const level of [3, 4] as const) {
    it(`renders title headings at level ${level}`, () => {
      render(<LinkGrid items={items()} headingLevel={level} />);
      const heading = screen.getByRole("heading", { name: "Topic 1", level });
      expect(heading.tagName).toBe(`H${level}`);
      expect(heading).toHaveClass("m-0");
    });
  }

  it("uses paragraphs when no heading level is requested", () => {
    render(<LinkGrid items={items()} />);
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Topic 1" }).parentElement?.tagName).toBe("P");
  });

  it("keeps every icon decorative, sized separately and outside the anchor", () => {
    render(<LinkGrid items={items().map((item) => ({ ...item, icon: <svg data-testid={`icon-${item.id}`} /> }))} />);
    items().forEach((item) => {
      const icon = screen.getByTestId(`icon-${item.id}`);
      expect(icon.parentElement).toHaveAttribute("aria-hidden", "true");
      expect(icon.parentElement).toHaveClass("link-grid-icon", "text-ink-secondary");
      expect(icon.closest("a")).toBeNull();
    });
  });

  it("refuses mixed icon presence", () => {
    const routes = items();
    routes[0] = { ...routes[0]!, icon: <svg /> };
    expect(() => render(<LinkGrid items={routes} />)).toThrow(TypeError);
  });

  it("keeps a rule tile's target at the minimum tap size even without supporting copy", () => {
    render(<LinkGrid surface="rule" items={items(2).map(({ description: _description, ...item }) => item)} />);
    expect(screen.getAllByRole("listitem")[0]?.style.minBlockSize).toBe("var(--ui-layout-tap-target)");
  });

  for (const slot of ["title", "description", "icon"] as const) {
    it(`refuses nested interactive content in ${slot}`, () => {
      const routes = items().map((item) => ({ ...item, [slot]: <span><a href="/other">Other route</a></span> }));
      expect(() => render(<LinkGrid items={routes} />)).toThrow(TypeError);
    });
  }

  it("allows one keyboard stop per tile", async () => {
    const user = userEvent.setup();
    render(<LinkGrid items={items()} />);
    for (const item of items()) {
      await user.tab();
      expect(screen.getByRole("link", { name: item.title as string })).toHaveFocus();
    }
  });

  it("forwards the consumer class through the normal class merge", () => {
    render(<LinkGrid items={items()} className="gap-2xl" />);
    expect(screen.getByRole("list")).toHaveClass("gap-2xl");
    expect(screen.getByRole("list")).not.toHaveClass("gap-lg");
  });

  it("exports the same component through the server barrel and renders without hooks", () => {
    expect(ServerLinkGrid).toBe(LinkGrid);
    expect(renderToStaticMarkup(<ServerLinkGrid items={items(2)} />)).toContain('data-link-grid=""');
  });
});
