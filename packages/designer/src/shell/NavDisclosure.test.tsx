import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { NavDisclosure } from "./NavDisclosure.js";
import { SiteHeader } from "./SiteHeader.js";

const nextFrame = () => new Promise<void>(resolve => { window.requestAnimationFrame(() => resolve()); });

function renderNav(placement: "header" | "standalone" = "header") {
  const nav = <NavDisclosure><a href="#about">About</a><a href="#contact"><span>Contact</span></a></NavDisclosure>;
  return render(placement === "header" ? <SiteHeader brand={<a href="/">Example</a>} nav={nav} /> : nav);
}

describe("NavDisclosure", () => {
  it("one nav landmark holds the toggle and each link once, in order", () => {
    renderNav();
    expect(screen.getAllByRole("navigation")).toHaveLength(1);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const toggle = within(nav).getByRole("button", { name: "Menu" });
    // Collapsed on a narrow layout, the stock panel keeps its links out of the accessibility tree.
    expect(within(nav).queryAllByRole("link")).toEqual([]);
    const links = within(nav).getAllByRole("link", { hidden: true });
    expect(links.map(link => link.textContent)).toEqual(["About", "Contact"]);
    expect(within(nav).getAllByRole("button")).toEqual([toggle]);
    expect(toggle.compareDocumentPosition(links[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("the toggle is a named button with aria-expanded and aria-controls", () => {
    renderNav();
    const toggle = screen.getByRole("button", { name: "Menu" });
    const panel = document.getElementById(toggle.getAttribute("aria-controls")!);
    expect(toggle).toHaveAttribute("type", "button");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(panel).toBe(screen.getByRole("link", { name: "About", hidden: true }).parentElement);
    expect(panel).not.toHaveAttribute("data-expanded");
    expect(panel).toHaveAttribute("hidden");
    // Both tap-target dimensions come from the Components toggle's min-size-tap utility, not inline style.
    expect(toggle).toHaveClass("min-size-tap");
    expect(toggle.getAttribute("style")).toBeNull();
    expect(toggle.className).toContain("nav-disclosure-toggle");
    toggle.focus();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(panel).toHaveAttribute("data-expanded");
    expect(panel).not.toHaveAttribute("hidden");
    expect(screen.getByRole("link", { name: "About" })).toBeVisible();
    expect(toggle).toHaveFocus();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(panel).not.toHaveAttribute("data-expanded");
    expect(panel).toHaveAttribute("hidden");
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

  it.each(["link", "nested target"])("activating a panel %s returns focus before the closed panel hides", target => {
    renderNav();
    const toggle = screen.getByRole("button", { name: "Menu" });
    fireEvent.click(toggle);
    const link = screen.getByRole("link", { name: "Contact" });
    act(() => link.focus());
    expect(link).toHaveFocus();
    expect(link.parentElement).not.toHaveAttribute("hidden");
    const hiddenAtFocus: boolean[] = [];
    toggle.addEventListener("focus", () => { hiddenAtFocus.push(link.parentElement!.hasAttribute("hidden")); }, { once: true });
    fireEvent.click(target === "link" ? link : screen.getByText("Contact"));
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(link.parentElement).not.toHaveAttribute("data-expanded");
    expect(link.parentElement).toHaveAttribute("hidden");
    expect(hiddenAtFocus).toEqual([false]);
    expect(toggle).toHaveFocus();
  });

  it("accepts landmark and trigger names and className, with instance-local controls", () => {
    render(<><NavDisclosure aria-label="Sections" triggerLabel="Sections menu" className="custom"><a href="#one">One</a></NavDisclosure><NavDisclosure><a href="#two">Two</a></NavDisclosure></>);
    expect(screen.getByRole("navigation", { name: "Sections" })).toHaveClass("custom");
    const first = screen.getByRole("button", { name: "Sections menu" }).getAttribute("aria-controls");
    const second = screen.getByRole("button", { name: "Menu" }).getAttribute("aria-controls");
    expect(first).toBeTruthy();
    expect(second).not.toBe(first);
  });

  it("server renders the inline row with the links reachable once for the no-JS fallback", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<NavDisclosure><a href="#about">About</a></NavDisclosure>);
    const html = host.innerHTML;
    expect(within(host).getByRole("link", { name: "About" })).toHaveAttribute("href", "#about");
    expect(host.querySelector(".nav-disclosure-panel")).not.toHaveAttribute("data-expanded");
    const panel = host.querySelector(".nav-disclosure-panel");
    expect(panel).not.toHaveAttribute("hidden");
    expect(panel).not.toHaveAttribute("aria-hidden", "true");
    expect(panel?.closest("[hidden],[inert]")).toBeNull();
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
  it("keeps closed content hidden and opens it from the decorative icon toggle", () => {
    render(<SiteHeader brand={<a href="/">Example</a>} nav={<NavDisclosure trigger="icon"><a href="/help">Help</a></NavDisclosure>} />);
    const toggle = screen.getByRole("button", { name: "Menu" });
    const panel = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(panel).toHaveAttribute("hidden");
    expect(toggle.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    fireEvent.click(toggle);
    expect(panel).not.toHaveAttribute("hidden");
    expect(screen.getByRole("link", { name: "Help" })).toBeVisible();
    act(() => (panel.querySelector("a") as HTMLElement).focus());
    fireEvent.keyDown(panel.querySelector("a")!, { key: "Escape" });
    expect(panel).toHaveAttribute("hidden");
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
    await act(async () => { fireEvent.resize(window); await nextFrame(); });
    expect(header).not.toHaveAttribute("data-collapsed");
    // The desktop row resets the opened state, keeps every link reachable and hides the toggle.
    const panel = document.getElementById(toggle.getAttribute("aria-controls")!);
    expect(panel).not.toHaveAttribute("data-expanded");
    expect(panel).not.toHaveAttribute("hidden");
    expect(toggle).toHaveClass("hidden");
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
    expect(observed).toContain(screen.getByRole("link", { name: "Help", hidden: true }));
    const toggle = screen.getByRole("button", { name: "Menu" });
    fireEvent.click(toggle);
    act(() => screen.getByRole("link", { name: "Help" }).focus());
    media.matches = true;
    await act(async () => { measure(); await nextFrame(); });
    expect(screen.getByRole("link", { name: "Help" })).toHaveFocus();
    expect(toggle.closest("nav")!.querySelector(".nav-disclosure-panel")).not.toHaveAttribute("data-expanded");
    media.matches = false;
    await act(async () => { measure(); await nextFrame(); });
    expect(toggle).toHaveFocus();
    media.matches = true;
    await act(async () => { measure(); await nextFrame(); });
    expect(screen.getByRole("link", { name: "Help" })).toHaveFocus();
    await act(async () => { screen.getByRole("link", { name: "Start" }).focus(); measure(); await nextFrame(); });
    expect(screen.getByRole("link", { name: "Start" })).toHaveFocus();
    view.rerender(scene(false));
    expect(frame.style.getPropertyValue("--site-header-clearance")).toBe("");
    expect(view.container.querySelector("header")).toHaveClass("site-header-contract");
    expect(view.container.querySelector("header nav, header button")).toBeNull();
  } finally { rects.mockRestore(); vi.unstubAllGlobals(); }
});

describe("NavDisclosure collapse measurement", () => {
  it("batches every measurement trigger in a frame into one measurement", () => {
    const frames: FrameRequestCallback[] = [];
    const request = vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { frames.push(callback); return frames.length; });
    const rectangles = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");
    try {
      renderNav();
      const initial = rectangles.mock.calls.length;
      fireEvent.resize(window); fireEvent.resize(window); fireEvent.resize(window);
      expect(rectangles.mock.calls.length).toBe(initial);
      expect(frames).toHaveLength(1);
      act(() => frames.shift()!(0));
      expect(rectangles.mock.calls.length).toBeGreaterThan(initial);
      fireEvent.resize(window);
      expect(frames).toHaveLength(1);
    } finally { request.mockRestore(); rectangles.mockRestore(); }
  });

  it("schedules a measurement when a brand image loads or the direction changes", async () => {
    const frames: FrameRequestCallback[] = [];
    const request = vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { frames.push(callback); return frames.length; });
    try {
      render(<SiteHeader brand={<a href="/"><img src="/mark.svg" alt="Example" /></a>} nav={<NavDisclosure><a href="/help">Help</a></NavDisclosure>} />);
      expect(frames).toHaveLength(0);
      fireEvent.load(screen.getByRole("img"));
      expect(frames).toHaveLength(1);
      act(() => frames.shift()!(0));
      await act(async () => { document.documentElement.setAttribute("dir", "rtl"); });
      expect(frames).toHaveLength(1);
    } finally { document.documentElement.removeAttribute("dir"); request.mockRestore(); }
  });

  it("does not flicker at the fit edge: a collapsed header expands only with a spacing step to spare", () => {
    const frames: FrameRequestCallback[] = [];
    const request = vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { frames.push(callback); return frames.length; });
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: !query.includes("prefers-reduced-motion"), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    let width = 999;
    // Brand 300, links 400, actions 100: the row needs 2 * 300 + 400 = 1000.
    const rectangles = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const measured = this.classList.contains("site-header-row") ? width
        : this.parentElement?.classList.contains("site-header-brand") ? 300
          : this.parentElement?.classList.contains("site-header-nav-links") ? 400 : 100;
      return { width: measured, height: 60, left: 0, right: measured, top: 0, bottom: 60, x: 0, y: 0, toJSON() {} };
    });
    try {
      render(<SiteHeader brand={<a href="/">Example</a>} nav={<NavDisclosure><ul className="site-header-nav-links"><li><a href="/help">Help</a></li></ul></NavDisclosure>} actions={<a href="/start">Start</a>} />);
      const header = screen.getByRole("banner");
      const toggles: boolean[] = [];
      const watcher = new MutationObserver(() => toggles.push(header.hasAttribute("data-collapsed")));
      const at = (next: number) => {
        width = next;
        fireEvent.resize(window);
        act(() => frames.shift()!(0));
        return header.hasAttribute("data-collapsed");
      };
      expect(header).toHaveAttribute("data-collapsed");
      watcher.observe(header, { attributes: true, attributeFilter: ["data-collapsed"] });
      expect([1000, 1004, 1007, 1004, 1007].map(at)).toEqual([true, true, true, true, true]);
      expect(at(1008)).toBe(false);
      expect([1007, 1003, 1000, 1003].map(at)).toEqual([false, false, false, false]);
      expect(at(999)).toBe(true);
      expect(header).not.toHaveAttribute("data-measuring");
      watcher.disconnect();
    } finally { request.mockRestore(); rectangles.mockRestore(); vi.unstubAllGlobals(); }
  });

  // Unmeasured, the actions row wraps and a long brand label breaks onto two
  // lines, so their rectangles shrink; only the natural width shows the clash.
  it.each([
    { scene: "many links and actions", links: ["Overview", "Product", "Solutions", "Resources", "Company"], actions: ["Sign in", "Contact sales", "Start free"], brand: "Example" },
    { scene: "long labels", links: ["Documentation and guides", "Integrations directory"], actions: ["Talk to the team"], brand: "Example brand with a long name" },
  ])("collapses before a clash with $scene, measured at natural width", ({ links, actions, brand }) => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: !query.includes("prefers-reduced-motion"), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    // Natural: 2 * 480 + 640 = 1600 and 2 * 480 + 736 = 1696 overflow the 1280 row;
    // the wrapped, unmeasured widths (880 and 1056) would not.
    const characters = 16;
    const rectangles = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const natural = Boolean(this.closest("header")?.hasAttribute("data-measuring"));
      const parent = this.parentElement;
      const index = parent ? [...parent.children].indexOf(this) : 0;
      const label = (this.textContent ?? "").length * characters;
      let left = 0;
      let measured = 100;
      if (this.classList.contains("site-header-row")) measured = 1280;
      else if (parent?.classList.contains("site-header-brand")) measured = natural ? label : Math.min(label, 160);
      else if (parent?.classList.contains("site-header-nav-links")) { measured = label; left = links.slice(0, index).join("").length * characters; }
      else if (parent?.classList.contains("site-header-desktop-actions")) { measured = natural ? label : Math.min(label, 120); left = natural ? actions.slice(0, index).join("").length * characters : 0; }
      return { width: measured, height: 60, left, right: left + measured, top: 0, bottom: 60, x: left, y: 0, toJSON() {} };
    });
    try {
      render(<SiteHeader brand={<a href="/">{brand}</a>} nav={
        <NavDisclosure>
          <ul className="site-header-nav-links">{links.map(label => <li key={label}><a href={`/${label.length}`}>{label}</a></li>)}</ul>
          <ul className="site-header-desktop-actions">{actions.map(label => <li key={label}><a href={`/a${label.length}`}>{label}</a></li>)}</ul>
        </NavDisclosure>
      } />);
      const header = screen.getByRole("banner");
      expect(header).toHaveAttribute("data-collapsed");
      expect(header).not.toHaveAttribute("data-measuring");
    } finally { rectangles.mockRestore(); vi.unstubAllGlobals(); }
  });
});
