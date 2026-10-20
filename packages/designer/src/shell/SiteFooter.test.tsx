import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { SiteFooter, type SiteFooterLegalProps } from "./SiteFooter.js";
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

describe("SiteFooter measured geometry", () => {
  type Rect = { left: number; right: number; top: number; bottom: number; width: number };
  type Measurement = {
    content: Rect; links: Rect; icons: Rect; copyright: Rect;
    copyrightText: Rect; targets: Rect[]; linkItems: Rect[];
  };
  let measurements: Record<string, Measurement>;
  beforeAll(() => {
    const browser = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]
      .find(name => spawnSync(name, ["--version"], { stdio: "ignore" }).status === 0);
    if (!browser) throw new Error("Footer geometry tests require Chromium or Google Chrome on PATH.");
    const css = readFileSync(join(import.meta.dirname, "../../styles/compiled.css"), "utf8");
    const fixtures = ["ltr", "rtl"].flatMap(dir => [
      { name: "wide", width: 1280, count: 7 },
      { name: "roomy", width: 1440, count: 7 },
      { name: "crowded", width: 1280, count: 30 },
      { name: "phone", width: 375, count: 7 },
      { name: "below-desktop", width: 1279, count: 7 },
    ].map(({ name, width, count }) => renderToStaticMarkup(
      <section dir={dir} data-geometry-case={`${dir}-${name}`}>
        <SiteFooter style={{ width }} secondary={<SiteFooter.Legal
          entity="Example"
          links={[{ label: "Privacy", href: "/privacy" }, { label: "Terms", href: "/terms" }]}
          icons={Array.from({ length: count }, (_, index) => ({
            label: `Profile ${index}`, href: `/profile/${index}`,
            icon: <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24"><path d="M4 12h16" /></svg>,
          }))}
          home={{ label: "Example home", href: "/", markSrc: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'/%3E" }}
        />} />
      </section>,
    ))).join("");
    function measure() {
      const rect = (node: Element | Range) => {
        const { left, right, top, bottom, width } = node.getBoundingClientRect();
        return { left, right, top, bottom, width };
      };
      const result = Object.fromEntries([...document.querySelectorAll("[data-geometry-case]")].map(fixture => {
        const content = fixture.querySelector("[data-footer-composition]")!;
        const region = (name: string) => content.querySelector(`[data-footer-region="${name}"]`)!;
        const text = document.createRange();
        text.selectNodeContents(region("copyright"));
        return [fixture.getAttribute("data-geometry-case"), {
          content: rect(content), links: rect(region("links")), icons: rect(region("icons")),
          copyright: rect(region("copyright")), copyrightText: rect(text),
          targets: [...region("icons").querySelectorAll("a")].map(rect),
          linkItems: [...region("links").querySelectorAll("li")].map(rect),
        }];
      }));
      document.getElementById("footer-geometry")!.textContent = JSON.stringify(result);
    }
    // Read real Chromium layout through DevTools and close the owned browser.
    async function readBrowserLayout() {
      const { spawn } = require("node:child_process") as typeof import("node:child_process");
      const browser = spawn(process.argv[1]!, ["--headless", "--no-sandbox", "--disable-dev-shm-usage",
        "--remote-debugging-port=0", `--user-data-dir=${process.argv[3]}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
      let socket: WebSocket | undefined;
      try {
        const endpoint = await new Promise<string>((resolve, reject) => {
          let output = "";
          browser.on("error", reject);
          browser.on("exit", code => reject(new Error(`Browser exited before DevTools was ready (${code}): ${output}`)));
          browser.stderr!.on("data", (chunk: Buffer) => {
            output += String(chunk);
            const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
            if (match) resolve(match[1]!);
          });
        });
        socket = new WebSocket(endpoint);
        const client = socket;
        await new Promise<void>((resolve, reject) => { client.onopen = () => resolve(); client.onerror = reject; });
        let id = 0;
        let pending: { id: number; resolve(response: any): void } | undefined;
        client.onmessage = event => {
          const response = JSON.parse(String(event.data));
          const request = pending;
          if (request && response.id === request.id) { pending = undefined; request.resolve(response); }
        };
        const command = (method: string, params = {}, sessionId?: string): Promise<any> => new Promise((resolve, reject) => {
          const request = ++id;
          pending = { id: request, resolve: response => response.error ? reject(new Error(response.error.message)) : resolve(response.result) };
          client.send(JSON.stringify({ id: request, method, params, sessionId }));
        });
        const { targetId } = await command("Target.createTarget", { url: "about:blank" });
        const { sessionId } = await command("Target.attachToTarget", { targetId, flatten: true });
        await command("Page.enable", {}, sessionId);
        const { frameTree } = await command("Page.getFrameTree", {}, sessionId);
        const html = require("node:fs").readFileSync(require("node:url").fileURLToPath(process.argv[2]), "utf8");
        await command("Page.setDocumentContent", { frameId: frameTree.frame.id, html }, sessionId);
        let value = "";
        for (let attempt = 0; attempt < 50 && !value; attempt++) {
          const response = await command("Runtime.evaluate", { expression: "document.getElementById('footer-geometry')?.textContent", returnByValue: true }, sessionId);
          value = response.result.value ?? "";
          if (!value) await new Promise(resolve => setTimeout(resolve, 20));
        }
        if (!value) throw new Error("Chromium did not produce footer layout measurements.");
        process.stdout.write(value);
      } finally {
        socket?.close();
        browser.kill();
      }
    }
    const directory = mkdtempSync(join(tmpdir(), "footer-geometry-"));
    try {
      const html = join(directory, "fixture.html");
      writeFileSync(html, `<!doctype html><meta charset="utf-8"><style>${css}</style>${fixtures}<pre id="footer-geometry"></pre><script>(${measure.toString()})()</script>`);
      const output = execFileSync(process.execPath, ["--experimental-websocket", "-e", `(${readBrowserLayout.toString()})().catch(error => { console.error(error.message); process.exitCode = 1; });`,
        browser, pathToFileURL(html).href, join(directory, "profile")],
      { encoding: "utf8", timeout: 5000, maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
      measurements = JSON.parse(output);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  for (const dir of ["ltr", "rtl"]) {
    it(`centres links on the whole footer with unequal side content in ${dir}`, () => {
      for (const size of ["wide", "roomy"]) {
        const { content, links, copyrightText, targets, linkItems } = measurements[`${dir}-${size}`]!;
        const iconWidth = Math.max(...targets.map(rect => rect.right)) - Math.min(...targets.map(rect => rect.left));
        expect(iconWidth).toBeGreaterThan(copyrightText.width + 100);
        expect(Math.abs((links.left + links.right - content.left - content.right) / 2)).toBeLessThan(1);
        const visibleCentre = (Math.min(...linkItems.map(rect => rect.left)) + Math.max(...linkItems.map(rect => rect.right))) / 2;
        expect(Math.abs(visibleCentre - (content.left + content.right) / 2)).toBeLessThan(1);
      }
    });
    it(`contains uncapped icon content before it collides with adjacent regions in ${dir}`, () => {
      const { content, links, icons, copyright, targets } = measurements[`${dir}-crowded`]!;
      expect(targets).toHaveLength(31);
      expect(new Set(targets.map(rect => Math.round(rect.top))).size).toBeGreaterThan(1);
      for (const target of targets) {
        expect(target.width).toBeGreaterThanOrEqual(44);
        expect(target.left).toBeGreaterThanOrEqual(icons.left - 1);
        expect(target.right).toBeLessThanOrEqual(icons.right + 1);
      }
      expect(Math.abs((links.left + links.right - content.left - content.right) / 2)).toBeLessThan(1);
      const regions = [copyright, links, icons].sort((a, b) => a.left - b.left);
      expect(regions[0]!.right).toBeLessThanOrEqual(regions[1]!.left);
      expect(regions[1]!.right).toBeLessThanOrEqual(regions[2]!.left);
    });
    it(`measures the centred phone stack and breakpoint collapse in ${dir}`, () => {
      for (const size of ["phone", "below-desktop"]) {
        const { content, links, icons, copyright } = measurements[`${dir}-${size}`]!;
        expect(links.bottom).toBeLessThanOrEqual(icons.top);
        expect(icons.bottom).toBeLessThanOrEqual(copyright.top);
        for (const region of [links, icons, copyright]) {
          expect(Math.abs((region.left + region.right - content.left - content.right) / 2)).toBeLessThan(1);
        }
      }
    });
  }
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
  it("allows empty lists without adding a heading, trigger or cardinality limit", () => {
    const { rerender } = render(<SiteFooter secondary={<SiteFooter.Legal entity="Example" links={[]} icons={[]} />} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<SiteFooter secondary={<SiteFooter.Legal entity="Example" links={Array.from({ length: 24 }, (_, i) => ({ label: `Policy ${i}`, href: `/policy/${i}` }))} />} />);
    expect(screen.getAllByRole("link")).toHaveLength(24);
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
    expect(composition).toContain('grid-template-areas: "links" "icons" "copyright"');
    expect(composition).toContain("min-width: 0");
    expect(wide()).toContain('grid-template-areas: "copyright links icons"');
    expect(wide()).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 2fr\) minmax\(0, 1fr\)/);
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
    expect(narrow).toContain('grid-template-areas: "links" "icons" "copyright"');
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
  it("wraps wide icons within their bounded track and never forces copyright word breaks", () => {
    const composition = rule("@utility site-footer-composition {");
    expect(composition).not.toContain("overflow-wrap: anywhere");
    expect(block(wide(), '& > [data-footer-region="icons"] > ul {')).toContain("flex-wrap: wrap");
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
