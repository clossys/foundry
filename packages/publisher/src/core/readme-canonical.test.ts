import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import { describe, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(import.meta.url);

function executeExample() {
  const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
  const section = readme.split("## Runnable canonical example\n")[1]?.split("\n## ")[0];
  expect(section, "README must supply a self-contained canonical example").toBeDefined();
  const fences = [...(section ?? "").matchAll(/^```ts\n([\s\S]*?)^```/gm)];
  expect(fences).toHaveLength(1);
  const output = buildSync({
    stdin: { contents: fences[0]![1]!, resolveDir: packageRoot, loader: "ts" },
    bundle: true, platform: "node", format: "cjs", write: false,
    alias: {
      "@clossys/publisher/core": fileURLToPath(new URL("./index.ts", import.meta.url)),
      "@clossys/writer": fileURLToPath(new URL("../../../writer/src/index.ts", import.meta.url)),
    },
  }).outputFiles[0]!.text;
  const module = { exports: {} as Record<string, any> };
  new Function("module", "exports", "require", output)(module, module.exports, require);
  return module.exports;
}

describe("runnable canonical README example", () => {
  it("executes the public imports and validates every representative section", () => {
    const example = executeExample();
    expect(example.findings).toEqual([]);
    expect(example.document.sections).toHaveLength(6);
    expect(example.document.sections.map((section: any) => section.size)).toEqual(["compact", "standard", "display", "standard", "compact", "display"]);
    expect(example.document.sections.map((section: any) => section.layout)).toEqual(["stacked", "stacked", "stacked", "split-start", "split-end", "stacked"]);
    expect(example.rawAxes).toEqual(example.recipeAxes);
  });
  it("resolves real registry text and retains consumer copy provenance throughout media", () => {
    const example = executeExample();
    expect(example.resolved.sections).toHaveLength(6);
    expect(example.resolved.resolutions.length).toBeGreaterThan(35);
    expect(example.resolved.resolutions.every((entry: any) => entry.recordId === "canonical-example" && entry.revision === "1" && entry.source.reference === "example-v1")).toBe(true);
    expect(example.resolved.resolutions.map((entry: any) => entry.entryId)).toContain("example.previous");
    expect(example.resolved.sections[2].block.sides[0].points).toEqual(["Source document", "Result"]);
    expect(example.resolved.sections[3].media.panel.badge.label).toBe("Ready");
    expect(example.resolved.sections[3].media.panel.parts[0].previousText).toBe("30 / 100");
    expect(example.resolved.sections[4].media.groups[1].owner.initials).toBe("AB");
    expect(example.resolved.sections[5].media.input.sources.items[0].title).toBe("Source document");
  });
});
