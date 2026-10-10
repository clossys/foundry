// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement, ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { CopyRef, CopyResolution, CopyResolver } from "@clossys/writer";
import { SITE_MAIN_ID, SiteFrame, siteShellFor } from "../frame/index.js";
import type { SiteFrameConfig } from "../frame/index.js";
import { CaptureView } from "../views/CaptureView.js";
import { StatusView } from "../views/StatusView.js";
import * as webIndex from "../index.js";
import * as webServer from "../server.js";
import * as webClient from "../client.js";
import { CardlessPageLayout, PageLayoutHeader } from "./PageLayout.js";

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Fixtures: one header, one action and one notes line, passed to each view.
// ---------------------------------------------------------------------------

const ACTION = <a href="/">Back to home</a>;
const NOTES = <a href="/contact">Contact us</a>;

interface Fixture {
  readonly name: string;
  readonly build: (options?: { action?: ReactNode; notes?: ReactNode; subtitle?: ReactNode }) => ReactElement;
}

const FIXTURES: readonly Fixture[] = [
  {
    name: "StatusView",
    build: ({ action = ACTION, notes, subtitle = "Page subtitle." } = {}) => (
      <StatusView status="Page title" subtitle={subtitle} action={action} notes={notes} />
    ),
  },
];

const ref = (id: string): CopyRef => ({ id });
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

/** The view's chrome-free root and the layout's slots, by position: header, action, notes. */
function slots(container: HTMLElement) {
  const root = container.firstElementChild as HTMLElement;
  const [header, action, notes] = [...root.children] as (HTMLElement | undefined)[];
  return { root, header: header!, action: action ?? null, notes: notes ?? null };
}

