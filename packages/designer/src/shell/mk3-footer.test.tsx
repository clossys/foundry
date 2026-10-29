import { act } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Icon } from "../components/Icon.js";
import { Link } from "../components/Link.server.js";
import { Globe } from "../icons/Globe.js";
import { Brandmark } from "./Brandmark.js";
import { SiteFooter } from "./SiteFooter.js";

const brand = <Brandmark variant="lockup" size="lg" label="Example home" wordmark="Example" markSrc="/example.svg" tone="inverse" />;
const fixture = () => <SiteFooter
  brand={brand}
  columns={[
    <SiteFooter.Column key="company" heading="Company"><Link href="/about">About</Link></SiteFooter.Column>,
    <SiteFooter.Column key="legal" heading="Legal"><Link href="/privacy">Privacy</Link></SiteFooter.Column>,
    <SiteFooter.Column key="connect" heading="Connect"><Link href="https://example.org/profile" aria-label="Public profile"><Icon glyph={Globe} decorative /></Link></SiteFooter.Column>,
  ]}
  secondary={<SiteFooter.Legal entity="Example" links={[]} />}
/>;

describe("MK-3 footer brand band", () => {
  it("keeps identity, labelled groups and copyright in document order", () => {
    const { container } = render(fixture());
    const footer = screen.getByRole("contentinfo");
    const body = footer.firstElementChild!;
    expect(Array.from(body.children).map(node => node.classList.contains("site-footer-columns") ? "columns" : "secondary")).toEqual(["columns", "secondary"]);
    const grid = body.querySelector(".site-footer-columns")!;
    expect(grid.children).toHaveLength(4);
    expect(grid.firstElementChild).toHaveAttribute("data-footer-brand", "");
    const band = container.querySelector("[data-footer-brand]")!;
    expect(within(band as HTMLElement).getByRole("link", { name: "Example home" })).toHaveAttribute("href", "/");
    expect(band.querySelector("img")).toHaveAttribute("src", "/example.svg");
    expect(band.querySelector("img")).toHaveAttribute("alt", "");
    expect(within(footer).getAllByRole("heading", { level: 2 }).map(node => node.textContent)).toEqual(["Company", "Legal", "Connect"]);
    expect(footer.querySelector("[data-footer-region=copyright]")?.textContent).toBe(`© ${new Date().getFullYear()} Example`);
    const profile = screen.getByRole("link", { name: "Public profile" });
    expect(profile).toHaveAttribute("rel", "noopener noreferrer");
    expect(profile.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(profile.querySelectorAll("svg path, svg circle").length).toBeGreaterThan(0);
    expect(profile.textContent).toBe("");
  });

  it("retains native links in reading and keyboard order without an extra trigger", async () => {
    const user = userEvent.setup();
    render(fixture());
    for (const name of ["Example home", "About", "Privacy", "Public profile"]) {
      await user.tab();
      expect(screen.getByRole("link", { name })).toHaveFocus();
    }
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("hydrates the same band, registered artwork and reading order without recoverable errors", async () => {
    const host = document.createElement("div");
    host.innerHTML = renderToString(fixture());
    document.body.append(host);
    const before = host.querySelector("footer")!.innerHTML;
    const errors: unknown[] = [];
    let root: Root | undefined;
    try {
      await act(async () => { root = hydrateRoot(host, fixture(), { onRecoverableError: error => errors.push(error) }); });
      expect(errors).toEqual([]);
      expect(host.querySelector("footer")!.innerHTML).toBe(before);
      expect(host.querySelectorAll("[data-footer-brand]")).toHaveLength(1);
    } finally {
      await act(async () => root?.unmount());
      host.remove();
    }
  });

  it("preserves the existing footer composition when no brand band is provided", () => {
    const { container } = render(<SiteFooter secondary={<SiteFooter.Legal entity="Example" links={[]} />} />);
    expect(container.querySelector("[data-footer-brand]")).toBeNull();
    expect(container.querySelector(".site-footer-columns")).toBeNull();
    expect(screen.getByRole("contentinfo").querySelectorAll("[data-footer-composition]")).toHaveLength(1);
  });

  it("renders a standalone brand band for a footer with no grouped links", () => {
    const { container } = render(<SiteFooter brand={brand} secondary={<SiteFooter.Legal entity="Example" links={[]} />} />);
    expect(container.querySelector(".site-footer-columns")).toBeNull();
    expect(screen.getByRole("contentinfo").firstElementChild?.firstElementChild).toHaveAttribute("data-footer-brand", "");
  });
});

/** Read balanced CSS blocks so nested container rules stay with their owner. */
function cssBlock(source: string, opening: string): string {
  const start = source.indexOf(opening);
  if (start < 0) throw new Error(`Missing footer rule: ${opening}`);
  const brace = source.indexOf("{", start);
  let depth = 0;
  for (let index = brace; index < source.length; index++) {
    if (source[index] === "{") depth++;
    if (source[index] === "}" && --depth === 0) return source.slice(brace + 1, index);
  }
  throw new Error("Unterminated footer rule");
}

/** Evaluate only the grid declarations and matching width conditions in this real rule. */
function columnsAtWidth(rule: string, width: number): number {
  let active = "";
  const declaration = /grid-template-columns\s*:\s*([^;]+);/g;
  const apply = (source: string) => {
    for (const match of source.matchAll(declaration)) active = match[1]!.trim();
  };
  const container = /@container\s*\(min-width:\s*([\d.]+)px\)\s*\{([^{}]*)\}/g;
  apply(rule.replace(container, ""));
  for (const match of rule.matchAll(container)) if (width >= Number(match[1])) apply(match[2]!);
  if (/^minmax\(0,\s*1fr\)$/.test(active)) return 1;
  const repeat = /^repeat\((\d+),\s*minmax\(0,\s*1fr\)\)$/.exec(active);
  if (!repeat) throw new Error(`Unsupported footer grid: ${active}`);
  return Number(repeat[1]);
}

describe("MR-9 footer responsive rules", () => {
  const theme = readFileSync(join(import.meta.dirname, "../../styles/theme-keys.css"), "utf8");
  const compiled = readFileSync(join(import.meta.dirname, "../../styles/compiled.css"), "utf8");
  const widths = [1440, 768, 390];

  it("uses the footer width to resolve four, two and one columns in authored and shipped CSS", () => {
    expect(cssBlock(theme, "@utility site-footer-dark {")).toMatch(/container-type:\s*inline-size\s*;/);
    for (const [source, opening] of [[theme, "@utility site-footer-columns {"], [compiled, ".site-footer-columns {"]] as const) {
      const rule = cssBlock(source, opening);
      expect(rule).toMatch(/display:\s*grid\s*;/);
      expect(widths.map(width => columnsAtWidth(rule, width))).toEqual([4, 2, 1]);
      expect([767, 768, 1279, 1280].map(width => columnsAtWidth(rule, width))).toEqual([1, 2, 2, 4]);
    }
  });

  it("rejects the specified fixed-four-column mutation", () => {
    const actual = cssBlock(theme, "@utility site-footer-columns {");
    const fixed = actual.replace(/@container\s*\([^)]*\)\s*\{[^{}]*\}/g, "")
      .replace(/grid-template-columns\s*:\s*[^;]+;/, "grid-template-columns: repeat(4, minmax(0, 1fr));");
    expect(widths.map(width => columnsAtWidth(fixed, width))).toEqual([4, 4, 4]);
    expect(widths.map(width => columnsAtWidth(fixed, width))).not.toEqual([4, 2, 1]);
  });
});
