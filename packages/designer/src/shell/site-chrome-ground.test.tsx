import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { withoutDsAttrs } from "../catalog-core/provenance-attrs.js";
import { SiteFooter } from "./SiteFooter.js";
import { SiteHeader } from "./SiteHeader.js";

const brand = <a href="/">Home</a>;
const columns = (
  <SiteFooter.Column heading="Product">
    <a href="/a">A</a>
  </SiteFooter.Column>
);
const legal = <SiteFooter.Legal entity="Acme Studio" links={[{ label: "Privacy", href: "/privacy" }]} linksLabel="Legal links" />;

/** The DOM provenance stamp is asserted in `frames/frames-wiring.test.ts`. */
const html = (node: React.ReactElement) => withoutDsAttrs(renderToStaticMarkup(node));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2030-06-15T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

/** The ground paint each solid ground owns: background, hairline edge colour and ink. */
const GROUND = {
  base: { bg: "bg-card", edge: "border-border", ink: "text-foreground" },
  inverse: { bg: "bg-foreground", edge: "border-background/14", ink: "text-background" },
} as const;

function mount(node: React.ReactElement): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html(node);
  return host;
}

describe("site chrome: base and inverse grounds", () => {
  for (const ground of ["base", "inverse"] as const) {
    it(`paints the ${ground} ground on the header and every footer composition`, () => {
      const paintOf = GROUND[ground];
      const header = mount(<SiteHeader surface="solid" tone={ground} brand={brand} nav={<nav>Nav</nav>} actions={<button type="button">Go</button>} />);
      expect(header.querySelector("header")).toHaveClass("site-header-contract", paintOf.bg, paintOf.ink, "hairline-b", paintOf.edge);
      expect(header.querySelector(".site-header-brand")).toHaveTextContent("Home");
      expect(header.querySelector("nav")).toHaveTextContent("Nav");
      expect(header.querySelector(".site-header-actions")).toHaveTextContent("Go");

      for (const node of [
        <SiteFooter ground={ground} columns={columns} secondary={<span>Legal</span>} />,
        <SiteFooter ground={ground} secondary={<span>Legal</span>} />,
        <SiteFooter ground={ground} columns={columns} secondary={legal} />,
      ]) {
        const footer = mount(node).querySelector("footer")!;
        expect(footer).toHaveAttribute("data-footer-root", "");
        expect(footer).toHaveClass("site-footer-dark", paintOf.bg, paintOf.ink, "hairline-t", paintOf.edge);
      }

      const withColumns = mount(<SiteFooter ground={ground} columns={columns} secondary={<span>Legal</span>} />);
      expect(withColumns).toHaveTextContent("Product");
      expect(withColumns.querySelector('a[href="/a"]')).toHaveTextContent("A");
      expect(withColumns).toHaveTextContent("Legal");

      const withLegal = mount(<SiteFooter ground={ground} columns={columns} secondary={legal} />);
      expect(withLegal).toHaveTextContent("Acme Studio");
      expect(withLegal).toHaveTextContent("2030");
      const legalLinks = withLegal.querySelector('[aria-label="Legal links"]')!;
      const privacy = legalLinks.querySelector('a[href="/privacy"]')!;
      expect(privacy).toHaveTextContent("Privacy");
      expect(privacy).toHaveAttribute("data-variant", "link");
    });
  }

  it("keeps base as the default ground", () => {
    expect(html(<SiteHeader brand={brand} />)).toBe(html(<SiteHeader brand={brand} surface="solid" tone="base" />));
    expect(html(<SiteFooter secondary={<span>Legal</span>} />)).toBe(html(<SiteFooter ground="base" secondary={<span>Legal</span>} />));
  });
});

/**
 * Every class token and inline style declaration the chrome markup carries. A stock link
 * button (`data-variant="link"`) paints no ground of its own; it is asserted as such and its
 * anatomy (a transparent clipped border box) is not chrome paint.
 */
