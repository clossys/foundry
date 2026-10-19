import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import { SectionIntro } from "./blocks/SectionIntro.js";
import { Hero } from "./blocks/Hero.js";
import { Brandmark } from "./shell/Brandmark.js";
import { SiteHeader } from "./shell/SiteHeader.js";
import { SiteFooter } from "./shell/SiteFooter.js";
import { NavDisclosure } from "./shell/NavDisclosure.js";

// Captured on unchanged main before the controls existed. Kept in this excluded test file.
const DEFAULT_OUTPUT: Record<"server" | "client", Record<string, string>> = {
  "server": {
    "brand": "<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent\" style=\"gap:var(--ui-brandmark-gap-md, 6px)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-md, 36px);width:auto\"><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-md, 36px) * 0.4583333333333333)\">Example</span></a>",
    "footer": "<footer data-footer-root=\"\" class=\"site-footer-dark text-ink-primary py-lg\" style=\"position:relative;z-index:var(--ui-z-shell, 20)\"><div class=\"mx-auto flex w-full flex-col gap-lg\" style=\"padding-inline:var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))\"><div class=\"grid grid-cols-1 gap-lg tablet:grid-cols-2 desktop:grid-cols-4\"><p>Links</p></div><div class=\"flex flex-col gap-sm text-body-s text-ink-secondary tablet:flex-row tablet:items-center tablet:justify-between\">Legal</div></div></footer>",
    "header": "<link rel=\"preload\" as=\"image\" href=\"/mark.svg\"><header class=\"bg-surface-raised py-sm border-b border-line-base\" style=\"position:relative;z-index:var(--ui-z-shell, 20);border-bottom-width:var(--ui-border-hairline, 1px)\"><div class=\"mx-auto flex w-full flex-wrap items-center justify-between gap-md\" style=\"padding-inline:var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))\"><div class=\"flex items-center gap-lg\"><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent\" style=\"gap:var(--ui-brandmark-gap-md, 6px)\"><img src=\"/mark.svg\" alt=\"\" style=\"height:var(--ui-brandmark-height-md, 36px);width:auto\"><span class=\"font-display leading-none\" style=\"font-size:calc(var(--ui-brandmark-height-md, 36px) * 0.4583333333333333)\">Example</span></a></div></div></header>",
    "hero": "<section class=\"flex flex-col gap-xl\"><div data-section-intro=\"display\" class=\"flex w-full flex-col items-start\" style=\"max-width:var(--ui-width-prose-max, 48rem)\"><p class=\"text-body-s font-medium uppercase tracking-label text-accent-text\">Topic</p><h1 class=\"text-display-m tablet:text-display-l font-display leading-display text-balance text-ink-primary mt-sm\">Opening</h1><p class=\"text-body-l text-pretty text-ink-secondary mt-2xl\">Supporting copy</p></div></section>",
    "intro": "<div data-section-intro=\"section\" class=\"flex w-full flex-col items-start\" style=\"max-width:var(--ui-width-prose-max, 48rem)\"><p class=\"text-body-s font-medium uppercase tracking-label text-accent-text\">Topic</p><h2 class=\"text-h1 tablet:text-h0 tablet-lg:text-display-m font-display leading-heading text-balance text-ink-primary mt-sm\">Opening</h2><p class=\"text-body-l text-pretty text-ink-secondary mt-xl\">Supporting copy</p></div>",
    "nav": "<nav aria-label=\"Primary\"><button type=\"button\" aria-expanded=\"false\" aria-controls=\"stable-id\" class=\"inline-flex items-center justify-center gap-sm rounded-control font-body px-sm py-xs text-body-s text-ink-primary hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent nav-disclosure-toggle\" style=\"min-height:var(--ui-layout-tap-target, 44px);min-width:var(--ui-layout-tap-target, 44px)\">Menu</button><div id=\"stable-id\" class=\"nav-disclosure-panel\"><a href=\"/about\">About</a></div></nav>"
  },
  "client": {
    "brand": "<a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent\" style=\"gap: var(--ui-brandmark-gap-md, 6px);\"><img alt=\"\" style=\"height: var(--ui-brandmark-height-md, 36px); width: auto;\" src=\"/mark.svg\"><span class=\"font-display leading-none\" style=\"font-size: calc(var(--ui-brandmark-height-md, 36px) * 0.4583333333333333);\">Example</span></a>",
    "footer": "<footer data-footer-root=\"\" class=\"site-footer-dark text-ink-primary py-lg\" style=\"position: relative; z-index: var(--ui-z-shell, 20);\"><div class=\"mx-auto flex w-full flex-col gap-lg\" style=\"padding-inline: var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px));\"><div class=\"grid grid-cols-1 gap-lg tablet:grid-cols-2 desktop:grid-cols-4\"><p>Links</p></div><div class=\"flex flex-col gap-sm text-body-s text-ink-secondary tablet:flex-row tablet:items-center tablet:justify-between\">Legal</div></div></footer>",
    "header": "<header class=\"bg-surface-raised py-sm border-b border-line-base\" style=\"position: relative; z-index: var(--ui-z-shell, 20); border-bottom-width: var(--ui-border-hairline, 1px);\"><div class=\"mx-auto flex w-full flex-wrap items-center justify-between gap-md\" style=\"padding-inline: var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px));\"><div class=\"flex items-center gap-lg\"><a href=\"/\" aria-label=\"Example home\" class=\"inline-flex items-center no-underline text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent\" style=\"gap: var(--ui-brandmark-gap-md, 6px);\"><img alt=\"\" style=\"height: var(--ui-brandmark-height-md, 36px); width: auto;\" src=\"/mark.svg\"><span class=\"font-display leading-none\" style=\"font-size: calc(var(--ui-brandmark-height-md, 36px) * 0.4583333333333333);\">Example</span></a></div></div></header>",
    "hero": "<section class=\"flex flex-col gap-xl\"><div data-section-intro=\"display\" class=\"flex w-full flex-col items-start\" style=\"max-width: var(--ui-width-prose-max, 48rem);\"><p class=\"text-body-s font-medium uppercase tracking-label text-accent-text\">Topic</p><h1 class=\"text-display-m tablet:text-display-l font-display leading-display text-balance text-ink-primary mt-sm\">Opening</h1><p class=\"text-body-l text-pretty text-ink-secondary mt-2xl\">Supporting copy</p></div></section>",
    "intro": "<div data-section-intro=\"section\" class=\"flex w-full flex-col items-start\" style=\"max-width: var(--ui-width-prose-max, 48rem);\"><p class=\"text-body-s font-medium uppercase tracking-label text-accent-text\">Topic</p><h2 class=\"text-h1 tablet:text-h0 tablet-lg:text-display-m font-display leading-heading text-balance text-ink-primary mt-sm\">Opening</h2><p class=\"text-body-l text-pretty text-ink-secondary mt-xl\">Supporting copy</p></div>",
    "nav": "<nav aria-label=\"Primary\"><button type=\"button\" aria-expanded=\"false\" aria-controls=\"stable-id\" class=\"inline-flex items-center justify-center gap-sm rounded-control font-body px-sm py-xs text-body-s text-ink-primary hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent nav-disclosure-toggle\" style=\"min-height: var(--ui-layout-tap-target, 44px); min-width: var(--ui-layout-tap-target, 44px);\">Menu</button><div id=\"stable-id\" class=\"nav-disclosure-panel\"><a href=\"/about\">About</a></div></nav>"
  }
};

