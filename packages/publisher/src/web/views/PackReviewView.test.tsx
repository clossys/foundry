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
import type { PackReviewViewLabels, PackReviewViewProps } from "./PackReviewView.js";

afterEach(cleanup);

const LABELS: PackReviewViewLabels = {
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
    const section = container.querySelector('section[aria-label="Marker pages"]') as HTMLElement;
    expect(within(section).getByRole("heading", { level: 2 }).textContent).toBe("Marker pages");
    const links = [...section.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toEqual([
      ["/", "/"],
      ["/contact", "/contact"],
      ["idle", "/contact?preview=idle"],
      ["accepted", "/contact?preview=accepted"],
    ]);
    expect(within(section).getByText("Marker draft")).toBeInTheDocument();
    expect(within(section).getByText("Marker delegated")).toBeInTheDocument();
  });

  it("lists each export with its kind, badge, path as text, and a width only where one is given", () => {
    const { container } = render(<PackReviewView {...props()} />);
    const section = container.querySelector('section[aria-label="Marker exports"]') as HTMLElement;
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
    const html = renderToStaticMarkup(
      <PackReviewView
        {...props({
          pages: [{ id: "/contact", href: "/contact", status: "delegated", states: [{ id: "idle", href: "/contact?preview=idle" }] }],
          exports: [{ id: "share-card:0", kind: "og-image", path: "out/share/og-image.png", status: "approved" }],
          widths: [390],
        })}
      />,
    );
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
      "<section class=\"flex flex-col gap-md\" aria-label=\"Marker pages\">" +
      "<h2 class=\"text-h2 text-ink-primary\">Marker pages</h2><ul class=\"flex flex-col gap-md\">" +
      "<li class=\"flex flex-col gap-xs\"><span class=\"flex items-center gap-xs text-body\">" +
      "<a href=\"/contact\">/contact</a>" +
      "<span class=\"inline-flex items-center rounded-pill px-sm py-xs text-caption font-body tracking-meta bg-status-warning-tint text-status-warning-text\">Marker delegated</span>" +
      "</span><ul class=\"flex flex-wrap gap-sm ps-lg text-body-s\"><li><a href=\"/contact?preview=idle\">idle</a></li>" +
      "</ul></li></ul></section><section class=\"flex flex-col gap-md\" aria-label=\"Marker exports\">" +
      "<h2 class=\"text-h2 text-ink-primary\">Marker exports</h2><ul class=\"flex flex-col gap-sm\">" +
      "<li class=\"flex flex-wrap items-center gap-xs text-body-s\">" +
      "<span class=\"inline-flex items-center rounded-pill px-sm py-xs text-caption font-body tracking-meta bg-status-success-tint text-status-success-text\">Marker approved</span>" +
      "<span class=\"text-ink-primary\">Marker og image</span>" +
      "<code class=\"break-all text-ink-secondary\">out/share/og-image.png</code></li></ul></section>" +
      "<section class=\"flex flex-col gap-md\" aria-label=\"Marker contact sheet\">" +
      "<h2 class=\"text-h2 text-ink-primary\">Marker contact sheet</h2>" +
      "<div class=\"flex flex-col gap-xl overflow-x-auto\"><div class=\"flex flex-col gap-sm\">" +
      "<p class=\"flex gap-xs text-body-s text-ink-secondary\"><span>/contact</span></p><div class=\"flex gap-lg\">" +
      "<iframe src=\"/contact\" title=\"Marker frame /contact base 390\" width=\"390\" height=\"640\" loading=\"lazy\" class=\"shrink-0 border border-line-base\">" +
      "</iframe></div></div><div class=\"flex flex-col gap-sm\"><p class=\"flex gap-xs text-body-s text-ink-secondary\">" +
      "<span>/contact</span><span>idle</span></p><div class=\"flex gap-lg\">" +
      "<iframe src=\"/contact?preview=idle\" title=\"Marker frame /contact idle 390\" width=\"390\" height=\"640\" loading=\"lazy\" class=\"shrink-0 border border-line-base\">" +
      "</iframe></div></div></div></section></main>" +
      "<footer class=\"bg-surface-raised text-ink-primary py-lg border-t border-line-base\" style=\"position:relative;z-index:var(--ui-z-shell, 20);border-top-width:var(--ui-border-hairline, 1px)\">" +
      "<div class=\"mx-auto flex w-full flex-col gap-lg\" style=\"padding-inline:var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))\">" +
      "</div></footer></div>",
    );
  });
});
