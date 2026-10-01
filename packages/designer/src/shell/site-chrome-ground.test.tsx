import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SiteFooter } from "./SiteFooter.js";
import { SiteHeader } from "./SiteHeader.js";

/**
 * Markup captured from `main` BEFORE the `transparent` ground existed
 * (fixed clock, so the legal row's year is stable). `base` and `inverse`
 * must stay byte-identical to it.
 */
const MAIN_MARKUP: Readonly<Record<string, string>> = {
  "header-base": "<header class=\"bg-surface-raised py-sm border-b border-line-base\" style=\"position:relative;z-index:var(--ui-z-shell, 20);border-bottom-width:var(--ui-border-hairline, 1px)\"><div class=\"mx-auto flex w-full flex-wrap items-center justify-between gap-md\" style=\"padding-inline:var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))\"><div class=\"flex items-center gap-lg\"><a href=\"/\">Home</a><nav>Nav</nav></div><div class=\"flex items-center gap-sm\"><button type=\"button\">Go</button></div></div></header>",
  "footer-cols-base": "<footer class=\"bg-surface-raised text-ink-primary py-lg border-t border-line-base\" style=\"position:relative;z-index:var(--ui-z-shell, 20);border-top-width:var(--ui-border-hairline, 1px)\"><div class=\"mx-auto flex w-full flex-col gap-lg\" style=\"padding-inline:var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))\"><div class=\"grid grid-cols-1 gap-lg tablet:grid-cols-2 desktop:grid-cols-4\"><div class=\"flex flex-col gap-sm\"><h2 class=\"text-body-s font-body font-medium\">Product</h2><div class=\"flex flex-col gap-xs\"><a href=\"/a\">A</a></div></div></div><div class=\"flex flex-col gap-sm text-body-s text-ink-secondary tablet:flex-row tablet:items-center tablet:justify-between border-t pt-lg border-line-base\"><span>Legal</span></div></div></footer>",
  "footer-secondary-base": "<footer class=\"bg-surface-raised text-ink-primary py-lg border-t border-line-base\" style=\"position:relative;z-index:var(--ui-z-shell, 20);border-top-width:var(--ui-border-hairline, 1px)\"><div class=\"mx-auto flex w-full flex-col gap-lg\" style=\"padding-inline:var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))\"><div class=\"flex flex-col gap-sm text-body-s text-ink-secondary tablet:flex-row tablet:items-center tablet:justify-between\"><span>Legal</span></div></div></footer>",
  "footer-legal-base": "<footer class=\"bg-surface-raised text-ink-primary py-lg border-t border-line-base\" style=\"position:relative;z-index:var(--ui-z-shell, 20);border-top-width:var(--ui-border-hairline, 1px)\"><div class=\"mx-auto flex w-full flex-col gap-lg\" style=\"padding-inline:var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))\"><div class=\"grid grid-cols-1 gap-lg tablet:grid-cols-2 desktop:grid-cols-4\"><div class=\"flex flex-col gap-sm\"><h2 class=\"text-body-s font-body font-medium\">Product</h2><div class=\"flex flex-col gap-xs\"><a href=\"/a\">A</a></div></div></div><div class=\"flex flex-col gap-sm text-body-s text-ink-secondary tablet:flex-row tablet:items-center tablet:justify-between border-t pt-lg border-line-base\"><div class=\"flex w-full flex-col items-center gap-sm text-center desktop:flex-row-reverse desktop:flex-nowrap desktop:items-center desktop:justify-between desktop:text-start\"><nav aria-label=\"Legal links\"><ul role=\"list\" class=\"m-0 flex list-none flex-wrap items-center justify-center gap-x-sm p-0 desktop:flex-nowrap desktop:justify-end\"><li><a href=\"/privacy\" class=\"inline-flex items-center justify-center px-xs text-inherit underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent\" style=\"min-height:var(--ui-layout-tap-target, 44px);min-width:var(--ui-layout-tap-target, 44px)\">Privacy</a></li></ul></nav><p class=\"m-0 desktop:whitespace-nowrap\">\u00a9 2030 Acme Studio</p></div></div></div></footer>",
  "header-inverse": "<header class=\"bg-surface-inverse py-sm border-b border-line-on-inverse\" style=\"position:relative;z-index:var(--ui-z-shell, 20);border-bottom-width:var(--ui-border-hairline, 1px)\"><div class=\"mx-auto flex w-full flex-wrap items-center justify-between gap-md\" style=\"padding-inline:var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))\"><div class=\"flex items-center gap-lg\"><a href=\"/\">Home</a><nav>Nav</nav></div><div class=\"flex items-center gap-sm\"><button type=\"button\">Go</button></div></div></header>",
  "footer-cols-inverse": "<footer class=\"bg-surface-inverse text-ink-on-inverse py-lg border-t border-line-on-inverse\" style=\"position:relative;z-index:var(--ui-z-shell, 20);border-top-width:var(--ui-border-hairline, 1px)\"><div class=\"mx-auto flex w-full flex-col gap-lg\" style=\"padding-inline:var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))\"><div class=\"grid grid-cols-1 gap-lg tablet:grid-cols-2 desktop:grid-cols-4\"><div class=\"flex flex-col gap-sm\"><h2 class=\"text-body-s font-body font-medium\">Product</h2><div class=\"flex flex-col gap-xs\"><a href=\"/a\">A</a></div></div></div><div class=\"flex flex-col gap-sm text-body-s text-ink-on-inverse-muted tablet:flex-row tablet:items-center tablet:justify-between border-t pt-lg border-line-on-inverse\"><span>Legal</span></div></div></footer>",
  "footer-secondary-inverse": "<footer class=\"bg-surface-inverse text-ink-on-inverse py-lg border-t border-line-on-inverse\" style=\"position:relative;z-index:var(--ui-z-shell, 20);border-top-width:var(--ui-border-hairline, 1px)\"><div class=\"mx-auto flex w-full flex-col gap-lg\" style=\"padding-inline:var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))\"><div class=\"flex flex-col gap-sm text-body-s text-ink-on-inverse-muted tablet:flex-row tablet:items-center tablet:justify-between\"><span>Legal</span></div></div></footer>",
  "footer-legal-inverse": "<footer class=\"bg-surface-inverse text-ink-on-inverse py-lg border-t border-line-on-inverse\" style=\"position:relative;z-index:var(--ui-z-shell, 20);border-top-width:var(--ui-border-hairline, 1px)\"><div class=\"mx-auto flex w-full flex-col gap-lg\" style=\"padding-inline:var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))\"><div class=\"grid grid-cols-1 gap-lg tablet:grid-cols-2 desktop:grid-cols-4\"><div class=\"flex flex-col gap-sm\"><h2 class=\"text-body-s font-body font-medium\">Product</h2><div class=\"flex flex-col gap-xs\"><a href=\"/a\">A</a></div></div></div><div class=\"flex flex-col gap-sm text-body-s text-ink-on-inverse-muted tablet:flex-row tablet:items-center tablet:justify-between border-t pt-lg border-line-on-inverse\"><div class=\"flex w-full flex-col items-center gap-sm text-center desktop:flex-row-reverse desktop:flex-nowrap desktop:items-center desktop:justify-between desktop:text-start\"><nav aria-label=\"Legal links\"><ul role=\"list\" class=\"m-0 flex list-none flex-wrap items-center justify-center gap-x-sm p-0 desktop:flex-nowrap desktop:justify-end\"><li><a href=\"/privacy\" class=\"inline-flex items-center justify-center px-xs text-inherit underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent\" style=\"min-height:var(--ui-layout-tap-target, 44px);min-width:var(--ui-layout-tap-target, 44px)\">Privacy</a></li></ul></nav><p class=\"m-0 desktop:whitespace-nowrap\">\u00a9 2030 Acme Studio</p></div></div></div></footer>",
  "header-default": "<header class=\"bg-surface-raised py-sm border-b border-line-base\" style=\"position:relative;z-index:var(--ui-z-shell, 20);border-bottom-width:var(--ui-border-hairline, 1px)\"><div class=\"mx-auto flex w-full flex-wrap items-center justify-between gap-md\" style=\"padding-inline:var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))\"><div class=\"flex items-center gap-lg\"><a href=\"/\">Home</a></div></div></header>",
  "footer-default": "<footer class=\"bg-surface-raised text-ink-primary py-lg border-t border-line-base\" style=\"position:relative;z-index:var(--ui-z-shell, 20);border-top-width:var(--ui-border-hairline, 1px)\"><div class=\"mx-auto flex w-full flex-col gap-lg\" style=\"padding-inline:var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))\"><div class=\"flex flex-col gap-sm text-body-s text-ink-secondary tablet:flex-row tablet:items-center tablet:justify-between\"><span>Legal</span></div></div></footer>",
};

