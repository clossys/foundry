/** @vitest-environment node */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { isContentJson } from "../content/json.js";
import { parseContentRegistry } from "../content/validate.js";
import { outputPathFor } from "../content/metadata.js";
import { createContentRevision } from "../content/revisions.js";
import { ContentRoutePage, ContentRouteNeedsError, prepareContentRoute } from "./content-route.js";
import { contentRouteCandidate, contentRouteContent, contentRouteFixture, CONTENT_ROUTE_AT, writerField } from "./__fixtures__/content-route.js";

const markup = (input = contentRouteFixture()) => renderToStaticMarkup(<ContentRoutePage input={input} />);
const content = () => contentRouteContent();

describe("content route server rendering", () => {
  it("uses finite validated revisions and actual Designer AuthFrame and EmptyState markup", () => {
    const input = contentRouteFixture();
    expect(isContentJson(input)).toBe(true);
    expect(parseContentRegistry(input.registry)).toEqual(input.registry);
    const before = JSON.stringify(input);
    const route = prepareContentRoute(input);
    expect(route.status).toBe("ready"); expect(route.needs).toEqual([]); expect(route.node).toBeDefined();
    expect(route.candidate.id).toBe("sign-in"); expect(route.outputPath).toBe(outputPathFor(input.registry.slots[0]!));
    const html = markup(input);
    expect(html).toContain('data-ds-leaf="frames.auth-shell"');
    expect(html).toContain('data-ds-leaf="sections.empty-state"');
    expect(html).toContain('href="#main-content"'); expect(html).toContain("Skip to sign-in content");
    expect(html).toContain('id="main-content"'); expect(html).toContain("Sign in to continue"); expect(html).toContain("Your account is ready.");
    expect(html).toContain("<title>Sign in | Example</title>");
    expect(html).toContain('name="robots" content="noindex"');
    expect(html).toContain('rel="canonical" href="https://example.test/sign-in"');
    expect(JSON.stringify(input)).toBe(before);
  });

  it("selects Writer copy and head metadata for the exact requested locale", () => {
    const base = content();
    const input = contentRouteFixture({ pageMeta: [...base.pageMeta!, writerField("title", "Connexion | Exemple", "fr"), writerField("description", "Retrouvez votre compte.", "fr")], composition: { ...base.composition!, sections: [{ ...base.composition!.sections[0]!, fields: [...base.composition!.sections[0]!.fields, writerField("title", "Connectez-vous", "fr"), writerField("description", "Votre compte est prêt.", "fr")] }] } });
    const localized = { ...input, locale: "fr", frameCopy: [...input.frameCopy!, writerField("skipLabel", "Aller au contenu", "fr")], registry: { ...input.registry, slots: input.registry.slots.map(slot => ({ ...slot, locales: ["en", "fr"] })) } };
    const html = markup(localized);
    expect(html).toContain("<title>Connexion | Exemple</title>"); expect(html).toContain("Connectez-vous"); expect(html).toContain("Aller au contenu");
    expect(html).not.toContain("Sign in | Example"); expect(html).not.toContain("Sign in to continue");
  });

  it("turns missing Writer frame words and section copy into Needs without a partial node", () => {
    const base = content();
    const input = contentRouteFixture({ composition: { ...base.composition!, sections: [{ ...base.composition!.sections[0]!, fields: [] }] } });
    const missing = { ...input, frameCopy: [] };
    const prepared = prepareContentRoute(missing);
    expect(prepared.status).toBe("needs-input"); expect(prepared.node).toBeUndefined();
    expect(prepared.needs).toContainEqual(expect.objectContaining({ kind: "copy", target: "writer" }));
    expect(prepared.needs.some(need => JSON.stringify(need).includes("skipLabel"))).toBe(true);
    expect(prepared.needs.some(need => JSON.stringify(need).includes("title"))).toBe(true);
    expect(() => markup(missing)).toThrow(ContentRouteNeedsError);
    try { markup(missing); } catch (error) { expect((error as ContentRouteNeedsError).needs).toEqual(prepared.needs); }
  });

  it("requires Writer title and indexable description without manufacturing fallback metadata", () => {
    const input = contentRouteFixture({ pageMeta: [] });
    const indexable = { ...input, registry: { ...input.registry, slots: input.registry.slots.map(slot => ({ ...slot, meta: { robots: "index" as const } })) } };
    const prepared = prepareContentRoute(indexable);
    expect(prepared.status).toBe("needs-input"); expect(prepared.node).toBeUndefined();
    expect(prepared.needs.filter(need => need.target === "writer").length).toBeGreaterThanOrEqual(2);
    expect(prepared.needs.some(need => JSON.stringify(need).includes("description"))).toBe(true);
  });

  it.each(["frames.site-shell", "frames.unknown"])("returns a Designer frame Need for unavailable %s", frameId => {
    const base = content();
    const input = contentRouteFixture({ composition: { ...base.composition!, frame: { frameId, configId: "default" } } });
    // Registration is not renderer availability; SiteFrame has no actual Designer export.
    const registered = { ...input, libraries: input.libraries.map(library => ({ ...library, frames: [...library.frames, { id: frameId, configIds: ["default"] }] })) };
    const prepared = prepareContentRoute(registered);
    expect(prepared.status).toBe("needs-input"); expect(prepared.node).toBeUndefined();
    expect(prepared.needs).toContainEqual(expect.objectContaining({ kind: "frame", target: "designer", ref: frameId }));
  });

  it("refuses missing section renderers and registered but unsupported configs", () => {
    const base = content();
    for (const variant of [{ sectionId: "sections.unavailable", configId: "default" }, { sectionId: "sections.empty-state", configId: "unsupported" }]) {
      const input = contentRouteFixture({ composition: { ...base.composition!, sections: [{ ...base.composition!.sections[0]!, ...variant }] } });
      const registered = { ...input, libraries: input.libraries.map(library => ({ ...library, sections: [{ id: variant.sectionId, configIds: [variant.configId] }] })) };
      const prepared = prepareContentRoute(registered);
      expect(prepared.status).toBe("needs-input"); expect(prepared.node).toBeUndefined();
      expect(prepared.needs).toContainEqual(expect.objectContaining({ kind: variant.sectionId === "sections.unavailable" ? "section" : "config", target: "designer" }));
    }
  });

  it("allows the same Writer keys across independent section occurrences and pages", () => {
    const base = content();
    const input = contentRouteFixture({ composition: { ...base.composition!, sections: [base.composition!.sections[0]!, { ...base.composition!.sections[0]!, key: "second" }] } });
    expect(prepareContentRoute(input).needs).toEqual([]);
    expect(markup(input).match(/data-ds-leaf="sections.empty-state"/g)).toHaveLength(2);
    const slot = { ...input.registry.slots[0]!, id: "sl_aaaaaaaaab" as const, aliases: [], route: "/sign-in-again", activeCandidateId: "other-page" };
    const second = { ...input, slotId: slot.id, registry: { ...input.registry, slots: [...input.registry.slots, slot], candidates: [...input.registry.candidates, contentRouteCandidate(base, "other-page", slot.id)] } };
    expect(prepareContentRoute(second).needs).toEqual([]); expect(markup(second)).toContain("Sign in to continue");
  });

  it("binds LogoHero artwork by exact library version and emits an asset Need when unavailable", () => {
    const base = content();
    const input = contentRouteFixture({ composition: { ...base.composition!, sections: [{ key: "logo", sectionId: "sections.logo-hero", configId: "default", intent: "continues", fields: [writerField("name", "Example logo")], assets: [{ assetId: "assets.example-mark", libraryVersion: "1" }] }] } });
    const registered = { ...input, libraries: input.libraries.map(library => ({ ...library, sections: [{ id: "sections.logo-hero", configIds: ["default"] }], assetIds: ["assets.example-mark"] })) };
    const absent = prepareContentRoute(registered);
    expect(absent.status).toBe("needs-input"); expect(absent.node).toBeUndefined();
    expect(absent.needs).toContainEqual(expect.objectContaining({ kind: "asset", target: "designer" }));
    const present = { ...registered, assets: [{ assetId: "assets.example-mark", libraryVersion: "1", src: "/artwork/example-mark.svg" }] };
    expect(prepareContentRoute(present).needs).toEqual([]);
    const html = markup(present);
    expect(html).toContain('data-ds-leaf="sections.logo-hero"'); expect(html).toContain('aria-label="Example logo"'); expect(html).toContain('src="/artwork/example-mark.svg"');
    expect(prepareContentRoute({ ...present, assets: [{ ...present.assets[0]!, libraryVersion: "2" }] }).needs).toContainEqual(expect.objectContaining({ kind: "asset", target: "designer" }));
  });

  it("uses the pinned historical section instead of a source candidate's live copy", () => {
    const base = content();
    const historical = { ...base, composition: { ...base.composition!, sections: [{ ...base.composition!.sections[0]!, fields: [writerField("title", "Historical title"), writerField("description", "Historical description")] }] } };
    const live = { ...base, composition: { ...base.composition!, sections: [{ ...base.composition!.sections[0]!, fields: [writerField("title", "Live title"), writerField("description", "Live description")] }] } };
    const source = { ...contentRouteCandidate(live, "shared", "sl_aaaaaaaaaa", "draft"), revision: "r2" as const, history: [createContentRevision(historical, "r1", CONTENT_ROUTE_AT), createContentRevision(live, "r2", CONTENT_ROUTE_AT)] };
    const input = contentRouteFixture({ composition: { ...base.composition!, sections: [{ ...base.composition!.sections[0]!, fields: [], ref: { candidateId: "shared", revision: "r1", sectionKey: "message" } }] } });
    const pinned = { ...input, registry: { ...input.registry, candidates: [...input.registry.candidates, source] } };
    const html = markup(pinned);
    expect(html).toContain("Historical title"); expect(html).not.toContain("Live title"); expect(html).not.toContain("Sign in to continue");
  });
});
