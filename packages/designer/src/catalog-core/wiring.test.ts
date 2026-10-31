// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHECK_CODES, WIRING_CODES, WIRING_GUIDANCE } from "./check-guidance.js";
import { checkWiring, foundryWiringExceptions, readWiringExceptions, wiringScope, WIRING_HEADLESS_MODULES, WIRING_REASON_CODES, type WiringInput, type WiringSource } from "./wiring.js";

const fixture = (name: string): string => readFileSync(new URL(`./__fixtures__/wiring/${name}`, import.meta.url), "utf8");
const NOW = "2026-10-26";
const SECTION = "packages/example/sections/aside-band.tsx";
const tokens = [
  { id: "tokens.region-width", contract: { emit: { aside: "--ui-layout-aside-w" } } },
  { id: "themes.background", contract: { emit: { canvas: "--ui-surface-canvas" } } },
];
const frame = (content: string, path = "packages/example/frames/frame.tsx"): WiringSource => ({ path, content, layer: "frames" });
const run = (input: Partial<WiringInput>) => checkWiring({ sources: [], tokens, now: NOW, ...input });
const codes = (result: ReturnType<typeof checkWiring>) => result.findings.map(row => `${row.code}:${row.severity}`);
const wl9 = () => JSON.parse(fixture("wl9.exceptions.json")) as { schemaVersion: 1; exceptions: Record<string, unknown>[] };
const routes = (content: string) => ({ modules: [{ path: "apps/example/app/studio/page.tsx", content }], assembly: [{ module: "@clossys/publisher/web", export: "RegisteredRoutePage" }, { module: "./runtime", export: "registry" }, { module: "./runtime", export: "useRuntime" }] });

