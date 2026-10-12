import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { Items } from "./items/Items.js";
import { assertNoNestedInteractive, cardLinkContainerClassName } from "./stretched-link.js";

const TITLES = ["Ownership records", "Signed agreements", "Insurance"] as const;
const HREFS = ["/records", "/agreements", "/insurance"] as const;

const features = (treatment: "plain" | "rule" | "plate", linked = true) =>
  TITLES.map((heading, index) => ({ id: `f${index}`, heading, description: "One line of supporting copy.", ...(linked ? { href: HREFS[index] } : {}) }));

/** Every linked block, rendered on each ground, with the container class it must carry. */
const LINKED_BLOCKS: ReadonlyArray<{ name: string; frame: "plate" | "plain" | "rule"; render: (ground: "base" | "sunken" | "inverse") => ReactElement }> = [
  { name: "Items plate", frame: "plate", render: (ground) => <Items arrangement="columns" ground={ground} columns={3} treatment="plate" items={features("plate")} /> },
  { name: "Items plain", frame: "plain", render: (ground) => <Items arrangement="columns" ground={ground} columns={3} treatment="plain" items={features("plain")} /> },
  { name: "Items rule", frame: "rule", render: (ground) => <Items arrangement="columns" ground={ground} columns={3} treatment="rule" items={features("rule")} /> },
  {
    name: "Items bento",
    frame: "plate",
    render: (ground) => (
      <Items arrangement="bento" treatment="plate"
        ground={ground}
        items={TITLES.map((heading, index) => ({ id: `c${index}`, heading, description: "One line.", span: "third" as const, href: HREFS[index], visual: <figure aria-label="A record">Static</figure> }))}
      />
    ),
  },
  {
    name: "Items rows",
    frame: "rule",
    render: (ground) => <Items arrangement="rows" treatment="rule" ground={ground} columns={1} items={TITLES.map((heading, index) => ({ id: `t${index}`, heading, description: "One line.", href: HREFS[index] }))} />,
  },
  {
    name: "Items connected",
    frame: "plain",
    render: (ground) => <Items arrangement="stacked" order="connected" ground={ground} items={TITLES.map((heading, index) => ({ id: `s${index}`, ordinal: `0${index + 1}`, heading, description: "One line.", href: HREFS[index] }))} />,
  },
];

