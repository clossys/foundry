// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, within } from "@testing-library/react";
import { RenderError } from "../../internal/errors.js";
import { PACK_REVIEW_WIDTHS } from "../../pack/review-index.js";
import { PackReviewView } from "./PackReviewView.js";
import type { PackReviewViewBrandKit, PackReviewViewLabels, PackReviewViewProps, PackReviewViewStrategy, PackReviewViewVoice } from "./PackReviewView.js";

afterEach(cleanup);

const LABELS: PackReviewViewLabels = {
  strategy: { heading: "Marker strategy", empty: "Marker no strategy", summary: "Marker summary", context: "Marker context", openQuestions: "Marker open questions" },
  brandKit: {
    heading: "Marker brand kit",
    empty: "Marker no brand kit",
    assets: "Marker assets",
    colors: "Marker colors",
    type: "Marker type",
    specimen: "Marker specimen",
    facts: "Marker brand facts",
  },
  voice: {
    heading: "Marker voice",
    empty: "Marker no voice",
    rules: "Marker rules",
    tagline: "Marker tagline",
    pitch: "Marker pitch",
    boilerplate: "Marker boilerplate",
    faq: "Marker faq",
  },
  pagesHeading: "Marker pages",
  exportsHeading: "Marker exports",
  sheetHeading: "Marker contact sheet",
  none: "Marker none",
  statuses: { draft: "Marker draft", delegated: "Marker delegated", approved: "Marker approved" },
  kinds: {
    "og-image": "Marker og image",
    favicon: "Marker favicon",
    "app-icon": "Marker app icon",
    logo: "Marker logo",
    "email-html": "Marker email",
    "email-text": "Marker email text",
    other: "Marker other",
  },
  exportWidth: (width) => `Marker width ${width}`,
  frameTitle: ({ page, state, width }) => `Marker frame ${page} ${state ?? "base"} ${width}`,
};

function props(over: Partial<PackReviewViewProps> = {}): PackReviewViewProps {
  return {
    brand: <span>Example Studio</span>,
    surfaceLabel: "Marker surface",
    heading: "Marker heading",
    description: "Marker description",
    pages: [
      { id: "/", href: "/", status: "draft", states: [] },
      {
        id: "/contact",
        href: "/contact",
        status: "delegated",
        states: [
          { id: "idle", href: "/contact?preview=idle" },
          { id: "accepted", href: "/contact?preview=accepted" },
        ],
      },
    ],
    exports: [
      { id: "share-card:0", kind: "og-image", path: "out/share/og-image.png", status: "approved" },
      { id: "email:0:600", kind: "email-html", path: "out/email/contact.html", status: "draft", width: 600 },
      { id: "email:0:375", kind: "email-html", path: "out/email/contact.html", status: "draft", width: 375 },
      { id: "email:1", kind: "email-text", path: "out/email/contact.txt", status: "draft" },
    ],
    labels: LABELS,
    ...over,
  };
}

/** The section named by the h2 its `aria-labelledby` points at. */
function sectionOf(container: HTMLElement, heading: string): HTMLElement {
  const h2 = [...container.querySelectorAll("h2")].find((candidate) => candidate.textContent === heading);
  if (h2 === undefined) throw new Error(`no h2 ${heading}`);
  const section = h2.closest("section");
  if (section === null) throw new Error(`no section around ${heading}`);
  return section;
}

