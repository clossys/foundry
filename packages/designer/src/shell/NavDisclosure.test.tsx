import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { NavDisclosure } from "./NavDisclosure.js";
import { SiteHeader } from "./SiteHeader.js";

function renderNav() {
  return render(
    <SiteHeader brand={<a href="/">Example</a>} nav={
      <NavDisclosure><a href="#about">About</a><a href="#contact"><span>Contact</span></a></NavDisclosure>
    } />,
  );
}

describe("NavDisclosure", () => {
  it("one nav landmark holds the toggle and each link once, in order", () => {
    renderNav();
    expect(screen.getAllByRole("navigation")).toHaveLength(1);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const toggle = within(nav).getByRole("button", { name: "Menu" });
    const links = within(nav).getAllByRole("link");
    expect(links.map(link => link.textContent)).toEqual(["About", "Contact"]);
    expect(nav.children).toHaveLength(2);
    expect(nav.firstElementChild).toBe(toggle);
    expect(nav.lastElementChild?.tagName).toBe("DIV");
    expect(toggle.compareDocumentPosition(links[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("the toggle is a named button with aria-expanded and aria-controls", () => {
    renderNav();
    const toggle = screen.getByRole("button", { name: "Menu" });
    const panel = document.getElementById(toggle.getAttribute("aria-controls")!);
    expect(toggle).toHaveAttribute("type", "button");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(panel).toBe(screen.getByRole("link", { name: "About" }).parentElement);
    expect(panel).not.toHaveAttribute("data-expanded");
    expect(toggle.style.minHeight).toBe("var(--ui-layout-tap-target, 44px)");
    expect(toggle.style.minWidth).toBe("var(--ui-layout-tap-target, 44px)");
    expect(toggle.className).toContain("nav-disclosure-toggle");
    expect(toggle.className).not.toMatch(/transition|duration|delay|animate/);
    toggle.focus();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(panel).toHaveAttribute("data-expanded");
    expect(toggle).toHaveFocus();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(panel).not.toHaveAttribute("data-expanded");
  });

  it("Escape while expanded collapses and returns focus to the toggle", () => {
    renderNav();
    const toggle = screen.getByRole("button", { name: "Menu" });
    fireEvent.click(toggle);
    const link = screen.getByRole("link", { name: "About" });
    link.focus();
    fireEvent.keyDown(link, { key: "Escape" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(link.parentElement).not.toHaveAttribute("data-expanded");
    expect(toggle).toHaveFocus();
  });

  it("activating a link in the panel collapses it, including a nested click target", () => {
    renderNav();
    const toggle = screen.getByRole("button", { name: "Menu" });
    fireEvent.click(toggle);
    fireEvent.click(screen.getByText("Contact"));
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("link", { name: "Contact" }).parentElement).not.toHaveAttribute("data-expanded");
  });

  it("accepts landmark and trigger names and className, with instance-local controls", () => {
    render(<><NavDisclosure aria-label="Sections" triggerLabel="Sections menu" className="custom"><a href="#one">One</a></NavDisclosure><NavDisclosure><a href="#two">Two</a></NavDisclosure></>);
    expect(screen.getByRole("navigation", { name: "Sections" })).toHaveClass("custom");
    const first = screen.getByRole("button", { name: "Sections menu" }).getAttribute("aria-controls");
    const second = screen.getByRole("button", { name: "Menu" }).getAttribute("aria-controls");
    expect(first).toBeTruthy();
    expect(second).not.toBe(first);
  });

  it("server renders collapsed with the links present once for the no-JS fallback", () => {
    const html = renderToStaticMarkup(<NavDisclosure><a href="#about">About</a></NavDisclosure>);
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("data-expanded");
    expect(html).not.toContain("hidden=");
    expect(html.match(/href="#about"/g)).toHaveLength(1);
  });

  it("exports through the client root and shell barrels, outside the server barrel", async () => {
    const shell = await import("./index.js");
    const root = await import("../index.js");
    const server = await import("./server.js");
    expect(shell.NavDisclosure).toBe(NavDisclosure);
    expect(root.NavDisclosure).toBe(NavDisclosure);
    expect(server).not.toHaveProperty("NavDisclosure");
  });
});

describe("HEADER-1 disclosure lifecycle", () => {
  it("keeps closed content inert and exposes a two-line X state when opened", () => {
    render(<SiteHeader brand={<a href="/">Example</a>} nav={<NavDisclosure trigger="icon"><a href="/help">Help</a></NavDisclosure>} />);
    const toggle = screen.getByRole("button", { name: "Menu" });
    const panel = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(panel).toHaveAttribute("inert");
    expect(toggle.querySelectorAll(".nav-disclosure-icon > span")).toHaveLength(2);
    fireEvent.click(toggle);
    expect(panel).not.toHaveAttribute("inert");
    expect(toggle.querySelector(".nav-disclosure-icon")).toHaveAttribute("data-open");
    act(() => (panel.querySelector("a") as HTMLElement).focus());
    fireEvent.keyDown(panel.querySelector("a")!, { key: "Escape" });
    expect(panel).toHaveAttribute("inert");
    expect(toggle.querySelector(".nav-disclosure-icon")).not.toHaveAttribute("data-open");
    expect(toggle).toHaveFocus();
  });
  it("resets navigation on history changes and leaves outside focus intact", () => {
    render(<><NavDisclosure><a href="/help">Help</a></NavDisclosure><button>Outside</button></>);
    const toggle = screen.getByRole("button", { name: "Menu" });
    fireEvent.click(toggle);
    fireEvent.popState(window);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveFocus();
    fireEvent.click(toggle);
    act(() => screen.getByRole("button", { name: "Outside" }).focus());
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "Outside" })).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
  });
});

it("HEADER-1 collapses from measured unequal tracks before collision and resets at desktop", () => {
  const media = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal("matchMedia", () => media);
  let width = 900;
  const rectangles = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
    const size = this.classList.contains("site-header-row") ? width : this.parentElement?.classList.contains("site-header-brand") ? 300 : this.parentElement?.classList.contains("site-header-actions") ? 100 : 400;
    return { width: size, height: 60, x: 0, y: 0, top: 0, left: 0, right: size, bottom: 60, toJSON() {} };
  });
  try {
    render(<SiteHeader brand={<a href="/">Brand with a long name</a>} nav={<NavDisclosure trigger="icon"><ul><li><a href="/help">Translated navigation label</a></li></ul></NavDisclosure>} actions={<a href="/start">Start</a>} />);
    const header = screen.getByRole("banner");
    expect(header).toHaveAttribute("data-collapsed");
    const toggle = screen.getByRole("button", { name: "Menu" });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    width = 1400;
    fireEvent.resize(window);
    expect(header).not.toHaveAttribute("data-collapsed");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById(toggle.getAttribute("aria-controls")!)).not.toHaveAttribute("inert");
  } finally { rectangles.mockRestore(); vi.unstubAllGlobals(); }
});