const brand = <a href="/">Home</a>;
const columns = (
  <SiteFooter.Column heading="Product">
    <a href="/a">A</a>
  </SiteFooter.Column>
);
const legal = <SiteFooter.Legal entity="Acme Studio" links={[{ label: "Privacy", href: "/privacy" }]} linksLabel="Legal links" />;

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2030-06-15T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("site chrome: base and inverse are unchanged", () => {
  for (const ground of ["base", "inverse"] as const) {
    it(`renders ${ground} byte-identically to main`, () => {
      expect(
        html(<SiteHeader ground={ground} brand={brand} nav={<nav>Nav</nav>} actions={<button type="button">Go</button>} />),
      ).toBe(MAIN_MARKUP[`header-${ground}`]);
      expect(html(<SiteFooter ground={ground} columns={columns} secondary={<span>Legal</span>} />)).toBe(
        MAIN_MARKUP[`footer-cols-${ground}`],
      );
      expect(html(<SiteFooter ground={ground} secondary={<span>Legal</span>} />)).toBe(
        MAIN_MARKUP[`footer-secondary-${ground}`],
      );
      expect(html(<SiteFooter ground={ground} columns={columns} secondary={legal} />)).toBe(
        MAIN_MARKUP[`footer-legal-${ground}`],
      );
    });
  }

  it("keeps base as the default ground", () => {
    expect(html(<SiteHeader brand={brand} />)).toBe(MAIN_MARKUP["header-default"]);
    expect(html(<SiteFooter secondary={<span>Legal</span>} />)).toBe(MAIN_MARKUP["footer-default"]);
  });
});

