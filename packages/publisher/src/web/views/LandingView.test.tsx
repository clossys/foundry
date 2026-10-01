// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { SiteFooter, SiteHeader } from "@clossys/designer/shell/server";
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

const COMBINATIONS = [
  { ground: "base", footer: "transparent" },
  { ground: "base", footer: "surface" },
  { ground: "inverse", footer: "transparent" },
  { ground: "inverse", footer: "surface" },
] as const satisfies ReadonlyArray<Pick<LandingViewProps, "ground" | "footer">>;

const BASE_INK = /(^|\s)text-ink-(primary|secondary|muted)(\s|$)/;

function classesOf(element: Element): string[] {
  return Array.from(element.classList);
}

describe("LandingView ground and footer defaults", () => {
  it("renders the same markup when ground and footer are passed as their defaults", () => {
    for (const props of [FULL, MINIMAL]) {
      expect(markup({ ...props, ground: "base", footer: "transparent" })).toBe(markup(props));
      expect(markup({ ...props, ground: "base" })).toBe(markup(props));
      expect(markup({ ...props, footer: "transparent" })).toBe(markup(props));
    }
  });

  it("paints no surface on the root by default", () => {
    expect(dom(FULL).firstElementChild!.className).toBe("relative flex min-h-dvh flex-col text-ink-primary");
  });
});

describe("LandingView inverse ground", () => {
  const inverse = (props: LandingViewProps = FULL) => dom({ ...props, ground: "inverse" });

  it("paints the inverse surface and the on-inverse ink on the page root", () => {
    const root = inverse().firstElementChild!;
    expect(classesOf(root)).toEqual(expect.arrayContaining(["bg-surface-inverse", "text-ink-on-inverse"]));
    expect(root.className).not.toMatch(BASE_INK);
  });

  it("gives every hero text role the on-inverse ink", () => {
    const main = inverse().querySelector("main")!;
    const [eyebrow, description] = Array.from(main.querySelectorAll("p"));
    expect(eyebrow?.textContent).toBe("EYEBROW-SENTINEL");
    expect(classesOf(eyebrow!)).toContain("text-ink-on-inverse-muted");
    expect(classesOf(main.querySelector("h1")!)).toContain("text-ink-on-inverse");
    expect(description?.textContent).toBe("DESCRIPTION-SENTINEL");
    expect(classesOf(description!)).toContain("text-ink-on-inverse-muted");
  });

  it("gives the banner the on-inverse ink by inheritance, with no ink of its own", () => {
    const root = inverse();
    const header = root.querySelector("header")!;
    for (const element of [header, ...header.querySelectorAll("*")]) {
      expect(element.getAttribute("class") ?? "").not.toMatch(/(^|\s)text-ink-/);
    }
    expect(header.parentElement!.classList).toContain("text-ink-on-inverse");
    expect(header.textContent).toContain("BRAND-SENTINEL");
    expect(header.textContent).toContain("HEADER-ACTION-SENTINEL");
  });

  it("gives the footer and its legal row the on-inverse ink", () => {
    const footer = inverse().querySelector("footer")!;
    expect(classesOf(footer)).toContain("text-ink-on-inverse");
    const legalRow = footer.querySelector("nav")!.closest("footer > div > div")!;
    expect(classesOf(legalRow)).toContain("text-ink-on-inverse-muted");
  });

  it("leaves no base ink class anywhere on the page", () => {
    for (const props of [FULL, MINIMAL]) {
      for (const element of inverse(props).querySelectorAll("*")) {
        expect(element.getAttribute("class") ?? "", `<${element.tagName.toLowerCase()}>`).not.toMatch(BASE_INK);
      }
    }
  });

  it("passes Designer's transparent-inverse chrome ground to SiteHeader and SiteFooter", () => {
    const root = inverse();
    expect(root.querySelector("header")!.outerHTML).toBe(
      renderToStaticMarkup(<SiteHeader ground="transparent-inverse" brand={FULL.brand} actions={FULL.headerAction} />),
    );
    expect(root.querySelector("footer")!.outerHTML).toBe(
      renderToStaticMarkup(<SiteFooter ground="transparent-inverse" secondary={<SiteFooter.Legal {...LEGAL} />} />),
    );
  });

  it("keeps the banner and footer plate-less over the backdrop", () => {
    const root = inverse();
    for (const chrome of [root.querySelector("header")!, root.querySelector("footer")!]) {
      for (const element of [chrome, ...chrome.querySelectorAll("*")]) {
        expect(element.getAttribute("class") ?? "").not.toMatch(/(^|\s)(?:[a-z-]+:)*(bg-|border(-|\s|$))/);
        expect(element.getAttribute("style") ?? "").not.toMatch(/border|background/i);
      }
    }
  });

  it("changes only classes: the structure and text match the base ground", () => {
    const strip = (html: string) => html.replace(/class="[^"]*"/g, 'class=""');
    expect(strip(markup({ ...FULL, ground: "inverse" }))).toBe(strip(markup(FULL)));
  });
});