describe("card-free layout: header, action and notes", () => {
  describe.each(FIXTURES)("$name", (fixture) => {
    it("renders the title as the one h1, with the subtitle directly under it", () => {
      render(fixture.build());
      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
      const h1 = screen.getByRole("heading", { level: 1, name: "Page title" });
      expect(h1.nextElementSibling).toHaveTextContent("Page subtitle.");
      expect(screen.queryAllByRole("heading")).toHaveLength(1);
    });

    it("puts the action after the header and the notes after the action, with no card", () => {
      const { container } = render(fixture.build({ notes: NOTES }));
      const { root, header, action, notes } = slots(container);
      expect(root.children).toHaveLength(3);
      expect(header).toContainElement(screen.getByRole("heading", { level: 1 }));
      expect(action).toContainElement(screen.getByRole("link", { name: "Back to home" }));
      expect(notes).toContainElement(screen.getByRole("link", { name: "Contact us" }));
      expect(container.querySelector(".rounded-control")).toBeNull();
    });

    it("centres the column, the header, the action and the notes", () => {
      const { container } = render(fixture.build({ notes: NOTES }));
      const { root, header, action, notes } = slots(container);
      expect(root.className).toContain("mx-auto");
      expect(root.className).toContain("justify-center");
      for (const part of [header, action!, notes!]) expect(part.className).toContain("items-center");
      expect(notes!.className).toContain("text-center");
    });

    it("takes the form measure from a token, with no raw-length fallback", () => {
      const { container } = render(fixture.build());
      expect(slots(container).root.style.maxWidth).toBe("var(--ui-width-form-max, none)");
    });

    it.each([
      ["undefined", undefined],
      ["null", null],
      ["false", false],
      ["an empty string", ""],
      ["an empty list", []],
    ])("omits the notes element when notes is %s", (_label, empty) => {
      const { container } = render(fixture.build({ notes: empty as ReactNode }));
      const { root, action } = slots(container);
      expect(root.children).toHaveLength(2);
      expect(root.lastElementChild).toBe(action);
    });

    it("renders no header, footer or main of its own, and exactly one h1", () => {
      const { container } = render(fixture.build({ notes: NOTES }));
      expect(container.firstElementChild?.tagName).toBe("DIV");
      expect(container.querySelector("header, main, footer, nav, [role='main'], [role='banner'], [role='contentinfo']")).toBeNull();
      expect(container.querySelectorAll("h1")).toHaveLength(1);
    });

    it("inside SiteFrame leaves exactly one main (with the frame's id) holding the one h1", () => {
      const { container } = render(framed(fixture.build({ notes: NOTES })));
      const mains = container.querySelectorAll("main");
      expect(mains).toHaveLength(1);
      expect(mains[0]).toHaveAttribute("id", SITE_MAIN_ID);
      expect(container.querySelectorAll("h1")).toHaveLength(1);
      expect(mains[0]).toContainElement(container.querySelector("h1"));
    });

    it("builds its header from the one shared header component that the card layout uses", () => {
      const { container, unmount } = render(fixture.build());
      const view = slots(container).header.outerHTML;
      unmount();
      const shared = render(<PageLayoutHeader title="Page title" subtitle="Page subtitle." />);
      expect(view).toBe(shared.container.innerHTML);
      shared.unmount();
      const card = render(<CaptureView heading="Page title" description="Page subtitle." form={<p>Card body</p>} />);
      expect((card.container.firstElementChild as HTMLElement).firstElementChild?.outerHTML).toBe(view);
    });

    it("refuses a landmark role or the frame's main id on its content root", () => {
      const element = fixture.build();
      const View = element.type as (props: object) => ReactElement;
      expect(() => render(<View {...(element.props as object)} role="main" />)).toThrow(new RegExp(`${fixture.name}: the content root`));
      expect(() => render(<View {...(element.props as object)} id={SITE_MAIN_ID} />)).toThrow(new RegExp(`${fixture.name}: the content root`));
    });
  });

  it("omits the action element when the action is empty", () => {
    for (const empty of [undefined, null, false, "", []]) {
      const { container, unmount } = render(<CardlessPageLayout title="T" subtitle="S" action={empty as ReactNode} />);
      expect(container.children).toHaveLength(1);
      unmount();
    }
  });

  it("renders a status-only placeholder page as the header alone", () => {
    const { container } = render(<StatusView status="Only a title" />);
    const { root } = slots(container);
    expect(root.children).toHaveLength(1);
    expect(root.querySelector("p")).toBeNull();
  });

  it("ships no copy of its own: the only words are the props", () => {
    expect(render(<StatusView status="T" subtitle="S" action={<a href="/">A</a>} notes={<p>N</p>} />).container.textContent).toBe("TSAN");
    cleanup();
    expect(render(<StatusView status={404} subtitle="S" action={<a href="/">A</a>} notes={<p>N</p>} />).container.textContent).toBe("404SAN");
  });

  it("is exported from the web entry, its server entry and, for StatusView, the browser client entry", () => {
    expect(webIndex.StatusView).toBe(StatusView);
    // The server entry reaches the views through the package's own import map, a separate module instance.
    expect("ConstructionView" in webIndex).toBe(false);
    expect("ConstructionView" in webServer).toBe(false);
    expect(webServer.StatusView.name).toBe("StatusView");
    expect(webClient.StatusView).toBe(StatusView);
  });
});

describe("the README", () => {
  it("shows StatusView in the card-free layout section and marks construction pages noindex", () => {
    const readme = readFileSync(join(import.meta.dirname, "..", "..", "..", "README.md"), "utf8");
    const start = readme.indexOf("\n### Card-free layout");
    expect(start).toBeGreaterThan(-1);
    const rest = readme.slice(start + 4);
    const end = rest.search(/\n##+ /);
    const section = end === -1 ? rest : rest.slice(0, end);
    const fences = [...section.matchAll(/```tsx\n([\s\S]*?)```/g)].map((match) => match[1]!);
    expect(fences.find((fence) => fence.includes("<StatusView"))).toBeDefined();
    expect(readme).not.toContain("ConstructionView");
    expect(section).toContain("`construction` page kind");
  });
});
