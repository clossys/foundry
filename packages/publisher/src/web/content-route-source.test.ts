/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { outputPathFor } from "../content/metadata.js";
import { selectContentRoute, bindContentRoute } from "./content-route-binding.js";
import { createContentRouteManifest, emitContentRoutePage } from "./content-route-source.js";
import { contentRouteCandidate, contentRouteContent, contentRouteFixture } from "./__fixtures__/content-route.js";

const loader = { file: "src/content-loader.ts", export: "loadContentRoute" };
const manifest = () => { const { registry, locale } = contentRouteFixture(); return createContentRouteManifest({ registry, locale, loader }); };

describe("content route v2 selection and deterministic source", () => {
  it("derives registration entirely from the active candidate and its immutable snapshot", () => {
    const input = contentRouteFixture();
    const alternative = contentRouteCandidate(contentRouteContent({ name: "Alternative" }), "alternative", input.slotId, "draft");
    const registry = { ...input.registry, candidates: [alternative, ...input.registry.candidates] };
    const before = JSON.stringify(registry);
    const selected = selectContentRoute(registry, input.slotId, input.locale);
    expect(selected.candidate.id).toBe("sign-in");
    const result = createContentRouteManifest({ registry, locale: input.locale, loader });
    expect(result.version).toBe(2); expect(result.consumer).toBe("example"); expect(result.routes).toHaveLength(1);
    const route = result.routes[0]!;
    expect(route).toMatchObject({ kind: "content", slotId: input.slotId, candidateId: "sign-in", revision: "r1", digest: input.registry.candidates[0]!.history[0]!.digest, locale: "en", path: "/sign-in", outputPath: outputPathFor(input.registry.slots[0]!), composition: selected.candidate.composition, source: { file: outputPathFor(input.registry.slots[0]!), export: "default" }, loader });
    expect(route).not.toHaveProperty("planItemId"); expect(route).not.toHaveProperty("layouts");
    expect(bindContentRoute({ ...input, registry }, route)).toEqual({ ...input, registry });
    expect(JSON.stringify(registry)).toBe(before);
    expect(createContentRouteManifest({ registry, locale: input.locale, loader })).toEqual(result);
  });

  it("guards missing active pointers, live edits outside the snapshot, and wrong locales", () => {
    const input = contentRouteFixture();
    const noPointer = { ...input.registry, slots: input.registry.slots.map(({ activeCandidateId: _active, ...slot }) => slot) };
    expect(() => selectContentRoute(noPointer, input.slotId, input.locale)).toThrow();
    const stale = { ...input.registry, candidates: input.registry.candidates.map(candidate => ({ ...candidate, name: "Unsnapshotted change" })) };
    expect(() => selectContentRoute(stale, input.slotId, input.locale)).toThrow();
    expect(() => selectContentRoute(input.registry, input.slotId, "fr")).toThrow();
  });

  it("rejects unsnapshotted Writer metadata and metadata-asset changes at selection and binding", () => {
    const input = contentRouteFixture({ pageMetaAssets: { "og-image": "assets.original", icon: "assets.icon" } });
    const route = createContentRouteManifest({ registry: input.registry, locale: input.locale, loader }).routes[0]!;
    expect(() => bindContentRoute(input, route)).not.toThrow();
    const original = input.registry.candidates[0]!;
    const drifts = [
      { ...original, pageMeta: original.pageMeta!.map(field => field.key === "title" && field.ref === undefined ? { ...field, value: "Unsnapshotted title" } : field) },
      { ...original, pageMetaAssets: { ...original.pageMetaAssets, "og-image": "assets.changed" } },
    ];
    for (const candidate of drifts) {
      const registry = { ...input.registry, candidates: [candidate] };
      expect(candidate.history).toBe(original.history);
      expect(() => selectContentRoute(registry, input.slotId, input.locale)).toThrow();
      expect(() => bindContentRoute({ ...input, registry }, route)).toThrow();
    }
  });

  it("accepts equivalent live content and captured composition with different object-key insertion order", () => {
    const input = contentRouteFixture({ typeSettings: { display: { density: "standard", tone: "clear" } } });
    const route = createContentRouteManifest({ registry: input.registry, locale: input.locale, loader }).routes[0]!;
    const original = input.registry.candidates[0]!, composition = original.composition!;
    const reorderedComposition = {
      libraryVersion: composition.libraryVersion,
      sections: composition.sections.map(section => ({
        fields: section.fields.map(field => field.ref === undefined ? { source: field.source, value: field.value, locale: field.locale, key: field.key } : { source: field.source, ref: field.ref, locale: field.locale, key: field.key }),
        intent: section.intent, configId: section.configId, sectionId: section.sectionId, key: section.key,
      })),
      frame: { configId: composition.frame.configId, frameId: composition.frame.frameId },
    };
    const candidate = { ...original, composition: reorderedComposition, typeSettings: { display: { tone: "clear", density: "standard" } } };
    const registry = { ...input.registry, candidates: [candidate] };
    expect(JSON.stringify(candidate.composition)).not.toBe(JSON.stringify(original.composition));
    expect(JSON.stringify(candidate.typeSettings)).not.toBe(JSON.stringify(original.typeSettings));
    expect(candidate.history).toBe(original.history);
    expect(selectContentRoute(registry, input.slotId, input.locale).candidate).toEqual(candidate);
    expect(() => bindContentRoute({ ...input, registry }, route)).not.toThrow();
    expect(() => bindContentRoute(input, { ...route, composition: reorderedComposition })).not.toThrow();
  });

  it("binds loader data against every captured route identity", () => {
    const input = contentRouteFixture(), route = manifest().routes[0]!;
    expect(() => bindContentRoute(input, route)).not.toThrow();
    const mutations = [
      { slotId: "sl_aaaaaaaaab" }, { candidateId: "alternative" }, { revision: "r2" as const }, { digest: "0".repeat(64) }, { locale: "fr" }, { path: "/other" }, { outputPath: "site/app/other/page.tsx" },
      { composition: { ...route.composition, frame: { frameId: "frames.site-shell", configId: "default" } } },
    ];
    for (const change of mutations) expect(() => bindContentRoute(input, { ...route, ...change }), JSON.stringify(change)).toThrow();
    const active = contentRouteCandidate(contentRouteContent({ name: "Replacement" }), "replacement");
    const switched = { ...input, registry: { ...input.registry, slots: input.registry.slots.map(slot => ({ ...slot, activeCandidateId: active.id })), candidates: [active] } };
    expect(() => bindContentRoute(switched, route)).toThrow();
  });

  it("keeps outputPathFor encoding, including the deploy-target root", () => {
    const input = contentRouteFixture();
    const target = "site/team.preview";
    const registry = { ...input.registry, workspace: { ...input.registry.workspace, deployTargets: [{ id: target, repo: "example", app: "site" }] }, slots: input.registry.slots.map(slot => ({ ...slot, deployTarget: target, route: "/account/settings.v2" })) };
    const route = createContentRouteManifest({ registry, locale: "en", loader, deployTarget: target }).routes[0]!;
    expect(route.outputPath).toBe(outputPathFor(registry.slots[0]!));
    expect(route.outputPath).toBe("site%2Fteam%2Epreview/app/account/settings%2Ev2/page.tsx");
    expect(route.source.file).toBe(route.outputPath);
  });

  it("rejects paths escaping the consumer root and invalid loader exports", () => {
    const input = contentRouteFixture();
    for (const file of ["../loader.ts", "/loader.ts", "src/../loader.ts", "src\\loader.ts", "./loader.ts"]) {
      expect(() => createContentRouteManifest({ registry: input.registry, locale: "en", loader: { ...loader, file } }), file).toThrow();
    }
    expect(() => createContentRouteManifest({ registry: input.registry, locale: "en", loader: { ...loader, export: "invalid-export" } })).toThrow();
    for (const path of ["/../escape", "/%2e%2e/escape", "/two//parts", "/trailing/"]) {
      const registry = { ...input.registry, slots: input.registry.slots.map(slot => ({ ...slot, route: path })) };
      expect(() => createContentRouteManifest({ registry, locale: "en", loader }), path).toThrow();
    }
  });

  it("omits nonroute boundaries by default and refuses an explicitly selected boundary", () => {
    const input = contentRouteFixture();
    const boundary = { ...input.registry.slots[0]!, id: "sl_aaaaaaaaab" as const, aliases: [], kind: "status" as const, name: "Not found", activeCandidateId: "not-found" };
    const { route: _route, ...withoutRoute } = boundary;
    const registry = { ...input.registry, slots: [...input.registry.slots, withoutRoute], candidates: [...input.registry.candidates, contentRouteCandidate(contentRouteContent(), "not-found", boundary.id)] };
    expect(createContentRouteManifest({ registry, locale: "en", loader }).routes.map(route => route.slotId)).toEqual([input.slotId]);
    expect(() => createContentRouteManifest({ registry, locale: "en", loader, slotIds: [boundary.id] })).toThrow();
    const { composition: _composition, ...redirectBase } = contentRouteContent();
    const redirectContent = { ...redirectBase, redirectTarget: "/sign-in" };
    const redirect = { ...boundary, kind: "redirect" as const, route: "/old-sign-in" };
    const withRedirect = { ...input.registry, slots: [redirect], candidates: [contentRouteCandidate(redirectContent, "not-found", redirect.id)] };
    expect(() => createContentRouteManifest({ registry: withRedirect, locale: "en", loader, slotIds: [redirect.id] })).toThrow();
  });

  it("emits an isolated server entry with a strict raw-data loader, binder and no handwritten body", () => {
    const route = manifest().routes[0]!, source = emitContentRoutePage(route);
    expect(source).toContain("@clossys/publisher/web/content-route");
    expect(source).toContain("ContentRoutePage"); expect(source).toContain("bindContentRoute"); expect(source).toContain("loadContentRoute");
    expect(source).toMatch(/export default/); expect(source).toMatch(/await\s+/);
    expect(source).not.toMatch(/use client|useRuntime|useRegisteredRoute|RegisteredRoutePage|\.\.\/core\/|<main|<section|<h[1-6]/);
    expect(emitContentRoutePage(structuredClone(route))).toBe(source);
    expect(() => emitContentRoutePage({ ...route, source: { file: "site/app/elsewhere/page.tsx", export: "default" } })).toThrow();
    expect(() => emitContentRoutePage({ ...route, outputPath: "../escape.tsx" })).toThrow();
  });
});
