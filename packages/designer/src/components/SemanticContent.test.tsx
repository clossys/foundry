import { createRef } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SemanticContent } from "./SemanticContent.js";

describe("SemanticContent", () => {
  for (const rank of [1, 2, 3, 4, 5, 6] as const) it(`preserves explicit heading rank ${rank} and its focus target`, () => {
    const ref = createRef<HTMLHeadingElement>();
    const { container } = render(<SemanticContent as={`h${rank}`} ref={ref} id="title" tabIndex={-1} aria-describedby="description">Title</SemanticContent>);
    const heading = screen.getByRole("heading", { level: rank });
    expect(heading.tagName).toBe(`H${rank}`);
    expect(ref.current).toBe(heading);
    expect(container.children).toHaveLength(1);
    expect(heading.getAttributeNames().sort()).toEqual(["aria-describedby", "id", "tabindex"]);
    heading.focus();
    expect(document.activeElement).toBe(heading);
  });

  it("preserves neutral heading and description composition without extra DOM or paint", () => {
    const { container } = render(<SemanticContent as="div"><SemanticContent as="h1" aria-describedby="description">Title</SemanticContent><SemanticContent as="p" id="description">Description</SemanticContent></SemanticContent>);
    expect(container.innerHTML).toBe('<div><h1 aria-describedby="description">Title</h1><p id="description">Description</p></div>');
    expect(screen.getByRole("heading", { name: "Title", description: "Description" }).tagName).toBe("H1");
  });

  it("forwards native attributes, original class/style and event handlers to the selected element", () => {
    const onClick = vi.fn();
    const { container } = render(<SemanticContent as="time" dateTime="2026-01-01" title="Date" className="consumer-class" style={{ opacity: 0.5 }} data-marker="caller" aria-label="Date" onClick={onClick}>Today</SemanticContent>);
    const time = container.firstElementChild!;
    expect(time.outerHTML).toBe('<time datetime="2026-01-01" title="Date" class="consumer-class" style="opacity: 0.5;" data-marker="caller" aria-label="Date">Today</time>');
    fireEvent.click(time);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("preserves list/container semantics, child identity and callback ref lifecycle", () => {
    const ref = vi.fn();
    const { container, unmount } = render(<SemanticContent as="section" aria-labelledby="empty"><SemanticContent as="h2" id="empty" /><SemanticContent as="ul" ref={ref}><SemanticContent as="li"><SemanticContent as="strong">Item</SemanticContent></SemanticContent></SemanticContent></SemanticContent>);
    expect(container.innerHTML).toBe('<section aria-labelledby="empty"><h2 id="empty"></h2><ul><li><strong>Item</strong></li></ul></section>');
    expect(ref).toHaveBeenCalledWith(screen.getByRole("list"));
    unmount();
    expect(ref.mock.lastCall?.[0]).toBe(null);
  });

  for (const tag of ["article", "aside", "code", "dd", "div", "dl", "dt", "main", "p", "section", "small", "span", "strong", "time", "ul", "li"] as const) it(`renders exactly the explicit ${tag} element`, () => {
    const { container } = render(<SemanticContent as={tag} />);
    expect(container.innerHTML).toBe(`<${tag}></${tag}>`);
  });

  for (const as of [undefined, "a", "button", "table", "iframe", "html", "style", "custom-element"]) it(`refuses unsupported runtime tag ${as}`, () => {
    expect(() => render(<SemanticContent {...({ as } as never)} />)).toThrow("SemanticContent requires a supported explicit tag");
  });
});

it("preserves the actual nested definition grammar without introducing layout wrappers", () => {
  const termRef = createRef<HTMLElement>();
  const { container } = render(<SemanticContent as="dl"><SemanticContent as="div"><SemanticContent as="dt" ref={termRef}>Name</SemanticContent><SemanticContent as="dd"><SemanticContent as="dl"><SemanticContent as="dt">Nested</SemanticContent><SemanticContent as="dd"><SemanticContent as="ul"><SemanticContent as="li">Value</SemanticContent></SemanticContent></SemanticContent></SemanticContent></SemanticContent></SemanticContent></SemanticContent>);
  expect(container.innerHTML).toBe('<dl><div><dt>Name</dt><dd><dl><dt>Nested</dt><dd><ul><li>Value</li></ul></dd></dl></dd></div></dl>');
  expect(termRef.current).toBe(screen.getByText("Name"));
  expect(termRef.current?.tagName).toBe("DT");
});
it("preserves small annotation inheritance and its native attributes without default presentation", () => {
  const ref = createRef<HTMLElement>();
  const { container } = render(<SemanticContent as="p" style={{ color: "red" }}><SemanticContent as="small" ref={ref} title="Annotation">Detail</SemanticContent></SemanticContent>);
  expect(container.innerHTML).toBe('<p style="color: red;"><small title="Annotation">Detail</small></p>');
  expect(ref.current).toBe(screen.getByText("Detail"));
  expect(ref.current?.style.cssText).toBe("");
  expect(ref.current?.className).toBe("");
});
