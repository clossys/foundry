import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { SITE_FOOTER_LIMITS, SiteFooter, SiteFooterContractError, type SiteFooterLegalProps } from "./SiteFooter.js";
import { UI_LAYOUT_TAP_TARGET } from "./internal/shell-vars.js";

describe("SiteFooter", () => {
  it("renders grouped link columns and a secondary row", () => {
    render(
      <SiteFooter
        columns={
          <>
            <SiteFooter.Column heading="Product">
              <a href="/features">Features</a>
              <a href="/pricing">Pricing</a>
            </SiteFooter.Column>
            <SiteFooter.Column heading="Company">
              <a href="/about">About</a>
            </SiteFooter.Column>
          </>
        }
        secondary={<span>© 2026 Acme</span>}
      />,
    );
    expect(screen.getByRole("heading", { name: "Product" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Company" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Features" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "About" })).toBeInTheDocument();
    expect(screen.getByText("© 2026 Acme")).toBeInTheDocument();
  });

  it("registers as the page's contentinfo landmark", () => {
    render(<SiteFooter secondary={<span>© 2026 Acme</span>} />);
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
  });

  it("renders with only columns, or only secondary", () => {
    const { rerender } = render(
      <SiteFooter columns={<SiteFooter.Column heading="Product"><a href="/x">X</a></SiteFooter.Column>} />,
    );
    expect(screen.getByRole("heading", { name: "Product" })).toBeInTheDocument();

    rerender(<SiteFooter secondary={<span>Legal</span>} />);
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.getByText("Legal")).toBeInTheDocument();
  });

  it("resets the browser heading margin on column headings", () => {
    render(<SiteFooter columns={<SiteFooter.Column heading="Product"><a href="/x">X</a></SiteFooter.Column>} />);
    expect(screen.getByRole("heading", { name: "Product" })).toHaveClass("m-0");
  });

  it("lays the columns out on the footer container instead of viewport breakpoints", () => {
    const { container } = render(<SiteFooter columns={<SiteFooter.Column heading="Product"><a href="/x">X</a></SiteFooter.Column>} />);
    const grid = container.querySelector("[data-footer-root] > div > div")!;
    expect(grid).toHaveClass("site-footer-columns");
    expect(grid.className).not.toMatch(/(?:^|\s)(?:tablet|desktop|mobile|wide)[-a-z]*:/);
  });

  it("forwards className merged with its own built-in classes", () => {
    render(<SiteFooter secondary={<span>Legal</span>} className="my-footer" />);
    expect(screen.getByRole("contentinfo").className).toContain("my-footer");
  });
});