describe("PackReviewView", () => {
  it("frames the page like the other views: header with the surface badge, one main with one h1, footer", () => {
    const { container } = render(<PackReviewView {...props()} />);
    const root = container.firstElementChild as HTMLElement;
    expect([...root.children].map((child) => child.tagName)).toEqual(["HEADER", "MAIN", "FOOTER"]);
    expect(root).toHaveClass("min-h-dvh");
    expect(within(root.children[0] as HTMLElement).getByText("Marker surface")).toBeInTheDocument();
    expect(within(root.children[0] as HTMLElement).getByText("Example Studio")).toBeInTheDocument();
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelector("h1")?.textContent).toBe("Marker heading");
  });

  it("holds the page to the form measure token", () => {
    const { container } = render(<PackReviewView {...props()} />);
    expect((container.querySelector("main") as HTMLElement).style.maxWidth).toBe("var(--ui-width-form-max, none)");
  });

  it("lists each page with its badge and links each page and each forced state", () => {
    const { container } = render(<PackReviewView {...props()} />);
    const section = sectionOf(container, "Marker pages");
    expect(within(section).getByRole("heading", { level: 2 }).textContent).toBe("Marker pages");
    const links = [...section.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toEqual([
      ["/", "/"],
      ["/contact", "/contact"],
      ["idle", "/contact?preview=idle"],
      ["accepted", "/contact?preview=accepted"],
    ]);
    expect(within(section).getByText("Marker draft")).toBeInTheDocument();
    expect(within(section).getAllByText("Marker delegated")).toHaveLength(3);
  });

  it("names each section by its own h2 through aria-labelledby, with a matching id and no aria-label", () => {
    const { container } = render(<PackReviewView {...props()} />);
    const sections = [...container.querySelectorAll("main > section")];
    expect(sections).toHaveLength(6);
    const ids = new Set<string>();
    for (const section of sections) {
      expect(section.hasAttribute("aria-label")).toBe(false);
      const labelledby = section.getAttribute("aria-labelledby");
      expect(labelledby).toBeTruthy();
      const h2 = section.querySelector("h2") as HTMLElement;
      expect(h2.getAttribute("id")).toBe(labelledby);
      ids.add(labelledby as string);
    }
    expect(ids.size).toBe(6);
    expect(container.querySelectorAll("[aria-label]")).toHaveLength(0);
  });

  it("shows the page badge next to each forced state", () => {
    const { container } = render(<PackReviewView {...props()} />);
    const section = sectionOf(container, "Marker pages");
    const stateItems = [...section.querySelectorAll("li li")];
    expect(stateItems.map((li) => li.textContent)).toEqual(["idleMarker delegated", "acceptedMarker delegated"]);
  });

  it("shows the page badge in each contact-sheet frame caption, and a text separator between the page and the state", () => {
    const { container } = render(<PackReviewView {...props()} />);
    const captions = [...sectionOf(container, "Marker contact sheet").querySelectorAll("p")];
    expect(captions.map((caption) => caption.textContent)).toEqual([
      "/Marker draft",
      "/contactMarker delegated",
      "/contact\u00b7idleMarker delegated",
      "/contact\u00b7acceptedMarker delegated",
    ]);
    const separator = captions[2]?.children[1] as HTMLElement;
    expect(separator.textContent).toBe("\u00b7");
    expect(separator.getAttribute("aria-hidden")).toBe("true");
    expect(captions[1]?.querySelectorAll("[aria-hidden]")).toHaveLength(0);
  });

  it("links an export's kind to its address when one is given, and refuses an address that is not same-site", () => {
    const exportsWithHref = [
      { id: "share-card:0", kind: "og-image" as const, path: "out/share/og-image.png", status: "approved" as const, href: "/pack/export?name=share-card%3A0" },
      { id: "email:1", kind: "email-text" as const, path: "out/email/contact.txt", status: "draft" as const },
    ];
    const { container } = render(<PackReviewView {...props({ exports: exportsWithHref })} />);
    const section = sectionOf(container, "Marker exports");
    expect([...section.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Marker og image", "/pack/export?name=share-card%3A0"],
    ]);
    expect(section.querySelector("code")?.textContent).toBe("out/share/og-image.png");
    for (const href of ["https://example.test/", "//example.test/", "javascript:alert(1)"]) {
      expect(() => renderToStaticMarkup(<PackReviewView {...props({ exports: [{ ...exportsWithHref[0]!, href }] })} />)).toThrow(/exports\[0\]\.href/);
    }
  });

  it("lists each export with its kind, badge, path as text, and a width only where one is given", () => {
    const { container } = render(<PackReviewView {...props()} />);
    const section = sectionOf(container, "Marker exports");
    const rows = [...section.querySelectorAll("li")].map((li) => li.textContent);
    expect(rows).toEqual([
      "Marker approvedMarker og imageout/share/og-image.png",
      "Marker draftMarker emailMarker width 600out/email/contact.html",
      "Marker draftMarker emailMarker width 375out/email/contact.html",
      "Marker draftMarker email textout/email/contact.txt",
    ]);
    expect(section.querySelectorAll("a")).toHaveLength(0);
  });

  it("renders one lazy frame per page, state and width, in that order", () => {
    const { container } = render(<PackReviewView {...props()} />);
    const frames = [...container.querySelectorAll("iframe")];
    const addresses = ["/", "/contact", "/contact?preview=idle", "/contact?preview=accepted"];
    expect(frames.map((frame) => [frame.getAttribute("src"), frame.getAttribute("width")])).toEqual(
      addresses.flatMap((address) => PACK_REVIEW_WIDTHS.map((width) => [address, String(width)])),
    );
    expect(frames.every((frame) => frame.getAttribute("loading") === "lazy")).toBe(true);
  });

  it("titles every frame through the label, and gives a page's own frame no state", () => {
    const { container } = render(<PackReviewView {...props({ pages: [{ id: "/", href: "/", status: "draft", states: [] }] })} />);
    expect([...container.querySelectorAll("iframe")].map((frame) => frame.getAttribute("title"))).toEqual([
      "Marker frame / base 390",
      "Marker frame / base 1024",
      "Marker frame / base 1440",
    ]);
  });

  it("defaults the sheet to the three widths the index exports, and takes others when given", () => {
    const { container } = render(<PackReviewView {...props({ widths: [320] })} />);
    expect([...container.querySelectorAll("iframe")].every((frame) => frame.getAttribute("width") === "320")).toBe(true);
    const defaults = render(<PackReviewView {...props()} />).container;
    const widths = new Set([...defaults.querySelectorAll("iframe")].map((frame) => Number(frame.getAttribute("width"))));
    expect([...widths]).toEqual([...PACK_REVIEW_WIDTHS]);
  });

  it("shows the none label for each empty list, and renders no frame", () => {
    const { container } = render(<PackReviewView {...props({ pages: [], exports: [] })} />);
    expect(within(container).getAllByText("Marker none")).toHaveLength(3);
    expect(container.querySelectorAll("iframe")).toHaveLength(0);
  });

  it("orders the sections strategy, brand kit, voice, pages, exports, contact sheet", () => {
    const { container } = render(<PackReviewView {...props()} />);
    expect([...container.querySelectorAll("main > section > h2")].map((h2) => h2.textContent)).toEqual([
      "Marker strategy",
      "Marker brand kit",
      "Marker voice",
      "Marker pages",
      "Marker exports",
      "Marker contact sheet",
    ]);
  });

  it("renders entry text as inert text", () => {
    const hostile = '<script>globalThis.hit=1</script><img src=x onerror="globalThis.hit=1">';
    const html = renderToStaticMarkup(
      <PackReviewView
        {...props({
          pages: [{ id: hostile, href: "/", status: "draft", states: [{ id: hostile, href: "/" }] }],
          exports: [{ id: "x", kind: "other", path: hostile, status: "draft" }],
        })}
      />,
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
  });

  it.each([
    ["a scheme", "javascript:alert(1)"],
    ["a protocol-relative address", "//example.test/"],
    ["a relative address", "contact"],
    ["a backslash", "/\\example.test"],
    ["a control character", "/a\u0000"],
    ["a non-string", 7 as unknown as string],
  ])("refuses a page address with %s, naming the position and not the value", (_name, href) => {
    let error: unknown;
    try {
      renderToStaticMarkup(<PackReviewView {...props({ pages: [{ id: "/", href, status: "draft", states: [] }] })} />);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(RenderError);
    expect((error as Error).message).toContain("pages[0].href");
    expect((error as Error).message).not.toContain("example.test");
    expect((error as Error).message).not.toContain("alert");
  });

  it("refuses a state address that is not same-site", () => {
    const pages = [{ id: "/", href: "/", status: "draft" as const, states: [{ id: "idle", href: "https://example.test/" }] }];
    expect(() => renderToStaticMarkup(<PackReviewView {...props({ pages })} />)).toThrow(/pages\[0\]\.states\[0\]\.href/);
  });

  it("refuses an unknown badge on a page or an export, without naming it", () => {
    const badPage = [{ id: "/", href: "/", status: "Hostile" as unknown as "draft", states: [] }];
    expect(() => renderToStaticMarkup(<PackReviewView {...props({ pages: badPage })} />)).toThrow(/pages\[0\]\.status/);
    const badExport = [{ id: "x", kind: "other" as const, path: "p", status: "Hostile" as unknown as "draft" }];
    let message = "";
    try {
      renderToStaticMarkup(<PackReviewView {...props({ exports: badExport })} />);
    } catch (caught) {
      message = (caught as Error).message;
    }
    expect(message).toContain("exports[0].status");
    expect(message).not.toContain("Hostile");
  });

  it.each([[[]], [[0]], [[-1]], [[1.5]], [[1e6]]])("refuses the sheet widths %j", (widths) => {
    expect(() => renderToStaticMarkup(<PackReviewView {...props({ widths })} />)).toThrow(/widths/);
  });

  describe("source shape", () => {
    const source = readFileSync(join(import.meta.dirname, "PackReviewView.tsx"), "utf8");

    it("injects no markup and reads no environment", () => {
      expect(source).not.toMatch(/dangerouslySetInnerHTML/);
      expect(source).not.toMatch(/process\.env|import\.meta\.env|window\.|document\./);
    });

    it("lazy-loads every frame and never sets srcDoc", () => {
      expect(source).toMatch(/loading="lazy"/);
      expect(source).not.toMatch(/srcDoc/i);
    });
  });

  it("golden: exact markup for a small review", () => {
    let html = renderToStaticMarkup(
      <PackReviewView
        {...props({
          pages: [{ id: "/contact", href: "/contact", status: "delegated", states: [{ id: "idle", href: "/contact?preview=idle" }] }],
          exports: [{ id: "share-card:0", kind: "og-image", path: "out/share/og-image.png", status: "approved" }],
          widths: [390],
        })}
      />,
    );
    // React's generated ids differ by version; each must appear as an h2 id and as its section's aria-labelledby.
    const ids = [...html.matchAll(/<h2 id="([^"]+)"/g)].map((match) => match[1]!);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
    ids.forEach((id, index) => {
      expect(html.match(new RegExp(`aria-labelledby="${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`, "g"))).toHaveLength(1);
      html = html.replaceAll(`"${id}"`, `"heading-id-${index}"`);
    });
    expect(html).toBe(
      "<div class=\"flex min-h-dvh flex-col\">" +
      "<header class=\"bg-surface-raised py-sm border-b border-line-base\" style=\"position:relative;z-index:var(--ui-z-shell, 20);border-bottom-width:var(--ui-border-hairline, 1px)\">" +
      "<div class=\"mx-auto flex w-full flex-wrap items-center justify-between gap-md\" style=\"padding-inline:var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))\">" +
      "<div class=\"flex items-center gap-lg\"><span>Example Studio</span></div><div class=\"flex items-center gap-sm\">" +
      "<span class=\"inline-flex items-center rounded-pill px-sm py-xs text-caption font-body tracking-meta bg-surface-sunken text-ink-secondary\">Marker surface</span>" +
      "</div></div></header>" +
      "<main class=\"mx-auto flex w-full flex-1 flex-col gap-xl px-lg py-2xl\" style=\"max-width:var(--ui-width-form-max, none)\">" +
      "<header class=\"flex flex-col gap-md\"><div class=\"flex flex-wrap items-start justify-between gap-lg\">" +
      "<div class=\"flex flex-col gap-xs\"><h1 class=\"text-h1 font-display text-ink-primary\">Marker heading</h1>" +
      "<p class=\"text-body text-ink-secondary\">Marker description</p></div></div></header>" +
      "<section class=\"flex flex-col gap-md\" aria-labelledby=\"heading-id-0\">" +
      "<h2 id=\"heading-id-0\" class=\"text-h2 text-ink-primary\">Marker strategy</h2>" +
      "<p class=\"text-body-s text-ink-muted\">Marker no strategy</p></section>" +
      "<section class=\"flex flex-col gap-md\" aria-labelledby=\"heading-id-1\">" +
      "<h2 id=\"heading-id-1\" class=\"text-h2 text-ink-primary\">Marker brand kit</h2>" +
      "<p class=\"text-body-s text-ink-muted\">Marker no brand kit</p></section>" +
      "<section class=\"flex flex-col gap-md\" aria-labelledby=\"heading-id-2\">" +
      "<h2 id=\"heading-id-2\" class=\"text-h2 text-ink-primary\">Marker voice</h2>" +
      "<p class=\"text-body-s text-ink-muted\">Marker no voice</p></section>" +
      "<section class=\"flex flex-col gap-md\" aria-labelledby=\"heading-id-3\">" +
      "<h2 id=\"heading-id-3\" class=\"text-h2 text-ink-primary\">Marker pages</h2><ul class=\"flex flex-col gap-md\">" +
      "<li class=\"flex flex-col gap-xs\"><span class=\"flex items-center gap-xs text-body\">" +
      "<a href=\"/contact\">/contact</a>" +
      "<span class=\"inline-flex items-center rounded-pill px-sm py-xs text-caption font-body tracking-meta bg-status-warning-tint text-status-warning-text\">Marker delegated</span>" +
      "</span><ul class=\"flex flex-wrap gap-sm ps-lg text-body-s\"><li class=\"flex items-center gap-xs\"><a href=\"/contact?preview=idle\">idle</a>" +
      "<span class=\"inline-flex items-center rounded-pill px-sm py-xs text-caption font-body tracking-meta bg-status-warning-tint text-status-warning-text\">Marker delegated</span></li>" +
      "</ul></li></ul></section><section class=\"flex flex-col gap-md\" aria-labelledby=\"heading-id-4\">" +
      "<h2 id=\"heading-id-4\" class=\"text-h2 text-ink-primary\">Marker exports</h2><ul class=\"flex flex-col gap-sm\">" +
      "<li class=\"flex flex-wrap items-center gap-xs text-body-s\">" +
      "<span class=\"inline-flex items-center rounded-pill px-sm py-xs text-caption font-body tracking-meta bg-status-success-tint text-status-success-text\">Marker approved</span>" +
      "<span class=\"text-ink-primary\">Marker og image</span>" +
      "<code class=\"break-all text-ink-secondary\">out/share/og-image.png</code></li></ul></section>" +
      "<section class=\"flex flex-col gap-md\" aria-labelledby=\"heading-id-5\">" +
      "<h2 id=\"heading-id-5\" class=\"text-h2 text-ink-primary\">Marker contact sheet</h2>" +
      "<div class=\"flex flex-col gap-xl overflow-x-auto\"><div class=\"flex flex-col gap-sm\">" +
      "<p class=\"flex items-center gap-xs text-body-s text-ink-secondary\"><span>/contact</span>" +
      "<span class=\"inline-flex items-center rounded-pill px-sm py-xs text-caption font-body tracking-meta bg-status-warning-tint text-status-warning-text\">Marker delegated</span></p><div class=\"flex gap-lg\">" +
      "<iframe src=\"/contact\" title=\"Marker frame /contact base 390\" width=\"390\" height=\"640\" loading=\"lazy\" class=\"shrink-0 border border-line-base\">" +
      "</iframe></div></div><div class=\"flex flex-col gap-sm\"><p class=\"flex items-center gap-xs text-body-s text-ink-secondary\">" +
      "<span>/contact</span><span aria-hidden=\"true\">\u00b7</span><span>idle</span>" +
      "<span class=\"inline-flex items-center rounded-pill px-sm py-xs text-caption font-body tracking-meta bg-status-warning-tint text-status-warning-text\">Marker delegated</span></p><div class=\"flex gap-lg\">" +
      "<iframe src=\"/contact?preview=idle\" title=\"Marker frame /contact idle 390\" width=\"390\" height=\"640\" loading=\"lazy\" class=\"shrink-0 border border-line-base\">" +
      "</iframe></div></div></div></section></main>" +
      "<footer class=\"bg-surface-raised text-ink-primary py-lg border-t border-line-base\" style=\"position:relative;z-index:var(--ui-z-shell, 20);border-top-width:var(--ui-border-hairline, 1px)\">" +
      "<div class=\"mx-auto flex w-full flex-col gap-lg\" style=\"padding-inline:var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))\">" +
      "</div></footer></div>",
    );
  });
});

describe("PackReviewView header slots", () => {
  it("renders headerAction, secondaryAction and nav inside the banner landmark, before the surface badge", () => {
    const { container } = render(
      <PackReviewView
        {...props({
          headerAction: <a href="/contact">Marker action</a>,
          secondaryAction: <a href="/sign-in">Marker secondary</a>,
          nav: <nav aria-label="Primary">Marker nav</nav>,
        })}
      />,
    );
    const banner = container.querySelector(":scope > div > header") as HTMLElement;
    const primary = within(banner).getByRole("link", { name: "Marker action" });
    const secondary = within(banner).getByRole("link", { name: "Marker secondary" });
    const badge = within(banner).getByText("Marker surface");
    expect(within(banner).getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
    expect(secondary.compareDocumentPosition(primary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(primary.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector("main")).not.toHaveTextContent(/Marker action|Marker secondary|Marker nav/);
    expect(container.querySelector("footer")).not.toHaveTextContent(/Marker action|Marker secondary|Marker nav/);
  });

  it("renders no header slot when they are omitted", () => {
    const banner = render(<PackReviewView {...props()} />).container.querySelector(":scope > div > header") as HTMLElement;
    expect(within(banner).queryAllByRole("link")).toHaveLength(0);
    expect(within(banner).queryByRole("navigation")).toBeNull();
  });

  it("passes ground to both the header and the footer", () => {
    const html = renderToStaticMarkup(<PackReviewView {...props({ ground: "transparent" })} />);
    expect(html).toMatch(/^<div class="flex min-h-dvh flex-col"><header class="py-sm" /);
    expect(html).toMatch(/<footer class="text-ink-primary py-lg" /);
  });
});

const STRATEGY: PackReviewViewStrategy = {
  source: "Marker source",
  summary: "Marker summary text",
  context: [{ name: "Marker audience", value: "businesses" }],
  openQuestions: ["Marker question one", "Marker question two"],
};

const BRAND_KIT: PackReviewViewBrandKit = {
  title: "Example Studio",
  usage: "Marker usage",
  assets: [{ role: "logo:0", href: "/pack/export?name=logo%3A0", label: "Marker logo asset" }],
  colors: [{ name: "--color-brand", value: "#123456" }],
  type: [{ name: "--font-display", value: "\"Example Sans\", sans-serif" }],
  facts: [{ name: "Marker fact", value: "Marker fact value" }],
  specimen: { text: "Marker specimen text", faces: [{ name: "--font-display", value: "\"Example Sans\", sans-serif" }] },
};

const VOICE: PackReviewViewVoice = {
  rules: [{ name: "Marker person", value: "Marker person rule" }],
  tagline: "Marker tagline text",
  pitch: [{ name: "Marker one line", value: "Marker pitch text" }],
  boilerplate: [{ name: "Marker short", value: "Marker boilerplate text" }],
  faq: [{ question: "Marker faq question", answer: "Marker faq answer" }],
};

describe("PackReviewView record sections", () => {
  it("shows each section's own empty label when its record is absent, and no guide markup", () => {
    const { container } = render(<PackReviewView {...props()} />);
    expect(within(sectionOf(container, "Marker strategy")).getByText("Marker no strategy")).toBeInTheDocument();
    expect(within(sectionOf(container, "Marker brand kit")).getByText("Marker no brand kit")).toBeInTheDocument();
    expect(within(sectionOf(container, "Marker voice")).getByText("Marker no voice")).toBeInTheDocument();
    expect(container.querySelectorAll("main h3, main h4, main main")).toHaveLength(0);
  });

  it("renders the strategy brief: source, summary, context and open questions", () => {
    const { container } = render(<PackReviewView {...props({ strategy: STRATEGY })} />);
    const section = sectionOf(container, "Marker strategy");
    expect(within(section).queryByText("Marker no strategy")).toBeNull();
    expect([...section.querySelectorAll("h3")].map((h3) => h3.textContent)).toEqual(["Marker summary", "Marker context", "Marker open questions"]);
    expect(within(section).getByText("Marker source")).toBeInTheDocument();
    expect(within(section).getByText("Marker summary text")).toBeInTheDocument();
    expect([...section.querySelectorAll("dt")].map((dt) => dt.textContent)).toEqual(["Marker audience"]);
    expect([...section.querySelectorAll("dd")].map((dd) => dd.textContent)).toEqual(["businesses"]);
    expect([...section.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["Marker question one", "Marker question two"]);
  });

  it("shows the none label for a strategy brief with no summary, context or open question", () => {
    const { container } = render(<PackReviewView {...props({ strategy: { source: "Marker source", context: [], openQuestions: [] } })} />);
    expect(within(sectionOf(container, "Marker strategy")).getAllByText("Marker none")).toHaveLength(3);
  });

  it("renders the brand kit through BrandGuideView, embedded: no second main or h1, a visible heading per part", () => {
    const { container } = render(<PackReviewView {...props({ brandKit: BRAND_KIT })} />);
    const section = sectionOf(container, "Marker brand kit");
    expect(container.querySelectorAll("main")).toHaveLength(1);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(section.querySelector("h3")?.textContent).toBe("Example Studio");
    expect(within(section).getByText("Marker usage")).toBeInTheDocument();
    expect([...section.querySelectorAll("h4")].map((h4) => h4.textContent)).toEqual([
      "Marker assets",
      "Marker colors",
      "Marker type",
      "Marker specimen",
      "Marker brand facts",
    ]);
    for (const part of section.querySelectorAll("h4")) {
      expect(part.closest("section")?.getAttribute("aria-labelledby")).toBe(part.getAttribute("id"));
    }
    expect([...section.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")])).toEqual([["Marker logo asset", "/pack/export?name=logo%3A0"]]);
    expect(within(section).getByText("#123456")).toBeInTheDocument();
    expect(within(section).getByText("Marker fact value")).toBeInTheDocument();
    const specimen = within(section).getByText("Marker specimen text");
    expect(specimen.style.fontFamily).toContain("Example Sans");
    expect(container.querySelectorAll("[aria-label]")).toHaveLength(0);
  });

  it("shows the none label for a brand kit list with no entries", () => {
    const empty: PackReviewViewBrandKit = { title: "Example Studio", usage: "Marker usage", assets: [], colors: [], type: [], facts: [] };
    const { container } = render(<PackReviewView {...props({ brandKit: empty })} />);
    const section = sectionOf(container, "Marker brand kit");
    expect(within(section).getAllByText("Marker none")).toHaveLength(4);
    expect([...section.querySelectorAll("h4")].map((h4) => h4.textContent)).not.toContain("Marker specimen");
  });

  it("refuses a brand-kit asset address that is not same-site, naming the position and not the value", () => {
    for (const href of ["https://example.test/logo.svg", "//example.test/logo.svg", "javascript:alert(1)", "logo.svg"]) {
      let message = "";
      try {
        renderToStaticMarkup(<PackReviewView {...props({ brandKit: { ...BRAND_KIT, assets: [{ role: "logo:0", href, label: "x" }] } })} />);
      } catch (caught) {
        expect(caught).toBeInstanceOf(RenderError);
        message = (caught as Error).message;
      }
      expect(message, href).toContain("brandKit.assets[0].href");
      expect(message).not.toContain("example.test");
      expect(message).not.toContain("alert");
    }
  });

  it("renders the voice and copy: rules, tagline, pitch, boilerplate and FAQ", () => {
    const { container } = render(<PackReviewView {...props({ voice: VOICE })} />);
    const section = sectionOf(container, "Marker voice");
    expect([...section.querySelectorAll("h3")].map((h3) => h3.textContent)).toEqual([
      "Marker rules",
      "Marker tagline",
      "Marker pitch",
      "Marker boilerplate",
      "Marker faq",
    ]);
    expect([...section.querySelectorAll("dt")].map((dt) => dt.textContent)).toEqual(["Marker person", "Marker one line", "Marker short", "Marker faq question"]);
    expect([...section.querySelectorAll("dd")].map((dd) => dd.textContent)).toEqual(["Marker person rule", "Marker pitch text", "Marker boilerplate text", "Marker faq answer"]);
    expect(within(section).getByText("Marker tagline text")).toBeInTheDocument();
  });

  it("shows the none label for each empty voice part and a missing tagline", () => {
    const { container } = render(<PackReviewView {...props({ voice: { rules: [], pitch: [], boilerplate: [], faq: [] } })} />);
    expect(within(sectionOf(container, "Marker voice")).getAllByText("Marker none")).toHaveLength(5);
  });

  it("renders record text in every section as inert text", () => {
    const hostile = '<script>globalThis.hit=1</script><img src=x onerror="globalThis.hit=1">';
    const html = renderToStaticMarkup(
      <PackReviewView
        {...props({
          strategy: { source: hostile, summary: hostile, context: [{ name: hostile, value: hostile }], openQuestions: [hostile] },
          brandKit: {
            title: hostile,
            usage: hostile,
            assets: [{ role: "a", href: "/a", label: hostile }],
            colors: [{ name: hostile, value: hostile }],
            type: [{ name: hostile, value: hostile }],
            facts: [{ name: hostile, value: hostile }],
            specimen: { text: hostile, faces: [{ name: hostile, value: hostile }] },
          },
          voice: { rules: [{ name: hostile, value: hostile }], tagline: hostile, pitch: [{ name: hostile, value: hostile }], boilerplate: [], faq: [{ question: hostile, answer: hostile }] },
        })}
      />,
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toMatch(/font-family:[^"]*onerror/);
  });

  it("reuses BrandGuideView for the brand kit rather than rendering tokens itself", () => {
    const source = readFileSync(join(import.meta.dirname, "PackReviewView.tsx"), "utf8");
    expect(source).toMatch(/import \{ BrandGuideView \} from "\.\/BrandGuideView\.js";/);
    expect(source.match(/<BrandGuideView\b/g)).toHaveLength(1);
    expect(source).toMatch(/<BrandGuideView\s+embedded\b/);
    expect(source).not.toMatch(/brandKit\.(colors|type|facts)\.map|fontFamily|lockupSvg/);
  });
});
