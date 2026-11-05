/** @vitest-environment node */
import { createCopyResolver, computeCopyFingerprint, type CopyEntryStatus, type CopyRegistry } from "@clossys/writer";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { resolveSectionedViewDocument } from "../../core/sectioned-view.js";
import { SectionedView } from "./SectionedView.js";
import { SectionedView as ServerSectionedView } from "./SectionedView.server.js";
import { renderSectionedViewSections } from "./SectionedViewContent.js";
import { sectionedViewBlocks } from "./SectionedViewBlocks.js";

const heading = "Consumer publication";
const now = new Date("2026-09-27T00:00:00.000Z");
function registry(status: CopyEntryStatus): CopyRegistry {
  return { id: "consumer-document", revision: "1", locale: "en", source: { kind: "consumer", reference: "fixture" }, entries: [
    { id: "publication.heading", text: heading, context: "Test heading", status, ...(status === "approved" ? { approval: { approvedBy: "owner" as const, approvedAt: "2026-08-01T00:00:00.000Z", textFingerprint: computeCopyFingerprint(heading), fingerprintAlgorithm: "sha256" as const } } : {}) },
  ] };
}
const authored = { id: "publication", sections: [{ id: "intro", kind: "hero" as const, ground: "base" as const, heading: { id: "publication.heading", locale: "en" } }] };
function approvedDocument() { return resolveSectionedViewDocument(authored, createCopyResolver(registry("approved"), { target: "production", now })); }

it("renders actual Writer preview draft provenance through client and server views without approving it", () => {
  const source = registry("draft");
  const document = resolveSectionedViewDocument(authored, createCopyResolver(source, { target: "preview", now }));
  expect(document.resolutions[0]).toMatchObject({ status: "draft", recordId: source.id, revision: source.revision, entryId: "publication.heading", source: source.source });
  expect(document.resolutions[0]).not.toHaveProperty("approval");
  const before = JSON.stringify(document), resolution = document.resolutions[0];
  const html = renderToStaticMarkup(<SectionedView document={document} />);
  expect(html).toContain(heading);
  expect(renderToStaticMarkup(<ServerSectionedView document={document} />)).toBe(html);
  expect(JSON.stringify(document)).toBe(before); expect(document.resolutions[0]).toBe(resolution);
  expect(createCopyResolver(source, { target: "production", now })(authored.sections[0].heading)).toBeUndefined();
});
it("retains the genuine production approved shape without adding lifecycle metadata", () => {
  const document = approvedDocument();
  expect(document.resolutions[0]).not.toHaveProperty("status");
  expect(document.resolutions[0]!.approval).toEqual({ approvedBy: "owner", pendingOwnerReview: false });
  expect(renderToStaticMarkup(<SectionedView document={document} />)).toContain(heading);
});
it.each(["draft", "approved", "retired"] satisfies CopyEntryStatus[])("treats known %s status only as recorded provenance", status => {
  const document = approvedDocument(); document.resolutions[0]!.status = status;
  const before = JSON.stringify(document);
  expect(renderToStaticMarkup(<SectionedView document={document} />)).toContain(heading);
  expect(JSON.stringify(document)).toBe(before);
  expect(createCopyResolver(registry("retired"), { target: "production", now })(authored.sections[0].heading)).toBeUndefined();
});
it.each(["published", "", null, 0, true, {}, ["draft"]])("refuses unknown lifecycle metadata %j before Designer", status => {
  const document = approvedDocument(); Object.assign(document.resolutions[0]!, { status });
  const called = vi.fn();
  expect(() => renderSectionedViewSections(document, { ...sectionedViewBlocks, Hero: called }, {})).toThrow(/CopyResolution provenance/);
  expect(called).not.toHaveBeenCalled();
});
it.each(["extra", "source", "approval", "getter"])("keeps strict %s provenance refusal when status is present", defect => {
  const document = approvedDocument(), resolution = document.resolutions[0]!; resolution.status = "draft";
  const getter = vi.fn(() => "draft"), called = vi.fn();
  if (defect === "extra") Object.assign(resolution, { otherStatus: "draft" });
  if (defect === "source") resolution.source.reference = "";
  if (defect === "approval") Object.assign(resolution.approval!, { pendingOwnerReview: true });
  if (defect === "getter") Object.defineProperty(resolution, "status", { enumerable: true, get: getter });
  expect(() => renderSectionedViewSections(document, { ...sectionedViewBlocks, Hero: called }, {})).toThrow();
  expect(called).not.toHaveBeenCalled(); expect(getter).not.toHaveBeenCalled();
});