describe("checkWiring static codes", () => {
  it("passes a clean frame and a clean route with no findings", () => {
    const result = run({ sources: [frame(fixture("clean.frame.tsx.txt"))], routes: routes(fixture("clean.route.tsx.txt")) });
    expect(result.findings).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.summary).toEqual(Object.fromEntries(WIRING_CODES.map(code => [code, 0])));
  });

  it("WL2: a Section reading a token member directly with no current exception", () => {
    const result = run({ sources: [{ path: SECTION, content: fixture("wl2.section.tsx.txt"), layer: "sections" }] });
    expect(codes(result)).toEqual(["WL2:error"]);
    expect(result.findings[0]).toMatchObject({ file: SECTION, line: 3, evidence: expect.stringContaining("tokens.region-width.aside") });
  });

  it("WL2: surfaces fills of sections/frames slots report scanned members not covered by an exception", () => {
    const fill = { id: "fill-aside", slot: "sections.aside-band", sourceFiles: [SECTION], scannedReads: { themes: ["tokens.region-width"], assets: ["assets.mark"] }, scannedTokenMembers: ["tokens.region-width.aside"] };
    const other = { ...fill, id: "fill-button", slot: "components.button" };
    const result = run({ surfaces: { fills: [fill, other] } });
    expect(result.findings.map(row => [row.code, row.subject, row.evidence.split(" ")[2]])).toEqual([["WL2", "sections.aside-band", "assets.mark"], ["WL2", "sections.aside-band", "tokens.region-width.aside"]]);
  });

  it("WL2: unmeasured without a token inventory, reported as a notice and never as clean", () => {
    const result = checkWiring({ sources: [frame(fixture("clean.frame.tsx.txt"))], now: NOW });
    expect(codes(result)).toEqual(["WL2:notice"]);
    expect(result.ok).toBe(true);
  });

  it("WL3: headless-engine imports above Components, type-only imports included", () => {
    const result = run({ sources: [frame(fixture("wl3.frame.tsx.txt"))] });
    expect(result.findings.map(row => [row.code, row.line, row.evidence.split(" ")[2]])).toEqual([["WL3", 1, "@radix-ui/react-slot"], ["WL3", 2, "react-stately"]]);
  });

  it("WL4: raw values above Components; a comment is never a finding", () => {
    const result = run({ sources: [frame(fixture("wl4.frame.tsx.txt"))] });
    expect(new Set(result.findings.map(row => row.code))).toEqual(new Set(["WL4"]));
    expect(result.findings.some(row => row.line === 1)).toBe(false);
    const evidence = result.findings.map(row => row.evidence).join("\n");
    for (const raw of ["[240px_1fr]", "12px", "#0f172a", "200ms", "RAIL_WIDTH = 240", "padding: \"12px\""]) expect(evidence).toContain(raw);
  });

  it("WL4: a bare var() custom-property hand-off is legitimate; a fallback or non-custom key is raw", () => {
    const ok = `export const A = () => <div style={{ "--w": "var(--ui-layout-aside-w)" }} />;\n`;
    expect(run({ sources: [frame(ok)] }).findings.filter(row => row.code === "WL4")).toEqual([]);
    const fallback = `export const A = () => <div style={{ "--w": "var(--ui-layout-aside-w, 280px)" }} />;\n`;
    expect(run({ sources: [frame(fallback)] }).findings.map(row => row.evidence).join("\n")).toContain("var() fallback for --ui-layout-aside-w");
    const dynamic = `export const A = ({ s }: { s: object }) => <div style={s} />;\n`;
    expect(codes(run({ sources: [frame(dynamic)] }))).toEqual(["WL4:error"]);
  });

  it("WL4: a frame layout constant object is a JS numeric layout constant; an arrow component body is not", () => {
    const config = `export const APP_FRAME_RIGHT_PANEL_CONFIG = Object.freeze({ min: 220, max: 420, defaultValue: 280 });\n`;
    expect(run({ sources: [frame(config, "packages/example/frames/right-panel-config.ts")] }).findings.map(row => row.evidence)).toEqual(
      ["220", "280", "420"].map(value => `JS numeric layout constant APP_FRAME_RIGHT_PANEL_CONFIG = ${value}`));
    const component = `export const AppLayout = ({ items }: { items: string[] }) => items.slice(2).map(item => item);\n`;
    expect(run({ sources: [frame(component)] }).findings).toEqual([]);
  });

  it("WL8: generated-artifact drift, a missing artifact and an artifact with no generator", () => {
    const result = run({ generated: [
      { path: "fills/a.json", committed: "{\n  \"a\": 1\n}\n", regenerated: "{\n  \"a\": 2\n}\n" },
      { path: "fills/b.json", regenerated: "{}\n" },
      { path: "fills/c.json", committed: "{}\n" },
      { path: "fills/d.json", committed: "{}\n", regenerated: "{}\n" },
    ] });
    expect(result.findings.map(row => [row.code, row.file, row.line, row.evidence.split(" ").slice(3).join(" ")])).toEqual([
      ["WL8", "fills/a.json", 2, "differs from regeneration"],
      ["WL8", "fills/b.json", 1, "committed artifact is missing"],
      ["WL8", "fills/c.json", 1, "has no generator"],
    ]);
  });

  it("WL9: invalid, dead and proposed rows; a signed current row covers its read", () => {
    const source = { path: SECTION, content: fixture("wl2.section.tsx.txt"), layer: "sections" as const };
    const result = run({ sources: [source], exceptions: wl9() });
    expect(result.exceptions).toEqual([
      { name: "aside-band-region-width", state: "current" },
      { name: "bad-reason-code", state: "invalid" },
      { name: "missing-owner", state: "invalid" },
      { name: "expired", state: "dead" },
      { name: "changed-hash", state: "dead" },
      { name: "proposed-surface-ground", state: "proposed" },
    ]);
    expect(result.findings.map(row => [row.code, row.severity, row.subject])).toEqual([
      ["WL9", "error", "changed-hash"],
      ["WL9", "error", "expired"],
      ["WL9", "error", "bad-reason-code"],
      ["WL9", "error", "missing-owner"],
      ["WL9", "warning", "proposed-surface-ground"],
    ]);
    expect(result.findings.find(row => row.subject === "bad-reason-code")?.evidence).toContain("outside A3");
    expect(result.ok).toBe(false);
  });

  it("WL9: a proposed row keeps its status through the DF6 liveness check and the input is not mutated", () => {
    const document = wl9(), before = JSON.stringify(document);
    const read = readWiringExceptions(document, [{ path: SECTION, content: fixture("wl2.section.tsx.txt") }], NOW);
    expect(read.exceptions.at(-1)?.row.status).toBe("proposed");
    expect(JSON.stringify(document)).toBe(before);
  });

  it("WL9: unreadable documents, duplicate names and missing files", () => {
    expect(readWiringExceptions({ exceptions: [] }, [], NOW).findings.map(row => row.code)).toEqual(["WL9"]);
    const row = wl9().exceptions[0]!;
    const duplicated = readWiringExceptions([row, row], [{ path: SECTION, content: fixture("wl2.section.tsx.txt") }], NOW);
    expect(duplicated.exceptions.map(item => item.state)).toEqual(["invalid", "invalid"]);
    expect(readWiringExceptions([row], [], NOW).exceptions.map(item => item.state)).toEqual(["dead"]);
  });

  it("WL9: a whole-file anchor is live only while the file hash matches", async () => {
    const { elementHash } = await import("./dogfood.js");
    const content = "export const A = 1;\n", path = "packages/example/frames/a.ts", hash = elementHash(content);
    const row = { name: "file-anchor", file: path, elementId: `${path}#file@${hash.slice(7, 19)}`, hash, read: "tokens.region-width.aside", reasonCode: "layout-geometry", reason: "Whole-file hand-off.", owner: "designer-maintainers", expiry: "2027-01-31", status: "signed" };
    expect(readWiringExceptions([row], [{ path, content }], NOW).exceptions[0]?.state).toBe("current");
    expect(readWiringExceptions([row], [{ path, content: `${content}// edited\n` }], NOW).exceptions[0]?.state).toBe("dead");
  });

  it("WL10: a route module importing blocks and rendering markup beside the runtime assembly", () => {
    const result = run({ routes: routes(fixture("wl10.route.tsx.txt")) });
    expect(new Set(result.findings.map(row => row.code))).toEqual(new Set(["WL10"]));
    const evidence = result.findings.map(row => row.evidence).join("\n");
    expect(evidence).toContain("imports @clossys/designer/blocks");
    expect(evidence).toContain("<DataTable>");
    expect(evidence).toContain("<div>");
    expect(evidence).not.toContain("<RegisteredRoutePage>");
  });

  it("the committed Foundry wiring-exceptions file reads with zero findings", () => {
    expect(readWiringExceptions(foundryWiringExceptions(), [], NOW)).toEqual({ exceptions: [], findings: [] });
  });
});

