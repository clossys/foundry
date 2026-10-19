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

it.each(["wrapped", "direct"])("HEADER-1 collapses from measured unequal tracks (%s) before collision and resets at desktop", async supply => {
  const media = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal("matchMedia", () => media);
  let width = 900;
  const rectangles = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
    const size = this.classList.contains("site-header-row") ? width : this.parentElement?.classList.contains("site-header-brand") ? 300 : this.parentElement?.classList.contains("site-header-actions") ? 100 : 400;
    const left = this.textContent === "Later navigation" ? 100 : 0;
    const measured = this.matches(".nav-disclosure-panel > a") ? (left ? 300 : 100) : size;
    return { width: measured, height: 60, x: left, y: 0, top: 0, left, right: left + measured, bottom: 60, toJSON() {} };
  });
  try {
    render(<SiteHeader brand={<a href="/">Brand with a long name</a>} nav={<NavDisclosure trigger="icon">{supply === "wrapped" ? <ul><li><a href="/help">Translated navigation label</a></li></ul> : <><a href="/help">First navigation</a><a href="/later">Later navigation</a></>}</NavDisclosure>} actions={<a href="/start">Start</a>} />);
    const header = screen.getByRole("banner");
    expect(header).toHaveAttribute("data-collapsed");
    const toggle = screen.getByRole("button", { name: "Menu" });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    width = 1400;
    await act(async () => { fireEvent.resize(window); await new Promise(requestAnimationFrame); });
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

it("HEADER-1 observes intrinsic children, preserves visible desktop focus and restores clearance on nav removal", async () => {
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
  const scene = (nav = true) => <div data-frame-root=""><SiteHeader brand={<a href="/">Example</a>} nav={nav ? <NavDisclosure trigger="icon"><ul className="site-header-nav-links"><li><a href="/help">Help</a></li></ul></NavDisclosure> : undefined} actions={nav ? <a href="/start">Start</a> : undefined} /></div>;
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
    await act(async () => { measure(); await new Promise(requestAnimationFrame); });
    expect(screen.getByRole("link", { name: "Help" })).toHaveFocus();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    media.matches = false;
    await act(async () => { measure(); await new Promise(requestAnimationFrame); });
    expect(toggle).toHaveFocus();
    media.matches = true;
    await act(async () => { measure(); await new Promise(requestAnimationFrame); });
    expect(screen.getByRole("link", { name: "Help" })).toHaveFocus();
    await act(async () => { screen.getByRole("link", { name: "Start" }).focus(); measure(); await new Promise(requestAnimationFrame); });
    expect(screen.getByRole("link", { name: "Start" })).toHaveFocus();
    view.rerender(scene(false));
    expect(frame.style.getPropertyValue("--site-header-clearance")).toBe("");
    expect(view.container.querySelector("header")).toHaveClass("site-header-contract");
    expect(view.container.querySelector("header nav, header button")).toBeNull();
  } finally { rects.mockRestore(); vi.unstubAllGlobals(); }
});

it("coalesces content-fit measurement into one animation frame", () => {
  const callbacks: FrameRequestCallback[] = [];
  const request = vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { callbacks.push(callback); return callbacks.length; });
  const rectangles = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");
  try {
    renderNav();
    const initial = rectangles.mock.calls.length;
    fireEvent.resize(window); fireEvent.resize(window); fireEvent.resize(window);
    expect(rectangles.mock.calls.length).toBe(initial);
    expect(callbacks).toHaveLength(1);
    act(() => callbacks[0]!(0));
    expect(rectangles.mock.calls.length).toBeGreaterThan(initial);
  } finally { request.mockRestore(); rectangles.mockRestore(); }
});

it("moves initially focused panel content to its control before first mobile collapse", () => {
  render(<SiteHeader brand={<a href="/">Example</a>} nav={<NavDisclosure><a href="#about" ref={node => { node?.focus(); }}>About</a></NavDisclosure>} />);
  expect(screen.getByRole("button", { name: "Menu" })).toHaveFocus();
  expect(screen.getByRole("link", { name: "About" }).parentElement).toHaveAttribute("inert");
});

it("keeps a closing panel painted but immediately inert, returns focus, reverses and cancels safely", async () => {
  const original = HTMLElement.prototype.animate;
  const finishes: (() => void)[] = [];
  const animations: { cancel: ReturnType<typeof vi.fn>; finished: Promise<void> }[] = [];
  const animate = vi.fn(() => {
    let finish!: () => void;
    const animation = { cancel: vi.fn(), finished: new Promise<void>(resolve => { finish = resolve; }) };
    finishes.push(finish); animations.push(animation); return animation as unknown as Animation;
  });
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, writable: true, value: animate });
  try {
    const view = renderNav(); const toggle = screen.getByRole("button", { name: "Menu" });
    const link = screen.getByRole("link", { name: "About" }); const panel = link.parentElement!;
    fireEvent.click(toggle);
    expect(animate).toHaveBeenCalledTimes(1);
    await act(async () => finishes[0]!());
    link.focus(); toggle.addEventListener("focus", () => expect(panel).not.toHaveAttribute("inert"), { once: true });
    fireEvent.keyDown(link, { key: "Escape" });
    expect(toggle).toHaveFocus(); expect(panel).toHaveAttribute("inert");
    expect(panel).toHaveAttribute("data-present"); expect(animate).toHaveBeenCalledTimes(2);
    fireEvent.click(toggle);
    expect(animations[1]!.cancel).toHaveBeenCalled(); expect(panel).not.toHaveAttribute("inert");
    await act(async () => finishes[1]!());
    expect(panel).toHaveAttribute("data-expanded");
    view.unmount(); expect(animations[2]!.cancel).toHaveBeenCalled();
  } finally { if (original) HTMLElement.prototype.animate = original; else delete (HTMLElement.prototype as { animate?: unknown }).animate; }
});

