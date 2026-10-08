// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement, ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { CopyRef, CopyRegistry, CopyResolution, CopyResolver } from "@clossys/writer";
import { createCopyResolver } from "@clossys/writer";
import { SITE_MAIN_ID, SiteFrame, siteShellFor } from "../frame/index.js";
import type { SiteFrameConfig } from "../frame/index.js";
import { AuthView } from "../views/AuthView.js";
import { CaptureView } from "../views/CaptureView.js";
import { DocumentView } from "../views/DocumentView.js";
import { PageLayoutHeader } from "./PageLayout.js";

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Fixtures: one header, one card body and one notes line, passed to each view.
// ---------------------------------------------------------------------------

const ref = (id: string): CopyRef => ({ id });

const registry: CopyRegistry = {
  id: "page-layout-fixture",
  locale: "en",
  revision: "1",
  source: { kind: "consumer", reference: "fixtures/page-layout" },
  entries: [
    { id: "doc.title", text: "Page title" },
    { id: "doc.summary", text: "Page subtitle." },
    { id: "doc.section", text: "Details" },
    { id: "doc.body", text: "Card body" },
  ].map((entry) => ({ ...entry, context: "fixture", status: "approved" as const })),
};
const resolveCopyId: CopyResolver = createCopyResolver(registry);

const documentBody = {
  id: "doc",
  title: ref("doc.title"),
  sections: [
    {
      kind: "section" as const,
      id: "details",
      level: 2 as const,
      heading: ref("doc.section"),
      blocks: [{ kind: "paragraph" as const, content: [{ kind: "text" as const, text: ref("doc.body") }] }],
    },
  ],
};

const NOTES = <a href="/elsewhere">Questions? Email us</a>;

interface Fixture {
  readonly name: string;
  /** The view's measure token: the form column or the prose column. */
  readonly measure: "form" | "prose";
  /** The view with the shared title, subtitle, card body and the given notes, and any deprecated chrome props. */
  readonly build: (options?: { notes?: ReactNode; chrome?: Record<string, unknown> }) => ReactElement;
}

const FIXTURES: readonly Fixture[] = [
  {
    name: "CaptureView",
    measure: "prose",
    build: ({ notes, chrome } = {}) => (
      <CaptureView heading="Page title" description="Page subtitle." form={<p>Card body</p>} notes={notes} {...chrome} />
    ),
  },
  {
    name: "AuthView",
    measure: "form",
    build: ({ notes, chrome } = {}) => (
      <AuthView heading="Page title" description="Page subtitle." form={<p>Card body</p>} notes={notes} {...chrome} />
    ),
  },
  {
    name: "DocumentView",
    measure: "prose",
    build: ({ notes, chrome } = {}) => (
      <DocumentView document={documentBody} resolveCopyId={resolveCopyId} summary={ref("doc.summary")} action={notes} {...chrome} />
    ),
  },
];

const COPY: Readonly<Record<string, string>> = {
  "brand.label": "Example home",
  "brand.name": "Example",
  skip: "Skip to content",
  "legal.entity": "Example Ltd",
  "legal.privacy": "Privacy",
  "legal.label": "Legal",
};
const resolveShellCopy: CopyResolver = (copyRef) => {
  const text = COPY[copyRef.id];
  if (text === undefined) return undefined;
  const resolution: CopyResolution = {
    ref: copyRef,
    text,
    recordId: `record-${copyRef.id}`,
    revision: "1",
    locale: "en-US",
    source: { kind: "consumer", reference: "fixture" },
    entryId: copyRef.id,
  };
  return resolution;
};
const BRAND_ASSET = { type: "image", src: "/brand/mark.svg", width: 48, height: 48, alt: "Example mark" };
const resolveAsset = (assetId: string): unknown => (assetId === "brand-mark" ? BRAND_ASSET : undefined);
const SHELL_CONFIG: SiteFrameConfig = {
  brand: { assetId: "brand-mark", label: ref("brand.label"), size: "md", variant: "lockup", wordmark: ref("brand.name") },
  skipLink: ref("skip"),
  origin: "https://example.com",
  legal: { entity: ref("legal.entity"), links: [{ href: "/privacy", label: ref("legal.privacy") }], linksLabel: ref("legal.label") },
};

