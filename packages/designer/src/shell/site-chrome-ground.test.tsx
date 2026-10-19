import { readFileSync } from "node:fs";
import { join } from "node:path";
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
  "footer-cols-base": "<footer data-footer-root=\"\" class=\"site-footer-dark bg-surface-raised text-ink-primary py-lg border-t border-line-base\" style=\"position:relative;z-index:var(--ui-z-shell, 20);border-top-width:var(--ui-border-hairline, 1px)\"><div class=\"mx-auto flex w-full flex-col gap-lg\" style=\"padding-inline:var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))\"><div class=\"grid grid-cols-1 gap-lg tablet:grid-cols-2 desktop:grid-cols-4\"><div class=\"flex flex-col gap-sm\"><h2 class=\"text-body-s font-body font-medium\">Product</h2><div class=\"flex flex-col gap-xs\"><a href=\"/a\">A</a></div></div></div><div class=\"flex flex-col gap-sm text-body-s text-ink-secondary tablet:flex-row tablet:items-center tablet:justify-between border-t pt-lg border-line-base\"><span>Legal</span></div></div></footer>",
  "footer-secondary-base": "<footer data-footer-root=\"\" class=\"site-footer-dark bg-surface-raised text-ink-primary py-lg border-t border-line-base\" style=\"position:relative;z-index:var(--ui-z-shell, 20);border-top-width:var(--ui-border-hairline, 1px)\"><div class=\"mx-auto flex w-full flex-col gap-lg\" style=\"padding-inline:var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))\"><div class=\"flex flex-col gap-sm text-body-s text-ink-secondary tablet:flex-row tablet:items-center tablet:justify-between\"><span>Legal</span></div></div></footer>",
  "footer-legal-base": "<footer data-footer-root=\"\" class=\"site-footer-dark bg-surface-raised text-ink-primary py-lg border-t border-line-base\" style=\"position:relative;z-index:var(--ui-z-shell, 20);border-top-width:var(--ui-border-hairline, 1px)\"><div class=\"mx-auto flex w-full flex-col gap-lg\" style=\"padding-inline:var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))\"><div class=\"grid grid-cols-1 gap-lg tablet:grid-cols-2 desktop:grid-cols-4\"><div class=\"flex flex-col gap-sm\"><h2 class=\"text-body-s font-body font-medium\">Product</h2><div class=\"flex flex-col gap-xs\"><a href=\"/a\">A</a></div></div></div><div class=\"flex flex-col gap-sm text-body-s text-ink-secondary tablet:flex-row tablet:items-center tablet:justify-between border-t pt-lg border-line-base\"><div data-footer-composition=\"\" class=\"site-footer-composition\"><nav data-footer-region=\"links\" aria-label=\"Legal links\"><ul role=\"list\" class=\"m-0 flex list-none flex-wrap items-center justify-center gap-x-sm p-0\"><li><a href=\"/privacy\" class=\"inline-flex items-center justify-center px-xs text-inherit underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-on-inverse\" style=\"min-height:var(--ui-layout-tap-target, 44px);min-width:var(--ui-layout-tap-target, 44px)\">Privacy</a></li></ul></nav><div data-footer-region=\"icons\"><ul role=\"list\" dir=\"ltr\" class=\"m-0 flex list-none flex-wrap items-center justify-center gap-x-sm p-0\"></ul></div><p data-footer-region=\"copyright\" class=\"m-0\">© 2030 Acme Studio</p></div></div></div></footer>",
  "footer-cols-inverse": "<footer data-footer-root=\"\" class=\"site-footer-dark bg-surface-inverse text-ink-on-inverse py-lg border-t border-line-on-inverse\" style=\"position:relative;z-index:var(--ui-z-shell, 20);border-top-width:var(--ui-border-hairline, 1px)\"><div class=\"mx-auto flex w-full flex-col gap-lg\" style=\"padding-inline:var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))\"><div class=\"grid grid-cols-1 gap-lg tablet:grid-cols-2 desktop:grid-cols-4\"><div class=\"flex flex-col gap-sm\"><h2 class=\"text-body-s font-body font-medium\">Product</h2><div class=\"flex flex-col gap-xs\"><a href=\"/a\">A</a></div></div></div><div class=\"flex flex-col gap-sm text-body-s text-ink-on-inverse-muted tablet:flex-row tablet:items-center tablet:justify-between border-t pt-lg border-line-on-inverse\"><span>Legal</span></div></div></footer>",
  "footer-secondary-inverse": "<footer data-footer-root=\"\" class=\"site-footer-dark bg-surface-inverse text-ink-on-inverse py-lg border-t border-line-on-inverse\" style=\"position:relative;z-index:var(--ui-z-shell, 20);border-top-width:var(--ui-border-hairline, 1px)\"><div class=\"mx-auto flex w-full flex-col gap-lg\" style=\"padding-inline:var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))\"><div class=\"flex flex-col gap-sm text-body-s text-ink-on-inverse-muted tablet:flex-row tablet:items-center tablet:justify-between\"><span>Legal</span></div></div></footer>",
  "footer-legal-inverse": "<footer data-footer-root=\"\" class=\"site-footer-dark bg-surface-inverse text-ink-on-inverse py-lg border-t border-line-on-inverse\" style=\"position:relative;z-index:var(--ui-z-shell, 20);border-top-width:var(--ui-border-hairline, 1px)\"><div class=\"mx-auto flex w-full flex-col gap-lg\" style=\"padding-inline:var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))\"><div class=\"grid grid-cols-1 gap-lg tablet:grid-cols-2 desktop:grid-cols-4\"><div class=\"flex flex-col gap-sm\"><h2 class=\"text-body-s font-body font-medium\">Product</h2><div class=\"flex flex-col gap-xs\"><a href=\"/a\">A</a></div></div></div><div class=\"flex flex-col gap-sm text-body-s text-ink-on-inverse-muted tablet:flex-row tablet:items-center tablet:justify-between border-t pt-lg border-line-on-inverse\"><div data-footer-composition=\"\" class=\"site-footer-composition\"><nav data-footer-region=\"links\" aria-label=\"Legal links\"><ul role=\"list\" class=\"m-0 flex list-none flex-wrap items-center justify-center gap-x-sm p-0\"><li><a href=\"/privacy\" class=\"inline-flex items-center justify-center px-xs text-inherit underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-on-inverse\" style=\"min-height:var(--ui-layout-tap-target, 44px);min-width:var(--ui-layout-tap-target, 44px)\">Privacy</a></li></ul></nav><div data-footer-region=\"icons\"><ul role=\"list\" dir=\"ltr\" class=\"m-0 flex list-none flex-wrap items-center justify-center gap-x-sm p-0\"></ul></div><p data-footer-region=\"copyright\" class=\"m-0\">© 2030 Acme Studio</p></div></div></div></footer>",
  "footer-default": "<footer data-footer-root=\"\" class=\"site-footer-dark bg-surface-raised text-ink-primary py-lg border-t border-line-base\" style=\"position:relative;z-index:var(--ui-z-shell, 20);border-top-width:var(--ui-border-hairline, 1px)\"><div class=\"mx-auto flex w-full flex-col gap-lg\" style=\"padding-inline:var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))\"><div class=\"flex flex-col gap-sm text-body-s text-ink-secondary tablet:flex-row tablet:items-center tablet:justify-between\"><span>Legal</span></div></div></footer>",
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
      const host = document.createElement("div");
      host.innerHTML = html(<SiteHeader ground={ground} brand={brand} nav={<nav>Nav</nav>} actions={<button type="button">Go</button>} />);
      expect(host.querySelector("header")).toHaveClass("site-header-contract", ground === "base" ? "bg-surface-raised" : "bg-surface-inverse", "border-b", ground === "base" ? "border-line-base" : "border-line-on-inverse");
      expect((host.querySelector("header") as HTMLElement).style.borderBottomWidth).toBe("var(--ui-border-hairline, 1px)");
      expect(host.querySelector(".site-header-brand")).toHaveTextContent("Home");
      expect(host.querySelector("nav")).toHaveTextContent("Nav");
      expect(host.querySelector(".site-header-actions")).toHaveTextContent("Go");
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
    expect(html(<SiteHeader brand={brand} />)).toBe(html(<SiteHeader brand={brand} ground="base" />));
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
    expect(containers[0]).toHaveClass("site-header-row");
    const css = readFileSync(join(import.meta.dirname, "../../styles/theme-keys.css"), "utf8");
    expect(css).toContain("padding-inline: max(var(--ui-width-page-padding-x");
    expect(css).toContain("env(safe-area-inset-left");
    expect(css).toContain("env(safe-area-inset-right");
    expect(containers[1].getAttribute("style")).toContain("padding-inline:var(--ui-width-page-padding-x");
    expect(containers[1].className).toContain("w-full");
  });
});
