import { SectionFrame as S4Frame } from "./SectionFrame.js";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CSSProperties } from "react";
import { render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { LogoCloud, type LogoCloudItem } from "./LogoCloud.js";
import { selectChromium } from "../__fixtures__/chromium-discovery.js";

type BrowserStep =
  | { viewport: number }
  | { eval: string; as: string }
  | { moveTo: string }
  | { click: string }
  | { key: "Tab" };

/*
 * Layout, :hover and :focus-visible need a real engine and jsdom has none, so
 * the measured checks drive Chromium over DevTools with real mouse and key
 * events against the shipped compiled.css (the SiteFooter method).
 */
async function driveChromium() {
  const { spawn } = require("node:child_process") as typeof import("node:child_process");
  const fs = require("node:fs") as typeof import("node:fs");
  const [chrome, page, profile, plan, blinkSettings] = process.argv.slice(1) as [string, string, string, string, string];
  // Pin the input capabilities (hover and a fine pointer) so (hover: hover) holds on a headless host that reports none.
  const deviceFlags = [`--blink-settings=${blinkSettings}`, "--force-device-scale-factor=1", "--window-size=1280,800", "--lang=en-US"];
  const browser = spawn(chrome, ["--headless", "--no-sandbox", "--disable-dev-shm-usage",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, ...deviceFlags, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  let socket: WebSocket | undefined;
  try {
    const endpoint = await new Promise<string>((resolve, reject) => {
      let output = "";
      browser.on("error", reject);
      browser.on("exit", code => reject(new Error(`Browser exited before DevTools was ready (${code}): ${output}`)));
      browser.stderr!.on("data", (chunk: Buffer) => {
        output += String(chunk);
        const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) resolve(match[1]!);
      });
    });
    const client = new WebSocket(endpoint);
    socket = client;
    await new Promise<void>((resolve, reject) => { client.onopen = () => resolve(); client.onerror = reject; });
    let id = 0;
    const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
    client.onmessage = event => {
      const response = JSON.parse(String(event.data));
      const request = pending.get(response.id);
      if (!request) return;
      pending.delete(response.id);
      if (response.error) request.reject(new Error(response.error.message)); else request.resolve(response.result);
    };
    const send = (method: string, params: object = {}, sessionId?: string): Promise<any> => new Promise((resolve, reject) => {
      const request = ++id;
      pending.set(request, { resolve, reject });
      client.send(JSON.stringify({ id: request, method, params, sessionId }));
    });
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    await send("Page.enable", {}, sessionId);
    await send("Emulation.setFocusEmulationEnabled", { enabled: true }, sessionId);
    // Never inherit the host's colour scheme, motion, contrast or forced-colours settings.
    await send("Emulation.setEmulatedMedia", { media: "screen", features: [
      { name: "prefers-color-scheme", value: "light" }, { name: "prefers-reduced-motion", value: "no-preference" },
      { name: "forced-colors", value: "none" }, { name: "prefers-contrast", value: "no-preference" },
    ] }, sessionId);
    const { frameTree } = await send("Page.getFrameTree", {}, sessionId);
    await send("Page.setDocumentContent", { frameId: frameTree.frame.id, html: fs.readFileSync(page, "utf8") }, sessionId);
    const evaluate = async (expression: string) => {
      const response = await send("Runtime.evaluate", { expression, returnByValue: true }, sessionId);
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
      return response.result.value;
    };
    const mouse = async (type: string, [x, y]: [number, number], extra: object = {}) =>
      send("Input.dispatchMouseEvent", { type, x, y, ...extra }, sessionId);
    const results: Record<string, unknown> = {};
    for (const step of JSON.parse(fs.readFileSync(plan, "utf8")) as BrowserStep[]) {
      if ("viewport" in step) {
        await send("Emulation.setDeviceMetricsOverride", { width: step.viewport, height: 4096, deviceScaleFactor: 1, mobile: false }, sessionId);
      } else if ("eval" in step) {
        results[step.as] = await evaluate(step.eval);
      } else if ("moveTo" in step) {
        await mouse("mouseMoved", await evaluate(step.moveTo));
      } else if ("click" in step) {
        const at = await evaluate(step.click) as [number, number];
        await mouse("mouseMoved", at);
        await mouse("mousePressed", at, { button: "left", buttons: 1, clickCount: 1 });
        await mouse("mouseReleased", at, { button: "left", clickCount: 1 });
      } else {
        for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 }, sessionId);
      }
    }
    process.stdout.write(JSON.stringify(results));
  } finally {
    socket?.close();
    browser.kill();
  }
}

