import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { elementFindings, loadManifest, loadRule, provenanceFindings, scanFindings } from "../../scripts/check-provenance.mjs";
import { writeDesignerSlot } from "../../scripts/__fixtures__/slot-model.mjs";

const json = (path: string) => JSON.parse(readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8"));
const rule = loadRule();
const manifest = loadManifest();
const ref = (registry: string, name: string) => {
  const row = manifest.items.find((item: { registry: string; name: string }) => item.registry === registry && item.name === name);
  return { registry, item: name, version: row.version, hash: row.hash };
};

type Lineage = { mode: string; source?: Record<string, string> };
const KIND: Record<string, string> = { original: "original", verbatim: "registry", customized: "derived" };
/** A slot-model consumer: each item is one Designer candidate `<element>-v<N>.json`; `pinned` pins it. */
function consumer(items: { slot: string; element: string; version: number; lineage: Lineage; pinned?: boolean }[]) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "provenance-")));
  const slots = new Map<string, { candidates: Record<string, unknown>; pin?: string }>();
  for (const { slot, element, version, lineage, pinned } of items) {
    const name = `${element}-v${version}.json`;
    const source = lineage.source
      ? { kind: KIND[lineage.mode], ref: [`${lineage.source.registry}/${lineage.source.item}@${lineage.source.version}`], hash: lineage.source.hash }
      : { kind: KIND[lineage.mode], ref: [] };
    const row = slots.get(slot) ?? { candidates: {} };
    row.candidates[name] = { name: element, type: "registry:block", files: [], meta: { slot, source } };
    if (pinned) row.pin = name;
    slots.set(slot, row);
  }
  for (const [id, row] of slots) writeDesignerSlot(root, { id, ...row });
  return root;
}

describe("provenance rule", () => {
  it("names real consumer-asset slots, the manifest registries and existing preset items", () => {
    const slots = new Set([...json("./slots/components.json"), ...json("./slots/assets.json")].map((row: { id: string }) => row.id));
    for (const slot of rule.consumerAssets.slots) expect(slots.has(slot), slot).toBe(true);
    expect(rule.trustedRegistries).toBe("references/manifest.json#registries");
    for (const cls of rule.classes) for (const item of cls.sourceItems ?? []) expect(ref(item.split("/")[0], item.split("/")[1]).hash).toMatch(/^sha256:/);
    expect(Object.keys(manifest.registries)).toEqual(expect.arrayContaining(["shadcn", "magicui", "diceui", "tailark-oss", "fontsource"]));
  });
});

