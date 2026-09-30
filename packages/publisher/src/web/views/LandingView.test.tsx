// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LandingView } from "./LandingView.js";
import type { LandingViewProps } from "./LandingView.js";
import * as webEntry from "../index.js";
import * as webServerEntry from "../server.js";

// Placeholder markers only: every string is an obviously-fake sentinel, so an
// assertion can tell exactly which prop a text node came from.

const LEGAL = {
  entity: "ENTITY-SENTINEL",
  links: [
    { label: "LINK-ONE-SENTINEL", href: "/one" },
    { label: "LINK-TWO-SENTINEL", href: "/two" },
  ],
  linksLabel: "LINKS-NAME-SENTINEL",
};

const FULL: LandingViewProps = {
  brand: <a href="/">BRAND-SENTINEL</a>,
  headerAction: <a href="/go">HEADER-ACTION-SENTINEL</a>,
  eyebrow: "EYEBROW-SENTINEL",
  heading: "HEADING-SENTINEL",
  description: "DESCRIPTION-SENTINEL",
  heroAction: <a href="/hero">HERO-ACTION-SENTINEL</a>,
  media: <div data-media="">MEDIA-SENTINEL</div>,
  backdrop: <div data-backdrop="">BACKDROP-SENTINEL</div>,
  legal: LEGAL,
};

const MINIMAL: LandingViewProps = {
  brand: <a href="/">BRAND-SENTINEL</a>,
  heading: "HEADING-SENTINEL",
  legal: LEGAL,
};

function markup(props: LandingViewProps): string {
  return renderToStaticMarkup(<LandingView {...props} />);
}

function dom(props: LandingViewProps): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = markup(props);
  return host;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2031-06-15T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("LandingView golden markup", () => {
  it("renders every slot", () => {
    expect(markup(FULL)).toMatchInlineSnapshot(`"<div class="relative flex min-h-dvh flex-col text-ink-primary"><div aria-hidden="true" class="pointer-events-none absolute inset-0 overflow-hidden"><div data-backdrop="">BACKDROP-SENTINEL</div></div><header class="py-sm" style="position:relative;z-index:var(--ui-z-shell, 20)"><div class="mx-auto flex w-full flex-wrap items-center justify-between gap-md" style="padding-inline:var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))"><div class="flex items-center gap-lg"><a href="/">BRAND-SENTINEL</a></div><div class="flex items-center gap-sm"><a href="/go">HEADER-ACTION-SENTINEL</a></div></div></header><main class="relative flex flex-1 flex-col items-center justify-center px-lg py-2xl"><div class="flex w-full flex-col gap-md items-center text-center"><p class="text-caption uppercase tracking-label text-ink-muted">EYEBROW-SENTINEL</p><h1 class="text-display-l font-display text-ink-primary">HEADING-SENTINEL</h1><p class="text-body-l max-w-display text-ink-secondary">DESCRIPTION-SENTINEL</p><div class="flex flex-wrap items-center gap-sm"><a href="/hero">HERO-ACTION-SENTINEL</a></div><div class="w-full max-w-display"><div data-media="">MEDIA-SENTINEL</div></div></div></main><footer class="text-ink-primary py-lg" style="position:relative;z-index:var(--ui-z-shell, 20)"><div class="mx-auto flex w-full flex-col gap-lg" style="padding-inline:var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))"><div class="flex flex-col gap-sm text-body-s text-ink-secondary tablet:flex-row tablet:items-center tablet:justify-between"><div class="flex w-full flex-col items-center gap-sm text-center desktop:flex-row-reverse desktop:flex-nowrap desktop:items-center desktop:justify-between desktop:text-start"><nav aria-label="LINKS-NAME-SENTINEL"><ul role="list" class="m-0 flex list-none flex-wrap items-center justify-center gap-x-sm p-0 desktop:flex-nowrap desktop:justify-end"><li><a href="/one" class="inline-flex items-center justify-center px-xs text-inherit underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" style="min-height:var(--ui-layout-tap-target, 44px);min-width:var(--ui-layout-tap-target, 44px)">LINK-ONE-SENTINEL</a></li><li><a href="/two" class="inline-flex items-center justify-center px-xs text-inherit underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" style="min-height:var(--ui-layout-tap-target, 44px);min-width:var(--ui-layout-tap-target, 44px)">LINK-TWO-SENTINEL</a></li></ul></nav><p class="m-0 desktop:whitespace-nowrap">© 2031 ENTITY-SENTINEL</p></div></div></div></footer></div>"`);
  });

  it("renders only the heading and legal", () => {
    expect(markup(MINIMAL)).toMatchInlineSnapshot(`"<div class="relative flex min-h-dvh flex-col text-ink-primary"><header class="py-sm" style="position:relative;z-index:var(--ui-z-shell, 20)"><div class="mx-auto flex w-full flex-wrap items-center justify-between gap-md" style="padding-inline:var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))"><div class="flex items-center gap-lg"><a href="/">BRAND-SENTINEL</a></div></div></header><main class="relative flex flex-1 flex-col items-center justify-center px-lg py-2xl"><div class="flex w-full flex-col gap-md items-center text-center"><h1 class="text-display-l font-display text-ink-primary">HEADING-SENTINEL</h1></div></main><footer class="text-ink-primary py-lg" style="position:relative;z-index:var(--ui-z-shell, 20)"><div class="mx-auto flex w-full flex-col gap-lg" style="padding-inline:var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))"><div class="flex flex-col gap-sm text-body-s text-ink-secondary tablet:flex-row tablet:items-center tablet:justify-between"><div class="flex w-full flex-col items-center gap-sm text-center desktop:flex-row-reverse desktop:flex-nowrap desktop:items-center desktop:justify-between desktop:text-start"><nav aria-label="LINKS-NAME-SENTINEL"><ul role="list" class="m-0 flex list-none flex-wrap items-center justify-center gap-x-sm p-0 desktop:flex-nowrap desktop:justify-end"><li><a href="/one" class="inline-flex items-center justify-center px-xs text-inherit underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" style="min-height:var(--ui-layout-tap-target, 44px);min-width:var(--ui-layout-tap-target, 44px)">LINK-ONE-SENTINEL</a></li><li><a href="/two" class="inline-flex items-center justify-center px-xs text-inherit underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" style="min-height:var(--ui-layout-tap-target, 44px);min-width:var(--ui-layout-tap-target, 44px)">LINK-TWO-SENTINEL</a></li></ul></nav><p class="m-0 desktop:whitespace-nowrap">© 2031 ENTITY-SENTINEL</p></div></div></div></footer></div>"`);
  });
});

