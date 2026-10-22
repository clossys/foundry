import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CSSProperties } from "react";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { PeopleGrid, type PeopleGridPerson } from "./PeopleGrid.js";

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
  const [chrome, page, profile, plan] = process.argv.slice(1) as [string, string, string, string];
  const browser = spawn(chrome, ["--headless", "--no-sandbox", "--disable-dev-shm-usage",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
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

function runInChromium(html: string, steps: readonly BrowserStep[]): Record<string, any> {
  const browser = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]
    .find(name => spawnSync(name, ["--version"], { stdio: "ignore" }).status === 0);
  if (!browser) throw new Error("Measured block tests require Chromium or Google Chrome on PATH.");
  const directory = mkdtempSync(join(tmpdir(), "block-measure-"));
  try {
    const page = join(directory, "page.html");
    const plan = join(directory, "steps.json");
    writeFileSync(page, html);
    writeFileSync(plan, JSON.stringify(steps));
    const output = execFileSync(process.execPath, ["--experimental-websocket", "-e", `(${driveChromium.toString()})().catch(error => { console.error(error.message); process.exitCode = 1; });`,
      browser, page, join(directory, "profile"), plan],
    { encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    return JSON.parse(output);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const people = (count: number): PeopleGridPerson[] => Array.from({ length: count }, (_, index) => ({ id: String(index), name: `Person ${index}`, role: `Role ${index}`, initials: `P${index}` }));

describe("PeopleGrid", () => {
  it("bounds the collection at two through twelve people [mutant: allow thirteen]", () => {
    for (const count of [1, 13]) {
      expect(() => renderToStaticMarkup(<PeopleGrid people={people(count)} />)).toThrow(TypeError);
      expect(() => renderToStaticMarkup(<PeopleGrid people={people(count)} />)).toThrow(/^PeopleGrid:/);
    }
    for (const count of [2, 12]) {
      const host = document.createElement("div");
      host.innerHTML = renderToStaticMarkup(<PeopleGrid people={people(count)} />);
      expect(host.querySelectorAll("ul > li")).toHaveLength(count);
    }
  });

  it("renders decorative initials and names at the requested heading level [mutant: name as paragraph]", () => {
    render(<PeopleGrid people={people(2)} headingLevel={4} />);
    expect(screen.getByRole("heading", { level: 4, name: "Person 0" })).toHaveClass("text-body-l", "font-medium");
    const initials = screen.getByText("P0");
    expect(initials.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(initials).toHaveClass("size-14", "shrink-0", "overflow-hidden", "rounded-pill", "bg-surface-sunken", "text-ink-secondary", "font-medium");
    expect(screen.getAllByRole("heading")).toHaveLength(2);
  });

  it("uses one title link per linked person [mutant: wrap card in another anchor]", () => {
    render(<PeopleGrid people={people(2).map(person => ({ ...person, href: `/people/${person.id}` }))} ground="inverse" />);
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(document.querySelectorAll("a a")).toHaveLength(0);
    for (const [index, entry] of screen.getAllByRole("listitem").entries()) {
      const link = screen.getByRole("link", { name: `Person ${index}` });
      expect(link).toHaveAttribute("href", `/people/${index}`);
      expect(link.parentElement?.tagName).toBe("H3");
      expect(link).toHaveClass("focus-visible:after:outline-accent-on-inverse");
      expect(entry.style.minBlockSize).toBe("var(--ui-layout-tap-target, 44px)");
      expect(entry).toHaveClass("relative", "isolate");
    }
  });

  it("honours four columns and defaults to three [mutant: ignore columns]", () => {
    const four = render(<PeopleGrid people={people(2)} columns={4} />);
    expect(four.container.querySelector("ul")).toHaveClass("grid-cols-1", "tablet:grid-cols-3", "desktop:grid-cols-4", "gap-x-lg", "gap-y-xl");
    four.unmount();
    render(<PeopleGrid people={people(2)} />);
    expect(screen.getByRole("list")).toHaveClass("desktop:grid-cols-3");
  });

  it("uses square media in photo mode and a row in avatar mode [mutant: swap media modes]", () => {
    const photo = render(<PeopleGrid people={people(2)} media="photo" columns={2} />);
    expect(photo.container.querySelectorAll(".aspect-square")).toHaveLength(2);
    expect(photo.container.querySelector(".aspect-square")).toHaveAttribute("aria-hidden", "true");
    expect(photo.container.querySelector(".aspect-square")).toHaveClass("w-full", "overflow-hidden", "rounded-panel");
    expect(photo.container.querySelector("ul")).toHaveClass("grid-cols-2", "tablet:grid-cols-2", "desktop:grid-cols-2");
    photo.unmount();
    const avatar = render(<PeopleGrid people={people(2)} />);
    expect(avatar.container.querySelector(".aspect-square")).toBeNull();
    expect(screen.getAllByRole("listitem")[0]).toHaveClass("flex", "items-start", "gap-md");
  });

  it("refuses interactive bio or role inside a linked person [mutant: drop nested-interactive assertion]", () => {
    for (const field of ["bio", "role"] as const) {
      const entries = people(2);
      entries[0] = { ...entries[0]!, href: "/person", [field]: <a href="/other">Other destination</a> };
      expect(() => renderToStaticMarkup(<PeopleGrid people={entries} />)).toThrow(TypeError);
      expect(() => renderToStaticMarkup(<PeopleGrid people={entries} />)).toThrow(/^PeopleGrid:/);
    }
  });

  it("uses ground-relative initials fills and secondary role ink", () => {
    for (const [ground, fill, primary, secondary] of [["base", "bg-surface-sunken", "text-ink-primary", "text-ink-secondary"], ["sunken", "bg-surface-raised", "text-ink-primary", "text-ink-secondary"], ["inverse", "bg-surface-inverse-raised", "text-ink-on-inverse", "text-ink-on-inverse-muted"]] as const) {
      const result = render(<PeopleGrid people={people(2)} ground={ground} />);
      expect(screen.getByText("P0")).toHaveClass(fill, ground === "inverse" ? primary : secondary);
      expect(screen.getByRole("heading", { name: "Person 0" })).toHaveClass(primary);
      expect(screen.getByText("Role 0")).toHaveClass("text-body-s", secondary);
      result.unmount();
    }
  });

  it("forwards host list attributes and renders supplied portraits and bio", () => {
    const entries = people(2);
    entries[0] = { ...entries[0]!, portrait: <svg data-testid="portrait" />, bio: "Keeps shared notes clear." };
    render(<PeopleGrid people={entries} aria-label="Reviewers" aria-labelledby="people" id="reviewers" className="gap-y-lg" style={{ marginBlockStart: "8px" }} />);
    const list = screen.getByRole("list");
    expect(list.tagName).toBe("UL");
    expect(list).toHaveAttribute("aria-label", "Reviewers");
    expect(list).toHaveAttribute("aria-labelledby", "people");
    expect(list).toHaveAttribute("id", "reviewers");
    expect(list).toHaveClass("gap-y-lg");
    expect(list.style.marginBlockStart).toBe("8px");
    expect(screen.getByTestId("portrait").parentElement).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByText("P0")).not.toBeInTheDocument();
    expect(screen.getByText("Keeps shared notes clear.")).toHaveClass("text-body-s");
  });
});

describe("PeopleGrid measured in Chromium", () => {
  type Card = { w: number; h: number; hitW: number; hitH: number; link: { w: number; h: number }; hover: boolean; focusVisible: boolean; ring: string };
  type Probe = { hoverMedia: boolean; avatar: Card[]; photo: Card[]; roomy: Card[]; active: { section: string | null; index: number } };
  const linked = (count: number): PeopleGridPerson[] => Array.from({ length: count }, (_, index) => ({ id: String(index), name: `Al ${index}`, initials: "A", href: `/people/${index}` }));
  const css = readFileSync(join(import.meta.dirname, "../../styles/compiled.css"), "utf8");
  // In-page probes: card box, the link's stretched ::after region, hover and focus state, and a click log that cancels navigation.
  const script = `
    window.clicks = [];
    addEventListener("click", event => { event.preventDefault(); clicks.push(event.target.closest("a")?.getAttribute("href") ?? null); }, true);
    window.corner = (selector, index, where) => { const box = document.querySelectorAll(selector)[index].getBoundingClientRect();
      return [where === "start" ? box.left + 1 : where === "end" ? box.right - 1 : box.left + box.width / 2, where === "start" ? box.top + 1 : where === "end" ? box.bottom - 1 : box.top + box.height / 2]; };
    window.cards = id => [...document.querySelectorAll("#" + id + " li")].map(item => {
      const link = item.querySelector("a"); const box = item.getBoundingClientRect(); const own = link.getBoundingClientRect(); const hit = getComputedStyle(link, "::after"); const ring = hit.outlineStyle + " " + hit.outlineWidth;
      return { w: box.width, h: box.height, hitW: parseFloat(hit.width), hitH: parseFloat(hit.height), link: { w: own.width, h: own.height }, hover: link.matches(":hover"), focusVisible: link.matches(":focus-visible"), ring };
    });
    window.all = () => { const active = document.activeElement; const section = active.closest("section"); return { hoverMedia: matchMedia("(hover: hover)").matches,
      avatar: cards("avatar"), photo: cards("photo"), roomy: cards("roomy"), active: { section: section?.id ?? null, index: section ? [...section.querySelectorAll("a")].indexOf(active) : -1 } }; };
  `;
  const page = `<!doctype html><meta charset="utf-8"><style>${css}body{margin:0}</style>${renderToStaticMarkup(<>
    <section id="avatar"><PeopleGrid people={linked(4)} /></section>
    <section id="photo"><PeopleGrid people={linked(2)} media="photo" columns={2} /></section>
    <section id="roomy" style={{ "--ui-layout-tap-target": "96px" } as CSSProperties}><PeopleGrid people={linked(2)} /></section>
  </>)}<script>${script}</script>`;
  let wide: Record<string, any>;
  let phone: Record<string, any>;
  beforeAll(() => {
    wide = runInChromium(page, [
      { viewport: 1280 },
      { eval: "all()", as: "rest" },
      { moveTo: "corner('#avatar li', 1, 'end')" }, { eval: "all()", as: "hoverCorner" },
      { moveTo: "[2, 2]" },
      { key: "Tab" }, { eval: "all()", as: "tab1" },
      { key: "Tab" }, { eval: "all()", as: "tab2" },
      { eval: "document.activeElement.blur(), 0", as: "blurred" },
      { click: "corner('#avatar li', 0, 'start')" }, { click: "corner('#avatar li', 0, 'end')" }, { click: "corner('#avatar li', 0, 'centre')" },
      { click: "corner('#avatar li', 2, 'end')" },
      { click: "corner('#photo li', 1, 'start')" }, { click: "corner('#photo li', 1, 'end')" }, { click: "corner('#photo li', 1, 'centre')" },
      { click: "corner('#roomy li', 1, 'start')" }, { click: "corner('#roomy li', 1, 'end')" },
      { eval: "clicks.slice()", as: "clicks" },
    ]);
    phone = runInChromium(page, [{ viewport: 375 }, { eval: "all()", as: "rest" }]);
  }, 90000);

  it("keeps each linked card and its stretched name-link region at least 44px at desktop and phone widths [mutant: drop stretched hit area]", () => {
    expect(wide.rest.hoverMedia).toBe(true);
    for (const probe of [wide.rest as Probe, phone.rest as Probe]) {
      for (const card of [...probe.avatar, ...probe.photo]) {
        expect(card.h).toBeGreaterThanOrEqual(44);
        expect(card.hitH).toBeGreaterThanOrEqual(44);
        expect(card.hitW).toBeGreaterThanOrEqual(44);
        // The stretched region covers the whole card; the bare name link is smaller than a tap target.
        expect(card.hitW).toBeGreaterThanOrEqual(card.w);
        expect(card.hitH).toBeGreaterThanOrEqual(card.h);
        expect(card.link.h).toBeLessThan(44);
      }
    }
  });

  it("follows the registered tap-target token for the card height [mutant: drop minBlockSize]", () => {
    for (const probe of [wide.rest as Probe, phone.rest as Probe]) {
      for (const card of probe.roomy) {
        expect(card.h).toBeGreaterThanOrEqual(96);
        expect(card.hitH).toBeGreaterThanOrEqual(96);
      }
    }
  });

  it("follows a real click at any card corner or centre to that person's page [mutant: drop relative isolate container]", () => {
    expect(wide.clicks).toEqual([
      "/people/0", "/people/0", "/people/0", "/people/2",
      "/people/1", "/people/1", "/people/1",
      "/people/1", "/people/1",
    ]);
  });

  it("marks the link hovered from a card corner away from its text [mutant: drop stretched hit area]", () => {
    expect((wide.hoverCorner as Probe).avatar.map(card => card.hover)).toEqual([false, true, false, false]);
  });

  it("shows one keyboard ring on the stretched region per Tab stop [mutant: drop focus-visible ring]", () => {
    for (const [name, index] of [["tab1", 0], ["tab2", 1]] as const) {
      const probe = wide[name] as Probe;
      expect(probe.active).toEqual({ section: "avatar", index });
      expect(probe.avatar.map(card => card.focusVisible)).toEqual([0, 1, 2, 3].map(position => position === index));
      expect(probe.avatar[index]!.ring).toMatch(/^solid 2px/);
      for (const [position, card] of probe.avatar.entries()) if (position !== index) expect(card.ring).toMatch(/^none/);
    }
  });
});
