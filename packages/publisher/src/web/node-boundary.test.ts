import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { join } from "node:path";
import { expect, it } from "vitest";

it("retains the exact scanner boundary in the registered Designer query graph", async () => {
  const result = await build({ entryPoints: [join(import.meta.dirname, "registered-route-query-source.ts")], bundle: true, platform: "node", format: "esm", external: ["@clossys/designer/catalog/dogfood/node"], write: false, metafile: true, logLevel: "silent" });
  const inputs = Object.keys(result.metafile!.inputs);
  expect(inputs.some(file => file.endsWith("registered-route-query-source.ts"))).toBe(true);
  expect(inputs.filter(file => /consumer-dogfood|catalog-core\/server|library-cli\/fs-library/.test(file))).toEqual([]);
  expect(result.metafile!.outputs["stdin.js"]?.imports ?? Object.values(result.metafile!.outputs)[0]!.imports).toContainEqual(expect.objectContaining({ path: "@clossys/designer/catalog/dogfood/node", external: true }));
  const script = result.outputFiles[0]!.text.replace(/export\s*\{[^}]*\};?\s*$/, "") + `
    const result = await registeredDesignerQuerySources();
    const summary = {};
    for (const [kind, row] of Object.entries(result)) {
      summary[kind] = { id: row.id, files: Object.keys(row.source.files), sourceHash: row.sourceHash };
    }
    console.log(JSON.stringify(summary));
  `;
  const descriptors = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 20_000 }));
  expect(descriptors.implementation.id).toBe("designer.layer-boards@1");
  expect(descriptors.implementation.files).toContain("studio/designer-layer-boards.js");
  expect(descriptors.provider.id).toBe("WholeStudioProvider");
});

it("projects App inventory through the real react-server web entry", () => {
  const script = `import { projectAppInventory } from "@clossys/publisher/web"; import { projectAppInventory as direct } from "./dist/web/publisher/app/inventory.js"; if(projectAppInventory !== direct) throw new Error("Wrong inventory implementation"); console.log(JSON.stringify(projectAppInventory({schemaVersion:2,artifactType:"app-route-inventory",source:{head:"a",tree:"b"},pages:[],subrows:[],nonAddressableTabs:[]})));`;
  const inventory = JSON.parse(execFileSync(process.execPath, ["--conditions=react-server", "--input-type=module", "-e", script], { encoding: "utf8", timeout: 20_000 }));
  expect(inventory).toMatchObject({ source: { head: "a", tree: "b" }, routes: [], nonAddressableTabs: [] });
});
