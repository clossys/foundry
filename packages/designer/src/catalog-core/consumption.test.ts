import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildComponentsConsumption, componentCandidateIntent, scanComponentReads } from "./consumption.js";
import type { ConsumptionInput } from "./consumption.js";

const input = (): ConsumptionInput => ({
  tokens: [
    { id: "tokens.text-color", contract: { emit: { primary: "--color-ink-primary" } } },
    { id: "tokens.spacing", contract: { emit: { md: "--spacing-md" } } },
    { id: "tokens.control-size", contract: { emit: { md: "--ui-control-h-md" } } },
    { id: "tokens.unread", contract: {} },
  ],
  assets: [{ id: "assets.icon-close" }],
  components: [{ id: "components.button" }, { id: "components.dialog" }],
  themeCss: "@theme inline { --color-ink-primary: var(--color-ink-primary); --spacing-md: var(--spacing-md); --spacing-control: var(--ui-control-h-md); }",
  fills: [{ id: "foundry/components.button", slot: "components.button", source: "foundry", members: [], composes: [],
    reads: { tokens: [], assets: [], components: [] }, conforms: [], evidence: [] }],
  sourceScans: [{ fill: "foundry/components.button", files: [{ path: "src/components/Button.tsx", content: 'const style = "text-ink-primary hover:px-md h-control"; useGlyph("assets.icon-close");' }], components: ["components.dialog"] }],
  foundryCoverage: [{ slot: "components.button", status: "candidate", supported: [], missing: [], notes: [] }, { slot: "components.dialog", status: "unavailable", supported: [], missing: [], notes: [] }],
  shadcnReceipt: [],
});

describe("component consumption lower bounds", () => {
  it("expands theme utilities, variants and arbitrary properties into exact token members", () => {
    const fixture = input();
    const scan = scanComponentReads('"text-ink-primary dark:hover:px-md h-control ring-(--color-ink-primary)"', fixture.tokens, fixture.themeCss);
    expect(scan.tokens).toEqual(["tokens.control-size", "tokens.spacing", "tokens.text-color"]);
    expect(scan.tokenMembers).toEqual(["tokens.control-size.md", "tokens.spacing.md", "tokens.text-color.primary"]);
    expect(scan.utilities).toEqual(["h-control", "px-md", "text-ink-primary"]);
    expect(scan.properties).toEqual(["--color-ink-primary", "--spacing-md", "--ui-control-h-md"]);
  });

  it("keeps missing declarations visible even when effective reads include the scanned lower bound", () => {
    const report = buildComponentsConsumption(input());
    const row = report.fills[0]!;
    expect(row.declaredReads.tokens).toEqual([]);
    expect(row.scannedReads.tokens).toEqual(["tokens.control-size", "tokens.spacing", "tokens.text-color"]);
    expect(row.effectiveReads.tokens).toEqual(row.scannedReads.tokens);
    expect(row.missingDeclaredReads).toEqual({ tokens: row.scannedReads.tokens, assets: ["assets.icon-close"], components: ["components.dialog"] });
    expect(report.findings).toContainEqual(expect.objectContaining({ code: "missing-declared-reads", fill: row.id, layer: "tokens" }));
    expect(report.findings).toContainEqual(expect.objectContaining({ code: "missing-declared-reads", fill: row.id, layer: "assets" }));
    expect(report.unreadTokenLeaves.scanned).toEqual(["tokens.unread"]);
    expect(report.unreadTokenLeaves.declared).toEqual(input().tokens.map(token => token.id).sort());
  });

  it("detects removal of a declaration and indexes both declared and scanned composition dependents", () => {
    const fixture = input();
    fixture.fills[0]!.reads.tokens = ["tokens.control-size", "tokens.spacing", "tokens.text-color"];
    fixture.fills[0]!.reads.assets = ["assets.icon-close"];
    fixture.fills[0]!.composes = ["components.dialog"];
    fixture.fills[0]!.reads.components = ["components.dialog"];
    expect(buildComponentsConsumption(fixture).findings).toEqual([]);
    fixture.fills[0]!.reads.tokens = ["tokens.spacing"];
    const mutated = buildComponentsConsumption(fixture);
    expect(mutated.findings).toContainEqual(expect.objectContaining({ code: "missing-declared-reads", layer: "tokens", reads: ["tokens.control-size", "tokens.text-color"] }));
    expect(mutated.reverseComposes["components.dialog"]).toEqual({ declared: ["foundry/components.button"], scanned: ["foundry/components.button"], effective: ["foundry/components.button"] });
  });

  it("does not treat an absent scan as an empty measured scan", () => {
    const fixture = input(); fixture.sourceScans = [];
    const report = buildComponentsConsumption(fixture);
    expect(report.fills[0]!.scanStatus).toBe("unavailable");
    expect(report.findings).toContainEqual(expect.objectContaining({ code: "source-scan-unavailable" }));
  });

  it("keeps source blockers separate from descriptor coverage and proposed candidate intent", () => {
    const fixture = input();
    fixture.fills.push({ ...fixture.fills[0]!, id: "shadcn@aria/components.button", source: "shadcn@aria", blockers: [{ code: "K4", value: "px-2.5", message: "Unbound length" }] });
    const report = buildComponentsConsumption(fixture);
    const row = report.candidates.find(row => row.slot === "components.button")!;
    expect(row.foundry.status).toBe("candidate");
    expect(row.shadcn).toMatchObject({ status: "blocked", descriptorCount: 1, blockedCount: 1, blockerCount: 1 });
    expect(row.intent).toEqual(componentCandidateIntent("components.button"));
    expect(row.intent.foundry).toBe("OFFER");
    expect(row.intent.shadcn).toBe("U-V");
  });
});

