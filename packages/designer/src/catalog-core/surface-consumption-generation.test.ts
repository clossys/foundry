/** @vitest-environment node */
import { realpathSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { buildSurfaceConsumption } from "./surface-consumption.js";
import { measureFoundrySurfaces } from "../../scripts/lib/foundry-surface-consumption.mjs";

/** SYNTHETIC scanner corpus; real package closure/coherence is covered separately. */
function fixture() {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "surface-measurement-")));
  const root = join(repo, "packages/designer");
  const write = (path: string, content: string) => { const target = join(root, path); mkdirSync(join(target, ".."), { recursive: true }); writeFileSync(target, content); };
  const json = (path: string, value: unknown) => write(path, JSON.stringify(value));
  json("package.json", { name: "@example/designer" });
  mkdirSync(join(repo, "packages/publisher"), { recursive: true });
  writeFileSync(join(repo, "packages/publisher/package.json"), JSON.stringify({ name: "@example/publisher" }));
  json("src/catalog/slots/themes.json", [{ id: "themes.ink", contract: { emit: { primary: "--color-ink" } } }]);
  json("src/catalog/slots/assets.json", []);
  json("src/catalog/slots/components.json", [{ id: "components.button" }]);
  json("src/catalog/slots/sections.json", [{ id: "sections.example", contract: { allowedReads: { themes: ["themes.ink", "themes.unused"], assets: [] }, allowedComposes: ["components.button", "components.unused"], parts: [] } }]);
  json("src/catalog/slots/frames.json", []);
  const doc = (slot: string, pointer: string) => ({ $extensions: { "com.clossys.fill": { id: `synthetic/${slot}`, slot, source: "synthetic", pin: { package: "@example/designer", version: "1.0.0", export: pointer } } }, [slot.split(".")[0]!]: { example: { propMap: {} } } });
  json("src/catalog/fills/foundry/components.button.json", doc("components.button", "./components#Button"));
  json("src/catalog/fills/foundry/sections.example.json", doc("sections.example", "./blocks#Example"));
  write("src/components/index.ts", 'export { Button } from "./Button.js";');
  write("src/components/Button.tsx", 'export function Button() { return <button/>; }');
  write("src/blocks/index.ts", 'export { Example } from "./Example.js";');
  write("src/blocks/Example.tsx", 'import { Button as Action } from "../components/index.js"; export function Example() { return <section className="text-ink"><Action/></section>; }');
  write("src/runtime/component-leaf.tsx", "export function componentLeaf(leaf, part) { return leaf; }");
  write("styles/theme.css", "@theme { --color-ink: var(--color-ink); }");
  write("styles/theme-keys.css", "");
  return { root, write, json, cleanup: () => rmSync(repo, { recursive: true, force: true }) };
}