/** Every class token and inline style declaration the markup carries. */
function paint(markup: string) {
  const host = document.createElement("div");
  host.innerHTML = markup;
  const classes: string[] = [];
  const styles: string[] = [];
  for (const el of Array.from(host.querySelectorAll("*"))) {
    classes.push(...Array.from(el.classList));
    const inline = el.getAttribute("style");
    if (inline) styles.push(inline);
  }
  return { classes, styles: styles.join(";") };
}

describe("site chrome: transparent ground", () => {
  const cases: ReadonlyArray<readonly [string, React.ReactElement]> = [
    ["SiteHeader", <SiteHeader ground="transparent" brand={brand} nav={<nav>Nav</nav>} actions={<button type="button">Go</button>} />],
    ["SiteFooter with columns", <SiteFooter ground="transparent" columns={columns} secondary={<span>Legal</span>} />],
    ["SiteFooter without columns", <SiteFooter ground="transparent" secondary={<span>Legal</span>} />],
    ["SiteFooter with the legal row", <SiteFooter ground="transparent" columns={columns} secondary={legal} />],
  ];

  for (const [name, node] of cases) {
    it(`${name} renders no bg-* class, no border-* class and no border-width style`, () => {
      const { classes, styles } = paint(html(node));
      expect(classes.filter((c) => /(^|:)bg-/.test(c))).toEqual([]);
      expect(classes.filter((c) => /(^|:)border(-|$)/.test(c))).toEqual([]);
      expect(styles).not.toMatch(/border/i);
      expect(styles).not.toMatch(/background/i);
    });
  }

  it("keeps the base ink", () => {
    const footer = paint(html(<SiteFooter ground="transparent" secondary={<span>Legal</span>} />));
    expect(footer.classes).toContain("text-ink-primary");
    expect(footer.classes).toContain("text-ink-secondary");
    expect(footer.classes.filter((c) => c.includes("on-inverse"))).toEqual([]);
  });

  it("still renders the landmarks, the brand slot and the children", () => {
    const markup = html(<SiteHeader ground="transparent" brand={brand} />);
    expect(markup).toContain("<header");
    expect(markup).toContain('<a href="/">Home</a>');
  });
});

