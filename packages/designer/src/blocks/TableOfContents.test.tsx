import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TableOfContents, type TableOfContentsItem, type TableOfContentsProps } from "./TableOfContents.js";

const LABEL = "On this page";
const CLEARANCE = "calc(max(var(--ui-layout-tap-target, 44px), var(--ui-brandmark-height-lg, 48px)) + 2 * var(--spacing-sm, 8px) + var(--ui-border-hairline, 1px) + env(safe-area-inset-top, 0px))";
const ITEMS: readonly TableOfContentsItem[] = [
  { id: "a", label: "Overview" },
  { id: "b", label: "Getting started" },
  { id: "c", label: "Configuration", level: 3 },
];

interface Recorded {
  callback: IntersectionObserverCallback;
  options: IntersectionObserverInit | undefined;
  observed: Element[];
  disconnects: number;
}

let observers: Recorded[];

class MockIntersectionObserver {
  readonly record: Recorded;
  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.record = { callback, options, observed: [], disconnects: 0 };
    observers.push(this.record);
  }
  observe(target: Element) { this.record.observed.push(target); }
  unobserve() {}
  disconnect() { this.record.disconnects += 1; }
  takeRecords() { return []; }
}

function targets(ids: readonly string[]) {
  for (const id of ids) {
    const section = document.createElement("section");
    section.id = id;
    document.body.append(section);
  }
}

function fire(record: Recorded, changes: Record<string, boolean>) {
  const entries = Object.entries(changes).map(([id, isIntersecting]) => ({
    target: document.getElementById(id)!, isIntersecting,
  })) as unknown as IntersectionObserverEntry[];
  act(() => record.callback(entries, {} as IntersectionObserver));
}

function view(props: Partial<TableOfContentsProps> = {}) {
  return <TableOfContents label={LABEL} items={ITEMS} {...props} />;
}

function current() {
  return screen.queryAllByRole("link").filter(link => link.hasAttribute("aria-current")).map(link => link.textContent);
}