describe("LandingView surface footer", () => {
  for (const ground of ["base", "inverse"] as const) {
    describe(`on the ${ground} ground`, () => {
      const surface = () => dom({ ...FULL, ground, footer: "surface" });
      const transparent = () => dom({ ...FULL, ground });

      it("paints Designer's base chrome plate with a hairline on the top edge only", () => {
        const footer = surface().querySelector("footer")!;
        expect(classesOf(footer)).toEqual(expect.arrayContaining(["bg-surface-raised", "border-t", "border-line-base"]));
        expect(footer.className).not.toMatch(/(^|\s)border-(b|l|r|x|y|s|e)(\s|$)/);
        const style = footer.getAttribute("style") ?? "";
        expect(style).toContain("border-top-width:var(--ui-border-hairline");
        expect(style).not.toMatch(/border-(bottom|left|right|inline|block)/);
        expect(footer.outerHTML).toBe(
          renderToStaticMarkup(<SiteFooter ground="base" secondary={<SiteFooter.Legal {...LEGAL} />} />),
        );
      });

      it("uses the base ink on its own plate", () => {
        const footer = surface().querySelector("footer")!;
        expect(classesOf(footer)).toContain("text-ink-primary");
        expect(classesOf(footer.querySelector("nav")!.closest("footer > div > div")!)).toContain("text-ink-secondary");
        expect(footer.outerHTML).not.toContain("on-inverse");
      });

      it("runs the full width and stays above the backdrop", () => {
        const root = surface().firstElementChild!;
        const footer = root.querySelector("footer")!;
        for (const element of [footer, ...footer.querySelectorAll("*")]) {
          expect(element.getAttribute("class") ?? "").not.toMatch(/(^|\s)(?:[a-z-]+:)*max-w-/);
          expect(element.getAttribute("style") ?? "").not.toMatch(/max-width/i);
        }
        const style = footer.getAttribute("style") ?? "";
        expect(style).toContain("position:relative");
        expect(style).toContain("z-index:var(--ui-z-shell");
        expect(root.firstElementChild!.getAttribute("aria-hidden")).toBe("true");
        expect(root.lastElementChild).toBe(footer);
      });

      it("leaves the banner, the hero and the page root unchanged", () => {
        const a = surface().firstElementChild!;
        const b = transparent().firstElementChild!;
        expect(a.querySelector("header")!.outerHTML).toBe(b.querySelector("header")!.outerHTML);
        expect(a.querySelector("main")!.outerHTML).toBe(b.querySelector("main")!.outerHTML);
        expect(a.className).toBe(b.className);
      });
    });
  }
});

describe("LandingView guarantees in every ground and footer combination", () => {
  for (const combination of COMBINATIONS) {
    const label = `ground ${combination.ground}, footer ${combination.footer}`;

    it(`keeps one banner, one main and one contentinfo landmark (${label})`, () => {
      for (const props of [FULL, MINIMAL]) {
        const root = dom({ ...props, ...combination });
        expect(root.querySelectorAll("header")).toHaveLength(1);
        expect(root.querySelectorAll("main")).toHaveLength(1);
        expect(root.querySelectorAll("footer")).toHaveLength(1);
        expect(root.querySelector("main")?.closest("header, footer")).toBeNull();
        expect(root.querySelector("header")?.closest("main, footer")).toBeNull();
        expect(root.querySelector("footer")?.closest("main, header")).toBeNull();
      }
    });

    it(`keeps the heading as the only h1 (${label})`, () => {
      const headings = dom({ ...FULL, ...combination }).querySelectorAll("h1");
      expect(headings).toHaveLength(1);
      expect(headings[0]?.textContent).toBe("HEADING-SENTINEL");
    });

    it(`keeps the backdrop first, inert and aria-hidden (${label})`, () => {
      const root = dom({ ...FULL, ...combination }).firstElementChild!;
      const backdrop = root.firstElementChild!;
      expect(backdrop.getAttribute("aria-hidden")).toBe("true");
      expect(backdrop.className).toContain("pointer-events-none");
      expect(backdrop.className).toContain("absolute");
      expect(backdrop.textContent).toBe("BACKDROP-SENTINEL");
      expect(backdrop.nextElementSibling?.tagName).toBe("HEADER");
      expect(markup({ ...MINIMAL, ...combination })).not.toContain("aria-hidden");
    });

    it(`keeps the banner plate-less and full width (${label})`, () => {
      const header = dom({ ...FULL, ...combination }).querySelector("header")!;
      for (const element of [header, ...header.querySelectorAll("*")]) {
        expect(element.getAttribute("class") ?? "").not.toMatch(/(^|\s)(?:[a-z-]+:)*(bg-|max-w-|border(-|\s|$))/);
        expect(element.getAttribute("style") ?? "").not.toMatch(/border|background|max-width/i);
      }
    });
  }
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
