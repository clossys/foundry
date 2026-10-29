/** @vitest-environment node */
import { beforeAll, expect, it } from "vitest";
import { computeCopyFingerprint } from "@clossys/writer";
import { packageSurfaceLibrary } from "../../../../designer/dist/library-cli/__fixtures__/package-surface-library.js";
import { compilePublication, publicationLibraryPins } from "./publication.js";
import { prepareContentRelease } from "./prepare.js";
import { releaseInput, refreshReleaseInput } from "./__fixtures__/release.js";
import { appendContentRevision } from "../revisions.js";
import { checkContentApproval } from "../approval.js";

let fixture: Awaited<ReturnType<typeof packageSurfaceLibrary>>;
beforeAll(async () => { fixture = await packageSurfaceLibrary(); }, 120000);
function setup() {
  const engine = { catalog: fixture.catalog, library: fixture.library, surfaceOptions: fixture.options };
  const pins = publicationLibraryPins(engine);
  const label = "Publication";
  const source = { id: "publication", revision: "r1", locale: "en", source: { kind: "consumer", reference: "synthetic/publication" }, entries: [{ id: "publication.title", text: label, context: "Synthetic release title", status: "approved", approval: { approvedBy: "owner", approvedAt: "2026-01-01T00:00:00Z", textFingerprint: computeCopyFingerprint(label), fingerprintAlgorithm: "sha256" } }] };
  const writer = { registry: source, at: "2026-02-04T05:06:07Z" };
  const map: any = { version: 1, publicationId: "publication", format: "web.page.responsive", entries: [{ id: "home", order: 0, title: label, kind: "page", path: "/agents/sample", pin: { nav: true }, source: { planItemId: "home" }, constructs: { main: [{ section: "sections.section-header", config: "default", content: { heading: { kind: "copy", ref: "heading" } } }] }, manifest: { l0: [] } }] };
  const bindings: any = { consumer: engine.library.source.id, channel: "site", brand: { homeRouteId: "home", label }, completeRoutes: { home: { kind: "designer", entry: { file: "src/app/page.tsx", export: "default" }, loader: { file: "src/data/home.ts", export: "loadRoute" } } } };
  const copy = { ref: { id: "publication.title", locale: "en" }, fingerprint: computeCopyFingerprint(label) };
  const snapshot: any = { version: 1, map, bindings, origin: "https://example.com", libraryVersion: pins.version, configPins: [pins.configs.find(p => p.leaf === "sections.section-header" && p.config === "default")], copyPins: { "map/entries/0/title": copy, "bindings/brand/label": copy, heading: copy } };
  return { engine, writer, snapshot };
}
it("compiles all seven products from one snapshot, immutable and deterministic", () => {
  const f = setup(), before = JSON.stringify(f.snapshot);
  const a = compilePublication(f.snapshot, f.engine, f.writer);
  expect(a.products.routes.routes[0]).toMatchObject({ routeId: "home", title: "Publication" });
  expect(a.products.nav.home.activeId).toBe("home");
  expect(a.products.cmdk[0]!.items[0]!.label).toBe("Publication");
  expect(a.products.breadcrumbs.home[0]!.label).toBe("Publication");
  expect(a.products.outline[0]!.id).toBe("home");
  expect(a.products.sitemap).toEqual([{ url: "https://example.com/agents/sample" }]);
  expect(a.products.deckOutline[0]).toMatchObject({ entryId: "home", slot: "main", index: 0, section: "sections.section-header", config: "default" });
  expect(compilePublication(JSON.parse(before), f.engine, f.writer)).toEqual(a);
  expect(Object.isFrozen(a.products.deckOutline)).toBe(true);
  expect(JSON.stringify(f.snapshot)).toBe(before);
});
it("refuses draft, missing approval, stale text, wrong fingerprint, unknown copy and caller switches", () => {
  for (const mutate of [
    (f: any) => { f.writer.registry.entries[0].status = "draft"; },
    (f: any) => { delete f.writer.registry.entries[0].approval; },
    (f: any) => { f.writer.registry.entries[0].text += " changed"; },
    (f: any) => { f.snapshot.copyPins.heading.fingerprint = "0".repeat(64); },
    (f: any) => { f.snapshot.copyPins.heading.ref.id = "missing"; },
    (f: any) => { f.writer.target = "preview"; },
    (f: any) => { delete f.snapshot.copyPins["map/entries/0/title"]; },
  ]) { const f = setup(); mutate(f); expect(() => compilePublication(f.snapshot, f.engine, f.writer)).toThrow(); }
});
it("refuses config/source/version drift and unknown config rather than silently repinning", () => {
  for (const mutate of [
    (f: any) => { f.snapshot.configPins[0].configHash = "0".repeat(64); },
    (f: any) => { f.snapshot.libraryVersion = "sha256:" + "0".repeat(64); },
    (f: any) => { f.snapshot.map.entries[0].constructs.main[0].config = "missing"; },
    (f: any) => { f.snapshot.configPins[0].descriptorHash = "sha256:" + "0".repeat(64); },
  ]) { const f = setup(); mutate(f); expect(() => compilePublication(f.snapshot, f.engine, f.writer)).toThrow(); }
});
it("revisions bind every publication input and invalidate old owner approval", () => {
  const f = setup(), input = releaseInput();
  (input.registry.candidates[0]!.typeSettings as any).publication = f.snapshot;
  refreshReleaseInput(input);
  const candidate = input.registry.candidates[0]!;
  for (const mutate of [
    (s: any) => { s.map.entries[0].order = 1; },
    (s: any) => { s.bindings.completeRoutes.home.loader.export = "other"; },
    (s: any) => { s.copyPins.heading.fingerprint = "0".repeat(64); },
    (s: any) => { s.configPins[0].config = "level-2"; },
  ]) { const changed = structuredClone(candidate); mutate(changed.typeSettings.publication); const history = appendContentRevision(candidate.history, changed, input.at); const next = { ...changed, revision: history.at(-1)!.revision, history }; expect(history).toHaveLength(2); expect(checkContentApproval(next, "publish").length).toBeGreaterThan(0); }
});
it("uses existing owner/review release gates and stamps seven outputs with final manifest digest", () => {
  const f = setup(), input: any = releaseInput();
  input.registry.candidates[0].typeSettings.publication = f.snapshot;
  refreshReleaseInput(input);
  input.publicationLibrary = f.engine; input.writer = { registry: f.writer.registry };
  const result = prepareContentRelease(input);
  expect(result.findings).toEqual([]); expect(result.ok).toBe(true);
  if (!result.ok) return;
  const bundle = result.releases[0]!;
  const products = bundle.build.publications![0]!.products;
  expect(Object.keys(products)).toHaveLength(7);
  for (const value of Object.values(products)) expect(value.releaseDigest).toBe(bundle.manifest.digest);
  const original = JSON.stringify(result);
  input.writer.registry.entries[0].status = "draft";
  expect(prepareContentRelease(input)).toMatchObject({ ok: false, releases: [] });
  expect(JSON.stringify(result)).toBe(original);
});
