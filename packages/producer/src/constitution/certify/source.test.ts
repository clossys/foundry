import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { backdropFindings, candidateLineage, carriesBackdrop, consumerOwnDerivation, globMatch, lineageFindings, parseRef, resolveProvenanceRule, seedItem, sha256, treeHash, verbatimFindings, type ProvenanceRule, type ReferenceManifest } from "./source.js";

const here = dirname(fileURLToPath(import.meta.url));
const producerRoot = join(here, "../../..");
const designerScripts = join(producerRoot, "../designer/scripts");
const builtSource = join(producerRoot, "dist/constitution/certify/source.js");

const BYTES = "export const Button = () => null;\n";
const MANIFEST: ReferenceManifest = {
  registries: { shadcn: {} },
  items: [{ registry: "shadcn", name: "button", version: "1.0.0", hash: "sha256:seed", type: "registry:ui", files: [{ path: "registry/ui/button.tsx", sha256: sha256(BYTES) }] }],
};
const RULE: ProvenanceRule = { consumerAssets: { slots: ["assets.*"] }, classes: [{ slots: "ui.*", sourceTypes: ["registry:ui"] }] };
const adopted = (content = BYTES, files: Record<string, string> = { "components/ui/button.tsx": "registry/ui/button.tsx" }) => ({
  name: "button",
  files: [{ path: "components/ui/button.tsx", content }],
  meta: { source: { kind: "registry", ref: ["shadcn/button@1.0.0"] }, refVerbatim: { files } },
});

