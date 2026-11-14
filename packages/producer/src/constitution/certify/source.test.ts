import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { candidateLineage, consumerOwnDerivation, globMatch, lineageFindings, parseRef, seedItem, sha256, treeHash, verbatimFindings, type ProvenanceRule, type ReferenceManifest } from "./source.js";

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
  }, 60_000);

  it("check-ref-verbatim.mjs imports with Producer resolved and keeps the shipped exports", async () => {
    const script = await import(join(designerScripts, "check-ref-verbatim.mjs"));
    expect(typeof script.checkRegistryItem).toBe("function");
    expect(typeof script.refVerbatimReport).toBe("function");
  }, 60_000);
});
