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
    expect(shown).toContain(anchor.firstElementChild);
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

  it.each([375, 767, 768, 1279, 1280])("keeps exactly one responsive artwork paint source visible in the default home link at %ipx", width => {
    const compiled = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "styles", "compiled.css"), "utf8");
    // jsdom does not evaluate media queries. Select the shipped rules at the
    // tested viewport, then let its CSS engine apply their actual selectors.
    const hideSelector = ".site-header-contract[data-header-root] .site-header-brand a > span:not([data-brand-mark]):not(:has(img))";
    const narrow = cssBlock(compiled.slice(compiled.lastIndexOf("@media", compiled.indexOf(hideSelector))), "@media (width < 768px) {");
    const desktop = cssBlock(compiled, "@media (width >= 1280px) {");
    const style = document.createElement("style");
    style.textContent = cssBlock(compiled, "  .hidden {") + cssBlock(compiled, "  .inline-flex {")
      + (width < 768 ? cssBlock(narrow, "    .site-header-contract[data-header-root] .site-header-brand a > span:not([data-brand-mark]):not(:has(img)) {") : "")
      + (width >= 1280 ? cssBlock(desktop, "    .desktop\\:block {") + cssBlock(desktop, "    .desktop\\:hidden {") : "");
    document.head.append(style);
    try {
      render(<SiteHeader brand={<Brandmark variant="lockup" size="sm" label="Example home" wordmark="Example"
        markSrc="/mark.svg" presentation="responsive"
        geometry={{ viewBox: { x: 0, y: 0, width: 100, height: 100 }, paintedBounds: { x: 10, y: 10, width: 80, height: 80 } }} />} />);
      const anchor = screen.getByRole("link", { name: "Example home" });
      expect(anchor).toHaveAttribute("href", "/");
      const visiblePaint = [...anchor.querySelectorAll<HTMLElement>("img, [style*='mask-image']")].filter(source => {
        for (let node: HTMLElement | null = source; node; node = node.parentElement) {
          if (getComputedStyle(node).display === "none" || getComputedStyle(node).visibility === "hidden") return false;
          if (node === anchor) return true;
        }
        return false;
      });
      expect(visiblePaint).toHaveLength(1);
      expect(anchor.closest("header")?.querySelectorAll('a[href="/"]')).toHaveLength(1);
    } finally {
      style.remove();
    }
  });
});