describe("committed component consumption evidence", () => {
  const read = (path: string) => JSON.parse(readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8"));
  const report = () => read("../catalog/reports/components-consumption.json");

  it("preserves the exact signed 53/45/57 leaf inventories", () => {
    const actual = report();
    for (const [layer, count] of [["tokens", 53], ["assets", 45], ["components", 57]] as const) {
      const freeze = read(`../catalog/ia/${layer}.leaf-freeze.json`);
      expect(actual.inventory[layer]).toEqual([...freeze.leafIds].sort());
      expect(actual.inventory[layer]).toHaveLength(count);
    }
    expect(actual.historicalInventory).toEqual({ tokenProperties: 217, meaning: "Historical CSS property inventory; not the token leaf count." });
  });

  it("reports every descriptor blocker without inventing adoption or runtime conformance", () => {
    const actual = report();
    expect(actual.summary.foundry).toEqual({ descriptors: 44, candidate: 34, subset: 10, unavailable: 13 });
    expect(actual.summary.shadcn).toMatchObject({ descriptors: 26, blocked: 24, unblocked: 2, blockers: 208 });
    expect(actual.candidates).toHaveLength(57);
    expect(actual.fills.every((fill: { conforms: string[]; evidence: unknown[] }) => fill.conforms.length === 0 && fill.evidence.length === 0)).toBe(true);
    expect(actual.findings.some((finding: { code: string }) => finding.code === "missing-declared-reads")).toBe(true);
    expect(actual.claims.runtimeAccessibility).toBe("unmeasured");
    expect(actual.claims.consumerAdoption).toBe("unmeasured");
  });

  it("records proposed section 2 classifications for all 57 leaves, including unavailable offers", () => {
    const actual = report();
    const counts: Record<string, number> = {};
    for (const row of actual.candidates) counts[row.intent.foundry] = (counts[row.intent.foundry] ?? 0) + 1;
    expect(counts).toEqual({ OFFER: 32, "OFFER-BUILD": 3, "ADOPT-ONLY": 17, GAP: 4, COMPOSED: 1 });
    const toolbar = actual.candidates.find((row: { slot: string }) => row.slot === "components.toolbar");
    expect(toolbar.intent.foundry).toBe("OFFER");
    expect(toolbar.foundry.status).toBe("unavailable");
    expect(actual.candidates.find((row: { slot: string }) => row.slot === "components.field").shadcn.status).toBe("rejected");
  });
});