describe("LandingView landmarks and headings", () => {
  it("has exactly one h1 equal to heading", () => {
    const headings = dom(FULL).querySelectorAll("h1");
    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toBe("HEADING-SENTINEL");
  });

  it("has one banner, one main and one contentinfo landmark", () => {
    const root = dom(FULL);
    expect(root.querySelectorAll("header")).toHaveLength(1);
    expect(root.querySelectorAll("main")).toHaveLength(1);
    expect(root.querySelectorAll("footer")).toHaveLength(1);
    expect(root.querySelector("main")?.closest("header, footer")).toBeNull();
    expect(root.querySelector("header")?.closest("main")).toBeNull();
    expect(root.querySelector("footer")?.closest("main")).toBeNull();
  });

  it("places the header action inside the header only", () => {
    const root = dom(FULL);
    const header = root.querySelector("header")!;
    expect(header.textContent).toContain("HEADER-ACTION-SENTINEL");
    expect(root.querySelector("main")!.textContent).not.toContain("HEADER-ACTION-SENTINEL");
    expect(root.querySelector("footer")!.textContent).not.toContain("HEADER-ACTION-SENTINEL");
  });

  it("renders heroAction only when supplied, and only inside main", () => {
    const withAction = dom(FULL);
    expect(withAction.querySelector("main")!.textContent).toContain("HERO-ACTION-SENTINEL");
    expect(withAction.querySelector("header")!.textContent).not.toContain("HERO-ACTION-SENTINEL");
    expect(markup({ ...FULL, heroAction: undefined })).not.toContain("HERO-ACTION-SENTINEL");
    expect(markup({ ...FULL, heroAction: undefined })).toContain("HEADER-ACTION-SENTINEL");
  });

  it("fills the viewport with a flex column root", () => {
    const root = dom(FULL).firstElementChild!;
    expect(root.className).toContain("min-h-dvh");
    expect(root.className).toContain("flex-col");
  });

  it("centres the hero both ways inside main", () => {
    const main = dom(FULL).querySelector("main")!;
    expect(main.className).toContain("flex-1");
    expect(main.className).toContain("items-center");
    expect(main.className).toContain("justify-center");
  });
});

describe("LandingView align and media", () => {
  it("defaults to centre", () => {
    expect(markup(FULL)).toBe(markup({ ...FULL, align: "center" }));
  });

  it("changes only its own classes between centre and start", () => {
    const centre = markup({ ...FULL, align: "center" });
    const start = markup({ ...FULL, align: "start" });
    expect(centre).not.toBe(start);
    const strip = (html: string) => html.replace(/class="[^"]*"/g, 'class=""');
    expect(strip(centre)).toBe(strip(start));
    const classAt = (html: string) => [...html.matchAll(/class="([^"]*)"/g)].map((m) => m[1]);
    const a = classAt(centre);
    const b = classAt(start);
    expect(a).toHaveLength(b.length);
    const changed = a.map((value, i) => [value, b[i]]).filter(([x, y]) => x !== y);
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.length).toBeLessThan(a.length);
    const heroClass = (props: LandingViewProps) => dom(props).querySelector("main > div")!.className;
    expect(heroClass({ ...FULL, align: "center" })).toContain("text-center");
    expect(heroClass({ ...FULL, align: "start" })).toContain("text-start");
    expect(heroClass({ ...FULL, align: "start" })).not.toContain("text-center");
  });

  it("renders media after the description", () => {
    const html = markup(FULL);
    expect(html.indexOf("MEDIA-SENTINEL")).toBeGreaterThan(html.indexOf("DESCRIPTION-SENTINEL"));
  });
});