function paint(markup: string) {
  const host = document.createElement("div");
  host.innerHTML = markup;
  const classes: string[] = [];
  const styles: string[] = [];
  for (const stock of Array.from(host.querySelectorAll("[data-slot=button]"))) expect(stock).toHaveAttribute("data-variant", "link");
  for (const el of Array.from(host.querySelectorAll("*")).filter((node) => !node.matches("[data-slot=button][data-variant=link]"))) {
    classes.push(...Array.from(el.classList));
    const inline = el.getAttribute("style");
    if (inline) styles.push(inline);
  }
  return { classes, styles: styles.join(";") };
}

describe("site chrome: transparent ground", () => {
  const cases: ReadonlyArray<readonly [string, React.ReactElement]> = [
    ["SiteHeader", <SiteHeader surface="transparent" brand={brand} nav={<nav>Nav</nav>} actions={<button type="button">Go</button>} />],
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
    expect(footer.classes).toContain("text-foreground");
    expect(footer.classes).toContain("text-muted-foreground");
    expect(footer.classes.filter((c) => c.includes("on-inverse"))).toEqual([]);
  });

  it("still renders the landmarks, the brand slot and the children", () => {
    const markup = html(<SiteHeader surface="transparent" brand={brand} />);
    expect(markup).toContain("<header");
    expect(markup).toContain('<a href="/">Home</a>');
  });
});

describe("site chrome: transparent-inverse ground", () => {
  const cases: ReadonlyArray<readonly [string, React.ReactElement]> = [
    ["SiteHeader", <SiteHeader surface="transparent" tone="inverse" brand={brand} nav={<nav>Nav</nav>} actions={<button type="button">Go</button>} />],
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
    expect(footer.classList).toContain("text-background");
    expect(footer.querySelector("nav")!.closest("footer > div > div")!.classList).toContain("text-background/75");
    const { classes } = paint(host.innerHTML);
    expect(classes.filter((c) => /^text-ink-(primary|secondary|muted)$/.test(c))).toEqual([]);
  });

  it("differs from transparent only in the footer's two ink classes", () => {
    const transparent = html(<SiteFooter ground="transparent" columns={columns} secondary={legal} />);
    const inverse = html(<SiteFooter ground="transparent-inverse" columns={columns} secondary={legal} />);
    expect(inverse).toBe(
      transparent.replace("text-foreground", "text-background").replace("text-muted-foreground", "text-background/75"),
    );
  });

  it("applies inverse ink independently of the transparent header surface", () => {
    const header = (ground: "transparent" | "transparent-inverse") =>
      html(<SiteHeader surface={ground.startsWith("transparent") ? "transparent" : "solid"} tone={ground.endsWith("inverse") ? "inverse" : "base"} brand={brand} nav={<nav>Nav</nav>} actions={<button type="button">Go</button>} />);
    expect(header("transparent-inverse")).toContain("text-background");
    expect(header("transparent")).toContain("text-foreground");
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
        html(<SiteHeader surface={ground.startsWith("transparent") ? "transparent" : "solid"} tone={ground.endsWith("inverse") ? "inverse" : "base"} brand={brand} nav={<nav>Nav</nav>} actions={<span>Act</span>} />) +
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
      html(<SiteHeader surface="transparent" brand={brand} />) + html(<SiteFooter ground="transparent" secondary={legal} />);
    const containers = Array.from(host.querySelectorAll("header > div, footer > div"));
    expect(containers).toHaveLength(2);
    expect(containers[0]).toHaveClass("site-header-row");
    const css = readFileSync(join(import.meta.dirname, "../../styles/theme-keys.css"), "utf8");
    expect(css).toContain("padding-inline: max(var(--ui-width-page-padding-x");
    expect(css).toContain("env(safe-area-inset-left");
    expect(css).toContain("env(safe-area-inset-right");
    // The footer container insets through the page-inset-x utility over the same page-padding token.
    expect(css).toContain("@utility page-inset-x { padding-inline: var(--ui-width-page-padding-x");
    expect(containers[1]).toHaveClass("page-inset-x");
    expect(containers[1].getAttribute("style")).toBeNull();
    expect(containers[1].className).toContain("w-full");
  });
});
