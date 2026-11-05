import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const entry = fileURLToPath(new URL("./PublisherInstancesView.tsx", import.meta.url));
it("bundles the production view and pure checker without TypeScript or Node runtime imports", async () => {
  const options = { bundle: true, platform: "browser" as const, format: "esm" as const, write: false, metafile: true, logLevel: "silent" as const };
  const result = await build({ ...options, entryPoints: [entry] });
  const inputs = Object.keys(result.metafile!.inputs);
  expect(inputs.some(path => path.endsWith("core/instance-binding.check.ts"))).toBe(true);
  expect(inputs.some(path => /node_modules\/typescript\//.test(path))).toBe(false);
  expect(inputs.some(path => /__fixtures__/.test(path))).toBe(false);
  for (const file of ["client.ts", "index.ts"]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    expect(source).toContain('export { PublisherInstancesView } from "./instances/PublisherInstancesView.js"');
  }
  await expect(build({ ...options, stdin: { contents: `export * from ${JSON.stringify(entry)}; import "node:fs";` } })).rejects.toThrow(/node:fs/);
});
