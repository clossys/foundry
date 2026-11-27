/**
 * CP1-REFS (b) and (c). The world is test-fixtures/consumer: frames.inspector's contract fixture ships as
 * shadcn-aria/sheet-example (a registry:example); sections.empty-state's and sections.error-state's fixture is the
 * `empty` primitive (registry:ui), whose example is shadcn-aria/empty-example.
 */
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { craftLineageOf, REFERENCE_MANIFEST, stockItemOf } from "../records/code-adopt.js";
import { packagePath } from "../package-path.js";
import { assembleBrief } from "./craft-brief.js";
import { licenceRequestLine } from "./licence-request.js";

const FIXTURE = fileURLToPath(new URL("../../test-fixtures/consumer/", import.meta.url));
const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

function world(): { root: string; consumer: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "craft-lineage-")));
  roots.push(root);
  cpSync(FIXTURE, root, { recursive: true });
  return { root, consumer: join(root, "clossys") };
}

const manifestRow = (root: string, registry: string, name: string) =>
  (JSON.parse(readFileSync(packagePath(root, REFERENCE_MANIFEST), "utf8")) as { items: { registry: string; name: string; hash: string; type: string }[] }).items
    .find(row => row.registry === registry && row.name === name)!;

describe("frames and sections cite a registry:example as lineage", () => {
  it("a frames craft brief cites the registry:example lineage with hash, candidate type registry:block, and names the gallery imports", () => {
    const { root, consumer } = world();
    const made = assembleBrief(root, consumer, "designer", "frames.inspector");
    if ("refusal" in made) throw new Error(made.refusal);
    const { lineage } = made.brief;
    const row = manifestRow(root, "shadcn-aria", "sheet-example");
    expect(row.type).toBe("registry:example");
    expect(lineage?.source).toMatchObject({ ref: "shadcn-aria/sheet-example@4.23.0", type: "registry:example", hash: row.hash });
    expect(lineage?.candidateType).toBe("registry:block");
    expect(lineage?.galleryScaffolding).toEqual({ "registry/aria-nova/examples/sheet-example.tsx": ["@/registry/aria-nova/components/example"] });
    expect(lineage?.note).toMatch(/the candidate's own type stays registry:block/);
    expect(lineage?.note).toMatch(/gallery wrapper .*which the craft removes/);
    // A components slot is byte-exact adopt, not crafted: its brief carries no lineage.
    expect(craftLineageOf(root, "components.checkbox")).toMatchObject({ none: expect.stringMatching(/not a frames or sections slot/) });
  });

  it("sections.empty-state is offered empty-example", () => {
    const { root } = world();
    for (const slot of ["sections.empty-state", "sections.error-state"]) {
      const found = stockItemOf(root, slot);
      if (!("stock" in found)) throw new Error(found.none);
      expect(found.stock.ref).toBe("shadcn-aria/empty-example@4.23.0");
      expect(found.stock.row.type).toBe("registry:example");
      const lineage = craftLineageOf(root, slot);
      expect("lineage" in lineage && lineage.lineage.source).toMatchObject({ item: "empty-example", hash: manifestRow(root, "shadcn-aria", "empty-example").hash });
    }
    // A components slot keeps its primitive: only a frame or section takes the example.
    const checkbox = stockItemOf(root, "components.checkbox");
    expect("stock" in checkbox && checkbox.stock.row.type).toBe("registry:ui");
  });
});

describe("the mark licence refusal names the way out", () => {
  const finding = "R05.1 [requirement] source.ref: meta.source.license proprietary is not one of MIT, CC0-1.0";

  it("an original mark with an unlisted licence gets the request line", () => {
    const line = licenceRequestLine("designer/assets.mark", "original", ["R05.1 [requirement] other: x", finding]);
    expect(line).toBe("licence: the standard takes MIT or CC0-1.0 for the mark file (meta.source.license, now proprietary); to use another licence, ask the owner with clossys request --kind change --subject designer/assets.mark --from designer/assets.mark --why \"<the licence the mark needs, and why>\"");
    expect(licenceRequestLine("designer/assets.mark", "derived", [finding])).toBeUndefined();
    expect(licenceRequestLine("designer/assets.mark", "original", ["R05.1 [requirement] source.ref: meta.source.kind x is not one of original"])).toBeUndefined();
  });
});
