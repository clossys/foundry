import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Brandmark } from "./Brandmark.js";
import { SiteHeader } from "./SiteHeader.js";

const themeKeys = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "styles", "theme-keys.css"), "utf8");
function cssBlock(text: string, opening: string): string {
  const start = text.indexOf(opening);
  expect(start, opening).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = text.indexOf("{", start); i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error(`unterminated ${opening}`);
}

// Captured from main before adding mobileLayout.
const DEFAULT_HEADERS = {
  "leading": "<header class=\"bg-surface-raised py-sm border-b border-line-base\" style=\"position:relative;z-index:var(--ui-z-shell, 20);border-bottom-width:var(--ui-border-hairline, 1px)\"><div class=\"mx-auto flex w-full flex-wrap items-center justify-between gap-md\" style=\"padding-inline:var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))\"><div class=\"flex items-center gap-lg\"><a href=\"/\">Example</a><nav aria-label=\"Primary\"><a href=\"/about\">About</a></nav></div><div class=\"flex items-center gap-sm\"><a href=\"/sign-in\">Sign in</a><button type=\"button\">Start</button></div></div></header>",
  "centered": "<header class=\"bg-surface-raised py-sm border-b border-line-base\" style=\"position:relative;z-index:var(--ui-z-shell, 20);border-bottom-width:var(--ui-border-hairline, 1px)\"><div class=\"mx-auto flex w-full flex-wrap items-center gap-md\" style=\"padding-inline:var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))\"><div class=\"flex flex-1 items-center\"><a href=\"/\">Example</a></div><div class=\"flex items-center\"><nav aria-label=\"Primary\"><a href=\"/about\">About</a></nav></div><div class=\"flex flex-1 items-center justify-end gap-sm\"><a href=\"/sign-in\">Sign in</a><button type=\"button\">Start</button></div></div></header>"
};

function header(navPlacement: "leading" | "centered", mobileLayout?: "inline" | "menu-brand-action") {
  return <SiteHeader navPlacement={navPlacement} mobileLayout={mobileLayout}
    brand={<a href="/">Example</a>}
    nav={<nav aria-label="Primary"><a href="/about">About</a></nav>}
    secondaryAction={<a href="/sign-in">Sign in</a>}
    actions={<button type="button">Start</button>} />;
}

