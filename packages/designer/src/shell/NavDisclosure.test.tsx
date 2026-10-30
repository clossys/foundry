import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { NavDisclosure } from "./NavDisclosure.js";
import { SiteHeader } from "./SiteHeader.js";

const nextFrame = () => new Promise<void>(resolve => { window.requestAnimationFrame(() => resolve()); });

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

  it("activating a link in the panel collapses it, including a nested click target, and refocuses the toggle", () => {
    renderNav();
    const toggle = screen.getByRole("button", { name: "Menu" });
    fireEvent.click(toggle);
    const link = screen.getByRole("link", { name: "Contact" });
    act(() => link.focus());
    fireEvent.click(screen.getByText("Contact"));
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(link.parentElement).not.toHaveAttribute("data-expanded");
    expect(link.parentElement).toHaveAttribute("inert");
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
    await act(async () => { fireEvent.resize(window); await nextFrame(); });
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
    await act(async () => { measure(); await nextFrame(); });
    expect(screen.getByRole("link", { name: "Help" })).toHaveFocus();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
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

type MockAnimation = { keyframes: Keyframe[]; options: KeyframeAnimationOptions; cancel: ReturnType<typeof vi.fn>; finish: () => void; finished: Promise<void> };

/** Installs a controllable element.animate; restore() puts back whatever jsdom had. */
function mockAnimate() {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "animate");
  const animations: MockAnimation[] = [];
  const animate = vi.fn((keyframes: Keyframe[], options: KeyframeAnimationOptions) => {
    let finish!: () => void;
    const finished = new Promise<void>(resolve => { finish = resolve; });
    const animation: MockAnimation = { keyframes, options, cancel: vi.fn(), finish, finished };
    animations.push(animation);
    return animation as unknown as Animation;
  });
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, writable: true, value: animate });
  return {
    animate, animations,
    restore() {
      if (original) Object.defineProperty(HTMLElement.prototype, "animate", original);
      else delete (HTMLElement.prototype as { animate?: unknown }).animate;
    },
  };
}

/** jsdom applies no stylesheet, so supply the panel's motion tokens inline. */
function motionTokens(panel: HTMLElement, duration = "240ms") {
  panel.style.setProperty("--site-header-panel-duration", duration);
  panel.style.setProperty("--site-header-panel-ease", "cubic-bezier(.2, 0, 0, 1)");
  panel.style.setProperty("--site-header-panel-shift", "calc(-1 * 8px)");
}

describe("NavDisclosure panel motion", () => {
  it("slides the sheet in on its motion tokens, then keeps a closing sheet painted but inert", async () => {
    const motion = mockAnimate();
    try {
      const view = renderNav();
      const toggle = screen.getByRole("button", { name: "Menu" });
      const link = screen.getByRole("link", { name: "About" });
      const panel = link.parentElement!;
      motionTokens(panel);
      fireEvent.click(toggle);
      expect(motion.animate).toHaveBeenCalledTimes(1);
      expect(motion.animations[0]!.keyframes).toEqual([
        { opacity: "0", transform: "translateY(calc(-1 * 8px))" },
        { opacity: "1", transform: "none" },
      ]);
      expect(motion.animations[0]!.options).toEqual({ duration: 240, easing: "cubic-bezier(.2, 0, 0, 1)", fill: "both" });
      expect(panel).toHaveAttribute("data-present");
      expect(panel).not.toHaveAttribute("inert");
      await act(async () => motion.animations[0]!.finish());
      expect(panel).not.toHaveAttribute("data-present");
      expect(panel).toHaveAttribute("data-expanded");

      act(() => link.focus());
      let inertWhenFocused = false;
      toggle.addEventListener("focus", () => { inertWhenFocused = panel.hasAttribute("inert"); }, { once: true });
      fireEvent.keyDown(link, { key: "Escape" });
      // Focus returns before the panel turns inert, and the panel is inert at once.
      expect(inertWhenFocused).toBe(false);
      expect(toggle).toHaveFocus();
      expect(panel).toHaveAttribute("inert");
      expect(panel).not.toHaveAttribute("data-expanded");
      expect(panel).toHaveAttribute("data-present");
      expect(motion.animations[1]!.keyframes.at(-1)).toEqual({ opacity: "0", transform: "translateY(calc(-1 * 8px))" });
      await act(async () => motion.animations[1]!.finish());
      expect(panel).not.toHaveAttribute("data-present");
      expect(panel).toHaveAttribute("inert");

      // Reopening mid-close reverses from the current frame and cancels the old run.
      fireEvent.click(toggle);
      fireEvent.click(toggle);
      expect(motion.animations[2]!.cancel).toHaveBeenCalled();
      expect(panel).toHaveAttribute("inert");
      view.unmount();
      expect(motion.animations[3]!.cancel).toHaveBeenCalled();
    } finally { motion.restore(); }
  });

  it("switches at once, still inert after close, under reduced motion", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("prefers-reduced-motion"), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const motion = mockAnimate();
    try {
      renderNav();
      const toggle = screen.getByRole("button", { name: "Menu" });
      const panel = screen.getByRole("link", { name: "About" }).parentElement!;
      motionTokens(panel);
      fireEvent.click(toggle);
      expect(panel).toHaveAttribute("data-expanded");
      fireEvent.click(toggle);
      expect(motion.animate).not.toHaveBeenCalled();
      expect(panel).not.toHaveAttribute("data-present");
      expect(panel).toHaveAttribute("inert");
    } finally { motion.restore(); vi.unstubAllGlobals(); }
  });

  it("treats a zero duration token, the stylesheet's reduced-motion fallback, as no motion", () => {
    const motion = mockAnimate();
    try {
      renderNav();
      const toggle = screen.getByRole("button", { name: "Menu" });
      const panel = screen.getByRole("link", { name: "About" }).parentElement!;
      motionTokens(panel, "0s");
      fireEvent.click(toggle);
      fireEvent.click(toggle);
      expect(motion.animate).not.toHaveBeenCalled();
      expect(panel).toHaveAttribute("inert");
    } finally { motion.restore(); }
  });

  it("cancels a running slide as soon as reduced motion turns on", () => {
    let onChange = () => {};
    const reduced = { matches: false, addEventListener: (_: string, callback: () => void) => { onChange = callback; }, removeEventListener: vi.fn() };
    vi.stubGlobal("matchMedia", (query: string) => query.includes("prefers-reduced-motion") ? reduced : { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const motion = mockAnimate();
    try {
      renderNav();
      const toggle = screen.getByRole("button", { name: "Menu" });
      const panel = screen.getByRole("link", { name: "About" }).parentElement!;
      motionTokens(panel);
      fireEvent.click(toggle);
      fireEvent.click(toggle);
      expect(panel).toHaveAttribute("data-present");
      reduced.matches = true;
      act(onChange);
      expect(motion.animations[1]!.cancel).toHaveBeenCalled();
      expect(panel).not.toHaveAttribute("data-present");
      expect(panel).toHaveAttribute("inert");
    } finally { motion.restore(); vi.unstubAllGlobals(); }
  });
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