describe("certify/source.ts helpers", () => {
  it("globMatch, parseRef, consumerOwnDerivation", () => {
    expect(globMatch("ui.*", "ui.button")).toBe(true);
    expect(globMatch("ui.button", "ui.buttons")).toBe(false);
    expect(parseRef("shadcn/button@1.0.0")).toEqual({ registry: "shadcn", item: "button", version: "1.0.0" });
    expect(parseRef("button")).toBeNull();
    expect(consumerOwnDerivation(["clossys/agents/designer/assets.logo"])).toBe(true);
    expect(consumerOwnDerivation(["shadcn/button@1.0.0"])).toBe(false);
  });

  it("treeHash sorts by path and hashes `<sha256>  <path>` lines", () => {
    const a = { path: "a.ts", sha256: sha256("a") }, b = { path: "b.ts", sha256: sha256("b") };
    expect(treeHash([b, a])).toBe(treeHash([a, b]));
    expect(treeHash([a, b])).toBe(`sha256:${sha256(`${a.sha256}  a.ts\n${b.sha256}  b.ts\n`)}`);
  });

  it("seedItem matches a ref id exactly, array or single string", () => {
    expect(seedItem(MANIFEST, ["shadcn/button@1.0.0"])?.name).toBe("button");
    expect(seedItem(MANIFEST, "shadcn/button@1.0.0")?.name).toBe("button");
    expect(seedItem(MANIFEST, "x shadcn/button@1.0.0 y")).toBeUndefined();
    expect(seedItem(MANIFEST, ["shadcn/button@2.0.0"])).toBeUndefined();
  });

  it("verbatimFindings: byte-exact passes; changed bytes, unmapped, unknown seed file and missing payload fail", () => {
    expect(verbatimFindings("c", adopted(), MANIFEST)).toEqual([]);
    expect(verbatimFindings("c", adopted(`${BYTES}// edit\n`), MANIFEST)).toEqual(["c: components/ui/button.tsx is not byte-exact to shadcn/button@1.0.0 registry/ui/button.tsx"]);
    expect(verbatimFindings("c", adopted(BYTES, {}), MANIFEST)[0]).toMatch(/maps no file/);
    expect(verbatimFindings("c", adopted(BYTES, { "components/ui/button.tsx": "registry/ui/other.tsx" }), MANIFEST)[0]).toMatch(/does not list/);
    expect(verbatimFindings("c", adopted(BYTES, { "components/ui/missing.tsx": "registry/ui/button.tsx" }), MANIFEST)[0]).toMatch(/does not ship/);
    expect(verbatimFindings("c", { ...adopted(), meta: { ...adopted().meta, source: { kind: "registry", ref: ["shadcn/none@1"] } } }, MANIFEST)[0]).toMatch(/names no reference-manifest item/);
  });

  it("lineageFindings: original only in consumer-asset slots; references must be trusted, listed and hashed", () => {
    expect(lineageFindings("o", { slot: "assets.logo", mode: "original" }, { rule: RULE, manifest: MANIFEST })).toEqual([]);
    expect(lineageFindings("o", { slot: "ui.button", mode: "original" }, { rule: RULE, manifest: MANIFEST })[0]).toMatch(/not a consumer-asset slot/);
    expect(lineageFindings("v", { slot: "ui.button", mode: "verbatim", source: { registry: "shadcn", item: "button", version: "1.0.0", hash: "sha256:seed" } }, { rule: RULE, manifest: MANIFEST })).toEqual([]);
    expect(lineageFindings("v", { slot: "ui.button", mode: "verbatim", source: { registry: "shadcn", item: "button", version: "1.0.0", hash: "sha256:other" } }, { rule: RULE, manifest: MANIFEST })[0]).toMatch(/hash sha256:other != manifest sha256:seed/);
    expect(lineageFindings("v", { slot: "ui.button", mode: "verbatim", source: { registry: "evil", item: "button", version: "1.0.0", hash: "sha256:seed" } }, { rule: RULE, manifest: MANIFEST })[0]).toMatch(/not a trusted registry/);
    expect(lineageFindings("v", { slot: "ui.button", mode: "forked" }, { rule: RULE, manifest: MANIFEST })[0]).toMatch(/is not verbatim, customized or original/);
  });

  it("candidateLineage reads a registry candidate's meta.source", () => {
    const lineage = candidateLineage("ui.button", { ...adopted(), meta: { source: { kind: "registry", ref: ["shadcn/button@1.0.0"], hash: "sha256:seed" } } });
    expect(lineage?.slot).toBe("ui.button");
    expect(lineage?.source?.item).toBe("button");
  });

  it("interactive backdrop: meta.backdrop rides on a code candidate in an interactiveBackdrops slot only, without changing the code's lineage (foundry-build-0048 A4, U23)", () => {
    const rule: ProvenanceRule = { ...RULE, interactiveBackdrops: { slots: ["sections.hero"], components: ["particles", "flickering-grid", "grid-pattern", "gradient-mesh"] } };
    const hero = (backdrop?: unknown) => ({ files: [{ path: "hero.tsx" }], meta: { source: { kind: "original", ref: [] }, ...(backdrop === undefined ? {} : { backdrop }) } });
    expect(carriesBackdrop(hero())).toBe(false);
    expect(backdropFindings("d", "sections.hero", hero(), rule)).toEqual([]);
    expect(carriesBackdrop(hero({ component: "flickering-grid", params: {} }))).toBe(true);
    expect(candidateLineage("sections.hero", hero({ component: "flickering-grid", params: {} }))).toEqual(candidateLineage("sections.hero", hero()));
    expect(backdropFindings("d", "sections.hero", hero({ component: "flickering-grid", params: {} }), rule)).toEqual([]);
    expect(backdropFindings("d", "sections.call-to-action", hero({ component: "flickering-grid", params: {} }), rule)).toEqual([expect.stringMatching(/meta\.backdrop in sections\.call-to-action, which is not an interactiveBackdrops slot/)]);
    expect(backdropFindings("d", "sections.hero", hero({ component: "grid-glow", params: {} }), rule)).toEqual([expect.stringMatching(/"grid-glow" is not one of the adopted interactive backdrop components/)]);
    expect(backdropFindings("d", "sections.hero", hero("flickering-grid"), rule)).toEqual([expect.stringMatching(/meta\.backdrop\.component null/)]);
    // A rule without interactiveBackdrops admits none, and so does an unresolved data reference.
    expect(backdropFindings("d", "sections.hero", hero({ component: "flickering-grid", params: {} }), RULE)).toHaveLength(2);
    const unresolved: ProvenanceRule = { ...RULE, interactiveBackdrops: { slots: { from: ["slots.json"], placement: "backdrop" }, components: { from: "registry.json" } } };
    expect(backdropFindings("d", "sections.hero", hero({ component: "flickering-grid", params: {} }), unresolved)).toHaveLength(2);
  });

  it("resolveProvenanceRule reads the backdrop slots from surface contracts and the components from the registry (U23)", () => {
    const files: Record<string, unknown> = {
      "sections.json": [
        { id: "sections.hero", contract: { slots: [{ name: "backdrop", type: "media", placement: "backdrop" }] } },
        { id: "sections.media", contract: { slots: [{ name: "figure", type: "media", placement: "figure" }] } },
      ],
      "frames.json": [{ id: "frames.site-shell", contract: { slots: [{ id: "ground", placement: "backdrop" }] } }, { id: "frames.app-shell", contract: { slots: [{ id: "main" }] } }],
      "registry.json": { components: [{ id: "ripple" }, { id: "particles" }] },
    };
    const read = (path: string) => { if (!(path in files)) throw new Error(`unreadable ${path}`); return files[path]; };
    const rule: ProvenanceRule = { ...RULE, interactiveBackdrops: { slots: { from: ["sections.json", "frames.json"], placement: "backdrop" }, components: { from: "registry.json" } } };
    expect(resolveProvenanceRule(rule, read).interactiveBackdrops).toEqual({ slots: ["frames.site-shell", "sections.hero"], components: ["ripple", "particles"] });
    // Lists pass through; a rule without backdrops is returned as is.
    const listed: ProvenanceRule = { ...RULE, interactiveBackdrops: { slots: ["sections.hero"], components: ["particles"] } };
    expect(resolveProvenanceRule(listed, read)).toEqual(listed);
    expect(resolveProvenanceRule(RULE, read)).toBe(RULE);
    expect(() => resolveProvenanceRule({ ...RULE, interactiveBackdrops: { components: { from: "missing.json" } } }, read)).toThrow(/unreadable missing\.json/);
    expect(() => resolveProvenanceRule({ ...RULE, interactiveBackdrops: { components: { from: "sections.json" } } }, read)).toThrow(/not a backdrop component registry/);
    expect(() => resolveProvenanceRule({ ...RULE, interactiveBackdrops: { slots: { from: ["registry.json"], placement: "backdrop" } } }, read)).toThrow(/not a list of slots/);
  });

  it("the shipped Designer provenance rule resolves to the catalog's backdrop surfaces and the adopted registry", () => {
    const designer = join(producerRoot, "../designer");
    const read = (path: string) => JSON.parse(readFileSync(join(designer, path), "utf8")) as unknown;
    const resolved = resolveProvenanceRule(read("src/catalog/rules/provenance.json") as ProvenanceRule, read).interactiveBackdrops;
    expect(resolved?.slots).toEqual(["sections.hero"]);
    expect(resolved?.components).toEqual((read("src/catalog/rules/backdrop-components.json") as { components: { id: string }[] }).components.map(entry => entry.id));
  });
});