it("generates measured package facts from reachable source, stopping at the registered primitive boundary", () => {
  const test = fixture();
  try {
    const { measurements } = measureFoundrySurfaces(test.root, buildSurfaceConsumption);
    const row = measurements["sections.example"];
    expect(row.consumption.scannedReads).toEqual({ themes: ["themes.ink"], assets: [], components: ["components.button"] });
    expect(row.consumption.scannedComposes).toEqual(["components.button"]);
    expect(row.consumption.sourceFiles.map((file: { path: string }) => file.path)).toEqual(["packages/designer/src/blocks/Example.tsx"]);
    expect(row.consumption.sourceFiles[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    test.write("src/blocks/Example.tsx", 'export function Example() { return <section/>; }');
    const changed = measureFoundrySurfaces(test.root, buildSurfaceConsumption).measurements["sections.example"].consumption;
    expect(changed.scannedReads).toEqual({ themes: [], assets: [], components: [] });
    expect(changed.scannedComposes).toEqual([]);
    expect(changed.sourceFiles[0].sha256).not.toBe(row.consumption.sourceFiles[0].sha256);
  } finally { test.cleanup(); }
});

it("measures a component leaf composed only through the registered componentLeaf factory, and loses it with the use", () => {
  const test = fixture();
  try {
    test.write("src/blocks/Example.tsx", 'import { componentLeaf } from "../runtime/component-leaf.js"; const Action = componentLeaf("components.button"); export function Example() { return <section><Action/></section>; }');
    const row = measureFoundrySurfaces(test.root, buildSurfaceConsumption).measurements["sections.example"].consumption;
    expect(row.scannedComposes).toEqual(["components.button"]);
    expect(row.scannedReads.components).toEqual(["components.button"]);
    expect(row.unresolved ?? []).toEqual([]);
    test.write("src/blocks/Example.tsx", 'import { componentLeaf } from "../runtime/component-leaf.js"; const Action = componentLeaf("components.button"); export function Example() { return <section/>; }');
    expect(measureFoundrySurfaces(test.root, buildSurfaceConsumption).measurements["sections.example"].consumption.scannedComposes).toEqual([]);
    test.write("src/blocks/Example.tsx", 'import { componentLeaf } from "../runtime/component-leaf.js"; const id = "components.button"; const Action = componentLeaf(id); export function Example() { return <section><Action/></section>; }');
    const dynamic = measureFoundrySurfaces(test.root, buildSurfaceConsumption).measurements["sections.example"].consumption;
    expect(dynamic.scannedComposes).toEqual([]);
    expect(dynamic.unresolved.some((row: { evidence: string }) => row.evidence.includes("leaf id or part is not a literal"))).toBe(true);
  } finally { test.cleanup(); }
});

it("refuses to measure when the component leaf factory source is unavailable", () => {
  const test = fixture();
  try {
    rmSync(join(test.root, "src/runtime/component-leaf.tsx"));
    expect(() => measureFoundrySurfaces(test.root, buildSurfaceConsumption)).toThrow("Component leaf factory source unavailable");
  } finally { test.cleanup(); }
});

it("refuses unavailable source instead of generating empty measured success", () => {
  const test = fixture();
  try {
    test.write("src/blocks/index.ts", "export const Unrelated = 1;");
    expect(() => measureFoundrySurfaces(test.root, buildSurfaceConsumption)).toThrow("Surface source measurement unavailable: sections.example");
  } finally { test.cleanup(); }
});


function privateFixture(extra = "", importText = 'import { value } from "./internal/assets.js";') {
  const test = fixture();
  test.json("src/catalog/slots/sections.json", []);
  test.json("src/catalog/slots/frames.json", [{ id: "frames.example", contract: { allowedReads: { themes: [], assets: [] }, composes: [] } }]);
  rmSync(join(test.root, "src/catalog/fills/foundry/sections.example.json"));
  test.json("src/catalog/fills/foundry/frames.example.json", { $extensions: { "com.clossys.fill": { id: "synthetic/frames.example", slot: "frames.example", source: "synthetic", pin: { package: "@example/designer", version: "1.0.0", export: "./blocks#Example" } } }, frames: { example: {} } });
  test.write("src/blocks/internal/assets.ts", "export const value = 1;");
  test.write("src/blocks/Example.tsx", `${importText} export function Example() { return <main>{value}${extra}</main>; }`);
  return test;
}

it("never reads a private runtime module path as an asset", () => {
  const test = privateFixture();
  try {
    const row = measureFoundrySurfaces(test.root, buildSurfaceConsumption).measurements["frames.example"].consumption;
    expect(row.scannedReads.assets).toEqual([]);
    expect(Object.keys(row)).not.toContain("rawScannedReads");
    expect(Object.keys(row)).not.toContain("privateInternalReads");
  } finally { test.cleanup(); }
});

it("preserves genuine consumer asset ids next to a private import", () => {
  const test = privateFixture('{"assets.js"}{"assets.unrelated"}');
  try {
    const { measurements, report } = measureFoundrySurfaces(test.root, buildSurfaceConsumption);
    expect(measurements["frames.example"].consumption.scannedReads.assets).toEqual(["assets.js", "assets.unrelated"]);
    expect(report.fills[0].missingDeclaredReads.assets).toEqual(["assets.js", "assets.unrelated"]);
  } finally { test.cleanup(); }
});

it("measures a type-only private import like any other source", () => {
  const test = privateFixture('{"assets.js"}', 'import type { value } from "./internal/assets.js";');
  try {
    const row = measureFoundrySurfaces(test.root, buildSurfaceConsumption).measurements["frames.example"].consumption;
    expect(row.scannedReads.assets).toEqual(["assets.js"]);
  } finally { test.cleanup(); }
});