describe("SiteHeader mobile layout", () => {
  it.each(["leading", "centered"] as const)("uses the new mobile default and retains explicit inline bytes for %s navigation", navPlacement => {
    expect(renderToStaticMarkup(header(navPlacement))).toBe(renderToStaticMarkup(header(navPlacement, "menu-brand-action")));
    expect(renderToStaticMarkup(header(navPlacement, "inline"))).toBe(DEFAULT_HEADERS[navPlacement]);
  });

  it.each(["leading", "centered"] as const)("menu-brand-action puts nav, brand and actions in columns 1, 2 and 3 for %s navigation", navPlacement => {
    render(header(navPlacement, "menu-brand-action"));
    const row = screen.getByRole("banner").firstElementChild!;
    if (navPlacement === "centered") {
      expect(row).toHaveClass("site-header-row");
      expect(screen.getByRole("banner")).toHaveClass("site-header-contract");
      expect(screen.getByRole("link", { name: "Example" }).parentElement).toHaveClass("site-header-brand");
      expect(screen.getByRole("navigation").parentElement).toBe(row);
      expect(screen.getByRole("button", { name: "Start" }).parentElement).toHaveClass("site-header-actions");
      return;
    }
    expect(row).toHaveClass("grid", "tablet:flex", "tablet:flex-wrap");
    expect((row as HTMLElement).style.gridTemplateColumns).toBe("auto minmax(0, 1fr) auto");
    expect(screen.getByRole("link", { name: "Example" }).parentElement).toHaveClass("col-start-2", "row-start-1");
    expect(screen.getByRole("navigation").parentElement).toHaveClass("col-start-1", "row-start-1");
    expect(screen.getByRole("button", { name: "Start" }).parentElement).toHaveClass("col-start-3", "row-start-1");
  });

  it.each(["leading", "centered"] as const)("restores the %s navPlacement layout from tablet up", navPlacement => {
    render(header(navPlacement, "menu-brand-action"));
    const brand = screen.getByRole("link", { name: "Example" }).parentElement!;
    const nav = screen.getByRole("navigation").parentElement!;
    const actions = screen.getByRole("button", { name: "Start" }).parentElement!;
    if (navPlacement === "leading") {
      expect(brand).toHaveClass("tablet:contents");
      expect(nav).toHaveClass("tablet:contents");
      expect(brand.parentElement).toBe(nav.parentElement);
      expect(brand.parentElement).toHaveClass("contents", "tablet:flex", "tablet:items-center", "tablet:gap-lg");
      expect(screen.getByRole("banner").firstElementChild).toHaveClass("tablet:justify-between");
    } else {
      expect(brand).toHaveClass("site-header-brand");
      expect(nav).toHaveClass("site-header-row");
      expect(actions).toHaveClass("site-header-actions");
    }
  });

  it.each(["leading", "centered"] as const)("keeps brand, nav and actions in DOM order and a shrinkable brand track for %s navigation", navPlacement => {
    render(header(navPlacement, "menu-brand-action"));
    const brand = screen.getByRole("link", { name: "Example" });
    const nav = screen.getByRole("navigation");
    const actions = screen.getByRole("button", { name: "Start" });
    expect(brand.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(nav.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    if (navPlacement === "leading") {
      expect(brand.parentElement).toHaveClass("min-w-0", "justify-self-center");
      expect((screen.getByRole("banner").firstElementChild as HTMLElement).style.gridTemplateColumns).toBe("auto minmax(0, 1fr) auto");
    } else expect(brand.parentElement).toHaveClass("site-header-brand");
    expect(screen.getAllByRole("navigation")).toHaveLength(1);
    expect(screen.getAllByRole("banner")).toHaveLength(1);
  });

  it.each(["leading", "centered"] as const)("allows omitted optional slots with %s navigation", navPlacement => {
    render(<SiteHeader mobileLayout="menu-brand-action" navPlacement={navPlacement} brand={<a href="/">Example</a>} />);
    expect(screen.getByRole("link", { name: "Example" }).parentElement).toHaveClass(navPlacement === "leading" ? "col-start-2" : "site-header-brand");
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it.each([
    ["shared plate lockup", { variant: "lockup", wordmark: "Example", plate: "shared" }],
    ["shared plate mark", { variant: "mark", plate: "shared" }],
    ["self plate lockup", { variant: "lockup", wordmark: "Example", plate: "self" }],
    ["accent lockup", { variant: "lockup", wordmark: "Example", markInk: "accent" }],
    ["accent mark on a shared plate", { variant: "mark", plate: "shared", markInk: "accent" }],
  ] as const)("hides only the wordmark, never the mark, in the mobile brand (%s)", (_name, props) => {
    // The mobile rule hides wordmark text beside the mark. A shared plate and an
    // accent mark are spans too, so the hide selector skips the marked mark element
    // and, for a hand-written brand, any span holding an image.
    expect(MOBILE_HIDE_RULE?.[1]).toBe("span:not([data-brand-mark]):not(:has(img))");
    render(<SiteHeader mobileLayout="menu-brand-action" brand={<Brandmark size="md" label="Example home" markSrc="/mark.svg" {...props} />} />);
    const anchor = screen.getByRole("link", { name: "Example home" });
    const { hidden, shown } = mobileBrand(anchor);
    expect(shown.some(child => child.matches("[data-brand-mark]"))).toBe(true);
    expect(hidden.map(child => child.textContent)).toEqual(props.variant === "lockup" ? ["Example"] : []);
    // The wordmark is hidden, the link keeps its whole accessible name.
    expect(anchor).toHaveAccessibleName("Example home");
  });

  it("still hides the text, never the image, of a hand-written brand link", () => {
    render(<SiteHeader mobileLayout="menu-brand-action" brand={<a href="/" aria-label="Example home"><span><img src="/mark.svg" alt="" /></span><span>Example</span></a>} />);
    const { hidden, shown } = mobileBrand(screen.getByRole("link", { name: "Example home" }));
    expect(hidden.map(child => child.textContent)).toEqual(["Example"]);
    expect(shown).toHaveLength(1);
  });
});

const MOBILE_HIDE_RULE = /& \.site-header-brand a > ([^{,]+?) \{ display: none; \}/.exec(cssBlock(themeKeys, "@utility site-header-mobile {"));

/** jsdom has no :has(), so apply the mobile rule's own conditions to the brand link's children. */
function mobileBrand(anchor: HTMLElement) {
  const hidden = [...anchor.children].filter(child => child.matches(".site-header-brand a > span:not([data-brand-mark])") && !child.querySelector("img"));
  return { hidden, shown: [...anchor.children].filter(child => !hidden.includes(child)) };
}

const HEIGHTS = { sm: "var(--ui-brandmark-height-sm, 24px)", md: "var(--ui-brandmark-height-md, 36px)", lg: "var(--ui-brandmark-height-lg, 48px)" } as const;
const BRAND_FORMS = [
  ["mark-only", { variant: "mark" }],
  ["mark-only on a shared plate", { variant: "mark", plate: "shared" }],
  ["accent mark-only", { variant: "mark", markInk: "accent" }],
  ["lockup", { variant: "lockup", wordmark: "Example" }],
  ["lockup on a shared plate", { variant: "lockup", wordmark: "Example", plate: "shared" }],
  ["accent lockup", { variant: "lockup", wordmark: "Example", markInk: "accent" }],
] as const;

describe("header brand slot", () => {
  it.each((["sm", "md", "lg"] as const).flatMap(size => BRAND_FORMS.map(([name, props]) => [size, name, props] as const)))(
    "resolves a %s %s brand to the size's one mark height, at desktop and mobile",
    (size, _name, props) => {
      render(<SiteHeader mobileLayout="menu-brand-action" brand={<Brandmark size={size} label="Example home" markSrc="/mark.svg" {...props} />} />);
      const anchor = screen.getByRole("link", { name: "Example home" });
      const marks = anchor.querySelectorAll<HTMLElement>("[data-brand-mark]");
      expect(marks).toHaveLength(1);
      // The mark's box is the size token at full height; a wordmark is set smaller.
      expect(marks[0]!.style.height).toBe(HEIGHTS[size]);
      const wordmark = anchor.querySelector<HTMLElement>("[data-brand-wordmark]");
      if (wordmark) expect(wordmark.style.fontSize).toBe(`calc(${HEIGHTS[size]} * ${22 / 48})`);
      // Nothing in the header resizes the brand at either width.
      for (const opening of ["@utility site-header-mobile {", "@utility site-header-contract {", "@utility site-header-brand {"]) {
        expect(cssBlock(themeKeys, opening)).not.toMatch(/--ui-brandmark-height-\w+\s*:|\.site-header-brand[^{]*\{[^}]*(?:^|[;{\s])(?:block-size|height|font-size)\s*:/);
      }
    },
  );

  it("names a mark-only brand by its label, with no wordmark text", () => {
    render(<SiteHeader brand={<Brandmark variant="mark" size="md" label="Example home" markSrc="/mark.svg" />} />);
    const anchor = screen.getByRole("link", { name: "Example home" });
    expect(anchor).toHaveAttribute("aria-label", "Example home");
    expect(anchor.querySelector("[data-brand-wordmark]")).toBeNull();
    expect(anchor.textContent).toBe("");
  });

  it("paints an accent mark with the accent token through a mask of the mark image", () => {
    const html = renderToStaticMarkup(<Brandmark variant="lockup" wordmark="Example" size="md" label="Example home" markSrc={'/brand/mark".svg'} markInk="accent" />);
    const host = document.createElement("div");
    host.innerHTML = html;
    const anchor = host.querySelector("a")!;
    const mark = anchor.querySelector<HTMLElement>("[data-brand-mark]")!;
    expect(mark.tagName).toBe("SPAN");
    expect(mark).toHaveAttribute("aria-hidden", "true");
    expect(mark).toHaveClass("bg-accent");
    expect(anchor.querySelector("img")).toBeNull();
    // The quote is escaped, so the URL cannot end the mask value early.
    expect(html).toContain('mask-image:url(&quot;/brand/mark\\22 .svg&quot;)');
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|oklch\(/i);
  });

  it("keeps the image mark by default", () => {
    render(<Brandmark variant="mark" size="md" label="Example home" markSrc="/mark.svg" />);
    expect(screen.getByRole("link", { name: "Example home" }).querySelector("img[data-brand-mark]")).toHaveAttribute("src", "/mark.svg");
  });

  it.each([
    ["auto", "text-ink-primary"],
    ["inverse", "text-ink-on-inverse"],
  ] as const)("sets the %s wordmark in the surface's own ink token, which follows the colour scheme", (tone, ink) => {
    render(<Brandmark variant="lockup" wordmark="Example" size="md" label="Example home" markSrc="/mark.svg" markInk="accent" tone={tone} />);
    const anchor = screen.getByRole("link", { name: "Example home" });
    expect(anchor).toHaveClass(ink);
    // The wordmark inherits that ink; only the mark carries the accent.
    expect(anchor.querySelector("[data-brand-wordmark]")!.className).not.toMatch(/\b(?:text|bg)-/);
    expect(anchor.querySelector("[data-brand-mark]")).toHaveClass("bg-accent");
  });

  it("defines the wordmark and accent inks for light and dark schemes, and the mobile header leaves brand paint alone", () => {
    const tokens = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "styles", "tokens.css"), "utf8");
    const darkAt = tokens.indexOf('\n:root[data-theme="dark"] {');
    const dark = cssBlock(tokens.slice(darkAt), ':root[data-theme="dark"] {');
    for (const token of ["--color-ink-primary", "--color-ink-on-inverse", "--color-accent"]) {
      expect(tokens.indexOf(`${token}:`)).toBeLessThan(darkAt);
      expect(dark).toContain(`${token}:`);
    }
    expect(cssBlock(themeKeys, "@utility site-header-mobile {")).not.toMatch(/\.site-header-brand[^{]*\{[^}]*(?:color|background)[\w-]*\s*:/);
  });

  it("centers the mobile mark on the bar between equal edge tracks for the menu and actions", () => {
    expect(cssBlock(themeKeys, "@utility site-header-row {")).toContain("grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);");
    const mobile = cssBlock(themeKeys, "@utility site-header-mobile {");
    expect(mobile).toContain("& .site-header-brand { grid-column: 2; justify-self: center; }");
    expect(mobile).toContain("& nav { display: block; grid-column: 1; grid-row: 1; }");
    expect(mobile).toContain("& .site-header-actions { grid-column: 3; grid-row: 1; display: flex; justify-content: end; }");
  });
});