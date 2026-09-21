/**
 * Issue #1053 — SectionedView closed kinds refuse unknown shapes at validate
 * and resolve time and name the unsupported kind.
 */

import { describe, expect, it } from "vitest";
import type { CopyRegistry, CopyResolver } from "@clossys/writer";
import { createCopyResolver } from "@clossys/writer";
import { resolveSectionedViewDocument, SectionedViewResolutionError, validateSectionedViewDocument } from "./sectioned-view.js";
import type { SectionedViewDocument } from "./sectioned-view.js";

const ref = (id: string) => ({ id });

const registry: CopyRegistry = {
  id: "acme-closed-kinds-fixture",
  locale: "en",
  revision: "1",
  source: { kind: "consumer", reference: "fixtures/acme-closed-kinds" },
  entries: [{ id: "acme.hero.heading", text: "Acme placeholder heading", context: "fixture", status: "approved" }],
};

const resolver: CopyResolver = createCopyResolver(registry);

describe("SectionedView — unknown section kinds refuse and name the kind", () => {
  const unknownKind = "statement-band";

  const documentWithUnknownKind: SectionedViewDocument = {
    id: "acme-statement-page",
    sections: [
      {
        id: "welcome",
        kind: "hero",
        ground: "base",
        heading: ref("acme.hero.heading"),
      },
      {
        id: "statement",
        kind: unknownKind,
        ground: "base",
        heading: ref("acme.hero.heading"),
        body: ref("acme.hero.heading"),
      } as SectionedViewDocument["sections"][number],
    ],
  };

  it("validateSectionedViewDocument reports sectioned-view-section-kind and names the unsupported kind", () => {
    const findings = validateSectionedViewDocument(documentWithUnknownKind);
    expect(findings.map((entry) => entry.rule)).toContain("sectioned-view-section-kind");
    expect(findings.find((entry) => entry.rule === "sectioned-view-section-kind")?.message).toContain(unknownKind);
  });

  it("resolveSectionedViewDocument refuses with unsupported-section-kind and names the unsupported kind", () => {
    try {
      resolveSectionedViewDocument(documentWithUnknownKind, resolver);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SectionedViewResolutionError);
      expect((error as SectionedViewResolutionError).reason).toBe("unsupported-section-kind");
      expect((error as Error).message).toContain(unknownKind);
    }
  });
});
