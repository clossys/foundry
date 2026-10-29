/** @vitest-environment node */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { buildSurfaceConsumption } from "./surface-consumption.js";
import { measureFoundrySurfaces } from "../../scripts/lib/foundry-surface-consumption.mjs";

/** SYNTHETIC scanner corpus; real package closure/coherence is covered separately. */
function fixture() {
  const repo = mkdtempSync(join(tmpdir(), "surface-measurement-"));
  const root = join(repo, "packages/designer");
  const write = (path: string, content: string) => { const target = join(root, path); mkdirSync(join(target, ".."), { recursive: true }); writeFileSync(target, content); };
  const json = (path: string, value: unknown) => write(path, JSON.stringify(value));
  json("package.json", { name: "@example/designer" });
  mkdirSync(join(repo, "packages/publisher"), { recursive: true });
  writeFileSync(join(repo, "packages/publisher/package.json"), JSON.stringify({ name: "@example/publisher" }));
  json("src/catalog/slots/tokens.json", [{ id: "tokens.ink", contract: { emit: { primary: "--color-ink" } } }]);
  json("src/catalog/slots/assets.json", []);
  json("src/catalog/slots/components.json", [{ id: "components.button" }]);
  json("src/catalog/slots/sections.json", [{ id: "sections.example", contract: { allowedReads: { tokens: ["tokens.ink", "tokens.unused"], assets: [] }, allowedComposes: ["components.button", "components.unused"], parts: [] } }]);
  json("src/catalog/slots/frames.json", []);
  const doc = (slot: string, pointer: string) => ({ $extensions: { "com.clossys.fill": { id: `synthetic/${slot}`, slot, source: "synthetic", pin: { package: "@example/designer", version: "1.0.0", export: pointer } } }, [slot.split(".")[0]!]: { example: { propMap: {} } } });
  json("src/catalog/fills/foundry/components.button.json", doc("components.button", "./components#Button"));
  json("src/catalog/fills/foundry/sections.example.json", doc("sections.example", "./blocks#Example"));
  write("src/components/index.ts", 'export { Button } from "./Button.js";');
  write("src/components/Button.tsx", 'export function Button() { return <button/>; }');
  write("src/blocks/index.ts", 'export { Example } from "./Example.js";');
  write("src/blocks/Example.tsx", 'import { Button as Action } from "../components/index.js"; export function Example() { return <section className="text-ink"><Action/></section>; }');
  write("styles/theme.css", "@theme { --color-ink: var(--color-ink); }");
  write("styles/theme-keys.css", "");
  return { root, write, json, cleanup: () => rmSync(repo, { recursive: true, force: true }) };
}