it("HEADER-1 preserves an open disclosure across equivalent JSX and resets meaningful route changes", async () => {
  const scene = (href: string) => <SiteHeader brand={<a href="/">Example</a>} nav={<NavDisclosure trigger="icon"><a href={href} aria-current="page">Current</a></NavDisclosure>} />;
  const view = render(scene("/current"));
  const toggle = screen.getByRole("button", { name: "Menu" });
  fireEvent.click(toggle);
  await act(async () => view.rerender(scene("/current")));
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  await act(async () => view.rerender(scene("/next")));
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(toggle).toHaveFocus();
});

it("HEADER-1 observes intrinsic children, preserves visible desktop focus and restores clearance on nav removal", () => {
  let measure = () => {};
  const observed: Element[] = [];
  class Observer { constructor(callback: () => void) { measure = callback; } observe(node: Element) { observed.push(node); } disconnect() {} }
  vi.stubGlobal("ResizeObserver", Observer);
  const media = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal("matchMedia", () => media);
  const rects = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
    const width = this.classList.contains("site-header-row") ? 1400 : 100;
    return { width, height: 72, left: 0, right: width, top: 0, bottom: 72, x: 0, y: 0, toJSON() {} };
  });
  const scene = (nav = true) => <div data-site-frame=""><SiteHeader brand={<a href="/">Example</a>} nav={nav ? <NavDisclosure trigger="icon"><ul className="site-header-nav-links"><li><a href="/help">Help</a></li></ul></NavDisclosure> : undefined} /></div>;
  try {
    const view = render(scene());
    const frame = view.container.firstElementChild as HTMLElement;
    expect(frame.style.getPropertyValue("--site-header-clearance")).toBe("72px");
    expect(observed).toContain(screen.getByRole("link", { name: "Example" }));
    expect(observed).toContain(screen.getByRole("link", { name: "Help" }));
    const toggle = screen.getByRole("button", { name: "Menu" });
    fireEvent.click(toggle);
    act(() => screen.getByRole("link", { name: "Help" }).focus());
    media.matches = true;
    act(measure);
    expect(screen.getByRole("link", { name: "Help" })).toHaveFocus();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    media.matches = false;
    act(measure);
    expect(toggle).toHaveFocus();
    media.matches = true;
    act(measure);
    expect(screen.getByRole("link", { name: "Help" })).toHaveFocus();
    view.rerender(scene(false));
    expect(frame.style.getPropertyValue("--site-header-clearance")).toBe("");
    expect(view.container.querySelector("header")).toHaveClass("site-header-contract");
    expect(view.container.querySelector("header nav, header button")).toBeNull();
  } finally { rects.mockRestore(); vi.unstubAllGlobals(); }
});
