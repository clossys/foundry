import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { Home, Settings } from "../icons/index.js";
import { SiteHeader } from "./SiteHeader.js";
import { NavDisclosure } from "./NavDisclosure.js";
import { SiteHeader as ServerSiteHeader } from "./server.js";
import { CONTRAST_PAIRS } from "../tokens/contrast-pairs.js";

describe("SiteHeader", () => {
  it.each(["plain", "disclosure", "none"])("keeps %s navigation in desktop layout across resize", supply => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    const links = <a href="/about">About</a>;
    try {
      render(<SiteHeader brand="Example" nav={supply === "plain" ? <nav>{links}</nav> : supply === "disclosure" ? <NavDisclosure>{links}</NavDisclosure> : undefined} />);
      fireEvent.resize(window);
      expect(screen.getByRole("banner")).not.toHaveAttribute("data-collapsed");
    } finally { vi.unstubAllGlobals(); }
  });

  it("uses the mandatory centered responsive structure with a plain nav and icon action", () => {
    const { container } = render(<SiteHeader brand={<a href="/">Example</a>} nav={<nav aria-label="Primary"><a href="/about">About</a></nav>} actions={<SiteHeader.ActionLink href="/app" label="App" icon={Home} />} />);
    expect(container.querySelector("header")).toHaveClass("site-header-contract");
    expect(container.querySelector(".site-header-row > .site-header-brand")).toHaveTextContent("Example");
    expect(container.querySelector(".site-header-row > nav")).toHaveAttribute("aria-label", "Primary");
    expect(container.querySelector(".site-header-row > .site-header-actions a")).toHaveAttribute("href", "/app");
    expect(container.querySelectorAll("header, header nav")).toHaveLength(2);
  });

  it("renders the brand, nav, and actions slots", () => {
    render(
      <SiteHeader
        brand={<span>Acme</span>}
        nav={<nav aria-label="Primary">Links</nav>}
        actions={<button type="button">Sign in</button>}
      />,
    );
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Primary" })).toHaveTextContent("Links");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("registers as the page's banner landmark", () => {
    render(<SiteHeader brand={<span>Acme</span>} />);
    expect(screen.getByRole("banner")).toBeInTheDocument();
  });

  it("renders with only the required brand slot", () => {
    render(<SiteHeader brand={<span>Acme</span>} />);
    expect(screen.getByRole("banner")).toHaveTextContent("Acme");
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("forwards className merged with its own built-in classes", () => {
    render(<SiteHeader brand={<span>Acme</span>} className="my-header" />);
    expect(screen.getByRole("banner").className).toContain("my-header");
  });

  it("renders brand leading, nav centered, secondary then primary CTA trailing, with no className override", () => {
    render(
      <SiteHeader
        navPlacement="centered"
        brand={<span>Acme</span>}
        nav={<nav aria-label="Primary">Links</nav>}
        actions={<><a href="/sign-in">Sign in</a><button type="button">Get started</button></>}
      />,
    );
    const row = screen.getByRole("banner").firstElementChild as HTMLElement;
    const [leading, center, trailing] = Array.from(row.children) as HTMLElement[];
    expect(row.children).toHaveLength(3);
    expect(leading).toContainElement(screen.getByText("Acme"));
    expect(center).toBe(screen.getByRole("navigation", { name: "Primary" }));
    const secondary = screen.getByRole("link", { name: "Sign in" });
    const primary = screen.getByRole("button", { name: "Get started" });
    expect(trailing).toContainElement(secondary);
    expect(trailing).toContainElement(primary);
    expect(secondary.compareDocumentPosition(primary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(leading).toHaveClass("site-header-brand");
    expect(trailing).toHaveClass("site-header-actions");
    expect(row).toHaveClass("site-header-row");
  });

  it("the centered layout has exactly one banner and one navigation landmark", () => {
    render(
      <SiteHeader
        navPlacement="centered"
        brand={<span>Acme</span>}
        nav={<nav aria-label="Primary">Links</nav>}
        actions={<><a href="/sign-in">Sign in</a><button type="button">Get started</button></>}
      />,
    );
    expect(screen.getAllByRole("banner")).toHaveLength(1);
    expect(screen.getAllByRole("navigation")).toHaveLength(1);
  });

  it("explicit legacy leading placement takes the secondary action", () => {
    render(
      <SiteHeader
        navPlacement="leading"
        brand={<span>Acme</span>}
        nav={<nav aria-label="Primary">Links</nav>}
        actions={<><a href="/sign-in">Sign in</a><button type="button">Get started</button></>}
      />,
    );
    const row = screen.getByRole("banner").firstElementChild as HTMLElement;
    const brand = screen.getByText("Acme");
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const secondary = screen.getByRole("link", { name: "Sign in" });
    const primary = screen.getByRole("button", { name: "Get started" });
    expect(brand.parentElement?.parentElement).toBe(nav.parentElement);
    expect(screen.getByRole("banner")).toHaveClass("site-header-leading");
    expect(secondary.nextElementSibling).toBe(primary);
  });

  it("keeps the trailing region empty when actions are omitted", () => {
    render(<SiteHeader brand={<span>Acme</span>} />);
    const row = screen.getByRole("banner").firstElementChild!;
    expect(row.children).toHaveLength(2);
    expect(row.lastElementChild!.children).toHaveLength(0);
    expect(screen.getByRole("banner")).not.toHaveTextContent("admin");
  });

  describe("surface", () => {
    it("documents an inverse overlay whose children inherit the gated ink", () => {
      const readme = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "README.md"), "utf8");
      const blocks = [...readme.matchAll(/```tsx\n([\s\S]*?)```/g)].map((match) => match[1] ?? "");
      const example = blocks.find((block) => block.includes('surface="glass"') && block.includes('tone="inverse"'));
      expect(example).toBeDefined();
      // tone sets inherited ink only: no child in the example may set its own.
      expect(example).not.toMatch(/<Link\b|<Brandmark\b|ActionLink|text-ink-/);
      const anchors = example?.match(/<a\b[^>]*>/g) ?? [];
      expect(anchors.length).toBeGreaterThan(0);
      for (const anchor of anchors) expect(anchor).toContain('className="text-inherit"');
      // ...so every child reads in the header's own ink, which the gate checks over the inverse glass.
      const { container } = render(
        <SiteHeader
          surface="glass"
          tone="inverse"
          brand={<a href="/" className="text-inherit">Acme</a>}
          actions={<a href="/sign-in" className="text-inherit">Sign in</a>}
        />,
      );
      expect(container.querySelector("header")?.classList.contains("text-ink-on-inverse")).toBe(true);
      for (const link of container.querySelectorAll("a")) expect(link.className).toBe("text-inherit");
      const gated = CONTRAST_PAIRS.filter((pair) => pair.background === "--color-surface-glass-inverse").map((pair) => pair.foreground);
      expect(new Set(gated)).toEqual(new Set(["--color-ink-on-inverse"]));
    });

    const FLOW_MARKUP = renderToStaticMarkup(<SiteHeader brand={<span>Acme</span>} navPlacement="centered" surface="solid" />);

    it("defaults to solid, byte-identical to the explicit default surface", () => {
      const html = renderToStaticMarkup(<SiteHeader brand={<span>Acme</span>} />);
      expect(html).toBe(FLOW_MARKUP);
      expect(renderToStaticMarkup(<SiteHeader brand={<span>Acme</span>} surface="solid" />)).toBe(FLOW_MARKUP);
    });

    it("applies inverse tone to the solid surface", () => {
      render(<SiteHeader brand={<span>Acme</span>} tone="inverse" menuOpen />);
      expect(screen.getByRole("banner")).toHaveAttribute("data-tone", "inverse");
      expect(screen.getByRole("banner")).toHaveClass("bg-surface-inverse", "text-ink-on-inverse");
    });

    it("overlay fixes the header to the top of the viewport, out of flow, over the shell z-index", () => {
      render(<SiteHeader brand={<span>Acme</span>} surface="glass" />);
      const banner = screen.getByRole("banner");
      expect(banner.style.position).toBe("fixed");
      expect(banner.style.insetBlockStart).toBe("0");
      expect(banner.style.insetInline).toBe("0");
      expect(banner.style.zIndex).toBe("var(--ui-z-shell, 20)");
      expect(banner).toHaveAttribute("data-placement", "overlay");
    });

    it("overlay paints through the site-header-overlay utility, with no ground plate or border classes", () => {
      render(<SiteHeader brand={<span>Acme</span>} surface="glass" />);
      const classes = screen.getByRole("banner").className.split(" ");
      expect(classes).toEqual(expect.arrayContaining(["site-header-overlay", "site-header-ink", "text-ink-primary", "py-sm", "site-header-contract"]));
      expect(classes).not.toEqual(expect.arrayContaining(["bg-surface-raised", "border-b"]));
      expect(screen.getByRole("banner").style.borderBottomWidth).toBe("");
    });

    it("overlay tone sets the ink and data-tone, defaulting to base", () => {
      const { unmount } = render(<SiteHeader brand={<span>Acme</span>} surface="glass" />);
      expect(screen.getByRole("banner")).toHaveAttribute("data-tone", "base");
      unmount();
      render(<SiteHeader brand={<span>Acme</span>} surface="glass" tone="inverse" />);
      const banner = screen.getByRole("banner");
      expect(banner).toHaveAttribute("data-tone", "inverse");
      expect(banner.className).toContain("text-ink-on-inverse");
      expect(banner.className).not.toContain("text-ink-primary");
    });

    it("overlay renders data-menu-open only while menuOpen is set", () => {
      const { unmount } = render(<SiteHeader brand={<span>Acme</span>} surface="glass" />);
      expect(screen.getByRole("banner")).not.toHaveAttribute("data-menu-open");
      unmount();
      render(<SiteHeader brand={<span>Acme</span>} surface="glass" menuOpen />);
      expect(screen.getByRole("banner")).toHaveAttribute("data-menu-open", "");
    });

    it("overlay keeps the caller's className and style, and renders on the server entry", () => {
      const html = renderToStaticMarkup(
        <ServerSiteHeader brand={<span>Acme</span>} surface="glass" className="my-header" style={{ zIndex: 5 }} />,
      );
      expect(html).toMatch(/class="[^"]*site-header-overlay[^"]*my-header"/);
      expect(html).toContain("position:fixed");
      expect(html).toContain("z-index:5");
      expect(html).toContain('data-surface="glass"');
    });
  });

  describe("SiteHeader.ActionLink", () => {
    it("without an icon shows its label at every width and keeps the tap target", () => {
      render(<SiteHeader.ActionLink href="/start" label="Get started" variant="primary" />);
      const link = screen.getByRole("link", { name: "Get started" });
      expect(link.textContent).toBe("Get started");
      expect(link.querySelector("svg")).toBeNull();
      expect(link.querySelector(".sr-only")).toBeNull();
      expect(link.childNodes).toHaveLength(1);
      expect(link.firstChild?.nodeType).toBe(Node.TEXT_NODE);
      expect(link.className).toContain("bg-accent");
      expect(link.style.minHeight).toBe("var(--ui-layout-tap-target, 44px)");
      expect(link.style.minWidth).toBe("var(--ui-layout-tap-target, 44px)");
    });

    function renderEnvironments(current: "app" | "admin" | null = "admin") {
      return render(
        <SiteHeader
          brand={<a href="/">Acme</a>}
          actions={
            <>
              <SiteHeader.ActionLink href="https://app.example.com/" label="App" icon={Home} isCurrent={current === "app"} />
              <SiteHeader.ActionLink href="https://admin.example.com/" label="Admin" icon={Settings} isCurrent={current === "admin"} />
            </>
          }
        />,
      );
    }

    it("renders a real link whose accessible name is the label, with a decorative icon", () => {
      renderEnvironments();
      const banner = screen.getByRole("banner");
      const app = within(banner).getByRole("link", { name: "App" });
      expect(app).toHaveAttribute("href", "https://app.example.com/");
      const svg = app.querySelector("svg") as SVGElement;
      expect(svg).toHaveAttribute("aria-hidden", "true");
      expect(svg).not.toHaveAttribute("aria-label");
      expect(app).not.toHaveAttribute("aria-label");
    });

    it("keeps the label in the DOM, visually hidden below tablet and shown from tablet up", () => {
      renderEnvironments();
      const label = within(screen.getByRole("link", { name: "Admin" })).getByText("Admin");
      expect(label.tagName).toBe("SPAN");
      expect(label.className.split(" ")).toEqual(["sr-only", "tablet:not-sr-only"]);
    });

    it("marks only the current link with aria-current=page and a non-colour cue", () => {
      renderEnvironments("admin");
      const app = screen.getByRole("link", { name: "App" });
      const admin = screen.getByRole("link", { name: "Admin" });
      expect(admin).toHaveAttribute("aria-current", "page");
      expect(app).not.toHaveAttribute("aria-current");
      expect(admin.style.boxShadow).toContain("inset");
      expect(app.style.boxShadow).toBe("");
    });

    it("renders no aria-current when no link is current", () => {
      renderEnvironments(null);
      for (const link of screen.getAllByRole("link")) expect(link).not.toHaveAttribute("aria-current");
    });

    it("reaches the tap-target token in both dimensions", () => {
      renderEnvironments();
      const app = screen.getByRole("link", { name: "App" });
      expect(app.style.minHeight).toBe("var(--ui-layout-tap-target, 44px)");
      expect(app.style.minWidth).toBe("var(--ui-layout-tap-target, 44px)");
    });

    it("borrows the small button look without the outline-none that would hide its focus outline", () => {
      render(<SiteHeader.ActionLink href="/" label="Home" icon={Home} variant="primary" />);
      const classes = screen.getByRole("link", { name: "Home" }).className.split(" ");
      expect(classes).toContain("bg-accent");
      expect(classes).toContain("px-sm");
      expect(classes).not.toContain("outline-none");
      expect(classes).toEqual(expect.arrayContaining(["focus-visible:outline-2", "focus-visible:outline-offset-2", "focus-visible:outline-accent"]));
    });

    it("defaults to the secondary look", () => {
      render(<SiteHeader.ActionLink href="/" label="Home" icon={Home} />);
      expect(screen.getByRole("link", { name: "Home" }).className).toContain("bg-surface-raised");
    });

    it("keeps one banner and no navigation landmark when several links fill actions", () => {
      renderEnvironments();
      expect(screen.getAllByRole("banner")).toHaveLength(1);
      expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    });

    it("ships from the server entry and renders without client code", () => {
      const html = renderToStaticMarkup(<ServerSiteHeader.ActionLink href="/" label="Home" icon={Home} isCurrent />);
      expect(html).toContain('href="/"');
      expect(html).toContain('aria-current="page"');
      expect(html).toContain(">Home</span>");
    });
  });
});


it("ships the default header candidate and a shared frame clearance including safe areas", () => {
  const styles = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "styles");
  const css = readFileSync(join(styles, "compiled.css"), "utf8");
  expect(css).toContain(".site-header-row {");
  const clearance = "var(--site-header-clearance, calc(max(var(--ui-layout-tap-target, 44px), var(--ui-brandmark-height-lg, 48px)) + 2 * var(--spacing-sm, 8px) + var(--ui-border-hairline, 1px) + env(safe-area-inset-top, 0px)))";
  expect(css).toContain(`scroll-margin-block-start: ${clearance}`);
  expect(css).toContain(`padding-block-start: ${clearance}`);
  expect(css).toContain(`max-block-size: calc(100dvb - ${clearance} - env(safe-area-inset-bottom, 0px))`);
  expect(css).toContain("env(safe-area-inset-bottom");
  expect(css).toContain("env(safe-area-inset-top");
  expect(css).toContain(".site-header-contract[data-header-root] .site-header-actions");
  expect(readFileSync(join(styles, "theme-keys.css"), "utf8").match(/& \.nav-disclosure-panel \{[^\n]*padding-inline:[^\n]+/g)?.at(-1)).toContain("padding-inline: max(var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px)), env(safe-area-inset-left, 0px), env(safe-area-inset-right, 0px))");
});

it("documents the two decorative icon bars", () => {
  expect(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "README.md"), "utf8")).toContain("icon toggle draws two\ndecorative bars");
});