describe("site chrome: transparent-inverse ground", () => {
  const cases: ReadonlyArray<readonly [string, React.ReactElement]> = [
    ["SiteHeader", <SiteHeader ground="transparent-inverse" brand={brand} nav={<nav>Nav</nav>} actions={<button type="button">Go</button>} />],
    ["SiteFooter with columns", <SiteFooter ground="transparent-inverse" columns={columns} secondary={<span>Legal</span>} />],
    ["SiteFooter without columns", <SiteFooter ground="transparent-inverse" secondary={<span>Legal</span>} />],
    ["SiteFooter with the legal row", <SiteFooter ground="transparent-inverse" columns={columns} secondary={legal} />],
  ];

  for (const [name, node] of cases) {
    it(`${name} renders no bg-* class, no border-* class and no border-width style`, () => {
      const { classes, styles } = paint(html(node));
      expect(classes.filter((c) => /(^|:)bg-/.test(c))).toEqual([]);
      expect(classes.filter((c) => /(^|:)border(-|$)/.test(c))).toEqual([]);
      expect(styles).not.toMatch(/border/i);
      expect(styles).not.toMatch(/background/i);
    });
  }

  it("carries the inverse ink on the footer and its secondary row, and no base ink", () => {
    const host = document.createElement("div");
    host.innerHTML = html(<SiteFooter ground="transparent-inverse" columns={columns} secondary={legal} />);
    const footer = host.querySelector("footer")!;
    expect(footer.classList).toContain("text-ink-on-inverse");
    expect(footer.querySelector("nav")!.closest("footer > div > div")!.classList).toContain("text-ink-on-inverse-muted");
    const { classes } = paint(host.innerHTML);
    expect(classes.filter((c) => /^text-ink-(primary|secondary|muted)$/.test(c))).toEqual([]);
  });

  it("differs from transparent only in the footer's two ink classes", () => {
    const transparent = html(<SiteFooter ground="transparent" columns={columns} secondary={legal} />);
    const inverse = html(<SiteFooter ground="transparent-inverse" columns={columns} secondary={legal} />);
    expect(inverse).toBe(
      transparent.replace("text-ink-primary", "text-ink-on-inverse").replace("text-ink-secondary", "text-ink-on-inverse-muted"),
    );
  });

  it("renders the header exactly as transparent does, since the header sets no ink", () => {
    const header = (ground: "transparent" | "transparent-inverse") =>
      html(<SiteHeader ground={ground} brand={brand} nav={<nav>Nav</nav>} actions={<button type="button">Go</button>} />);
    expect(header("transparent-inverse")).toBe(header("transparent"));
  });
});

describe("site chrome: full width", () => {
  const inners = (markup: string) => {
    const host = document.createElement("div");
    host.innerHTML = markup;
    return Array.from(host.querySelectorAll("*"));
  };

  for (const ground of ["base", "inverse", "transparent", "transparent-inverse"] as const) {
    it(`carries no max-w-* class and no maxWidth style anywhere (${ground})`, () => {
      const markup =
        html(<SiteHeader ground={ground} brand={brand} nav={<nav>Nav</nav>} actions={<span>Act</span>} />) +
        html(<SiteFooter ground={ground} columns={columns} secondary={legal} />);
      const all = inners(markup);
      expect(all.length).toBeGreaterThan(10);
      for (const el of all) {
        expect(Array.from(el.classList).filter((c) => /(^|:)max-w-/.test(c))).toEqual([]);
        expect(el.getAttribute("style") ?? "").not.toMatch(/max-width/i);
      }
    });
  }

  it("insets the header and footer inner containers only by the page-padding token", () => {
    const host = document.createElement("div");
    host.innerHTML =
      html(<SiteHeader ground="transparent" brand={brand} />) + html(<SiteFooter ground="transparent" secondary={legal} />);
    const containers = Array.from(host.querySelectorAll("header > div, footer > div"));
    expect(containers).toHaveLength(2);
    for (const el of containers) {
      expect(el.getAttribute("style")).toContain("padding-inline:var(--ui-width-page-padding-x");
      expect(el.className).toContain("w-full");
    }
  });
});