const brand = { variant: "lockup", size: "md", label: "Example home", wordmark: "Example", markSrc: "/mark.svg" } as const;
const copy = { eyebrow: "Topic", heading: "Opening", description: "Supporting copy" };
const css = (name: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "styles", name), "utf8");
// Old prop types must not prevent the tests-first runtime failure from being measured.
const options = (value: object) => value;
const normaliseIds = (html: string) => html.replace(/(?:«|_)[^"<>]*(?:»|_)/g, "stable-id");
const modes = ["server", "client"] as const;
function output(element: ReactElement, mode: typeof modes[number]): HTMLElement {
  if (mode === "client") return render(element).container;
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(element);
  return container;
}
afterEach(cleanup);

for (const mode of modes) describe(`frame parity controls: ${mode}`, () => {
  it("pins default output including mandatory dark footer paint", () => {
    const elements = {
      intro: <SectionIntro {...copy} />,
      hero: <Hero {...copy} />,
      brand: <Brandmark {...brand} />,
      header: <SiteHeader brand={<Brandmark {...brand} />} />,
      footer: <SiteFooter ground="transparent" columns={<p>Links</p>} secondary="Legal" />,
      nav: <NavDisclosure><a href="/about">About</a></NavDisclosure>,
    };
    for (const [name, element] of Object.entries(elements)) {
      expect(normaliseIds(output(element, mode).innerHTML)).toBe(DEFAULT_OUTPUT[mode][name]);
    }
  });

  it("renders inverse brand ink and inherits header tone unless explicitly overridden", () => {
    const direct = output(<Brandmark {...brand} {...options({ tone: "inverse" })} />, mode);
    expect(direct.querySelector("a")).toHaveClass("text-ink-on-inverse");
    for (const navPlacement of ["leading", "centered"] as const) {
      const inherited = output(<SiteHeader placement="overlay" tone="inverse" navPlacement={navPlacement} brand={<Brandmark {...brand} />} />, mode);
      expect(inherited.querySelector("a")).toHaveClass("text-ink-on-inverse");
      const overridden = output(<SiteHeader placement="overlay" tone="inverse" navPlacement={navPlacement} brand={<Brandmark {...brand} {...options({ tone: "auto" })} />} />, mode);
      expect(overridden.querySelector("a")).toHaveClass("text-ink-primary");
    }
  });

  it("keeps header tone ignored in flow placement", () => {
    const original = output(<SiteHeader brand={<Brandmark {...brand} />} />, mode).innerHTML;
    expect(output(<SiteHeader tone="inverse" brand={<Brandmark {...brand} />} />, mode).innerHTML).toBe(original);
  });

  it("uses inverse brand focus outline without a header", () => {
    const variants = [brand, { variant: "mark", size: "md", label: "Example home", markSrc: "/mark.svg" }] as const;
    for (const props of variants) {
      const inverse = output(<Brandmark {...props} tone="inverse" />, mode).querySelector("a")!;
      expect(inverse).toHaveClass("focus-visible:outline-ink-on-inverse");
      expect(inverse).not.toHaveClass("focus-visible:outline-accent");
      const auto = output(<Brandmark {...props} tone="auto" />, mode).querySelector("a")!;
      expect(auto).toHaveClass("focus-visible:outline-accent");
      expect(auto).not.toHaveClass("focus-visible:outline-ink-on-inverse");
      expect(output(<Brandmark {...props} />, mode).querySelector("a")?.outerHTML).toBe(auto.outerHTML);
    }
  });

  for (const Component of [SectionIntro, Hero]) {
    it(`${Component.name} uses secondary eyebrow ink for every ground`, () => {
      for (const ground of ["base", "sunken", "inverse"] as const) {
        const root = output(<Component {...copy} ground={ground} {...options({ eyebrowTone: "muted" })} />, mode);
        expect(root.querySelector("p")).toHaveClass(ground === "inverse" ? "text-ink-on-inverse-muted" : "text-ink-secondary");
        expect(root.querySelector("p")?.className).not.toMatch(/text-accent/);
      }
    });
    it(`${Component.name} gives only the wide body a 64rem cap`, () => {
      const root = output(<Component {...copy} {...options({ measure: "wide" })} />, mode);
      const intro = root.querySelector<HTMLElement>("[data-section-intro]")!;
      expect(intro.style.maxWidth).toBe("none");
      expect(intro.querySelector("h1,h2")?.getAttribute("style")).toBeNull();
      expect(intro.querySelectorAll("p")[1].style.maxWidth).toBe("var(--ui-width-hero-wide, 64rem)");
    });
    it(`${Component.name} opts into the responsive display heading ramp`, () => {
      const root = output(<Component {...copy} {...options({ headingScale: "display" })} />, mode);
      expect(root.querySelector("h1,h2")).toHaveClass("text-display-m", "tablet:text-display-l", "tablet-lg:text-display-xl", "font-display", "leading-display");
    });
  }

  it("draws only the requested transparent footer top rule and no inner divider", () => {
    const root = output(<SiteFooter ground="transparent" {...options({ rule: "top" })} columns={<p>Links</p>} secondary="Legal" />, mode);
    const footer = root.querySelector("footer")!;
    expect(footer).toHaveClass("border-t", "border-line-base");
    expect(footer.style.borderTopWidth).toBe("var(--ui-border-hairline, 1px)");
    expect(footer.querySelector(".border-t")).toBeNull();
    for (const ground of ["base", "inverse", "transparent-inverse"] as const) {
      const original = output(<SiteFooter ground={ground} secondary="Legal" />, mode).innerHTML;
      expect(output(<SiteFooter ground={ground} {...options({ rule: "top" })} secondary="Legal" />, mode).innerHTML).toBe(original);
    }
  });

  it("keeps inverse navigation ink through hover, expanded and focus states", () => {
    const root = output(<NavDisclosure {...options({ tone: "inverse" })}><a href="/about">About</a></NavDisclosure>, mode);
    const trigger = root.querySelector("button")!;
    expect(trigger).toHaveClass("text-ink-on-inverse", "hover:text-ink-on-inverse", "aria-expanded:text-ink-on-inverse", "focus-visible:text-ink-on-inverse", "focus-visible:outline-ink-on-inverse");
    expect(trigger).not.toHaveClass("text-ink-primary", "hover:bg-surface-sunken");
    expect(trigger).toHaveAttribute("data-tone", "inverse");
    if (mode === "client") {
      fireEvent.click(trigger);
      expect(trigger).toHaveAttribute("aria-expanded", "true");
      expect(trigger).toHaveClass("text-ink-on-inverse");
      trigger.focus();
      expect(trigger).toHaveFocus();
    }
  });
});

it("ships the one non-brandable wide hero token and desktop display token", async () => {
  expect(css("tokens.css")).toMatch(/--ui-width-hero-wide:\s*64rem;/);
  expect(css("tokens.css")).toMatch(/--text-display-xl:\s*72px;/);
  const { TOKENS } = await import("./tokens/tokens.js");
  expect(TOKENS["--ui-width-hero-wide"]).toMatchObject({ value: "64rem", brandable: false });
});

it("lets an inverse header style an unconfigured nav trigger without importing the client component", () => {
  const keys = css("theme-keys.css");
  expect(keys).toContain('&[data-tone="inverse"] .nav-disclosure-toggle:not([data-tone])');
  expect(keys).toContain("color: var(--color-ink-on-inverse");
  expect(keys).toContain("background-color: var(--color-control-tonal-inverse-hover");
  expect(css("compiled.css")).toContain('&[data-tone="inverse"] .nav-disclosure-toggle:not([data-tone])');
  expect(css("compiled.css")).toContain('.tablet-lg\\:text-display-xl');
});
