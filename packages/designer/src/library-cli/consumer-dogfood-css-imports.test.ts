/** @vitest-environment node */
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { consumerDogfoodSources, runConsumerDogfood } from "./consumer-dogfood.js";
let root: string;
beforeEach(async () => { root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "consumer-css-"))); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
async function write(file: string, content: string) {
  await fs.mkdir(join(root, file, ".."), { recursive: true });
  await fs.writeFile(join(root, file), content);
}
async function fixture(exports: unknown, style?: string) {
  await write("Page.tsx", 'import "./root.css"; export default function Page(){return null}');
  await write("root.css", '@import "@example/styles";');
  await write("node_modules/@example/styles/package.json", JSON.stringify({ name: "@example/styles", exports, style }));
  await write("node_modules/@example/styles/index.css", '@import "./nested.css";');
  await write("node_modules/@example/styles/nested.css", '.component { padding:4px; }');
  await write("node_modules/@example/styles/dist/lib.js", 'throw new Error("JavaScript must never execute");');
}
const sources = () => consumerDogfoodSources(["Page.tsx"], { version: 1, sources: {}, pages: ["Page.tsx"] }, root, root);
it("resolves the observed Tailwind root export shape through style and scans its CSS closure", async () => {
  await fixture({ ".": { types: "./dist/lib.d.mts", style: "./index.css", require: "./dist/lib.js", import: "./dist/lib.mjs" } }, "index.css");
  const input = await sources();
  expect(input.files.map(file => file.file)).toContain("node_modules/@example/styles/index.css");
  expect(input.files.map(file => file.file)).toContain("node_modules/@example/styles/nested.css");
  expect(input.files.some(file => file.file.endsWith("lib.js"))).toBe(false);
  expect(runConsumerDogfood(input).findings).toContainEqual(expect.objectContaining({ file: "node_modules/@example/styles/nested.css", code: "DF2" }));
});
it("follows imports beside mixed theme declarations and nested keyframes without hiding findings", async () => {
  await fixture({ ".": { style: "./index.css" } });
  await write("node_modules/@example/styles/index.css", `@import "./nested.css";
    @layer theme { @theme default {
      --animate-spin: spin 1s linear infinite;
      @keyframes spin { 0%, 100% { padding:8px; } }
      --blur-xs:4px;
    } }`);
  const input = await sources();
  expect(input.files.map(file => file.file)).toContain("node_modules/@example/styles/nested.css");
  const report = runConsumerDogfood(input);
  expect(report.findings).toEqual(expect.arrayContaining([
    expect.objectContaining({ file: "node_modules/@example/styles/index.css", code: "DF2", evidence: expect.stringContaining("8px") }),
    expect.objectContaining({ file: "node_modules/@example/styles/nested.css", code: "DF2", evidence: expect.stringContaining("4px") }),
  ]));
  expect(report.findings.some(row => row.evidence.includes("Unresolved CSS"))).toBe(false);
});
it.each([
  [{ ".": { css: { default: "./index.css" }, default: "./dist/lib.js" } }, undefined],
  ["./index.css", undefined],
  [undefined, "index.css"],
])("supports explicit CSS conditions, direct CSS exports and legacy style entries: %j", async (exports, style) => {
  await fixture(exports, style);
  expect((await sources()).files.map(file => file.file)).toContain("node_modules/@example/styles/nested.css");
});
it.each([
  [{ ".": { default: "./dist/lib.js" } }, /non-CSS/],
  [{ ".": { style: "./dist/lib.js" } }, /non-CSS/],
  [{ ".": { require: "./dist/lib.js" } }, /Unresolved/],
  [{ ".": { browser: "./index.css" } }, /Unresolved/],
  [{ "./private.css": "./index.css" }, /Unresolved/],
  [{ ".": null }, /Unresolved/],
  [{ ".": ["./index.css", "./other.css"] }, /Ambiguous/],
  [{ ".": { style: "./index.css", css: "./other.css" } }, /Ambiguous/],
  [{ ".": { style: "../outside.css" } }, /Unsafe/],
  [{ ".": { style: "./../outside.css" } }, /Unsafe/],
  [{ ".": { style: "./node_modules/other/index.css" } }, /Unsafe/],
  [{ ".": { style: "./%2e%2e/outside.css" } }, /Unsafe/],
  [{ ".": "./missing.css" }, /ENOENT/],
])("fails closed for unresolved, ambiguous, non-CSS and escaping exports: %j", async (exports, error) => {
  await fixture(exports);
  await expect(sources()).rejects.toThrow(error);
});
it("never uses the legacy style field to bypass a package export boundary", async () => {
  await fixture({ ".": null }, "index.css");
  await expect(sources()).rejects.toThrow(/Unresolved/);
});
it("refuses an unresolved import reached in package CSS", async () => {
  await fixture({ ".": { style: "./index.css" } });
  await write("node_modules/@example/styles/nested.css", '@import "./missing.css";');
  await expect(sources()).rejects.toThrow(/Unresolved/);
});
it("refuses a relative package CSS edge that escapes the package", async () => {
  await fixture({ ".": { style: "./index.css" } });
  await write("node_modules/@example/styles/nested.css", '@import "../outside.css";');
  await write("node_modules/@example/outside.css", '.component { padding:4px; }');
  await expect(sources()).rejects.toThrow(/escapes package/);
});
it("refuses a CSS export symlink into another package", async () => {
  await fixture({ ".": { style: "./escape.css" } });
  await write("outside.css", '.component { padding:4px; }');
  await fs.symlink(join(root, "outside.css"), join(root, "node_modules/@example/styles/escape.css"));
  await expect(sources()).rejects.toThrow(/escapes package/);
});
it("locates a package installed through a package-manager directory symlink", async () => {
  await fixture({ ".": { style: "./index.css" } });
  const physical = join(root, "node_modules/.store/styles");
  await fs.mkdir(join(physical, ".."), { recursive: true });
  await fs.rename(join(root, "node_modules/@example/styles"), physical);
  await fs.symlink(physical, join(root, "node_modules/@example/styles"));
  expect((await sources()).files.map(file => file.file)).toContain("node_modules/.store/styles/nested.css");
});
it("resolves explicit stylesheet subpaths and the most specific export pattern", async () => {
  await fixture({ "./*": "./missing/*.css", "./tokens/*": { style: "./*.css" }, "./tokens/blocked": null });
  await write("root.css", '@import "@example/styles/tokens/index";');
  expect((await sources()).files.map(file => file.file)).toContain("node_modules/@example/styles/nested.css");
  await write("root.css", '@import "@example/styles/tokens/blocked";');
  await expect(sources()).rejects.toThrow(/Unresolved/);
});
it("refuses a nested non-CSS import instead of scanning it as JavaScript", async () => {
  await fixture({ ".": "./index.css" });
  await write("node_modules/@example/styles/nested.css", '@import "./dist/lib.js";');
  await expect(sources()).rejects.toThrow(/non-CSS/);
});
it("validates package boundaries even when a stylesheet was already reached as a source root", async () => {
  await fixture({ ".": "./index.css" });
  await write("node_modules/@example/styles/nested.css", '@import "../outside.css";');
  await write("node_modules/@example/outside.css", ".component { padding:4px; }");
  await expect(consumerDogfoodSources(["node_modules/@example/styles/index.css", "Page.tsx"], { version: 1, sources: {}, pages: ["Page.tsx"] }, root, root)).rejects.toThrow(/escapes package/);
});