function framed(child: ReactElement): ReactElement {
  return (
    <SiteFrame shell={siteShellFor(SHELL_CONFIG, "front-door")} resolveCopy={resolveShellCopy} resolveAsset={resolveAsset}>
      {child}
    </SiteFrame>
  );
}

/** Landmarks as a browser computes them: header/footer count as banner/contentinfo only outside main and sectioning content. */
function landmarks(container: HTMLElement) {
  const all = (selector: string) => [...container.querySelectorAll(selector)] as HTMLElement[];
  const outsideSectioning = (element: HTMLElement) => element.parentElement?.closest("main, article, aside, nav, section") === null;
  return {
    mains: all("main"),
    banners: all("header").filter(outsideSectioning),
    contentinfos: all("footer").filter(outsideSectioning),
    skipLinks: all(`a[href="#${SITE_MAIN_ID}"]`),
    h1s: all("h1"),
  };
}

/** The layout's column: the view's chrome-free root, or the legacy page's `<main>`. */
function column(container: HTMLElement): HTMLElement {
  return (container.querySelector("main") ?? container.firstElementChild) as HTMLElement;
}

/** The layout's three slots, found by position in the column: header, the card (and what wraps it), the notes. */
function slots(container: HTMLElement) {
  const root = column(container);
  const header = root.firstElementChild as HTMLElement;
  const card = root.querySelector(".rounded-control") as HTMLElement;
  let body: HTMLElement = card;
  while (body.parentElement !== root) body = body.parentElement as HTMLElement;
  return { root, header, card, body, notes: body.nextElementSibling as HTMLElement | null };
}