// The Designer's scripts now call this module through the built Producer (dist/); with it built,
// their exported lineage functions are this module's, finding for finding.
describe.skipIf(!existsSync(builtSource))("the Designer scripts call certify/source.ts", () => {
  const lineages = [
    { slot: "assets.logo", mode: "original" },
    { slot: "ui.button", mode: "original" },
    { slot: "ui.button", mode: "verbatim", source: { registry: "shadcn", item: "button", version: "1.0.0", hash: "sha256:other" } },
    { slot: "ui.button", mode: "customized", source: { registry: "shadcn", item: "nope", version: "1.0.0", hash: "sha256:seed" } },
  ];

  it("check-provenance.mjs lineageFindings and candidateLineage equal source.ts's", async () => {
    const script = await import(join(designerScripts, "check-provenance.mjs"));
    for (const lineage of lineages) expect(script.lineageFindings("x", lineage, { rule: RULE, manifest: MANIFEST })).toEqual(lineageFindings("x", lineage, { rule: RULE, manifest: MANIFEST }));
    const item = { ...adopted(), meta: { source: { kind: "registry", ref: ["shadcn/button@1.0.0"], hash: "sha256:seed" } } };
    expect(script.candidateLineage("ui.button", item)).toEqual(candidateLineage("ui.button", item));
    const backdrop = { files: [], meta: { source: { kind: "original", ref: [] }, backdrop: { component: "flickering-grid", params: {} } } };
    const backdropRule: ProvenanceRule = { ...RULE, interactiveBackdrops: { slots: ["sections.hero"], components: ["flickering-grid"] } };
    for (const slot of ["sections.hero", "sections.call-to-action"]) expect(script.backdropFindings("x", slot, backdrop, { rule: backdropRule })).toEqual(backdropFindings("x", slot, backdrop, backdropRule));
  }, 60_000);

  it("check-ref-verbatim.mjs imports with Producer resolved and keeps the shipped exports", async () => {
    const script = await import(join(designerScripts, "check-ref-verbatim.mjs"));
    expect(typeof script.checkRegistryItem).toBe("function");
    expect(typeof script.refVerbatimReport).toBe("function");
  }, 60_000);
});
