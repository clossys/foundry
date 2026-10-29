/** @vitest-environment node */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as composition from "../content/composition.js";
import type { CopyField } from "../content/composition.js";
import { isAdminContentRoute } from "../content/admin-copy.js";
import { ContentRouteNeedsError, ContentRoutePage, prepareContentRoute } from "./content-route.js";
import type { ContentRouteInput } from "./content-route-types.js";
import { contentRouteCandidate, contentRouteFixture, withApprovedRouteCopy, withRouteContent } from "./__fixtures__/content-route.js";

afterEach(() => vi.restoreAllMocks());
const render = (input: ContentRouteInput) => renderToStaticMarkup(<ContentRoutePage input={input} />);
function adminInput(): ContentRouteInput {
  const base = withApprovedRouteCopy(contentRouteFixture());
  return { ...base, registry: { ...base.registry, workspace: { ...base.registry.workspace,
    deployTargets: [{ id: "site", repo: "example", app: "admin" }] } } };
}
function inlineAt(input: ContentRouteInput, binding: "body" | "metadata" | "frame" | "pinned", source: "writer" | "handwritten"): ContentRouteInput {
  const literal: CopyField = { key: binding === "frame" ? "skipLabel" : "title", locale: "en", source, value: "Unresolved inline text" };
  if (binding === "frame") return { ...input, frameCopy: [literal] };
  const content = input.registry.candidates[0]!.history[0]!.content;
  if (binding === "metadata") return withRouteContent(input, { ...content, pageMeta: [literal, ...content.pageMeta!.filter(field => field.key !== "title")] });
  const section = content.composition!.sections[0]!;
  const historical = { ...content, composition: { ...content.composition!, sections: [{ ...section, fields: [literal, ...section.fields.filter(field => field.key !== "title")] }] } };
  if (binding === "body") return withRouteContent(input, historical);
  const sourceCandidate = contentRouteCandidate(historical, "shared", input.slotId, "draft");
  const pinned = withRouteContent(input, { ...content, composition: { ...content.composition!, sections: [{ ...section, fields: [],
    ref: { candidateId: "shared", revision: "r1", sectionKey: section.key } }] } });
  return { ...pinned, registry: { ...pinned.registry, candidates: [...pinned.registry.candidates, sourceCandidate] } };
}

describe("admin content route Writer boundary", () => {
  it.each([
    ["admin home placement", "admin", "/", "site", true],
    ["admin account placement", "admin", "/account", "site", true],
    ["admin sign-in target", "auth", "/sign-in", "admin", true],
    ["admin home target", "app", "/", "admin", true],
    ["known console route", "app", "/agents/writer", "site", true],
    ["site sign-in", "auth", "/sign-in", "site", false],
    ["public site", "site", "/", "site", false],
  ] as const)("derives strictness from %s", (_name, l2, route, app, strict) => {
    const base = contentRouteFixture();
    const slot = { ...base.registry.slots[0]!, aliases: [], l2, route };
    const workspace = { ...base.registry.workspace, deployTargets: [{ id: "site", repo: "example", app }] };
    const input = { ...base, registry: { ...base.registry, workspace, slots: [slot] } };
    expect(isAdminContentRoute(slot, workspace)).toBe(strict);
    expect(prepareContentRoute(input).status).toBe(strict ? "needs-input" : "ready");
    if (strict) expect(() => render(input)).toThrow(ContentRouteNeedsError);
    else expect(render(input)).toContain("Sign in to continue");
  });

  for (const source of ["writer", "handwritten"] as const) it.each(["body", "metadata", "frame", "pinned"] as const)(`refuses ${source} inline %s among approved references`, binding => {
    const input = inlineAt(adminInput(), binding, source);
    const before = JSON.stringify(input);
    const prepared = prepareContentRoute(input);
    expect(prepared.status).toBe("needs-input");
    expect(prepared.node).toBeUndefined();
    expect(prepared.provenance).toBeUndefined();
    expect(prepared.copyFindings).toContainEqual(expect.objectContaining({ rule: "legacy-inline-copy", severity: "error" }));
    expect(prepared.needs).toContainEqual(expect.objectContaining({ kind: "copy", target: "writer", detail: expect.stringContaining("legacy-inline-copy") }));
    expect(JSON.stringify(prepared.metadata)).not.toContain("Unresolved inline text");
    expect(() => render(input)).toThrow(ContentRouteNeedsError);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("refuses historical warning-only complete reports at the web boundary", () => {
    const input = inlineAt(adminInput(), "body", "writer");
    const actual = composition.resolveCopy;
    const legacy = actual({ pageMeta: [{ key: "title", locale: "en", source: "writer", value: "Legacy title" }] }, "en", { requireWriterCopy: false });
    expect(legacy.complete).toBe(true);
    expect(legacy.findings).toContainEqual(expect.objectContaining({ rule: "legacy-inline-copy", severity: "warning" }));
    const reports = vi.spyOn(composition, "resolveCopy").mockImplementation((candidate, locale, options) =>
      actual(candidate, locale, { ...options, requireWriterCopy: false }));
    const prepared = prepareContentRoute(input);
    expect(prepared.status).toBe("needs-input");
    expect(prepared.node).toBeUndefined();
    expect(prepared.needs).toContainEqual(expect.objectContaining({ kind: "copy", target: "writer", detail: expect.stringContaining("legacy-inline-copy") }));
    expect(reports.mock.results.some(result => result.type === "return" && result.value.complete && result.value.findings.some(finding => finding.rule === "legacy-inline-copy"))).toBe(true);
    expect(() => render(input)).toThrow(ContentRouteNeedsError);
  });

  it.each(["/", "/sign-in"])("renders approved Writer copy on the admin app at %s with only Writer provenance", route => {
    const base = adminInput();
    const input = { ...base, registry: { ...base.registry, slots: base.registry.slots.map(slot => ({ ...slot, route })) } };
    const before = JSON.stringify(input);
    const prepared = prepareContentRoute(input);
    expect(prepared.status).toBe("ready");
    expect(prepared.needs).toEqual([]);
    expect(prepared.copyFindings).toEqual([]);
    expect(prepared.provenance?.inline).toEqual([]);
    expect(prepared.provenance?.copy).toHaveLength(5);
    for (const proof of prepared.provenance!.copy) expect(proof).toMatchObject({ recordId: "route-fixture-en", revision: "r1", requestedLocale: "en", servedLocale: "en", chain: ["en"], source: { kind: "consumer", reference: "fixtures/content-route" } });
    const html = render(input);
    expect(html).toContain("Sign in to continue");
    expect(html).toContain("Skip to sign-in content");
    expect(html).toContain("Sign in | Example");
    expect(JSON.stringify(input)).toBe(before);
  });

  it("still refuses unapproved Writer entries on an admin route", () => {
    const input = adminInput();
    const writer = { ...input.writer!, registry: { ...input.writer!.registry,
      entries: input.writer!.registry.entries.map(({ approval: _approval, ...entry }) => ({ ...entry, status: "draft" as const })) } };
    const invalid = { ...input, writer };
    expect(prepareContentRoute(invalid).status).toBe("needs-input");
    expect(() => render(invalid)).toThrow(ContentRouteNeedsError);
  });
});
