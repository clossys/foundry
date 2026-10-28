// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import type { CopyResolver } from "@clossys/writer";
import { resolveSectionedViewDocument, validateSectionedViewDocument } from "../../core/sectioned-view.js";
import type { ResolvedSectionedViewDocument, SectionedViewDocument, SectionedViewGround } from "../../core/sectioned-view.js";
import { LandingView } from "@clossys/designer/frames";
import { ServerLandingView as ServerLandingView } from "@clossys/designer/frames";
import { SectionedView } from "./SectionedView.js";
import { SectionedView as ServerSectionedView } from "./SectionedView.server.js";

const resolveCopy: CopyResolver = ref => ({ ref, text: ref.id, recordId: ref.id, revision: "1", locale: "en", source: { kind: "consumer", reference: "fixture" }, entryId: ref.id });
const resolution = resolveCopy({ id: "Welcome" })!;
const OPTIONS = [
  ["eyebrowTone", "accent"], ["eyebrowTone", "muted"],
  ["measure", "prose"], ["measure", "wide"],
  ["headingScale", "default"], ["headingScale", "display"],
] as const;
const FIELDS = ["eyebrowTone", "measure", "headingScale"] as const;
const DEFAULTS = { eyebrowTone: "accent", measure: "prose", headingScale: "default" } as const;
const OPTED_IN = { eyebrowTone: "muted", measure: "wide", headingScale: "display" } as const;
const VIEWS = [
  { name: "LandingView", View: LandingView },
  { name: "server LandingView", View: ServerLandingView },
  { name: "SectionedView", View: SectionedView },
  { name: "server SectionedView", View: ServerSectionedView },
] as const;

function authored(options: Record<string, unknown> = {}): SectionedViewDocument {
  return {
    id: "example-home",
    sections: [{ id: "hero", kind: "hero", ground: "base", eyebrow: { id: "News" }, heading: { id: "Welcome" }, description: { id: "Supporting copy" }, ...options }],
  } as SectionedViewDocument;
}

function resolved(options: Record<string, unknown> = {}): ResolvedSectionedViewDocument {
  return {
    id: "example-home", resolutions: [resolution],
    sections: [{ id: "hero", kind: "hero", ground: "base", eyebrow: "News", heading: "Welcome", description: "Supporting copy", ...options }],
  } as ResolvedSectionedViewDocument;
}

function output(element: ReactElement, mode: "ssr" | "client"): HTMLElement {
  if (mode === "client") return render(element).container;
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(element);
  return root;
}

function refusal(action: () => unknown, field: string): void {
  let error: unknown;
  try { action(); } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toContain(field);
  expect((error as Error).message).not.toContain("PAYLOAD-SENTINEL");
}

afterEach(cleanup);

describe("hero parity authored inputs", () => {
  it.each(OPTIONS)("accepts and retains %s=%s", (field, value) => {
    const source = authored({ [field]: value });
    expect(validateSectionedViewDocument(source)).toEqual([]);
    expect(resolveSectionedViewDocument(source, resolveCopy).sections[0]).toHaveProperty(field, value);
  });

  it.each(FIELDS)("refuses invalid authored %s without echoing its value", field => {
    const source = authored({ [field]: "PAYLOAD-SENTINEL" });
    const findings = validateSectionedViewDocument(source);
    expect(findings.some(finding => finding.path === `sections.0.${field}`)).toBe(true);
    expect(JSON.stringify(findings)).not.toContain("PAYLOAD-SENTINEL");
    refusal(() => resolveSectionedViewDocument(source, resolveCopy), field);
  });

  it("leaves omitted hero controls absent after copy resolution", () => {
    const hero = resolveSectionedViewDocument(authored(), resolveCopy).sections[0]!;
    for (const field of FIELDS) expect(Object.hasOwn(hero, field)).toBe(false);
  });
});

for (const { name, View } of VIEWS) {
  describe(name, () => {
    it.each(FIELDS)("refuses invalid direct resolved %s without echoing its value", field => {
      refusal(() => renderToStaticMarkup(<View document={resolved({ [field]: "PAYLOAD-SENTINEL" })} landmark="none" />), field);
    });

    for (const mode of ["ssr", "client"] as const) {
      it(`${mode} keeps omitted and explicit hero defaults byte-identical`, () => {
        const omitted = output(<View document={resolved()} landmark="none" />, mode);
        const explicit = output(<View document={resolved(DEFAULTS)} landmark="none" />, mode);
        expect(explicit.innerHTML).toBe(omitted.innerHTML);
        const intro = omitted.querySelector<HTMLElement>("[data-section-intro]")!;
        expect(intro.style.maxWidth).toBe("var(--ui-width-prose-max, 48rem)");
        expect(intro.querySelector("p")).toHaveClass("text-accent-text");
        expect(intro.querySelector("h1")).not.toHaveClass("tablet-lg:text-display-xl");
      });

      for (const ground of ["base", "sunken", "inverse"] as const satisfies readonly SectionedViewGround[]) {
        for (const size of ["display", "compact"] as const) {
          it(`${mode} forwards muted, wide and display controls on ${ground} ${size} hero`, () => {
            const root = output(<View document={resolved({ ...OPTED_IN, ground, size })} landmark="none" />, mode);
            const intro = root.querySelector<HTMLElement>("[data-section-intro]")!;
            const eyebrow = intro.querySelector("p")!;
            const heading = intro.querySelector("h1")!;
            const body = intro.querySelector<HTMLElement>("p.text-body-l")!;
            expect(eyebrow).toHaveClass(ground === "inverse" ? "text-ink-on-inverse-muted" : "text-ink-secondary");
            expect(eyebrow).not.toHaveClass("text-accent-text");
            expect(intro.style.maxWidth).toBe("none");
            expect(body.style.maxWidth).toBe("var(--ui-width-hero-wide, 64rem)");
            expect(heading).toHaveClass("text-display-m", "tablet:text-display-l", "tablet-lg:text-display-xl");
            expect(heading).toHaveClass(ground === "inverse" ? "text-ink-on-inverse" : "text-ink-primary");
            expect(root.querySelectorAll("h1")).toHaveLength(1);
          });
        }
      }
    }
  });
}
