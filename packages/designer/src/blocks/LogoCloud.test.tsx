import { render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LogoCloud, type LogoCloudItem } from "./LogoCloud.js";

const items = (count: number): LogoCloudItem[] => Array.from({ length: count }, (_, index) => ({ id: String(index), name: `Mark ${index}`, logo: <svg aria-label="Supplied artwork label" /> }));

describe("LogoCloud", () => {
  it("accepts only three, four, six, eight or twelve marks [mutant: drop count check]", () => {
    for (const count of [0, 1, 2, 5, 7, 13]) {
      expect(() => renderToStaticMarkup(<LogoCloud items={items(count)} />)).toThrow(TypeError);
      expect(() => renderToStaticMarkup(<LogoCloud items={items(count)} />)).toThrow(/^LogoCloud:/);
    }
    for (const count of [3, 4, 6, 8, 12]) {
      const host = document.createElement("div");
      host.innerHTML = renderToStaticMarkup(<LogoCloud items={items(count)} />);
      expect(host.querySelectorAll("ul > li")).toHaveLength(count);
    }
  });

  it("exposes names beside decorative fixed-height marks [mutant: remove logo aria-hidden]", () => {
    const { container } = render(<LogoCloud items={items(3)} />);
    for (const [index, entry] of screen.getAllByRole("listitem").entries()) {
      expect(within(entry).getByText(`Mark ${index}`)).toHaveClass("sr-only");
      const logo = entry.querySelector("svg")?.parentElement;
      expect(logo).toHaveAttribute("aria-hidden", "true");
      expect(logo).toHaveClass("inline-flex", "h-8", "w-full", "max-w-40", "overflow-hidden", "tablet:h-10");
      expect(entry).toHaveClass("flex", "min-h-[3rem]", "items-center", "justify-center");
    }
    expect(container.querySelector("ul")).toHaveClass("grid", "gap-x-xl", "gap-y-lg");
  });

  it("names each link from its sr-only name rather than title [mutant: move name to title]", () => {
    const linked = items(3).map((item, index) => ({ ...item, href: `/marks/${index}` }));
    render(<LogoCloud items={linked} />);
    for (const item of linked) {
      const link = screen.getByRole("link", { name: item.name });
      expect(link).toHaveAttribute("href", item.href);
      expect(link).not.toHaveAttribute("title");
      expect(within(link).getByText(item.name)).toHaveClass("sr-only");
      expect(link.style.minBlockSize).toBe("var(--ui-layout-tap-target, 44px)");
      expect(link).toHaveClass("focus-visible:outline-2", "focus-visible:outline-offset-2", "focus-visible:outline-accent");
    }
  });

  it("maps twelve and six marks to six desktop columns [mutant: twelve uses four columns]", () => {
    const twelve = render(<LogoCloud items={items(12)} />);
    expect(twelve.container.querySelector("ul")).toHaveClass("grid-cols-2", "tablet:grid-cols-4", "desktop:grid-cols-6");
    twelve.unmount();
    render(<LogoCloud items={items(6)} />);
    expect(screen.getByRole("list")).toHaveClass("grid-cols-2", "tablet:grid-cols-3", "desktop:grid-cols-6");
  });

  it("defaults to grayscale and leaves original marks unchanged [mutant: omit grayscale]", () => {
    const mono = render(<LogoCloud items={items(3)} />);
    for (const mark of mono.container.querySelectorAll('span[aria-hidden="true"]')) expect(mark).toHaveClass("grayscale");
    expect(mono.container.innerHTML).not.toMatch(/opacity-|brightness-/);
    mono.unmount();
    const original = render(<LogoCloud items={items(3)} tone="original" />);
    expect(original.container.innerHTML).not.toContain("grayscale");
  });

  it("renders unlinked marks without anchors [mutant: always anchor]", () => {
    const { container } = render(<LogoCloud items={items(3)} />);
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("restores linked monochrome marks on hover and keyboard focus", () => {
    const linked = items(3).map(item => ({ ...item, href: "/mark" }));
    render(<LogoCloud items={linked} ground="inverse" />);
    expect(screen.getByRole("list")).toHaveClass("text-ink-on-inverse");
    for (const link of screen.getAllByRole("link")) {
      expect(link).toHaveClass("focus-visible:outline-accent-on-inverse");
      expect(link).toHaveClass("grayscale", "hover:grayscale-0", "focus-visible:grayscale-0");
    }
  });

  it("forwards host list attributes and style and keeps the other static column maps", () => {
    for (const [count, base, tablet] of [[3, "grid-cols-3", "tablet:grid-cols-3"], [4, "grid-cols-2", "tablet:grid-cols-4"], [8, "grid-cols-2", "tablet:grid-cols-4"]] as const) {
      const host = document.createElement("div");
      host.innerHTML = renderToStaticMarkup(<LogoCloud items={items(count)} aria-label="Contributors" aria-labelledby="marks" id="logos" className="gap-y-xl" style={{ marginBlockStart: "8px" }} />);
      const list = host.querySelector("ul")!;
      expect(list).toHaveAttribute("role", "list");
      expect(list).toHaveAttribute("aria-label", "Contributors");
      expect(list).toHaveAttribute("aria-labelledby", "marks");
      expect(list).toHaveAttribute("id", "logos");
      expect(list).toHaveClass(base, tablet, count === 3 ? "desktop:grid-cols-3" : "desktop:grid-cols-4", "gap-y-xl");
      expect(list.style.marginBlockStart).toBe("8px");
    }
  });
});
