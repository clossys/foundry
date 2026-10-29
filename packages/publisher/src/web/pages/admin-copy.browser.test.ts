import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import { expect, it } from "vitest";

/** Public built entry points, with no Node externals, aliases or shims. */
async function browserApi<T>(entry: string, exports = "*"): Promise<{ api: T; evaluate: <R>(expression: string) => R }> {
  const result = await build({
    stdin: { contents: `export ${exports} from ${JSON.stringify(entry)};`, resolveDir: fileURLToPath(new URL("../../../", import.meta.url)) },
    bundle: true, platform: "browser", format: "iife", globalName: "PublicCopy", write: false, metafile: true, logLevel: "silent",
  });
  const inputs = Object.keys(result.metafile!.inputs);
  expect(inputs.some(path => /approval-bypass\.(?:js|ts)$/.test(path))).toBe(false);
  expect(inputs.some(path => /writer\/(?:dist|src)\/approval\.(?:js|ts)$/.test(path))).toBe(false);
  expect(inputs.some(path => /writer\/(?:dist|src)\/approval-policy\.(?:js|ts)$/.test(path))).toBe(true);
  expect(inputs.some(path => /writer\/(?:dist|src)\/sha256\.(?:js|ts)$/.test(path))).toBe(true);
  expect(Object.values(result.metafile!.outputs).flatMap(output => output.imports)).toEqual([]);
  expect(result.outputFiles[0]!.text).not.toMatch(/(?:require\(|from\s*)["']node:/);
  console.info("admin-copy-browser-proof", JSON.stringify({ entry, platform: "browser", inputs: inputs.length, bytes: result.outputFiles[0]!.contents.length, nodeImports: 0, externalImports: 0, sharedPolicy: true }));
  const context = createContext({ TextEncoder, TextDecoder, Uint8Array, Intl });
  const api = runInContext(`${result.outputFiles[0]!.text}\nPublicCopy;`, context) as T;
  return { api, evaluate: <R>(expression: string) => runInContext(expression, context) as R };
}

it("bundles public Writer admin copy and preserves production refusal and explicit draft preview", async () => {
  const { api: writer } = await browserApi<typeof import("@clossys/writer/admin-copy")>("@clossys/writer/admin-copy");
  const record = writer.ADMIN_WRITER_COPY_EN.records.find(row => row.context.endsWith("coverageSummary"))!;
  const ref = { id: record.id, values: { records: 7, bindings: 4 } };
  expect(writer.resolveAdminCopyRef(ref)).toBeUndefined();
  expect(writer.resolveAdminCopyRef(ref, undefined, { target: "production" })).toBeUndefined();
  expect(writer.resolveAdminCopyRef(ref, undefined, { target: "preview" })).toMatchObject({
    text: "7 records; 4 proposed bindings.", status: "draft", activation: "none", servedLocale: "en",
  });
  expect(record).not.toHaveProperty("approval");
});

it("bundles the public Publisher admin-pages producer and resolves authentic item-name draft preview", async () => {
  // The complete generic barrel is separately bundled as ESM in
  // admin-copy-browser.test.ts. Execute this copy-only public export in a VM
  // without pulling native Designer components (which use top-level await).
  const { evaluate } = await browserApi<typeof import("./index.js")>("@clossys/publisher/web/admin-pages", "{ createAdminPageCopy }");
  const { api: writer } = await browserApi<typeof import("@clossys/writer/admin-copy")>("@clossys/writer/admin-copy");
  const source = writer.ADMIN_COPY_EN.envelopes.find(envelope => envelope.records.some(record => record.id === "st.7zkxq40fwy"))!;
  const before = JSON.stringify(source);
  // Browser inputs must be materialized in that realm; runtimeSnapshot correctly
  // refuses exotic objects whose prototype comes from this Node test realm.
  const copy = evaluate<import("./admin-copy.js").AdminPageCopy>(`PublicCopy.createAdminPageCopy({ locale: "en", envelopes: [{ source: "admin-studio.r1.en.json", envelope: JSON.parse(${JSON.stringify(before)}) }] })`);
  expect(copy.resolve({ id: "st.7zkxq40fwy" })).toMatchObject({ text: "Button", provenance: {
    cellId: "designer.item.components.button", recordId: "st.7zkxq40fwy", locale: "en", status: "draft", activation: "none", mode: "writer-icu-preview",
  } });
  expect(() => copy({ id: "st.unknown000" })).toThrow(/Writer/);
  expect(JSON.stringify(source)).toBe(before);
});
