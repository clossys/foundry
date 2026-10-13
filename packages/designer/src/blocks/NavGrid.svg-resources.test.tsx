import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { createElement, type ReactNode } from "react";
import { NavGrid, type NavGridItem } from "./NavGrid.js";
import { assertNoNestedInteractive, hasInteractiveContent } from "./stretched-link.js";

const graphic = <svg aria-hidden="true"><use href="#mark" /><image href="/mark.svg" /><use xlinkHref="#mark" /></svg>;
const items = (count: number): NavGridItem[] => Array.from({ length: count }, (_, index) => ({ id: String(index), title: `Topic ${index}`, href: `/topics/${index}`, description: "Supporting copy" }));
const withGraphic = (count: number, slot: "description" | "title" | "icon"): NavGridItem[] => items(count).map(item => slot === "title" ? { ...item, title: <>{item.title}{graphic}</> } : slot === "description" ? { ...item, description: <>{item.description}{graphic}</> } : { ...item, icon: graphic });

describe("NavGrid passive SVG resources", () => {
  it.each([1, 2, 7].flatMap(count => (["description", "title", "icon"] as const).map(slot => ({ count, slot }))))("keeps a whole-tile link with a sprite in $slot for $count items", ({ count, slot }) => {
    const { container } = render(<NavGrid items={withGraphic(count, slot)} />);
    const primary = screen.getByRole("link", { name: "Topic 0" });
    expect(primary).toHaveAttribute("href", "/topics/0");
    expect(primary).toHaveAttribute("data-card-link");
    expect(primary).toHaveClass("after:absolute", "after:inset-0");
    expect(screen.getAllByRole("link")).toHaveLength(count);
    expect(container.querySelectorAll('use[href="#mark"]')).toHaveLength(count);
    expect(container.querySelectorAll('image[href="/mark.svg"]')).toHaveLength(count);
    if (count === 2) {
      expect(container.querySelector('[data-link-grid][data-count="2"]')).not.toBeNull();
      expect(primary).toHaveClass("after:rounded-panel");
      expect(primary.closest("li")).toHaveClass("relative", "isolate", "bg-surface-sunken");
      expect(container.querySelector("[data-nav-grid-card]")).toBeNull();
    } else {
      expect(container.querySelector("[data-link-grid]")).toBeNull();
      expect(primary).toHaveClass("after:rounded-control");
      expect(primary.closest("[data-nav-grid-card]")).toHaveClass("relative", "isolate");
    }
    if (slot === "description") {
      expect(primary.querySelector("use, image")).toBeNull();
      expect(primary).not.toHaveTextContent("Supporting copy");
      expect(screen.getAllByText("Supporting copy")).toHaveLength(count);
    }
  });

  it("keeps the eligible sprite description path during ordinary SSR", () => {
    const html = renderToStaticMarkup(<NavGrid items={withGraphic(2, "description")} />);
    const doc = JSDOM.fragment(html);
    expect(doc.querySelector('[data-link-grid][data-count="2"]')).not.toBeNull();
    expect(doc.querySelectorAll('a[data-card-link]')).toHaveLength(2);
    expect(doc.querySelectorAll('use[href="#mark"]')).toHaveLength(2);
    expect(doc.querySelectorAll('image[href="/mark.svg"]')).toHaveLength(2);
    expect(doc.querySelector("button, [data-nav-grid-card]")).toBeNull();
    expect(doc.textContent?.match(/Supporting copy/g)).toHaveLength(2);
    for (const link of doc.querySelectorAll("a")) expect(link.textContent).not.toContain("Supporting copy");
  });

  it.each([
    { name: "SVG link", description: <svg><a href="/help">Help</a></svg>, role: "link" as const, label: "Help" },
    { name: "foreignObject button", description: <svg><foreignObject><button>Details</button></foreignObject></svg>, role: "button" as const, label: "Details" },
  ])("keeps $name outside a separate title link", ({ description, role, label }) => {
    const sample = items(2); sample[0] = { ...sample[0]!, description };
    const { container } = render(<NavGrid items={sample} />);
    const primary = screen.getByRole("link", { name: "Topic 0" });
    const control = screen.getByRole(role, { name: label });
    expect(primary).not.toContainElement(control);
    expect(primary.className).not.toMatch(/(?:^|\s)after:/);
    expect(container.querySelector("[data-link-grid]")).toBeNull();
    expect(primary).toHaveAttribute("href", "/topics/0");
  });

  it.each([1, 2, 7].flatMap(count => (["title", "icon"] as const).map(slot => ({ count, slot }))))("still refuses an interactive $slot when description controls select fallback for $count items", ({ count, slot }) => {
    const sample = items(count);
    sample[0] = { ...sample[0]!, description: <button>Details</button>, [slot]: slot === "title" ? <a href="/nested">Topic 0</a> : <button>Icon control</button> };
    expect(() => renderToStaticMarkup(<NavGrid items={sample} />)).toThrow('NavGrid: item "0" is linked (href), so it cannot hold another link, button or field');
  });
});

