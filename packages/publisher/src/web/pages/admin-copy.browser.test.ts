import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import { expect, it } from "vitest";

/** Public built entry points, with no Node externals, aliases or shims. */
async function browserBundle(entry: string, exports: string, format: "iife" | "esm") {
  const result = await build({
    stdin: { contents: `export ${exports} from ${JSON.stringify(entry)};`, resolveDir: fileURLToPath(new URL("../../../", import.meta.url)) },
    bundle: true, platform: "browser", format, ...(format === "iife" ? { globalName: "PublicCopy" } : {}), write: false, metafile: true, logLevel: "silent",
  });
  const inputs = Object.keys(result.metafile!.inputs);
  expect(inputs.some(path => /approval-bypass\.(?:js|ts)$/.test(path))).toBe(false);
  expect(inputs.some(path => /writer\/(?:dist|src)\/approval\.(?:js|ts)$/.test(path))).toBe(false);
  expect(inputs.some(path => /writer\/(?:dist|src)\/approval-policy\.(?:js|ts)$/.test(path))).toBe(true);
  expect(inputs.some(path => /writer\/(?:dist|src)\/sha256\.(?:js|ts)$/.test(path))).toBe(true);
  expect(Object.values(result.metafile!.outputs).flatMap(output => output.imports)).toEqual([]);
  expect(result.outputFiles[0]!.text).not.toMatch(/(?:require\(|from\s*)["']node:/);
  console.info("admin-copy-browser-proof", JSON.stringify({ entry, platform: "browser", format, inputs: inputs.length, bytes: result.outputFiles[0]!.contents.length, nodeImports: 0, externalImports: 0, sharedPolicy: true }));
  return result.outputFiles[0]!.text;
}
async function browserApi<T>(entry: string): Promise<{ api: T; evaluate: <R>(expression: string) => R }> {
  const source = await browserBundle(entry, "*", "iife");
  const context = createContext({ TextEncoder, TextDecoder, Uint8Array, Intl });
  const api = runInContext(`${source}\nPublicCopy;`, context) as T;
  return { api, evaluate: <R>(expression: string) => runInContext(expression, context) as R };
}

/** Evaluate the public ESM entry in a browser-like realm. VM modules need their
 * own Node flag; the child only hosts the VM and exposes no Node globals to it. */
async function browserEsm(entry: string, exports: string) {
  const source = await browserBundle(entry, exports, "esm");
  const runner = `
    import { readFileSync } from "node:fs";
    import { SourceTextModule, createContext, runInContext } from "node:vm";
    const { source, expression } = JSON.parse(readFileSync(0, "utf8"));
    const context = createContext({ TextEncoder, TextDecoder, Uint8Array, Intl });
    const module = new SourceTextModule(source, { context });
    await module.link(() => { throw new Error("Unexpected browser module import"); });
    await module.evaluate();
    context.PublicCopy = module.namespace;
    process.stdout.write(JSON.stringify(runInContext(expression, context)));
  `;
  return { evaluate: <R>(expression: string): R => JSON.parse(execFileSync(process.execPath,
    ["--experimental-vm-modules", "--input-type=module", "--eval", runner],
    { input: JSON.stringify({ source, expression }), encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] })) as R };
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
  // Match the real public entry's ESM format. Native Designer modules use
  // top-level await, which cannot be transformed to IIFE even when unused.
  const { evaluate } = await browserEsm("@clossys/publisher/web/admin-pages", "{ createAdminPageCopy }");
  const { api: writer } = await browserApi<typeof import("@clossys/writer/admin-copy")>("@clossys/writer/admin-copy");
  const source = writer.ADMIN_COPY_EN.envelopes.find(envelope => envelope.records.some(record => record.id === "st.7zkxq40fwy"))!;
  const before = JSON.stringify(source);
  // Browser inputs must be materialized in that realm; runtimeSnapshot correctly
  // refuses exotic objects whose prototype comes from this Node test realm.
  const observed = evaluate<{ resolution: import("./admin-copy.js").ResolvedAdminPageCopy; gradient: import("./admin-copy.js").ResolvedAdminPageCopy; unknownError: string; sourceUnchanged: boolean; globals: string[] }>(`(() => {
    const source = JSON.parse(${JSON.stringify(before)});
    const copy = PublicCopy.createAdminPageCopy({ locale: "en", envelopes: [{ source: "admin-studio.r1.en.json", envelope: source }] });
    const resolution = copy.resolve({ id: "st.7zkxq40fwy" });
    const gradient = copy.resolve({ id: "st.tbfa7dx2cf" });
    let unknownError = "";
    try { copy({ id: "st.unknown000" }); } catch (error) { unknownError = error.message; }
    return { resolution, gradient, unknownError, sourceUnchanged: JSON.stringify(source) === ${JSON.stringify(before)},
      globals: [typeof process, typeof require, typeof Buffer] };
  })()`);
  expect(observed.resolution).toMatchObject({ text: "Button", provenance: {
    cellId: "designer.item.components.button", recordId: "st.7zkxq40fwy", locale: "en", status: "draft", activation: "none", mode: "writer-icu-preview",
  } });
  expect(observed.gradient).toMatchObject({ text: "Gradient", provenance: {
    cellId: "designer.item.tokens.gradient", recordId: "st.tbfa7dx2cf", locale: "en", status: "draft", activation: "none", mode: "writer-icu-preview",
  } });
  expect(observed.unknownError).toMatch(/Writer/);
  expect(observed.sourceUnchanged).toBe(true);
  expect(observed.globals).toEqual(["undefined", "undefined", "undefined"]);
  expect(JSON.stringify(source)).toBe(before);
});