describe("wiring scope and lists", () => {
  it("resolves 'above Components' through the component registry", () => {
    expect(wiringScope("packages/example/components/button/button.tsx")).toBe("components");
    expect(wiringScope("packages/example/components/not-a-leaf/thing.tsx")).toBe("above");
    expect(wiringScope("packages/example/frames/button.tsx")).toBe("above");
    const raw = fixture("wl3.frame.tsx.txt");
    const result = run({ sources: [frame(raw, "packages/example/components/button/headless.tsx"), frame(raw, "packages/example/components/not-a-leaf/headless.tsx")] });
    expect(result.exempt).toEqual(["packages/example/components/button/headless.tsx"]);
    expect(new Set(result.findings.map(row => row.file))).toEqual(new Set(["packages/example/components/not-a-leaf/headless.tsx"]));
  });

  it("extends K2 FORBIDDEN_MODULES exactly, then the A4 React Aria engines", () => {
    const source = readFileSync(new URL("./check-components.ts", import.meta.url), "utf8");
    const k2 = JSON.parse(/const FORBIDDEN_MODULES = (\[[^\]]*\]);/.exec(source)![1]!) as string[];
    expect(WIRING_HEADLESS_MODULES).toEqual([...k2, "react-aria-components", "react-aria", "@react-aria/", "react-stately"]);
    expect(WIRING_REASON_CODES).toEqual(["layout-geometry", "surface-ground", "document-head", "motion-orchestration"]);
  });

  it("registers WL1-WL10 guidance without touching the Finding code list", () => {
    expect(WIRING_CODES).toEqual(["WL1", "WL2", "WL3", "WL4", "WL5", "WL6", "WL7", "WL8", "WL9", "WL10"]);
    expect(CHECK_CODES.some(code => code.startsWith("WL"))).toBe(false);
    for (const row of Object.values(WIRING_GUIDANCE)) {
      expect(row.severities.length).toBeGreaterThan(0);
      for (const text of [row.meaning, row.typicalCause, row.fix]) expect(text.length).toBeGreaterThan(15);
    }
  });
});

describe("mutation proofs", () => {
  it("removing a reasonCode fires WL9 and un-covers the read (WL2 returns)", () => {
    const document = wl9();
    document.exceptions = [document.exceptions[0]!];
    const source = { path: SECTION, content: fixture("wl2.section.tsx.txt"), layer: "sections" as const };
    expect(codes(run({ sources: [source], exceptions: document }))).toEqual([]);
    delete document.exceptions[0]!.reasonCode;
    expect(codes(run({ sources: [source], exceptions: document }))).toEqual(["WL2:error", "WL9:error"]);
  });

  it("adding a react-aria-components import to a clean frame fires WL3", () => {
    const content = `import { Button as AriaButton } from "react-aria-components";\n${fixture("clean.frame.tsx.txt")}`;
    expect(codes(run({ sources: [frame(content)] }))).toEqual(["WL3:error"]);
  });

  it("adding var(--x, 4px) to a clean frame fires WL4", () => {
    const content = fixture("clean.frame.tsx.txt").replace(`className="flex flex-col"`, `className="flex flex-col" style={{ "--gap": "var(--x, 4px)" }}`);
    expect(run({ sources: [frame(content)] }).findings.every(row => row.code === "WL4")).toBe(true);
    expect(run({ sources: [frame(content)] }).findings.map(row => row.evidence).join("\n")).toContain("var() fallback for --x");
  });
});