describe("shared SVG resource classification", () => {
  it("accepts passive resource href only in SVG context, including SVG re-entry", () => {
    const reentered = <svg><foreignObject><svg><use href="#mark" /></svg></foreignObject></svg>;
    expect(hasInteractiveContent([graphic, reentered])).toBe(false);
    expect(() => assertNoNestedInteractive("NavGrid", "0", [graphic, reentered])).not.toThrow();
  });
  it.each([
    { name: "outside SVG", node: <use href="#mark" /> },
    { name: "foreignObject HTML context", node: <svg><foreignObject><use href="#mark" /></foreignObject></svg> },
    { name: "SVG link", node: <svg><a href="/nested">Nested</a></svg> },
    { name: "resource descendant button", node: <svg><use href="#mark"><button>Control</button></use></svg> },
    { name: "resource click handler", node: <svg><use href="#mark" onClick={() => undefined} /></svg> },
    { name: "resource press handler", node: <svg><use href="#mark" {...{ onPress: () => undefined }} /></svg> },
    { name: "resource focus target", node: <svg><use href="#mark" tabIndex={-1} /></svg> },
    { name: "editable resource", node: <svg><image href="/mark.svg" contentEditable /></svg> },
  ])("keeps $name classified as a target", ({ node }) => {
    expect(hasInteractiveContent([node])).toBe(true);
    expect(() => assertNoNestedInteractive("NavGrid", "0", [node])).toThrow(TypeError);
  });
  it("does not execute an opaque href component to discover its output", () => {
    let calls = 0;
    const Sprite = (_props: { href: string; children?: ReactNode }) => { calls++; return graphic; };
    expect(hasInteractiveContent([<Sprite href="#mark" />])).toBe(true);
    expect(() => assertNoNestedInteractive("NavGrid", "0", [<Sprite href="#mark" />])).toThrow(TypeError);
    expect(calls).toBe(0);
  });
});

describe("conservative SVG reference limits", () => {
  it("requires a visible literal svg ancestor for sprite children in an opaque wrapper", () => {
    let calls = 0;
    const SpriteIcon = ({ children }: { children?: ReactNode }) => { calls++; return <svg>{children}</svg>; };
    SpriteIcon.displayName = "svg";
    const wrapped = <SpriteIcon><use href="#mark" /></SpriteIcon>;
    expect(hasInteractiveContent([wrapped])).toBe(true);
    expect(() => assertNoNestedInteractive("NavGrid", "0", [wrapped])).toThrow(TypeError);
    const sample = items(2).map(item => ({ ...item, icon: wrapped }));
    expect(() => renderToStaticMarkup(<NavGrid items={sample} />)).toThrow(TypeError);
    expect(calls).toBe(0);
    expect(hasInteractiveContent([<svg><use href="#mark" /></svg>])).toBe(false);
  });

  it.each(["linearGradient", "radialGradient", "pattern", "textPath", "feImage", "mpath"])("conservatively refuses the unsupported %s href carrier in a linked title", tag => {
    const reference = <svg aria-hidden="true">{createElement(tag, { href: "#base" })}</svg>;
    expect(hasInteractiveContent([reference])).toBe(true);
    const sample = items(2); sample[0] = { ...sample[0]!, title: <>Topic 0{reference}</> };
    expect(() => renderToStaticMarkup(<NavGrid items={sample} />)).toThrow(TypeError);
  });
});