// Blink enums: hover 2 = hover; pointer 4 = fine. (1 = none for both.)
const INPUT_CAPABILITIES = "primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4";

function runInChromium(html: string, steps: readonly BrowserStep[]): Record<string, any> {
  const browser = selectChromium(process.env.FOUNDRY_TEST_CHROME, (executable, args) => spawnSync(executable, args, { stdio: "ignore" }));
  if (!browser) throw new Error("Measured block tests require Chromium or Google Chrome on PATH.");
  const directory = mkdtempSync(join(tmpdir(), "block-measure-"));
  try {
    const page = join(directory, "page.html");
    const plan = join(directory, "steps.json");
    writeFileSync(page, html);
    writeFileSync(plan, JSON.stringify(steps));
    const output = execFileSync(process.execPath, ["--experimental-websocket", "-e", `(${driveChromium.toString()})().catch(error => { console.error(error.message); process.exitCode = 1; });`,
      browser, page, join(directory, "profile"), plan, INPUT_CAPABILITIES],
    { encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    return JSON.parse(output);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

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

describe("LogoCloud measured in Chromium", () => {
  type Mark = { w: number | null; h: number | null; gray: number; markGray: number };
  type Probe = { hoverMedia: boolean; mono: Mark[]; original: Mark[]; plain: Mark[]; roomy: Mark[] };
  type Focus = { section: string | null; index: number; focusVisible: boolean; outline: string; mono: Mark[] };
  const linked = (count: number): LogoCloudItem[] => Array.from({ length: count }, (_, index) => ({
    id: String(index), name: `Mark ${index}`, href: `/marks/${index}`,
    logo: <svg width="24" height="12" viewBox="0 0 24 12"><rect width="24" height="12" /></svg>,
  }));
  const unlinked = linked(4).map(({ href: _href, ...item }) => item);
  const css = readFileSync(join(import.meta.dirname, "../../styles/compiled.css"), "utf8");
  // In-page probes: grayscale amount, link box, centre point, and a click log that cancels navigation.
  const script = `
    window.clicks = [];
    addEventListener("click", event => { event.preventDefault(); clicks.push(event.target.closest("a")?.getAttribute("href") ?? null); }, true);
    window.gray = element => { const match = getComputedStyle(element).filter.match(/grayscale\\(([\\d.]+)\\)/); return match ? Number(match[1]) : 0; };
    window.centre = (selector, index, dy = 0) => { const box = document.querySelectorAll(selector)[index].getBoundingClientRect(); return [box.left + box.width / 2, box.top + box.height / 2 + dy]; };
    window.snap = id => [...document.querySelectorAll("#" + id + " li")].map(item => {
      const link = item.querySelector("a"); const mark = item.querySelector("[aria-hidden]"); const box = link?.getBoundingClientRect();
      return { w: box?.width ?? null, h: box?.height ?? null, gray: gray(link ?? mark), markGray: gray(mark) };
    });
    window.all = () => ({ hoverMedia: matchMedia("(hover: hover)").matches, mono: snap("mono"), original: snap("original"), plain: snap("plain"), roomy: snap("roomy") });
    window.focused = () => { const active = document.activeElement; const section = active.closest("section"); const items = section ? [...section.querySelectorAll("a")] : [];
      return { section: section?.id ?? null, index: items.indexOf(active), focusVisible: active.matches(":focus-visible"), outline: getComputedStyle(active).outlineStyle + " " + getComputedStyle(active).outlineWidth, mono: snap("mono") }; };
  `;
  const page = `<!doctype html><meta charset="utf-8"><style>${css}body{margin:0}</style>${renderToStaticMarkup(<>
    <section id="mono"><LogoCloud items={linked(4)} /></section>
    <section id="original"><LogoCloud items={linked(4)} tone="original" /></section>
    <section id="plain"><LogoCloud items={unlinked} /></section>
    <section id="roomy" style={{ "--ui-layout-tap-target": "72px" } as CSSProperties}><LogoCloud items={linked(4)} /></section>
  </>)}<script>${script}</script>`;
  let wide: Record<string, any>;
  let phone: Record<string, any>;
  beforeAll(() => {
    wide = runInChromium(page, [
      { viewport: 1280 },
      { eval: "all()", as: "rest" },
      { moveTo: "centre('#mono a', 1)" }, { eval: "all()", as: "hover" },
      { moveTo: "[2, 2]" }, { eval: "all()", as: "away" },
      { moveTo: "centre('#plain span[aria-hidden]', 1)" }, { eval: "all()", as: "plainHover" },
      { moveTo: "[2, 2]" },
      { key: "Tab" }, { eval: "focused()", as: "tab1" },
      { key: "Tab" }, { eval: "focused()", as: "tab2" },
      { eval: "document.activeElement.blur(), 0", as: "blurred" },
      // One pixel inside the top and bottom edge of the 44px band around the first mark.
      { click: "centre('#mono a', 0, -21)" }, { click: "centre('#mono a', 0, 21)" },
      { eval: "clicks.slice()", as: "clicks" },
    ]);
    phone = runInChromium(page, [{ viewport: 375 }, { eval: "all()", as: "rest" }]);
  }, 90000);

  it("gives every linked mark a measured target of at least 44px at desktop and phone widths [mutant: drop minBlockSize]", () => {
    for (const probe of [wide.rest as Probe, phone.rest as Probe]) {
      for (const group of [probe.mono, probe.original]) {
        expect(group).toHaveLength(4);
        for (const mark of group) {
          expect(mark.h).toBeGreaterThanOrEqual(44);
          expect(mark.w).toBeGreaterThanOrEqual(44);
        }
      }
      // The target follows the registered tap-target token rather than a hard-coded size.
      for (const mark of probe.roomy) expect(mark.h).toBeGreaterThanOrEqual(72);
      for (const mark of probe.plain) expect(mark.h).toBeNull();
    }
  });

  it("follows a real click anywhere in the 44px band of a mark to its destination [mutant: drop minBlockSize]", () => {
    expect(wide.clicks).toEqual(["/marks/0", "/marks/0"]);
  });

  it("renders monochrome marks gray at rest and leaves original marks untouched [mutant: omit grayscale]", () => {
    expect(wide.rest.hoverMedia).toBe(true);
    const { mono, original, plain } = wide.rest as Probe;
    for (const mark of mono) expect(mark.gray).toBe(1);
    for (const mark of plain) { expect(mark.gray).toBe(1); expect(mark.markGray).toBe(1); }
    for (const mark of original) expect(mark.gray).toBe(0);
  });

  it("restores colour on the hovered link only and re-grays on leave [mutant: drop hover:grayscale-0]", () => {
    expect((wide.hover as Probe).mono.map(mark => mark.gray)).toEqual([1, 0, 1, 1]);
    expect((wide.away as Probe).mono.map(mark => mark.gray)).toEqual([1, 1, 1, 1]);
    expect((wide.hover as Probe).original.map(mark => mark.gray)).toEqual([0, 0, 0, 0]);
  });

  it("keeps an unlinked mark gray under the pointer [mutant: restore colour on unlinked marks]", () => {
    expect((wide.plainHover as Probe).plain.map(mark => mark.gray)).toEqual([1, 1, 1, 1]);
  });

  it("restores colour on keyboard focus only and shows the focus ring [mutant: drop focus-visible:grayscale-0]", () => {
    const first = wide.tab1 as Focus;
    expect(first).toMatchObject({ section: "mono", index: 0, focusVisible: true });
    expect(first.mono.map(mark => mark.gray)).toEqual([0, 1, 1, 1]);
    expect(first.outline).not.toMatch(/^none/);
    const second = wide.tab2 as Focus;
    expect(second).toMatchObject({ section: "mono", index: 1, focusVisible: true });
    expect(second.mono.map(mark => mark.gray)).toEqual([1, 0, 1, 1]);
    expect(second.outline).not.toMatch(/^none/);
  });
});

it("S4-6 retains the bare root, direct children and host identity under one external band", () => {
  let clicks = 0;
  const view = render(<LogoCloud items={items(3)} id="bare" dir="rtl" data-host="bare" className="gap-xl" style={{ marginTop: 7 }} onClick={() => clicks++} />);
  const root = view.container.firstElementChild as HTMLElement;
  expect(root.tagName).toBe("UL");
  expect(root).toHaveAttribute("id", "bare");
  expect(root).toHaveAttribute("dir", "rtl");
  expect(root).toHaveAttribute("data-host", "bare");
  expect(root.style.marginTop).toBe("7px");
  expect(root).toHaveClass("gap-xl");
  expect(Array.from(root.children).every(child => child.tagName === "LI")).toBe(true);
  expect(root.querySelector("section,header,h1,h2")).toBeNull();
  root.click(); expect(clicks).toBe(1);
  view.rerender(<S4Frame><LogoCloud items={items(3)} id="bare" /></S4Frame>);
  expect(view.container.querySelectorAll("[data-designer-section-frame]")).toHaveLength(1);
  expect(view.container.querySelector("#bare")?.tagName).toBe("UL");
});