describe("linked items (stretched link)", () => {
  for (const frame of ["plain", "rule"] as const) {
    it(`${frame} frames use the smaller outset below tablet for both the hit area and hover plate`, () => {
      const { container } = render(<Items arrangement="columns" columns={3} treatment={frame} items={features(frame)} />);
      for (const link of container.querySelectorAll("a")) {
        expect(link).toHaveClass("after:-inset-x-sm", "tablet:after:-inset-x-md");
        expect(link).not.toHaveClass("after:-inset-x-md");
        const item = link.closest(".relative.isolate");
        expect(item).toHaveClass("before:-inset-x-sm", "tablet:before:-inset-x-md");
        expect(item).not.toHaveClass("before:-inset-x-md");
        if (frame === "plain") {
          expect(link).toHaveClass("after:-inset-y-sm", "tablet:after:-inset-y-md");
          expect(link).not.toHaveClass("after:-inset-y-md");
          expect(item).toHaveClass("before:-inset-y-sm", "tablet:before:-inset-y-md");
          expect(item).not.toHaveClass("before:-inset-y-md");
        } else {
          expect(link).toHaveClass("after:top-0", "after:-bottom-sm", "tablet:after:-bottom-md");
          expect(link).not.toHaveClass("after:-bottom-md");
          expect(item).toHaveClass("before:top-0", "before:-bottom-sm", "tablet:before:-bottom-md");
          expect(item).not.toHaveClass("before:-bottom-md");
        }
      }
    });
  }

  for (const block of LINKED_BLOCKS) {
    for (const ground of ["base", "sunken", "inverse"] as const) {
      it(`${block.name} on ${ground}: one anchor per item, named by its title alone, with an aria-hidden chevron, a stretched hit area and a ring around the item`, () => {
        const { container } = render(block.render(ground));
        const anchors = [...container.querySelectorAll("a")];
        expect(anchors).toHaveLength(TITLES.length);
        TITLES.forEach((title, index) => {
          const link = screen.getByRole("link", { name: title });
          expect(link).toHaveAttribute("href", HREFS[index]);
          expect(link).toHaveAttribute("data-card-link");
          // The chevron and the no-break join are decorative and outside the name.
          const chevron = link.lastElementChild as Element;
          expect(chevron.tagName.toLowerCase()).toBe("svg");
          expect(chevron).toHaveAttribute("aria-hidden", "true");
          expect(chevron.previousElementSibling).toHaveAttribute("aria-hidden", "true");
          expect(chevron.previousElementSibling?.textContent).toBe(" ");
          expect(link).toHaveClass("quiet-action", "after:absolute", "after:z-10", "focus-visible:after:outline-2", "focus-visible:after:outline-offset-2");
          expect(link).toHaveClass(ground === "inverse" ? "focus-visible:after:outline-accent-on-inverse" : "focus-visible:after:outline-accent");
          expect(link).toHaveClass("underline", "decoration-transparent", "hover:decoration-current");
          expect(link.className).not.toMatch(/transition/);
          const container = link.closest(".relative.isolate");
          expect(container).not.toBeNull();
          expect(container?.className).toContain(cardLinkContainerClassName(block.frame, ground));
          // The anchor wraps only the title: the description is outside it.
          expect(link).not.toHaveTextContent("One line");
        });
      });
    }
  }

  it("gives bare items (plain, rule, connected) a hover plate in the band's other ground, and plates none", () => {
    expect(cardLinkContainerClassName("plain", "base")).toContain("hover:before:bg-surface-sunken");
    expect(cardLinkContainerClassName("rule", "sunken")).toContain("hover:before:bg-surface-raised");
    expect(cardLinkContainerClassName("rule", "inverse")).toContain("has-focus-visible:before:bg-surface-inverse-raised");
    expect(cardLinkContainerClassName("plate", "base")).toBe("relative isolate");
    expect(cardLinkContainerClassName("control", "base")).toBe("relative isolate");
  });

  it("renders no anchor, chevron or link container for unlinked items", () => {
    const { container } = render(
      <>
        <Items arrangement="columns" columns={3} treatment="plain" items={features("plain", false)} />
        <Items arrangement="rows" treatment="rule" items={TITLES.slice(0, 2).map((heading, index) => ({ id: `t${index}`, heading }))} />
      </>,
    );
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector(".isolate")).toBeNull();
  });

  it("keeps the card grid heading a real heading whose link carries the title", () => {
    render(<Items arrangement="bento" treatment="plate" items={TITLES.slice(0, 2).map((heading, index) => ({ id: `c${index}`, heading, span: "half" as const, href: HREFS[index] }))} />);
    const heading = screen.getByRole("heading", { name: TITLES[0] });
    expect(heading.tagName).toBe("H3");
    expect(within(heading).getByRole("link", { name: TITLES[0] })).toBeInTheDocument();
    // A transformed heading would trap the stretched hit area, so a linked display title drops font-display's scaleX.
    expect(heading).toHaveClass("font-display", "transform-none");
  });

  it("keeps the display scale on an unlinked card heading", () => {
    render(<Items arrangement="bento" treatment="plate" items={TITLES.slice(0, 2).map((heading, index) => ({ id: `c${index}`, heading, span: "half" as const }))} />);
    expect(screen.getByRole("heading", { name: TITLES[0] })).not.toHaveClass("transform-none");
  });

  it("throws a TypeError when a linked item holds another link, button or field", () => {
    const nested = <span>Read <a href="/more">more</a></span>;
    expect(() => render(<Items arrangement="columns" columns={2} treatment="plate" items={[{ id: "a", heading: "A", description: nested, href: "/a" }, { id: "b", heading: "B", href: "/b" }]} />)).toThrow(TypeError);
    expect(() =>
      render(<Items arrangement="bento" treatment="plate" items={[{ id: "a", heading: "A", span: "half", href: "/a", visual: <div><button type="button">Open</button></div> }, { id: "b", heading: "B", span: "half", href: "/b" }]} />),
    ).toThrow(TypeError);
    expect(() => render(<Items arrangement="rows" treatment="rule" items={[{ id: "a", heading: "A", description: <input aria-label="x" />, href: "/a" }, { id: "b", heading: "B", href: "/b" }]} />)).toThrow(TypeError);
    expect(() =>
      render(<Items arrangement="stacked" order="connected" items={[{ id: "a", ordinal: 1, heading: "A", visual: <span onClick={() => undefined}>x</span>, href: "/a" }, { id: "b", ordinal: 2, heading: "B", href: "/b" }, { id: "c", ordinal: 3, heading: "C", href: "/c" }]} />),
    ).toThrow(TypeError);
    // The same content is fine on an unlinked item.
    expect(() => render(<Items arrangement="rows" treatment="rule" items={[{ id: "a", heading: "A", description: nested }, { id: "b", heading: "B" }]} />)).not.toThrow();
    expect(() => assertNoNestedInteractive("Block", "a", ["Plain", <strong key="s">bold</strong>])).not.toThrow();
  });

  it("refuses href on statement feature items: headlines, not destinations", () => {
    expect(() => render(<Items arrangement="columns" emphasis="statement" items={features("plain")} />)).toThrow(TypeError);
  });
});
