import type { LocalFontPayload, LocalFontSource } from "./types.js";

function fail(message: string): never { throw new TypeError(`local font: ${message}`); }
function closed(v: unknown, keys: readonly string[]): Record<string, unknown> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) fail("object required");
  if (Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) fail("unexpected or missing fields");
  return Object.fromEntries(Object.entries(v));
}
function text(v: unknown): string {
  if (typeof v !== "string" || !v.trim() || /[\u0000-\u001f]/.test(v)) fail("nonempty text required");
  return v;
}
function reference(v: unknown): string {
  const ref = text(v);
  if (ref.startsWith("/") || /^(?:file:|[a-zA-Z]:[\\/])/.test(ref)) fail("evidence reference must not be a host path");
  return ref;
}
function strings(v: unknown): string[] {
  if (!Array.isArray(v) || !v.length) fail("nonempty string list required");
  const rows = v.map(text);
  if (new Set(rows).size !== rows.length) fail("duplicate list identity");
  return rows;
}
function path(v: unknown): string {
  const value = text(v);
  if (value.startsWith("/") || /[\\:]/.test(value) || value.split("/").some(p => !p || p === "." || p === "..")) fail("unsafe relative file path");
  return value;
}
function digest(v: unknown): string {
  if (typeof v !== "string" || !/^[a-f0-9]{64}$/.test(v)) fail("raw sha256 required");
  return v;
}
function source(input: unknown, hash: string): LocalFontSource {
  const v = closed(input, ["ref", "version", "sha256"]);
  if (v.sha256 !== hash) fail("source byte digest differs");
  return { ref: reference(v.ref), version: text(v.version), sha256: hash };
}
function bytes(v: Record<string, unknown>) {
  const sha256 = digest(v.sha256), count = v.bytes;
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 1) fail("positive byte length required");
  return { path: path(v.path), sha256, bytes: count, source: source(v.source, sha256) };
}
function weight(v: unknown): string {
  const value = text(v), weights = value.split(" ");
  if (weights.length > 2 || weights.some(w => !/^[1-9][0-9]{0,3}$/.test(w) || Number(w) > 1000) || (weights.length === 2 && Number(weights[0]) >= Number(weights[1]))) fail("invalid canonical weight or range");
  return value;
}
/** Parse closed local-font evidence; coverage semantics and provider admission belong to the caller. */
export function parseLocalFontPayload(input: unknown): LocalFontPayload {
  const v = closed(input, ["kind", "family", "fallback", "licenses", "files"]);
  if (v.kind !== "local") fail("local font required");
  if (!Array.isArray(v.licenses) || !v.licenses.length || !Array.isArray(v.files) || !v.files.length) fail("font files and licenses required");
  const ids = new Set<string>(), paths = new Set<string>(), faces = new Set<string>();
  function uniquePath(p: string): void { if (paths.has(p)) fail("duplicate asset path"); paths.add(p); }
  const licenses = v.licenses.map(input => {
    const row = closed(input, ["id", "spdx", "path", "sha256", "bytes", "source"]);
    const license = { id: text(row.id), spdx: text(row.spdx), ...bytes(row) };
    if (ids.has(license.id)) fail("duplicate license identity");
    ids.add(license.id); uniquePath(license.path);
    return license;
  });
  const files = v.files.map((input): LocalFontPayload["files"][number] => {
    const row = closed(input, ["path", "sha256", "bytes", "weight", "style", "subsets", "languages", "license", "source", "coverage"]);
    const descriptor = bytes(row); uniquePath(descriptor.path);
    if (!/\.(ttf|otf|woff|woff2)$/.test(descriptor.path)) fail("unsupported font extension");
    if (row.style !== "normal" && row.style !== "italic") fail("invalid font style");
    const license = text(row.license);
    if (!ids.has(license)) fail("unresolved font license");
    const coverage = closed(row.coverage, ["ref", "sha256"]);
    const file: LocalFontPayload["files"][number] = { ...descriptor, weight: weight(row.weight), style: row.style, subsets: strings(row.subsets), languages: strings(row.languages), license, coverage: { ref: reference(coverage.ref), sha256: digest(coverage.sha256) } };
    const identity = JSON.stringify([file.weight, file.style, [...file.subsets].sort()]);
    if (faces.has(identity)) fail("duplicate font face identity"); faces.add(identity);
    return file;
  });
  return { kind: "local", family: text(v.family), fallback: strings(v.fallback), licenses, files };
}
