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
  return { root, write, cleanup: () => rmSync(repo, { recursive: true, force: true }) };
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