describe("page layout: header, body card and notes", () => {
  describe.each(FIXTURES)("$name", (fixture) => {
    it("renders the title as the one h1, with the subtitle directly under it", () => {
      render(fixture.build());
      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
      const h1 = screen.getByRole("heading", { level: 1, name: "Page title" });
      expect(h1.nextElementSibling).toHaveTextContent("Page subtitle.");
    });

    it("puts the body in a card after the header, and the notes after the card", () => {
      const { container } = render(fixture.build({ notes: NOTES }));
      const { root, header, card, body, notes } = slots(container);
      expect([...root.children]).toEqual([header, body, notes]);
      expect(card).toHaveTextContent("Card body");
      expect(notes).toContainElement(screen.getByRole("link", { name: "Questions? Email us" }));
      expect(card).not.toContainElement(notes);
    });

    it("centres the column, the header and the notes, and keeps the card's own content start-aligned", () => {
      const { container } = render(fixture.build({ notes: NOTES }));
      const { root, header, card, notes } = slots(container);
      expect(root.className).toContain("mx-auto");
      for (const part of [header, notes!]) {
        expect(part.className).toContain("items-center");
        expect(part.className).toContain("text-center");
      }
      expect(card.className).toContain("text-start");
    });

    it("takes its column measure from a token, with no raw-length fallback", () => {
      const { container } = render(fixture.build());
      expect(column(container).style.maxWidth).toBe(`var(--ui-width-${fixture.measure}-max, none)`);
    });

    it.each([
      ["undefined", undefined],
      ["null", null],
      ["false", false],
      ["an empty string", ""],
      ["an empty list", []],
    ])("omits the notes element when notes is %s", (_label, empty) => {
      const { container } = render(fixture.build({ notes: empty as ReactNode }));
      const { root, body } = slots(container);
      expect(body.nextElementSibling).toBeNull();
      expect(root.lastElementChild).toBe(body);
    });

    it("renders no header, footer or main of its own, and exactly one h1", () => {
      const { container } = render(fixture.build({ notes: NOTES }));
      expect(container.firstElementChild?.tagName).toBe("DIV");
      expect(container.querySelector("header, main, footer, nav, [role='main'], [role='banner'], [role='contentinfo']")).toBeNull();
      expect(container.querySelectorAll("h1")).toHaveLength(1);
      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    });

    it("inside SiteFrame leaves exactly one skip link, banner, main (with the frame's id), contentinfo and h1", () => {
      const { container } = render(framed(fixture.build({ notes: NOTES })));
      const found = landmarks(container);
      expect(found.skipLinks).toHaveLength(1);
      expect(found.banners).toHaveLength(1);
      expect(found.mains).toHaveLength(1);
      expect(found.mains[0]).toHaveAttribute("id", SITE_MAIN_ID);
      expect(found.contentinfos).toHaveLength(1);
      expect(found.h1s).toHaveLength(1);
      expect(found.mains[0]).toContainElement(found.h1s[0]!);
    });

    it("keeps the same header, card and notes on the deprecated legacy page, which adds its own banner, main and footer", () => {
      const content = render(fixture.build({ notes: NOTES }));
      const contentSlots = slots(content.container);
      const expected = [contentSlots.header.outerHTML, contentSlots.body.outerHTML, contentSlots.notes!.outerHTML];
      content.unmount();

      const legacy = render(fixture.build({ notes: NOTES, chrome: { brand: "Acme" } }));
      const found = landmarks(legacy.container);
      expect(found.mains).toHaveLength(1);
      expect(found.banners).toHaveLength(1);
      expect(found.contentinfos).toHaveLength(1);
      expect(found.h1s).toHaveLength(1);
      const legacySlots = slots(legacy.container);
      expect(legacySlots.root).toBe(found.mains[0]);
      expect([legacySlots.header.outerHTML, legacySlots.body.outerHTML, legacySlots.notes!.outerHTML]).toEqual(expected);
    });
  });

  it("gives every view the same header, card and notes markup around different content", () => {
    const signatures = FIXTURES.map((fixture) => {
      const { container, unmount } = render(fixture.build({ notes: NOTES }));
      const { header, card, notes } = slots(container);
      const classes = (element: Element | null | undefined) => element?.className ?? null;
      const h1 = header.querySelector("h1");
      const signature = {
        header: classes(header),
        h1: classes(h1),
        subtitle: classes(h1?.nextElementSibling),
        card: card.className.split(/\s+/).includes("text-start"),
        notes: classes(notes),
      };
      unmount();
      return signature;
    });
    for (const signature of signatures.slice(1)) expect(signature).toEqual(signatures[0]);
  });

  it("builds each view's header from the one shared header component, which a card-free layout reuses", () => {
    for (const fixture of FIXTURES) {
      const { container, unmount } = render(fixture.build());
      const view = slots(container).header.outerHTML;
      unmount();
      const shared = render(<PageLayoutHeader title="Page title" subtitle="Page subtitle." />);
      expect(view).toBe(shared.container.innerHTML);
      shared.unmount();
    }
    const titleOnly = render(<PageLayoutHeader title="Only a title" />);
    expect(titleOnly.container.querySelectorAll("h1")).toHaveLength(1);
    expect(titleOnly.container.querySelector("p")).toBeNull();
  });

  it("ships no copy of its own: the only words are the props", () => {
    const { container } = render(<CaptureView heading="H" description="D" form={<p>F</p>} notes={<p>N</p>} />);
    expect(container.textContent).toBe("HDFN");
  });
});

describe("the README", () => {
  it("shows CaptureView, DocumentView and AuthView side by side in the page layout section", () => {
    const readme = readFileSync(join(import.meta.dirname, "..", "..", "..", "README.md"), "utf8");
    const start = readme.indexOf("\n### Page layout");
    expect(start).toBeGreaterThan(-1);
    const rest = readme.slice(start + 4);
    const end = rest.search(/\n##+ /);
    const section = end === -1 ? rest : rest.slice(0, end);
    const fences = [...section.matchAll(/```tsx\n([\s\S]*?)```/g)].map((match) => match[1]!);
    const together = fences.find((fence) => ["CaptureView", "DocumentView", "AuthView"].every((view) => fence.includes(`<${view}`)));
    expect(together).toBeDefined();
  });
});