describe("LandingView backdrop", () => {
  it("is aria-hidden, pointer-events-none and precedes the header", () => {
    const root = dom(FULL).firstElementChild!;
    const backdrop = root.firstElementChild!;
    expect(backdrop.getAttribute("aria-hidden")).toBe("true");
    expect(backdrop.className).toContain("pointer-events-none");
    expect(backdrop.className).toContain("absolute");
    expect(backdrop.textContent).toBe("BACKDROP-SENTINEL");
    expect(backdrop.nextElementSibling?.tagName).toBe("HEADER");
  });

  it("is absent from the markup when not supplied", () => {
    const html = markup(MINIMAL);
    expect(html).not.toContain("aria-hidden");
    expect(html).not.toContain("pointer-events-none");
    expect(dom(MINIMAL).firstElementChild!.firstElementChild!.tagName).toBe("HEADER");
  });
});

describe("LandingView chrome", () => {
  const FORBIDDEN = [/(^|\s)(?:[a-z-]+:)*bg-/, /(^|\s)(?:[a-z-]+:)*border(?:-|\s|$)/, /(^|\s)(?:[a-z-]+:)*max-w-/];

  function chromeElements(root: HTMLElement): Element[] {
    const header = root.querySelector("header")!;
    const footer = root.querySelector("footer")!;
    return [header, ...header.querySelectorAll("*"), footer, ...footer.querySelectorAll("*")];
  }

  it("carries no background, border or max-width class, and no maxWidth style", () => {
    for (const element of chromeElements(dom(FULL))) {
      const className = element.getAttribute("class") ?? "";
      for (const pattern of FORBIDDEN) {
        expect(className, `<${element.tagName.toLowerCase()} class="${className}">`).not.toMatch(pattern);
      }
      const style = element.getAttribute("style") ?? "";
      expect(style).not.toMatch(/max-width/i);
      expect(style).not.toMatch(/border/i);
      expect(style).not.toMatch(/background/i);
    }
  });

  it("feeds the legal row only from legal, so every text node comes from props", () => {
    const footer = dom(FULL).querySelector("footer")!;
    const walker = document.createTreeWalker(footer, NodeFilter.SHOW_TEXT);
    const texts: string[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim();
      if (text) texts.push(text);
    }
    expect(texts.sort()).toEqual(["© 2031 ENTITY-SENTINEL", "LINK-ONE-SENTINEL", "LINK-TWO-SENTINEL"].sort());
    expect(footer.querySelector("nav")?.getAttribute("aria-label")).toBe("LINKS-NAME-SENTINEL");
  });

  it("renders no text of its own beyond the props", () => {
    const root = dom(FULL);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const texts: string[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim();
      if (text) texts.push(text);
    }
    for (const text of texts) {
      expect(text).toMatch(/SENTINEL/);
    }
  });

  it("passes rest props through to the root", () => {
    const html = renderToStaticMarkup(<LandingView {...MINIMAL} id="landing-root" data-probe="yes" className="extra" />);
    expect(html).toContain('id="landing-root"');
    expect(html).toContain('data-probe="yes"');
    expect(html).toMatch(/class="[^"]*extra/);
  });
});

describe("LandingView export surface", () => {
  it("is exported from both web entries", () => {
    expect(webEntry.LandingView).toBe(LandingView);
    expect(webServerEntry.LandingView).toBeTypeOf("function");
  });
});

describe("LandingView source guard", () => {
  const source = readFileSync(join(import.meta.dirname, "LandingView.tsx"), "utf8");

  it("is a server-safe module", () => {
    expect(source).not.toMatch(/["']use client["']/);
    expect(source).not.toMatch(/react-aria-components/);
    expect(source).not.toMatch(/\buse[A-Z][A-Za-z]*\(/);
    expect(source).not.toMatch(/dangerouslySetInnerHTML/);
    expect(source).not.toMatch(/token-gate:ignore/);
  });

  it("imports Designer only through the server barrels", () => {
    const designerImports = [...source.matchAll(/from\s+["'](@clossys\/designer[^"']*)["']/g)].map((m) => m[1]);
    expect(designerImports.length).toBeGreaterThan(0);
    for (const specifier of designerImports) {
      expect(["@clossys/designer/shell/server", "@clossys/designer/atoms/server", "@clossys/designer/blocks/server"]).toContain(specifier);
    }
  });

  it("uses no arbitrary-value class", () => {
    expect(source).not.toMatch(/(?:class(?:Name)?\s*=|mergeUiClasses\(|cx\()[^\n]*\[[^\]\n]+\]/);
    for (const [, literal] of source.matchAll(/"([^"\n]*)"/g)) {
      if (/\b[a-z-]+-\[/.test(literal ?? "")) throw new Error(`arbitrary-value class in ${literal}`);
    }
  });
});
