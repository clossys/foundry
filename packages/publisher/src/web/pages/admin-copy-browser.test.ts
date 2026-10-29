import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const external = Object.keys(manifest.peerDependencies).flatMap(peer => [peer, `${peer}/*`]);
const bundle = (contents: string) => build({
  stdin: { contents, resolveDir: root, sourcefile: "admin-copy-consumer.mjs" },
  absWorkingDir: root, bundle: true, platform: "browser", format: "esm",
  write: false, metafile: true, external, logLevel: "silent",
});

it("bundles the public admin-copy client seam without Writer root or the server validator", async () => {
  const result = await bundle('export * from "@clossys/publisher/web/admin-pages";');
  const inputs = Object.keys(result.metafile!.inputs);
  expect(inputs.some(path => /writer\/dist\/admin-copy\.js$/.test(path))).toBe(true);
  expect(inputs.some(path => /web\/pages\/admin-copy\.js$/.test(path))).toBe(true);
  expect(inputs.some(path => /web\/registered-route-pages\.js$/.test(path))).toBe(true);
  expect(inputs.some(path => /controller\/dist\/review\//.test(path))).toBe(false);
  expect(inputs.some(path => /writer\/dist\/index\.js$|web\/pages\/admin-copy-source\.js$/.test(path))).toBe(false);
  const guarded = await bundle('import "@clossys/publisher/web/registered-route-check";');
  expect(Object.keys(guarded.metafile!.inputs).filter(path => path !== "admin-copy-consumer.mjs")).toEqual([expect.stringMatching(/refuse-registered-route-browser\.js$/)]);
  await expect(bundle('export { prepareAdminPageCopyEnvelopes } from "@clossys/publisher/web/registered-route-check";')).rejects.toMatchObject({
    errors: [expect.objectContaining({ text: expect.stringContaining("No matching export") })],
  });
});
