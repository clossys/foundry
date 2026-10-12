import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Item } from "./Item.js";
import { Items } from "./Items.js";
import { Items as NativeItems } from "./Items.server.js";
import type { ItemData } from "./types.js";

const questions = (icon?: ItemData["icon"]): ItemData[] => Array.from({ length: 4 }, (_, i) => ({ id: String(i), heading: `Question ${i}`, description: `Answer ${i}`, icon }));
const graphic = <svg><use href="#check" /><image href="/example.svg" /><use xlinkHref="#check" /></svg>;
const linked = (icon: ItemData["icon"]) => <Item id="one" heading="Title" icon={icon} href="/one" treatment="plain" size="standard" ground="base" />;

describe("native SVG references in canonical supplied content", () => {
  it.each([Items, NativeItems])("accepts use and image resources in every trigger slot without creating targets", Component => {
    const items = questions(graphic).map(item => ({ ...item, heading: <>{item.heading}{graphic}</>, eyebrow: graphic, meta: graphic, badge: { label: graphic } }));
    const html = renderToStaticMarkup(<Component arrangement="rows" reveal="disclose" items={items} />);
    const host = document.createElement("div"); host.innerHTML = html;
    expect(host.querySelectorAll('use[href="#check"]')).toHaveLength(20);
    expect(host.querySelectorAll('image[href="/example.svg"]')).toHaveLength(20);
    expect(host.querySelectorAll("button, summary")).toHaveLength(4);
    expect(host.querySelector("a")).toBeNull();
  });
  it("accepts sprite and image resources in linked standalone and collection items", () => {
    const single = renderToStaticMarkup(linked(graphic));
    const collection = renderToStaticMarkup(<Items arrangement="columns" items={questions(graphic).slice(0, 3).map(item => ({ ...item, href: `/item-${item.id}` }))} />);
    expect(single).toContain('href="#check"'); expect(single).toContain('href="/example.svg"');
    expect(single.match(/<a /g)).toHaveLength(1);
    expect(collection.match(/<a /g)).toHaveLength(3);
  });
  it.each([
    <svg key="anchor"><a href="/nested">Link</a></svg>,
    <svg key="foreign"><foreignObject><button>Control</button></foreignObject></svg>,
    <svg key="descendant"><use href="#check"><button>Control</button></use></svg>,
    <svg key="tab"><use href="#check" tabIndex={-1} /></svg>,
    <svg key="editable"><image href="/example.svg" contentEditable /></svg>,
    <svg key="click"><use href="#check" onClick={() => {}} /></svg>,
  ])("keeps authored SVG targets refused in both linked and disclosure policies %j", icon => {
    expect(() => renderToStaticMarkup(linked(icon))).toThrow(TypeError);
    for (const Component of [Items, NativeItems]) expect(() => renderToStaticMarkup(<Component arrangement="rows" reveal="disclose" items={questions(icon)} />)).toThrow(TypeError);
  });
  it.each([
    <use key="outside" href="#check" />,
    <svg key="foreign-use"><foreignObject><use href="#check" /></foreignObject></svg>,
  ])("requires actual SVG context rather than a slot index or foreignObject ancestor %j", icon => {
    expect(() => renderToStaticMarkup(linked(icon))).toThrow(TypeError);
    const items = questions().map(item => ({ ...item, meta: icon }));
    expect(() => renderToStaticMarkup(<Items arrangement="rows" reveal="disclose" items={items} />)).toThrow(TypeError);
  });
  it("enters SVG context again inside foreignObject without executing opaque supplied components", () => {
    const icon = <svg><foreignObject><svg><use href="#check" /></svg></foreignObject></svg>;
    expect(() => renderToStaticMarkup(linked(icon))).not.toThrow();
    expect(() => renderToStaticMarkup(<Items arrangement="rows" reveal="disclose" items={questions(icon)} />)).not.toThrow();
    let calls = 0;
    const Sprite = (_props: { href: string }) => { calls++; return <svg />; };
    expect(() => renderToStaticMarkup(linked(<Sprite href="#check" />))).toThrow(TypeError);
    expect(calls).toBe(0);
  });
  it("retains disclosure-only control-role refusals on a passive resource", () => {
    const icon = <svg><use href="#check" role="button" /></svg>;
    expect(() => renderToStaticMarkup(<NativeItems arrangement="rows" reveal="disclose" items={questions(icon)} />)).toThrow(TypeError);
  });
});

describe("native disclosure typography baseline", () => {
  it.each([3, 4] as const)("sets the h%s baseline without flattening authored emphasis", headingLevel => {
    const items = questions().map(item => ({ ...item, meta: <>Actor <strong>Lead</strong></> }));
    const { container } = render(<NativeItems arrangement="rows" reveal="disclose" headingLevel={headingLevel} items={items} />);
    expect(container.querySelectorAll(`summary > h${headingLevel}`)).toHaveLength(4);
    for (const heading of container.querySelectorAll(`summary > h${headingLevel}`)) {
      expect(heading).toHaveClass("font-medium");
      expect(heading.querySelector('[data-item-meta] .text-caption')).toHaveClass("font-body");
      expect(heading.querySelector("strong")).toHaveTextContent("Lead");
    }
    expect(screen.getAllByText("Lead")).toHaveLength(4);
  });
});
