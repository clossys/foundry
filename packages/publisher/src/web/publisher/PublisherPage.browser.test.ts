import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("bundles the pack page without fixture data, host parser or Node imports", async () => {
  const result = await build({ entryPoints: [fileURLToPath(new URL("./PublisherPage.tsx", import.meta.url))], bundle: true, platform: "browser", format: "esm", write: false, metafile: true, logLevel: "silent" });
  const inputs = Object.keys(result.metafile!.inputs);
  expect(inputs.some(path => path.endsWith("core/instance-binding.check.ts"))).toBe(true);
  expect(inputs.some(path => /__fixtures__|node_modules\/typescript\//.test(path))).toBe(false);
});