beforeEach(() => {
  observers = [];
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
  targets(ITEMS.map(item => item.id));
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("TableOfContents", () => {
  it("names its navigation landmark by the label prop", () => {
    render(view());
    expect(screen.getByRole("navigation", { name: LABEL })).toBeInTheDocument();
    expect(screen.getAllByRole("navigation")).toHaveLength(1);
    expect(screen.getAllByRole("link").map(link => link.getAttribute("href"))).toEqual(["#a", "#b", "#c"]);
  });

  it("marks a controlled currentId with aria-current location on that link only", () => {
    render(view({ currentId: "b" }));
    const links = screen.getAllByRole("link");
    expect(links[1]).toHaveAttribute("aria-current", "location");
    expect(links.filter(link => link.hasAttribute("aria-current"))).toHaveLength(1);
    expect(links[1]).toHaveClass("border-accent", "font-medium", "text-ink-primary", "forced-colors:border-current");
    expect(links[0]).toHaveClass("border-transparent", "text-ink-secondary");
    expect(links[0]).not.toHaveClass("font-medium");
  });

  it.each([
    ["one item", { items: ITEMS.slice(0, 1) }],
    ["31 items", { items: Array.from({ length: 31 }, (_, index) => ({ id: `s${index}`, label: `Section ${index}` })) }],
    ["duplicate ids", { items: [{ id: "a", label: "One" }, { id: "a", label: "Two" }] }],
    ["an id with a space", { items: [{ id: "a b", label: "One" }, { id: "c", label: "Two" }] }],
    ["an id with a hash", { items: [{ id: "#a", label: "One" }, { id: "c", label: "Two" }] }],
    ["an empty label", { label: " " }],
    ["a level outside 2 and 3", { items: [{ id: "a", label: "One", level: 4 as 2 }, { id: "c", label: "Two" }] }],
    ["a currentId outside the items", { currentId: "z" }],
  ])("throws a prefixed TypeError for %s", (_name, props) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => render(view(props as Partial<TableOfContentsProps>))).toThrow(TypeError);
      expect(() => render(view(props as Partial<TableOfContentsProps>))).toThrow(/^TableOfContents: /);
    } finally {
      error.mockRestore();
    }
  });

  it("accepts exactly 2 and 30 items", () => {
    const thirty = Array.from({ length: 30 }, (_, index) => ({ id: `s${index}`, label: `Section ${index}` }));
    render(view({ items: thirty }));
    expect(screen.getAllByRole("link")).toHaveLength(30);
  });

  it("tracks the first visible heading in document order and keeps it when nothing is visible", () => {
    render(view());
    expect(observers).toHaveLength(1);
    const [record] = observers as [Recorded];
    expect(record.observed.map(element => element.id)).toEqual(["a", "b", "c"]);
    expect(current()).toEqual([]);
    fire(record, { c: true, b: true });
    expect(current()).toEqual(["Getting started"]);
    expect(screen.getByRole("link", { name: "Getting started" })).toHaveAttribute("aria-current", "location");
    fire(record, { b: false });
    expect(current()).toEqual(["Configuration"]);
    fire(record, { c: false });
    expect(current()).toEqual(["Configuration"]);
  });

  it("skips a missing target and builds the observer with the reading-line root margin, disconnecting on unmount", () => {
    document.getElementById("b")!.remove();
    const { unmount } = render(view());
    const [record] = observers as [Recorded];
    expect(record.options).toEqual({ rootMargin: "0px 0px -70% 0px" });
    expect(record.observed.map(element => element.id)).toEqual(["a", "c"]);
    expect(record.disconnects).toBe(0);
    unmount();
    expect(record.disconnects).toBe(1);
  });

  it.each([
    ["a controlled currentId", { currentId: "a" }],
    ["trackCurrent false", { trackCurrent: false }],
  ])("constructs no observer with %s", (_name, props) => {
    render(view(props));
    expect(observers).toHaveLength(0);
  });

  it("renders with no current item when IntersectionObserver is unavailable", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    render(view());
    expect(screen.getAllByRole("link")).toHaveLength(3);
    expect(current()).toEqual([]);
  });

  it("indents level 3 items further than level 2 items", () => {
    render(view());
    const [first, , third] = screen.getAllByRole("link");
    expect(first).toHaveClass("ps-md");
    expect(first).not.toHaveClass("ps-xl");
    expect(third).toHaveClass("ps-xl");
    expect(third).not.toHaveClass("ps-md");
  });

  it("gives every link the tap-target minimum, a start border and the focus-visible outline", () => {
    render(view());
    for (const link of screen.getAllByRole("link")) {
      expect(link.style.minBlockSize).toBe("var(--ui-layout-tap-target, 44px)");
      expect(link).toHaveClass("flex", "items-center", "border-s-2", "pe-sm", "text-body-s", "focus-visible:outline-2", "focus-visible:outline-offset-2", "focus-visible:outline-accent");
    }
  });

  it("renders the sidebar as a captioned list that is sticky from desktop below the header clearance", () => {
    const { container } = render(view({ className: "mt-lg", style: { maxInlineSize: "20rem" } }));
    const nav = screen.getByRole("navigation", { name: LABEL });
    expect(container.firstElementChild).toBe(nav);
    expect(nav).toHaveClass("desktop:sticky", "desktop:max-h-dvh", "desktop:overflow-y-auto", "mt-lg");
    expect(nav.style.insetBlockStart).toBe(CLEARANCE);
    expect(nav.style.zIndex).toBe("var(--ui-z-sticky, 10)");
    expect(nav.style.maxInlineSize).toBe("20rem");
    const caption = nav.querySelector("p")!;
    expect(caption).toHaveAttribute("aria-hidden", "true");
    expect(caption).toHaveTextContent(LABEL);
    expect(caption).toHaveClass("pb-sm", "text-caption", "text-ink-muted");
    expect(nav.querySelector("ol")).toHaveClass("flex", "flex-col");
    const spacer = nav.lastElementChild as HTMLElement;
    expect(spacer).toHaveAttribute("aria-hidden", "true");
    expect(spacer).toHaveClass("hidden", "desktop:block");
    expect(spacer.style.blockSize).toBe(CLEARANCE);
  });

  it("renders inline as a bordered disclosure named by the label, expanded by default and collapsible", async () => {
    const user = userEvent.setup();
    const { container } = render(view({ presentation: "inline", className: "mt-lg" }));
    const box = container.firstElementChild as HTMLElement;
    expect(box).toHaveClass("rounded-panel", "border", "border-line-base", "p-md", "mt-lg");
    const trigger = screen.getByRole("button", { name: LABEL });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const nav = screen.getByRole("navigation", { name: LABEL });
    expect(nav).toBeVisible();
    expect(nav.querySelector("p")).toBeNull();
    expect(nav).not.toHaveClass("desktop:sticky");
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(nav).not.toBeVisible();
  });

  it("sets no scroll behaviour and every rendered class has a compiled rule", () => {
    const css = readFileSync(resolve(import.meta.dirname, "../../styles/compiled.css"), "utf8");
    const { container } = render(<>{view({ currentId: "a" })}{view({ presentation: "inline" })}</>);
    const classes = new Set<string>();
    for (const element of container.querySelectorAll("*")) for (const name of element.classList) classes.add(name);
    expect(classes.size).toBeGreaterThan(20);
    const missing = [...classes].filter(name => !css.includes("." + name.replace(/[^a-zA-Z0-9_-]/g, character => "\\" + character)));
    expect(missing).toEqual([]);
    for (const element of container.querySelectorAll<HTMLElement>("*")) expect(element.style.scrollBehavior).toBe("");
  });
});