it("measures desktop intrinsics with hysteresis and observes direction and image changes", async () => {
  const callbacks: FrameRequestCallback[] = [];
  const request = vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { callbacks.push(callback); return callbacks.length; });
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  let width = 999;
  const rects = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
    if (this.closest("header") && !this.matches("header")) expect(this.closest("header")).toHaveAttribute("data-measuring");
    const measured = this.classList.contains("site-header-row") ? width : this.parentElement?.classList.contains("site-header-brand") ? 300 : this.parentElement?.classList.contains("site-header-nav-links") ? 400 : 100;
    return { width: measured, height: 60, left: 0, right: measured, top: 0, bottom: 60, x: 0, y: 0, toJSON() {} };
  });
  const frame = () => act(() => { const callback = callbacks.shift(); expect(callback).toBeDefined(); callback!(0); });
  try {
    render(<SiteHeader brand={<a href="/"><img src="/mark.svg" alt="Example" /></a>} nav={<NavDisclosure><ul className="site-header-nav-links"><li><a href="/help">Help</a></li></ul></NavDisclosure>} actions={<a href="/start">Start</a>} />);
    const header = screen.getByRole("banner");
    expect(header).toHaveAttribute("data-collapsed"); expect(header).not.toHaveAttribute("data-measuring");
    width = 1001; fireEvent.resize(window); frame(); expect(header).toHaveAttribute("data-collapsed");
    width = 1002; fireEvent.resize(window); frame(); expect(header).not.toHaveAttribute("data-collapsed");
    width = 1000; fireEvent.resize(window); frame(); expect(header).not.toHaveAttribute("data-collapsed");
    width = 999; fireEvent.resize(window); frame(); expect(header).toHaveAttribute("data-collapsed");
    await act(async () => { header.setAttribute("dir", "rtl"); }); frame();
    fireEvent.load(screen.getByRole("img")); frame();
  } finally { request.mockRestore(); rects.mockRestore(); vi.unstubAllGlobals(); }
});

it("cancels panel travel immediately when reduced motion becomes active", () => {
  let onChange = () => {};
  const reduced = { matches: false, addEventListener: (_: string, callback: () => void) => { onChange = callback; }, removeEventListener() {} };
  vi.stubGlobal("matchMedia", (query: string) => query.includes("prefers-reduced-motion") ? reduced : { matches: false, addEventListener() {}, removeEventListener() {} });
  const original = HTMLElement.prototype.animate;
  const animation = { cancel: vi.fn(), finished: new Promise<void>(() => {}) };
  const animate = vi.fn(() => animation as unknown as Animation);
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, writable: true, value: animate });
  try {
    renderNav(); const toggle = screen.getByRole("button", { name: "Menu" });
    fireEvent.click(toggle); expect(animate).toHaveBeenCalledOnce();
    reduced.matches = true; act(onChange);
    expect(animation.cancel).toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "About" }).parentElement).not.toHaveAttribute("data-present");
    fireEvent.click(toggle); expect(animate).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: "About" }).parentElement).toHaveAttribute("inert");
  } finally { vi.unstubAllGlobals(); if (original) HTMLElement.prototype.animate = original; else delete (HTMLElement.prototype as { animate?: unknown }).animate; }
});

it("removes panel inertness before restoring desktop link focus", async () => {
  const media = { matches: false, addEventListener() {}, removeEventListener() {} };
  vi.stubGlobal("matchMedia", () => media);
  const rects = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
    const width = this.classList.contains("site-header-row") ? 1400 : 100;
    return { width, height: 60, left: 0, right: width, top: 0, bottom: 60, x: 0, y: 0, toJSON() {} };
  });
  const inertAtFocus: boolean[] = [];
  const original = HTMLElement.prototype.focus;
  const focus = vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (options) {
    if (this.tagName === "A") inertAtFocus.push(Boolean(this.closest("[inert]")));
    original.call(this, options);
  });
  try {
    renderNav(); screen.getByRole("button", { name: "Menu" }).focus();
    media.matches = true;
    await act(async () => { fireEvent.resize(window); await new Promise(requestAnimationFrame); });
    expect(inertAtFocus).toEqual([false]);
    expect(screen.getByRole("link", { name: "About" })).toHaveFocus();
  } finally { focus.mockRestore(); rects.mockRestore(); vi.unstubAllGlobals(); }
});