it("generates measured package facts from reachable source, stopping at the registered primitive boundary", () => {
  const test = fixture();
  try {
    const { measurements } = measureFoundrySurfaces(test.root, buildSurfaceConsumption);
    const row = measurements["sections.example"];
    expect(row.consumption.scannedReads).toEqual({ tokens: ["tokens.ink"], assets: [], components: ["components.button"] });
    expect(row.consumption.scannedComposes).toEqual(["components.button"]);
    expect(row.consumption.sourceFiles.map((file: { path: string }) => file.path)).toEqual(["packages/designer/src/blocks/Example.tsx"]);
    expect(row.consumption.sourceFiles[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    test.write("src/blocks/Example.tsx", 'export function Example() { return <section/>; }');
    const changed = measureFoundrySurfaces(test.root, buildSurfaceConsumption).measurements["sections.example"].consumption;
    expect(changed.scannedReads).toEqual({ tokens: [], assets: [], components: [] });
    expect(changed.scannedComposes).toEqual([]);
    expect(changed.sourceFiles[0].sha256).not.toBe(row.consumption.sourceFiles[0].sha256);
  } finally { test.cleanup(); }
});

it("refuses unavailable source instead of generating empty measured success", () => {
  const test = fixture();
  try {
    test.write("src/blocks/index.ts", "export const Unrelated = 1;");
    expect(() => measureFoundrySurfaces(test.root, buildSurfaceConsumption)).toThrow("Surface source measurement unavailable: sections.example");
  } finally { test.cleanup(); }
});


const privateTarget = "packages/designer/src/blocks/internal/assets.ts";
function privateFixture(extra = "", declaration: unknown = [privateTarget], importText = 'import { value } from "./internal/assets.js";') {
  const test = fixture();
  test.json("src/catalog/slots/sections.json", []);
  test.json("src/catalog/slots/frames.json", [{ id: "frames.example", contract: { allowedReads: { tokens: [], assets: [], privateInternal: declaration }, composes: [] } }]);
  rmSync(join(test.root, "src/catalog/fills/foundry/sections.example.json"));
  test.json("src/catalog/fills/foundry/frames.example.json", { $extensions: { "com.clossys.fill": { id: "synthetic/frames.example", slot: "frames.example", source: "synthetic", pin: { package: "@example/designer", version: "1.0.0", export: "./blocks#Example" } } }, frames: { example: {} } });
  test.write("src/blocks/internal/assets.ts", "export const value = 1;");
  test.write("src/blocks/Example.tsx", `${importText} export function Example() { return <main>{value}${extra}</main>; }`);
  return test;
}

it("classifies a proven private runtime import and retains raw asset evidence", () => {
  const test = privateFixture();
  try {
    const row = measureFoundrySurfaces(test.root, buildSurfaceConsumption).measurements["frames.example"].consumption;
    expect(row.scannedReads.assets).toEqual([]);
    expect(row.rawScannedReads.assets).toEqual(["assets.js"]);
    expect(row.privateInternalReads).toEqual([expect.objectContaining({ target: privateTarget, file: "packages/designer/src/blocks/Example.tsx", specifier: "./internal/assets.js", line: 1, rawAssets: ["assets.js"], targetSha256: expect.stringMatching(/^[a-f0-9]{64}$/), sourceSha256: row.sourceFiles.find((file: { path: string }) => file.path.endsWith("Example.tsx")).sha256 })]);
  } finally { test.cleanup(); }
});

it("preserves a genuine same-name consumer asset alongside its private import", () => {
  const test = privateFixture('{"assets.js"}{"assets.unrelated"}');
  try {
    const { measurements, report } = measureFoundrySurfaces(test.root, buildSurfaceConsumption);
    expect(measurements["frames.example"].consumption.scannedReads.assets).toEqual(["assets.js", "assets.unrelated"]);
    expect(measurements["frames.example"].consumption.privateInternalReads).toHaveLength(1);
    expect(report.fills[0].missingDeclaredReads.assets).toEqual(["assets.js", "assets.unrelated"]);
  } finally { test.cleanup(); }
});

it.each([{ declaration: [] }, { declaration: ["packages/designer/src/blocks/internal/unrelated.ts"] }])("does not infer private use from unrelated permission $declaration", ({ declaration }) => {
  const test = privateFixture('{"assets.other"}', declaration);
  try {
    const row = measureFoundrySurfaces(test.root, buildSurfaceConsumption).measurements["frames.example"].consumption;
    expect(row.scannedReads.assets).toEqual(["assets.js", "assets.other"]);
    expect(row.privateInternalReads).toBeUndefined();
  } finally { test.cleanup(); }
});

it.each([{ declaration: ["assets.js"] }, { declaration: ["packages/designer/src/blocks/Example.tsx"] }, { declaration: ["../internal/assets.ts"] }, { declaration: [{ target: privateTarget, hide: "assets.js" }] }])("refuses arbitrary private declarations $declaration", ({ declaration }) => {
  const test = privateFixture("", declaration);
  try { expect(() => measureFoundrySurfaces(test.root, buildSurfaceConsumption)).toThrow(/private internal/i); }
  finally { test.cleanup(); }
});

it("does not classify a type-only import as runtime private evidence", () => {
  const test = privateFixture('{"assets.js"}', [privateTarget], 'import type { value } from "./internal/assets.js";');
  try {
    const row = measureFoundrySurfaces(test.root, buildSurfaceConsumption).measurements["frames.example"].consumption;
    expect(row.scannedReads.assets).toEqual(["assets.js"]);
    expect(row.privateInternalReads).toBeUndefined();
  } finally { test.cleanup(); }
});