describe("SiteFooter.Legal", () => {
  const links = [
    { label: "Privacy", href: "/privacy" },
    { label: "Terms", href: "/terms" },
  ] as const;

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderLegal(props: Partial<SiteFooterLegalProps> = {}) {
    return render(
      <SiteFooter secondary={<SiteFooter.Legal entity="Acme Studio" links={links} {...props} />} />,
    );
  }

  it("renders one copyright string with the current year and the entity", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2031-06-15T12:00:00Z"));
    const { container } = renderLegal();
    expect(container.querySelector("p")?.textContent).toBe("© 2031 Acme Studio");
    expect(screen.getByText("© 2031 Acme Studio")).toBeInTheDocument();
  });

  it("recomputes the year at render when the clock moves", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2031-06-15T12:00:00Z"));
    const first = renderLegal();
    expect(first.container.querySelector("p")?.textContent).toBe("© 2031 Acme Studio");
    first.unmount();

    vi.setSystemTime(new Date("2044-03-02T12:00:00Z"));
    const second = renderLegal();
    expect(second.container.querySelector("p")?.textContent).toBe("© 2044 Acme Studio");
  });

  it("places the links before the copyright in DOM order", () => {
    const { container } = renderLegal();
    const list = container.querySelector("ul");
    const copyright = container.querySelector("p");
    expect(list).not.toBeNull();
    expect(copyright).not.toBeNull();
    expect(list!.compareDocumentPosition(copyright!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("owns named composition regions in phone reading order", () => {
    const { container } = renderLegal();
    const row = container.querySelector("[data-footer-composition]");
    expect(row).not.toBeNull();
    expect(Array.from(row!.children).map(node => node.getAttribute("data-footer-region"))).toEqual(["links", "icons", "copyright"]);
    expect(row).toHaveClass("site-footer-composition");
  });

  it("renders every link as a real anchor with a 44px minimum tap target", () => {
    renderLegal();
    for (const { label, href } of links) {
      const link = screen.getByRole("link", { name: label });
      expect(link.tagName).toBe("A");
      expect(link).toHaveAttribute("href", href);
      expect(link.style.minHeight).toBe(UI_LAYOUT_TAP_TARGET);
      expect(link.style.minWidth).toBe(UI_LAYOUT_TAP_TARGET);
      expect(link.className).not.toContain("min-h-[");
      expect(link.className).not.toContain("min-w-[");
      expect(link.className).toContain("focus-visible:outline-2");
    }
  });

  it("wraps the links in a labelled nav only when linksLabel is given", () => {
    const { unmount } = renderLegal({ linksLabel: "Legal links" });
    const nav = screen.getByRole("navigation", { name: "Legal links" });
    expect(within(nav).getAllByRole("link")).toHaveLength(2);
    unmount();

    renderLegal();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  it("never renders children or a disclaimer forced past the type system", () => {
    // The compile-time half lives in internal/site-footer-legal-contract.check.tsx.
    const forced = {
      entity: "Acme Studio",
      links,
      children: <span>stray child</span>,
      disclaimer: "stray disclaimer",
      className: "stray-class",
      style: { color: "red" },
      "data-stray": "yes",
    } as unknown as SiteFooterLegalProps;
    const { container } = render(<SiteFooter secondary={<SiteFooter.Legal {...forced} />} />);
    expect(screen.queryByText("stray child")).not.toBeInTheDocument();
    expect(screen.queryByText("stray disclaimer")).not.toBeInTheDocument();
    expect(container.querySelector(".stray-class")).toBeNull();
    expect(container.querySelector("[data-stray]")).toBeNull();
    expect(container.querySelector("[style*='red']")).toBeNull();
  });

  it("composes inside the unchanged secondary slot", () => {
    render(
      <SiteFooter
        columns={<SiteFooter.Column heading="Product"><a href="/x">X</a></SiteFooter.Column>}
        secondary={<SiteFooter.Legal entity="Acme Studio" links={links} />}
      />,
    );
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByRole("link", { name: "Privacy" })).toBeInTheDocument();
    expect(within(footer).getByRole("heading", { name: "Product" })).toBeInTheDocument();
  });
});


describe("SiteFooter mandatory dark composition", () => {
  const options = {
    icons: [{ href: "https://example.org/profile", label: "Community profile", icon: <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 12h16" /></svg> }],
    home: { href: "/", label: "Example home", markSrc: "/dark-mark.svg" },
  };
  function fixture(entity = "Example", labels = ["Privacy", "Terms"]) {
    return <SiteFooter secondary={<SiteFooter.Legal entity={entity} links={labels.map((label, i) => ({ href: i ? "/terms" : "/privacy", label }))} {...options} />} />;
  }
  it("puts social before the home mark inside the icon group with named destinations and safe external rel", () => {
    const { container } = render(fixture());
    const icons = container.querySelector('[data-footer-region="icons"]')!;
    expect(Array.from(icons.querySelectorAll("a")).map(a => [a.getAttribute("aria-label"), a.getAttribute("href")])).toEqual([
      ["Community profile", "https://example.org/profile"], ["Example home", "/"],
    ]);
    expect(within(icons as HTMLElement).getByRole("link", { name: "Example home" }).querySelector("img")).toHaveAttribute("src", "/dark-mark.svg");
    expect(screen.getByRole("link", { name: "Community profile" })).toHaveAttribute("rel", "noopener noreferrer");
    for (const name of ["Privacy", "Terms", "Community profile", "Example home"]) {
      expect(screen.getByRole("link", { name })).not.toHaveClass("underline");
    }
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector('[data-consent], [data-privacy-choices]')).toBeNull();
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
  });
  it("allows empty lists without adding a heading or trigger", () => {
    render(<SiteFooter secondary={<SiteFooter.Legal entity="Example" links={[]} icons={[]} />} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("refuses blank names and unsafe, missing or noncanonical destinations on every footer-owned anchor", () => {
    const noncanonical = [" https://example.org/profile", "https://example.org/profile ", "https://example.org/\tprofile", "\nhttps://example.org/profile"];
    for (const replacement of [{ label: " " }, { href: "" }, { href: "javascript:alert(1)" }, ...noncanonical.map(href => ({ href }))]) {
      expect(() => render(<SiteFooter.Legal entity="Example" links={[]} icons={[{ ...options.icons[0], ...replacement }]} />)).toThrow(TypeError);
      expect(() => render(<SiteFooter.Legal entity="Example" links={[]} home={{ ...options.home, ...replacement }} />)).toThrow(TypeError);
      expect(() => render(<SiteFooter.Legal entity="Example" links={[{ label: "Privacy", href: "/privacy", ...replacement }]} />)).toThrow(TypeError);
    }
  });
  it("classifies external column anchors the way the browser parses them", () => {
    const hrefs = [" https://example.org/a", "HTTPS://example.org/b", "\\\\example.org/c", "/\\example.org/d", "https:example.org/e"];
    render(<SiteFooter columns={<SiteFooter.Column heading="Resources">{hrefs.map((href, i) => <a key={i} href={href}>{`Doc ${i}`}</a>)}<a href="/local">Local</a><a href="mailto:team@example.org">Mail</a></SiteFooter.Column>} />);
    hrefs.forEach((_, i) => expect(screen.getByRole("link", { name: `Doc ${i}` })).toHaveAttribute("rel", "noopener noreferrer"));
    for (const name of ["Local", "Mail"]) expect(screen.getByRole("link", { name })).not.toHaveAttribute("rel");
  });
  it("keeps dark paint, inverse focus and safe areas in its shipped CSS", () => {
    const css = readFileSync(join(import.meta.dirname, "../../styles/compiled.css"), "utf8");
    expect(css).toContain(".site-footer-dark");
    expect(css).toContain(".site-footer-composition");
    expect(css).toContain("env(safe-area-inset-bottom");
    expect(css).toContain(":visited");
    expect(css).toContain("forced-colors: active");
  });

  const theme = readFileSync(join(import.meta.dirname, "../../styles/theme-keys.css"), "utf8");
  function block(source: string, opening: string) {
    const start = source.indexOf(opening);
    expect(start, opening).toBeGreaterThanOrEqual(0);
    let depth = 0;
    for (let i = source.indexOf("{", start); i < source.length; i++) {
      if (source[i] === "{") depth++;
      if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error(`Unterminated footer CSS: ${opening}`);
  }
  const rule = (opening: string) => block(theme, opening);
  const breakpoint = (name: string) => theme.match(new RegExp(`--breakpoint-${name}:\\s*([^;]+);`))![1]!.trim();
  const containerQueries = (css: string) => Array.from(css.matchAll(/@container\s*\(min-width:\s*([^)]+)\)/g), match => match[1]!.trim());
  const wide = () => block(rule("@utility site-footer-composition {"), "@container");

  it("uses centered bounded tracks with links between copyright and icons, then collapses to reading order", () => {
    const composition = rule("@utility site-footer-composition {");
    // Narrow footers place regions in DOM order (links, icons, copyright); named areas exist only on the wide row.
    expect(composition.replace(wide(), "")).not.toContain("grid-template-areas");
    expect(composition.replace(wide(), "")).not.toContain("grid-area");
    expect(composition).toContain("min-width: 0");
    expect(wide()).toContain('grid-template-areas: "copyright links icons"');
    expect(wide()).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 2fr\) minmax\(max-content, 1fr\)/);
    expect(wide()).toContain("align-items: center");
    expect(wide()).toContain("justify-content: flex-end");
  });
  it("stacks links, then icons, then copyright, all centred, below the desktop breakpoint", () => {
    const { container } = render(fixture());
    const row = container.querySelector("[data-footer-composition]")!;
    expect(Array.from(row.children).map(node => node.getAttribute("data-footer-region"))).toEqual(["links", "icons", "copyright"]);
    for (const region of ["links", "icons"]) {
      expect(row.querySelector(`[data-footer-region="${region}"] > ul`)).toHaveClass("justify-center", "items-center");
    }
    const composition = rule("@utility site-footer-composition {");
    const narrow = composition.replace(wide(), "");
    expect(narrow).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(narrow).toContain("text-align: center");
    expect(narrow).toContain("justify-items: center");
    expect(narrow).toMatch(/& > \* \{[^}]*max-width: 100%/);
    expect(narrow).not.toMatch(/\border\s*:/);
    expect(wide()).toContain("justify-items: stretch");
  });
  it("follows the document direction instead of forcing left-to-right", () => {
    const composition = rule("@utility site-footer-composition {");
    expect(composition).not.toMatch(/direction\s*:/);
    // Every footer utility, not just the composition: physical properties and physical VALUES both pin a side.
    const footerCss = ["site-footer-dark", "site-footer-columns", "site-footer-composition"].map(name => rule(`@utility ${name} {`)).join("\n");
    expect(footerCss).not.toMatch(/(?:^|[\s;{-])(?:left|right)\s*:|(?:margin|padding|border)-(?:left|right)/);
    expect(footerCss).not.toMatch(/(?:justify-content|justify-items|justify-self|align-self|text-align|float|clear)\s*:\s*(?:left|right)\b/);
    const { container } = render(<div dir="rtl">{fixture()}</div>);
    const footer = container.querySelector("footer")!;
    expect(footer.querySelector("[dir]")).toBeNull();
    // Home is the last icon in DOM order, so it lands at the inline end in either direction.
    const icons = Array.from(footer.querySelectorAll('[data-footer-region="icons"] li'));
    expect(icons.at(-1)!.querySelector("a")).toHaveAttribute("aria-label", "Example home");
    expect(wide()).toContain("text-align: start");
  });
  it("aligns the inline-end icon art to the page gutter on wide footers", () => {
    const end = block(wide(), '& > [data-footer-region="icons"] li:last-child > a {');
    expect(end).toContain("justify-content: flex-end");
    expect(end).toContain("padding-inline-end: 0");
  });
  it("switches legal row and link columns from one breakpoint source on the footer container", () => {
    const columns = rule("@utility site-footer-columns {");
    const legal = containerQueries(rule("@utility site-footer-composition {"));
    const grid = containerQueries(columns);
    expect(legal).toEqual([breakpoint("desktop")]);
    expect(grid).toEqual([breakpoint("tablet"), breakpoint("desktop")]);
    expect(block(columns, `@container (min-width: ${breakpoint("desktop")}) {`)).toContain("grid-template-columns: repeat(4, minmax(0, 1fr))");
    expect(block(columns, `@container (min-width: ${breakpoint("tablet")}) {`)).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(rule("@utility site-footer-dark {")).toContain("container-type: inline-size");
  });
  it("keeps the wide icon row on one line and never breaks the copyright mid-word", () => {
    const composition = rule("@utility site-footer-composition {");
    expect(composition).not.toContain("overflow-wrap: anywhere");
    expect(block(wide(), '& > [data-footer-region="icons"] > ul {')).toContain("flex-wrap: nowrap");
  });
  it("shows the home artwork on a page-ground plate so page-ground marks read on the dark footer", () => {
    const { container } = render(fixture());
    const home = screen.getByRole("link", { name: "Example home" });
    const plate = home.querySelector("[data-footer-home-plate]")!;
    expect(plate).not.toBeNull();
    expect(plate).toHaveClass("bg-surface-base");
    expect(plate).toHaveAttribute("aria-hidden", "true");
    expect(plate.querySelector("img")).toHaveAttribute("src", "/dark-mark.svg");
    expect(plate.getAttribute("style")).toContain("var(--ui-brandmark-height-sm");
    expect(container.querySelectorAll("[data-footer-home-plate]")).toHaveLength(1);
  });
  it("selects dark brand roles separately for light, explicit dark and OS dark themes", () => {
    const paint = rule("@utility site-footer-dark {");
    expect(paint).toContain("--site-footer-surface: var(--color-surface-inverse,");
    // OS dark applies only inside the prefers-color-scheme media block, in source and in shipped CSS.
    const osDark = block(paint, "@media (prefers-color-scheme: dark) {");
    expect(osDark).toContain(':root:not([data-theme="light"]) &[data-footer-root] {');
    const compiled = readFileSync(join(import.meta.dirname, "../../styles/compiled.css"), "utf8");
    const shippedOsDark = Array.from(compiled.matchAll(/@media \(prefers-color-scheme: dark\) \{/g), m => block(compiled.slice(m.index), "@media"))
      .filter(media => media.includes('.site-footer-dark[data-footer-root]'));
    expect(shippedOsDark).toHaveLength(1);
    expect(shippedOsDark[0]).toContain(':root:not([data-theme="light"]) .site-footer-dark[data-footer-root]');
    expect(shippedOsDark[0]).toContain("--site-footer-surface: var(--color-surface-base,");
    for (const [selector, source] of [[':root[data-theme="dark"] &[data-footer-root]', paint], [':root:not([data-theme="light"]) &[data-footer-root]', osDark]] as const) {
      const dark = block(source, `${selector} {`);
      expect(dark).toContain("--site-footer-surface: var(--color-surface-base,");
      expect(dark).toContain("--site-footer-ink: var(--color-ink-primary,");
      expect(dark).toContain("--site-footer-muted: var(--color-ink-secondary,");
    }
    const { container } = render(fixture());
    expect(container.querySelector("footer")).toHaveClass("site-footer-dark");
    expect(container.querySelector("[data-theme]")).toBeNull();
    expect(paint).toContain("background-color: var(--site-footer-surface, var(--color-surface-inverse, oklch(0.2178 0 0)))");
    expect(paint).toContain("env(safe-area-inset-bottom");
    for (const state of ["a:visited", "a:hover", "a:active"]) expect(paint).toContain(state);
    expect(paint).toContain("outline: var(--ui-border-rule, 2px) solid var(--site-footer-ink, var(--color-ink-on-inverse, oklch(0.9702 0 0)))");
    expect(paint).toContain("@media (forced-colors: active)");
    expect(paint).toContain("@media (prefers-reduced-motion: reduce)");
  });
  it("adds rel safety to external legal and supported column anchors", () => {
    render(<SiteFooter columns={<SiteFooter.Column heading="Resources"><a href="https://example.org/docs" target="_blank">Docs</a></SiteFooter.Column>}
      secondary={<SiteFooter.Legal entity="Example" links={[{ label: "Policy", href: "//example.org/policy" }]} />} />);
    for (const name of ["Docs", "Policy"]) expect(screen.getByRole("link", { name })).toHaveAttribute("rel", "noopener noreferrer");
  });
  it("retains server and client reading order and authored image attributes", () => {
    const html = renderToStaticMarkup(fixture());
    const { container } = render(fixture());
    const server = document.createElement("div"); server.innerHTML = html;
    const facts = (root: HTMLElement) => Array.from(root.querySelectorAll("[data-footer-region], a, img")).map(e => [e.tagName, e.getAttribute("data-footer-region"), e.getAttribute("href"), e.getAttribute("aria-label"), e.getAttribute("alt")]);
    expect(facts(server)).toEqual(facts(container));
  });
});

describe("SiteFooter configuration contract (FOOTER-2)", () => {
  const glyph = <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 12h16" /></svg>;
  const linkList = (count: number) => Array.from({ length: count }, (_, i) => ({ label: `Page ${i + 1}`, href: `/page-${i + 1}` }));
  const iconList = (count: number) => Array.from({ length: count }, (_, i) => ({ label: `Profile ${i + 1}`, href: `https://example.org/p${i + 1}`, icon: glyph }));
  const home = { label: "Example home", href: "/", markSrc: "/mark.svg" };
  const legal = (props: Partial<SiteFooterLegalProps>) => <SiteFooter secondary={<SiteFooter.Legal entity="Example" links={[]} {...props} />} />;
  function contractError(run: () => unknown): SiteFooterContractError {
    try {
      run();
    } catch (error) {
      expect(error).toBeInstanceOf(SiteFooterContractError);
      expect(error).toBeInstanceOf(TypeError);
      expect((error as Error).name).toBe("SiteFooterContractError");
      return error as SiteFooterContractError;
    }
    throw new Error("expected a SiteFooterContractError");
  }

  it("publishes the caps it enforces", () => {
    expect(SITE_FOOTER_LIMITS).toEqual({ links: 5, icons: 5 });
    expect(Object.isFrozen(SITE_FOOTER_LIMITS)).toBe(true);
  });

  it("renders five links flat in one row", () => {
    const { container } = render(legal({ links: linkList(5) }));
    const region = container.querySelector('[data-footer-region="links"]')!;
    expect(region.querySelectorAll("ul")).toHaveLength(1);
    expect(region.querySelectorAll(":scope > ul > li > a")).toHaveLength(5);
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("rejects a sixth flat link with the named error instead of truncating", () => {
    const error = contractError(() => render(legal({ links: linkList(6) })));
    expect(error.code).toBe("footer-link-limit");
    expect(error.message).toMatch(/at most five/);
    expect(error.message).toMatch(/column/);
    expect(screen.queryByRole("link", { name: "Page 1" })).toBeNull();
  });

  it("renders grouped links as labelled columns, not in the flat row", () => {
    const groups = [{ heading: "Product", links: linkList(4) }, { heading: "Company", links: linkList(3).map(link => ({ ...link, href: `${link.href}-c` })) }];
    const { container } = render(
      <SiteFooter
        columns={groups.map(group => <SiteFooter.Column key={group.heading} heading={group.heading}>{group.links.map(link => <a key={link.href} href={link.href}>{link.label}</a>)}</SiteFooter.Column>)}
        secondary={<SiteFooter.Legal entity="Example" links={[{ label: "Privacy", href: "/privacy" }]} />}
      />,
    );
    const grid = container.querySelector(".site-footer-columns")!;
    const columns = Array.from(grid.children);
    expect(columns).toHaveLength(2);
    expect(columns.map(column => column.querySelector("h2")?.textContent)).toEqual(["Product", "Company"]);
    expect(columns.map(column => column.querySelectorAll("a").length)).toEqual([4, 3]);
    for (const column of columns) expect(column.querySelector("h2 a, a h2")).toBeNull();
    expect(Array.from(container.querySelectorAll('[data-footer-region="links"] a'), a => a.textContent)).toEqual(["Privacy"]);
  });

  it("rejects a sixth icon slot, counting the home mark", () => {
    expect(contractError(() => render(legal({ icons: iconList(5), home }))).code).toBe("footer-icon-limit");
    expect(contractError(() => render(legal({ icons: iconList(6) }))).code).toBe("footer-icon-limit");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders five icon slots with the site's own mark last", () => {
    const { container } = render(legal({ icons: iconList(4), home }));
    const anchors = Array.from(container.querySelectorAll('[data-footer-region="icons"] a'));
    expect(anchors.map(a => a.getAttribute("aria-label"))).toEqual(["Profile 1", "Profile 2", "Profile 3", "Profile 4", "Example home"]);
    expect(anchors.at(-1)!.querySelector("[data-footer-home-plate] img")).toHaveAttribute("src", "/mark.svg");
    expect(anchors.slice(0, -1).some(a => a.querySelector("[data-footer-home-plate]"))).toBe(false);
  });

  it("renders no mark when no home is supplied", () => {
    const { container } = render(legal({ icons: iconList(2) }));
    expect(container.querySelector("[data-footer-home-plate]")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("names the home mark like the header brand: one accessible name, decorative art", () => {
    render(legal({ home }));
    const link = screen.getByRole("link", { name: "Example home" });
    expect(link.querySelector("img")).toHaveAttribute("alt", "");
    expect(link.querySelector("[data-footer-home-plate]")).toHaveAttribute("aria-hidden", "true");
    expect(link.textContent).toBe("");
  });

  it("refuses a footer link or icon that repeats the home destination", () => {
    expect(contractError(() => render(legal({ links: [{ label: "Start", href: "/" }], home }))).code).toBe("footer-duplicate-link");
    expect(contractError(() => render(legal({ icons: [{ label: "Start", href: "/", icon: glyph }], home }))).code).toBe("footer-duplicate-link");
    expect(() => render(legal({ links: [{ label: "Start", href: "/" }] }))).not.toThrow();
  });
});

describe("SiteFooter finished composition CSS (FOOTER-2)", () => {
  const theme = readFileSync(join(import.meta.dirname, "../../styles/theme-keys.css"), "utf8");
  const compiled = readFileSync(join(import.meta.dirname, "../../styles/compiled.css"), "utf8");
  function block(source: string, opening: string) {
    const start = source.indexOf(opening);
    expect(start, opening).toBeGreaterThanOrEqual(0);
    let depth = 0;
    for (let i = source.indexOf("{", start); i < source.length; i++) {
      if (source[i] === "{") depth++;
      if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error(`Unterminated footer CSS: ${opening}`);
  }
  const columns = () => block(theme, "@utility site-footer-columns {");
  const composition = () => block(theme, "@utility site-footer-composition {");
  const narrow = () => composition().replace(block(composition(), "@container"), "");

  it("styles group labels as muted labels, distinct from bright links, with no margin", () => {
    // Whole declarations, so a renamed property or a nonzero margin cannot pass as a substring.
    for (const heading of [block(columns(), "& h2 {"), block(block(compiled, ".site-footer-columns {"), "& h2 {")]) {
      expect(heading).toMatch(/[{;]\s*margin: 0;/);
      expect(heading).toMatch(/[{;]\s*color: var\(--site-footer-muted, var\(--color-ink-on-inverse-muted,/);
      expect(heading).not.toMatch(/text-decoration|cursor|margin-(block|inline)/);
    }
  });

  it("aligns a column's label and link text on one inline edge and tops uneven columns", () => {
    expect(columns()).toContain("align-items: start");
    const link = block(columns(), "& a {");
    expect(link).toContain("padding-inline: 0");
    expect(link).toContain("justify-content: flex-start");
    expect(block(block(compiled, ".site-footer-columns {"), "& a {")).toContain("padding-inline: 0");
  });

  it("omits empty link and icon regions so they add no row or gap", () => {
    const empty = block(narrow(), '& > [data-footer-region="links"]:not(:has(li)),');
    expect(empty).toContain('& > [data-footer-region="icons"]:not(:has(li))');
    expect(empty).toContain("display: none");
  });

  it("spaces the phone stack 8px between links and icons and 12px before the copyright, without a copyright margin", () => {
    expect(narrow()).toContain("gap: var(--spacing-sm, 8px)");
    const copyright = block(narrow(), '& > [data-footer-region="copyright"] {');
    expect(copyright).toContain("padding-block-start: var(--spacing-xs, 4px)");
    expect(copyright).not.toContain("margin");
    expect(block(block(composition(), "@container"), '& > [data-footer-region="copyright"] {')).toContain("padding-block-start: 0");
  });
});