describe("designer-provenance-check", () => {
  it("passes referenced items and consumer-asset originals", () => {
    const root = consumer([
      { slot: "components.skip-nav", element: "skip-nav", version: 1, lineage: { mode: "customized", source: ref("diceui", "skip-nav") }, pinned: true },
      { slot: "themes.font-heading", element: "font-heading", version: 1, lineage: { mode: "customized", source: ref("fontsource", "inter-tight") }, pinned: true },
      { slot: "themes.theme", element: "theme", version: 1, lineage: { mode: "customized", source: ref("shadcn", "neutral") }, pinned: true },
      { slot: "components.logo", element: "logo", version: 1, lineage: { mode: "original" }, pinned: true },
    ]);
    expect(provenanceFindings(root, { rule, manifest })).toMatchObject({ violations: [], pending: [] });
  });

  it("fails a synthetic original item, an untrusted registry, a stale hash and a font from a non-font item", () => {
    const root = consumer([
      { slot: "sections.legal-prose", element: "legal-prose", version: 1, lineage: { mode: "original" }, pinned: true },
      { slot: "sections.hero", element: "hero", version: 1, lineage: { mode: "customized", source: { ...ref("tailark-oss", "mist-hero-section-1"), registry: "acme-ui" } } },
      { slot: "sections.features", element: "features", version: 1, lineage: { mode: "verbatim", source: { ...ref("tailark-oss", "mist-features-1"), hash: "sha256:" + "1".repeat(64) } } },
      { slot: "themes.font-heading", element: "font-heading", version: 1, lineage: { mode: "customized", source: ref("shadcn", "button") } },
    ]);
    const { violations } = provenanceFindings(root, { rule, manifest });
    expect([...violations].sort()).toEqual([
      expect.stringMatching(/^option sections\.features\/features-v1\.json: tailark-oss\/mist-features-1@\S+ hash sha256:1+ != manifest/),
      expect.stringMatching(/^option sections\.hero\/hero-v1\.json: .* acme-ui, which is not a trusted registry/),
      expect.stringMatching(/^option themes\.font-heading\/font-heading-v1\.json: themes\.font-heading must come from registry:font/),
      expect.stringMatching(/^pin sections\.legal-prose\/legal-prose-v1\.json: original item in sections\.legal-prose/),
    ]);
  });

  it("lists a pinned violator as pending when its slot's option passes, and refuses to pin it", () => {
    const root = consumer([
      { slot: "sections.legal-prose", element: "legal-prose", version: 1, lineage: { mode: "original" }, pinned: true },
      { slot: "sections.legal-prose", element: "legal-prose", version: 2, lineage: { mode: "customized", source: ref("tailwindcss-typography", "typography") } },
    ]);
    const result = provenanceFindings(root, { rule, manifest });
    expect(result.violations).toEqual([]);
    expect(result.pending).toEqual([expect.stringMatching(/^pin sections\.legal-prose\/legal-prose-v1\.json: original item .*pending replacement/)]);
    expect(elementFindings(root, "sections.legal-prose/legal-prose-v1.json", { rule, manifest })).toHaveLength(1);
    expect(elementFindings(root, "sections.legal-prose/legal-prose-v2.json", { rule, manifest })).toEqual([]);
  });

  it("gives a slot marked not needed no option, still checks it under --all, and still checks a pinned slot that also says not needed", () => {
    const root = consumer([
      { slot: "sections.consent", element: "consent", version: 1, lineage: { mode: "original" } },
      { slot: "sections.legal-prose", element: "legal-prose", version: 1, lineage: { mode: "original" }, pinned: true },
    ]);
    const mark = (slot: string, notNeeded: unknown) => {
      const path = join(root, "agents", "designer", slot, "slot.json");
      writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, "utf8")), notNeeded }));
    };
    const declined = { reason: "no approved-registry source", since: "2026-11-04", decidedBy: "planner:test" };
    expect(provenanceFindings(root, { rule, manifest }).violations).toHaveLength(2);
    mark("sections.consent", declined);
    mark("sections.legal-prose", declined);
    const result = provenanceFindings(root, { rule, manifest });
    expect(result.violations).toEqual([expect.stringMatching(/^pin sections\.legal-prose\/legal-prose-v1\.json: original item/)]);
    expect(result.checked).toEqual(["sections.legal-prose/legal-prose-v1.json"]);
    expect(provenanceFindings(root, { rule, manifest, all: true }).violations).toHaveLength(2);
    // A malformed marker is not the not-needed state: the option is checked again.
    mark("sections.consent", { reason: "" });
    expect(provenanceFindings(root, { rule, manifest }).violations).toHaveLength(2);
  });

  it("reads a candidate derived only from the consumer's own asset slots as an original: allowed in a consumer-asset slot only", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "provenance-")));
    const own = { kind: "derived", ref: ["clossys/agents/designer/assets.mark/candidates/mark-v2.json", "clossys/agents/designer/assets.logo"] };
    const outside = { kind: "derived", ref: ["clossys/agents/designer/assets.mark/candidates/mark-v2.json", "packages/producer/studio/public/studio-mark.svg"] };
    const item = (slot: string, source: unknown) => ({ name: slot.split(".").at(-1), type: "registry:block", files: [], meta: { slot, source } });
    writeDesignerSlot(root, { id: "components.logo", candidates: { "logo-v1.json": item("components.logo", own) }, pin: "logo-v1.json" });
    writeDesignerSlot(root, { id: "components.badge", candidates: { "badge-v1.json": item("components.badge", own) }, pin: "badge-v1.json" });
    writeDesignerSlot(root, { id: "assets.lockup", candidates: { "lockup-v1.json": item("assets.lockup", outside) }, pin: "lockup-v1.json" });
    expect([...provenanceFindings(root, { rule, manifest }).violations].sort()).toEqual([
      expect.stringMatching(/^pin assets\.lockup\/lockup-v1\.json: customized item has no lineage\.source/),
      expect.stringMatching(/^pin components\.badge\/badge-v1\.json: original item in components\.badge, which is not a consumer-asset slot/),
    ]);
  });

  it("reads pins only through the slot-model reader: a legacy selection store is ignored", () => {
    const root = consumer([{ slot: "components.logo", element: "logo", version: 1, lineage: { mode: "original" }, pinned: true }]);
    writeFileSync(join(root, "selection.json"), JSON.stringify({ pins: { "sections.legal-prose": { element: "legal-prose", version: 1 } } }));
    expect(provenanceFindings(root, { rule, manifest })).toMatchObject({ violations: [], pending: [], checked: ["components.logo/logo-v1.json"] });
  });

  it("finds no unreferenced record in Foundry outside test fixtures", () => {
    const result = scanFindings(resolve(dirname(fileURLToPath(import.meta.url)), "../../.."), { rule, manifest });
    expect(result.violations).toEqual([]);
    expect(result.exempt.length).toBeGreaterThan(0);
  });
});
