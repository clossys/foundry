import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { specimenFramePage } from "./specimen-frame.js";

const script = /<script>([\s\S]*)<\/script>/.exec(specimenFramePage({ src: "/__specimen-site/k/index.html", width: 1280, title: "probe" }))![1]!;

/**
 * Runs the frame script against a stub host: a `data-specimen-fit="content"` gallery host with a
 * square aspect, `padding` px of padding on each side (border-box, no border), `hostWidth` px wide;
 * the inner page is `natural` px tall. Returns the height the script sets on the host.
 */
function fitHost(options: { hostWidth: number; padding: number; natural: number }): string {
  const timers: Array<() => void> = [];
  const listeners: Record<string, () => void> = {};
  const innerWidth = options.hostWidth - 2 * options.padding;
  const host = {
    style: {} as Record<string, string>,
    clientWidth: options.hostWidth, clientHeight: options.hostWidth, offsetHeight: options.hostWidth,
    getAttribute: (name: string) => (name === "data-specimen-fit" ? "content" : null),
  };
  const inner = {
    documentElement: { scrollHeight: options.natural },
    body: { scrollHeight: options.natural, getElementsByTagName: () => [] },
    defaultView: { getComputedStyle: () => ({ position: "static", display: "block" }) },
    addEventListener: () => {},
  };
  const frame = {
    style: {} as Record<string, string>,
    contentDocument: inner,
    contentWindow: { location: { href: "http://localhost/__specimen-site/k/index.html" } },
    getAttribute: (name: string) => (name === "data-width" ? "1280" : null),
    addEventListener: (type: string, listener: () => void) => { listeners[type] = listener; },
  };
  runInNewContext(script, {
    document: { getElementById: () => frame },
    window: { frameElement: { parentElement: host } },
    getComputedStyle: () => ({ aspectRatio: "1 / 1", paddingTop: `${options.padding}px`, paddingBottom: `${options.padding}px` }),
    innerWidth, innerHeight: innerWidth,
    parent: { postMessage: () => {} }, location: { origin: "http://localhost" },
    addEventListener: () => {},
    setTimeout: (callback: () => void) => { timers.push(callback); return timers.length; },
    clearTimeout: () => {},
    Math, Number, String, parseFloat,
  });
  listeners.load!();
  while (timers.length) timers.shift()!();
  return host.style.height!;
}

describe("specimen frame fit-to-content (R2F-03b)", () => {
  it("keeps the host's padding around short content, so the frame is never squeezed to no height", () => {
    // 300 px of frame for a 1280 px page: scale 0.234, a 100 px item is 23.4 px tall, plus 2 x 24 px padding.
    expect(fitHost({ hostWidth: 348, padding: 24, natural: 100 })).toBe(`${Math.ceil(100 * (300 / 1280) + 48)}px`);
  });

  it("caps a long page at the host's square, padding included, never taller than the card", () => {
    expect(fitHost({ hostWidth: 348, padding: 24, natural: 4000 })).toBe("348px");
  });
});
