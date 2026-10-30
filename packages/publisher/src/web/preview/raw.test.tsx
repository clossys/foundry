import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ContentRoutePage, ContentRouteNeedsError, prepareContentRoute } from "../content-route.js";
import { RawContentPreview } from "./raw.js";
import { ContentPreviewRefusal, previewContentRouteInput } from "./selection.js";
import { PREVIEW_LEGACY_ALIAS, PREVIEW_SLOT, previewFixture } from "./__fixtures__/input.js";

describe("raw content preview", () => {
  it("is the exact PB-5 active render, including the registered legacy example alias", () => {
    const input = previewFixture(), before = structuredClone(input);
    const expected = renderToStaticMarkup(<ContentRoutePage input={input} />);
    expect(previewContentRouteInput(input)).toBe(input);
    expect(renderToStaticMarkup(<RawContentPreview input={input} />)).toBe(expected);
    expect(renderToStaticMarkup(<RawContentPreview input={{ ...input, slotId: PREVIEW_LEGACY_ALIAS }} />)).toBe(expected);
    expect(input.registry.slots[0]?.id).toBe(PREVIEW_SLOT);
    expect(input).toEqual(before);
  });
  it("renders the chosen candidate's pinned snapshot rather than current content", () => {
    const input = previewFixture(), before = structuredClone(input);
    const selected = previewContentRouteInput(input, { candidateId: "c2", revision: "r1" });
    const html = renderToStaticMarkup(<RawContentPreview input={input} candidateId="c2" revision="r1" />);
    expect(html).toBe(renderToStaticMarkup(<ContentRoutePage input={selected} />));
    expect(html).toContain("Earlier body"); expect(html).toContain("Earlier page");
    expect(html).not.toContain("Later body"); expect(html).not.toContain("Later page");
    expect(html).not.toContain("later-icon");
    expect(selected.registry.candidates.find(candidate => candidate.id === "c2")?.history).toHaveLength(1);
    expect(selected.registry.candidates.find(candidate => candidate.id === "c1")?.state).toBe("draft");
    expect(input).toEqual(before);
  });
  it("defaults explicit candidate selection to its current immutable revision", () => {
    const input = previewFixture();
    const html = renderToStaticMarkup(<RawContentPreview input={input} candidateId="c2" />);
    expect(html).toContain("Later body"); expect(html).toContain("Later page");
    expect(renderToStaticMarkup(<RawContentPreview input={input} revision="r1" />)).toBe(renderToStaticMarkup(<ContentRoutePage input={input} />));
  });
  it("keeps stored release evidence and approvals untouched during a historical preview", () => {
    const base = previewFixture();
    const input = { ...base, registry: { ...base.registry, slots: base.registry.slots.map(slot => ({ ...slot, releases: [{ n: 1, candidateId: "c2", revision: "r2" as const, at: base.raisedAt }] })) } };
    const before = structuredClone(input);
    expect(renderToStaticMarkup(<RawContentPreview input={input} candidateId="c2" revision="r1" />)).toContain("Earlier body");
    expect(input).toEqual(before);
    expect(input.registry.slots[0]?.releases[0]?.revision).toBe("r2");
    expect(input.registry.candidates.every(candidate => candidate.approval === undefined)).toBe(true);
  });
  it.each([
    ["unknown-slot", (input: any) => { input.slotId = "missing"; }, {}],
    ["unknown-candidate", (_input: any) => {}, { candidateId: "missing" }],
    ["unknown-revision", (_input: any) => {}, { candidateId: "c2", revision: "r99" }],
    ["unknown-revision", (_input: any) => {}, { candidateId: "c2", revision: "latest" }],
    ["unsupported-locale", (input: any) => { input.locale = "fr"; }, {}],
    ["unsupported-medium", (input: any) => { input.registry.slots[0].l1 = "documents"; input.registry.slots[0].l2 = "docs"; }, {}],
    ["no-active-candidate", (input: any) => { delete input.registry.slots[0].activeCandidateId; input.registry.candidates[0].state = "draft"; }, {}],
  ])("names refusal %s", (code, mutate, selection) => {
    const input = structuredClone(previewFixture()); mutate(input);
    expect(() => previewContentRouteInput(input, selection as any)).toThrow(ContentPreviewRefusal);
    try { previewContentRouteInput(input, selection as any); } catch (error) { expect(error).toMatchObject({ name: "ContentPreviewRefusal", code }); }
  });
  it("can select a draft when no candidate is active without persisting activation", () => {
    const input: any = structuredClone(previewFixture()); delete input.registry.slots[0].activeCandidateId; input.registry.candidates[0].state = "draft";
    expect(renderToStaticMarkup(<RawContentPreview input={input} candidateId="c2" revision="r1" />)).toContain("Earlier body");
    expect(input.registry.slots[0].activeCandidateId).toBeUndefined();
    expect(input.registry.candidates.every((candidate: any) => candidate.state === "draft")).toBe(true);
  });
  it("forwards existing PB-5 Needs instead of drawing a substitute body", () => {
    const input = { ...previewFixture(), frameCopy: [] };
    const prepared = prepareContentRoute(input);
    expect(prepared.status).toBe("needs-input");
    expect(() => renderToStaticMarkup(<RawContentPreview input={input} />)).toThrow(ContentRouteNeedsError);
    try { renderToStaticMarkup(<RawContentPreview input={input} />); } catch (error) {
      expect((error as ContentRouteNeedsError).needs).toEqual(prepared.needs);
    }
  });
});