const MOBILE_HIDE_RULE = /& \.site-header-brand a > ([^{,]+?) \{ display: none; \}/.exec(cssBlock(themeKeys, "@utility site-header-mobile {"));

/** jsdom has no :has(), so apply the mobile rule's own conditions to the brand link's children. */
function mobileBrand(anchor: HTMLElement) {
  const hidden = [...anchor.children].filter(child => child.matches(".site-header-brand a > span:not([data-brand-mark])") && !child.querySelector("img"));
  return { hidden, shown: [...anchor.children].filter(child => !hidden.includes(child)) };
}

/** Brandmark renders the mark first and, for a lockup, the wordmark second. */
const markOf = (anchor: HTMLElement) => anchor.children[0] as HTMLElement;
const wordmarkOf = (anchor: HTMLElement) => anchor.children[1] as HTMLElement | undefined;

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
      expect(anchor.children).toHaveLength(props.variant === "lockup" ? 2 : 1);
      // The mark's box is the size token at full height; a wordmark is set smaller.
      expect(markOf(anchor).style.height).toBe(HEIGHTS[size]);
      const wordmark = wordmarkOf(anchor);
      if (props.variant === "lockup") expect(wordmark!.style.fontSize).toBe(`calc(${HEIGHTS[size]} * ${22 / 48})`);
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
    expect(anchor.children).toHaveLength(1);
    expect(anchor.textContent).toBe("");
  });

  it("paints an accent mark with the accent token through a mask of the mark image", () => {
    const html = renderToStaticMarkup(<Brandmark variant="lockup" wordmark="Example" size="md" label="Example home" markSrc={'/brand/mark".svg'} markInk="accent" />);
    const host = document.createElement("div");
    host.innerHTML = html;
    const anchor = host.querySelector("a")!;
    const mark = markOf(anchor);
    expect(mark.tagName).toBe("SPAN");
    expect(mark).toHaveAttribute("data-brand-mark", "");
    expect(mark).toHaveAttribute("aria-hidden", "true");
    expect(mark).toHaveClass("bg-accent");
    expect(anchor.querySelector("img")).toBeNull();
    // The quote is escaped, so the URL cannot end the mask value early.
    expect(html).toContain('mask-image:url(&quot;/brand/mark\\22 .svg&quot;)');
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|oklch\(/i);
  });

  it("keeps the image mark, and its markup, by default for a Brandmark outside a header", () => {
    render(<Brandmark variant="mark" size="md" label="Example home" markSrc="/mark.svg" />);
    const mark = markOf(screen.getByRole("link", { name: "Example home" }));
    expect(mark.tagName).toBe("IMG");
    expect(mark).toHaveAttribute("src", "/mark.svg");
    expect(mark).not.toHaveAttribute("data-brand-mark");
  });

  const HEADER_BRANDS = [
    ["mark-only", { variant: "mark" }],
    ["mark-only on a shared plate", { variant: "mark", plate: "shared" }],
    ["lockup", { variant: "lockup", wordmark: "Example" }],
    ["lockup on a shared plate", { variant: "lockup", wordmark: "Example", plate: "shared" }],
  ] as const;
  const HEADER_CASES = (["inline", "menu-brand-action"] as const).flatMap(mobileLayout => HEADER_BRANDS.map(([name, props]) => [name, mobileLayout, props] as const));

  it.each(HEADER_CASES)("paints a %s header logomark in the accent token by default (%s layout, server and client)", (_name, mobileLayout, props) => {
    const element = <SiteHeader mobileLayout={mobileLayout} brand={<Brandmark size="md" label="Example home" markSrc="/mark.svg" {...props} />} />;
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(element);
    const { container } = render(element);
    for (const root of [host, container]) {
      const anchor = root.querySelector<HTMLElement>('a[aria-label="Example home"]')!;
      expect(anchor).toHaveAccessibleName("Example home");
      expect(anchor.querySelector("img")).toBeNull();
      const mark = markOf(anchor);
      expect(mark).toHaveAttribute("data-brand-mark", "");
      expect(mark.matches(".bg-accent") || mark.querySelector(".bg-accent") !== null).toBe(true);
      // jsdom drops mask properties on the client, so read the paint from the server markup.
      if (root === host) expect((mark.matches("[style*=mask]") ? mark : mark.querySelector("[style*=mask]"))!.getAttribute("style")).toContain('mask-image:url("/mark.svg")');
      // In the menu-brand-action layout the wordmark hides below tablet and the accent
      // mark stays, centred on the bar; the inline layout hides nothing.
      const { hidden, shown } = mobileBrand(anchor);
      expect(shown[0]).toBe(mark);
      expect(hidden.map(child => child.textContent)).toEqual(mobileLayout === "menu-brand-action" && props.variant === "lockup" ? ["Example"] : []);
    }
  });

  it.each(HEADER_CASES)("keeps a %s header logomark as the image when markInk=\"image\" opts out (%s layout)", (_name, mobileLayout, props) => {
    render(<SiteHeader mobileLayout={mobileLayout} brand={<Brandmark size="md" label="Example home" markSrc="/mark.svg" markInk="image" {...props} />} />);
    const anchor = screen.getByRole("link", { name: "Example home" });
    expect(anchor.querySelector("img")).toHaveAttribute("src", "/mark.svg");
    expect(anchor.querySelector("[data-brand-mark]")).toBeNull();
    expect(anchor.querySelector(".bg-accent")).toBeNull();
    // The opted-out image mark also stays visible on mobile.
    expect(mobileBrand(anchor).shown[0]).toBe(markOf(anchor));
  });

  it("keeps an explicit tone and accent default together in the header", () => {
    render(<SiteHeader brand={<Brandmark variant="lockup" wordmark="Example" size="md" label="Example home" markSrc="/mark.svg" tone="inverse" />} />);
    const anchor = screen.getByRole("link", { name: "Example home" });
    expect(anchor).toHaveClass("text-ink-on-inverse");
    expect(markOf(anchor)).toHaveClass("bg-accent");
  });

  it.each([
    ["auto", "text-ink-primary"],
    ["inverse", "text-ink-on-inverse"],
  ] as const)("sets the %s wordmark in the surface's own ink token, which follows the colour scheme", (tone, ink) => {
    render(<Brandmark variant="lockup" wordmark="Example" size="md" label="Example home" markSrc="/mark.svg" markInk="accent" tone={tone} />);
    const anchor = screen.getByRole("link", { name: "Example home" });
    expect(anchor).toHaveClass(ink);
    // The wordmark inherits that ink; only the mark carries the accent.
    expect(wordmarkOf(anchor)!.className).not.toMatch(/\b(?:text|bg)-/);
    expect(markOf(anchor)).toHaveClass("bg-accent");
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
