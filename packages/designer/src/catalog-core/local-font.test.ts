import { describe, expect, it } from "vitest";
import { parseLocalFontPayload } from "./local-font.js";

// Schema-only synthetic descriptors: no font bytes, admission, coverage qualification or owner choice.
function synthetic() {
  const sha256 = "a".repeat(64), source = { ref: "synthetic:fixture", version: "1", sha256 };
  return { kind: "local", family: "Synthetic Face", fallback: ["sans-serif"],
    licenses: [{ id: "synthetic-license", spdx: "LicenseRef-Synthetic", path: "licenses/synthetic.txt", sha256, bytes: 1, source }],
    files: [{ path: "fonts/synthetic.woff2", sha256, bytes: 1, weight: "100 900", style: "normal", subsets: ["synthetic"], languages: ["und"], license: "synthetic-license", source, coverage: { ref: "synthetic:coverage", sha256 } }] };
}
describe("closed local font contract", () => {
  it("snapshots explicit multiface evidence without changing system or Fontsource payloads", () => {
    const input = synthetic(); input.files.push({ ...input.files[0]!, path: "fonts/italic.woff2", style: "italic" });
    const parsed = parseLocalFontPayload(input); input.fallback[0] = "changed";
    expect(parsed.files).toHaveLength(2); expect(parsed.fallback).toEqual(["sans-serif"]);
    expect(() => parseLocalFontPayload({ kind: "system" })).toThrow();
    expect(() => parseLocalFontPayload({ kind: "fontsource", package: "synthetic" })).toThrow();
  });
  it.each(["/absolute.ttf", "../escape.ttf", "a/../escape.ttf", "a\\bad.ttf", "https://example.invalid/a.ttf", "a//b.ttf", "a/./b.ttf", "a.ttf\0", "a.svg"])("rejects unsafe/unsupported asset %s", path => {
    const input = synthetic(); input.files[0]!.path = path;
    expect(() => parseLocalFontPayload(input)).toThrow();
  });
  it.each(["0", "1001", "0400", "400 400", "900 100", "100 900 1000", "400  700", "normal"])("rejects weight %s", weight => {
    const input = synthetic(); input.files[0]!.weight = weight;
    expect(() => parseLocalFontPayload(input)).toThrow(/weight/);
  });
  const mutations: [string, (v: ReturnType<typeof synthetic>) => void][] = [
    ["fallback", v => { v.fallback = []; }], ["family", v => { v.family = " "; }],
    ["files", v => { v.files = []; }], ["licenses", v => { v.licenses = []; }],
    ["language", v => { v.files[0]!.languages = []; }], ["subset", v => { v.files[0]!.subsets = []; }],
    ["license reference", v => { v.files[0]!.license = "missing"; }],
    ["source hash", v => { v.files[0]!.source = { ...v.files[0]!.source, sha256: "b".repeat(64) }; }],
    ["coverage digest", v => { v.files[0]!.coverage.sha256 = "unpinned"; }],
    ["coverage host path", v => { v.files[0]!.coverage.ref = "/local/evidence"; }],
    ["byte length", v => { v.files[0]!.bytes = 0; }],
    ["duplicate file", v => { v.files.push({ ...v.files[0]! }); }],
    ["duplicate face", v => { v.files.push({ ...v.files[0]!, path: "fonts/other.woff2" }); }],
    ["duplicate license", v => { v.licenses.push({ ...v.licenses[0]!, path: "licenses/other.txt" }); }],
  ];
  it.each(mutations)("rejects missing/conflicting %s", (_name, mutate) => {
    const input = synthetic(); mutate(input); expect(() => parseLocalFontPayload(input)).toThrow();
  });
  it("rejects unknown fields, style and provider metadata", () => {
    expect(() => parseLocalFontPayload({ ...synthetic(), provider: "google" })).toThrow();
    const input = synthetic(); input.files[0]!.style = "oblique";
    expect(() => parseLocalFontPayload(input)).toThrow(/style/);
  });
});
