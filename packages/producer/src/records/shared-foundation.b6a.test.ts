import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { treeHash } from "./hash.js";
import { validateReferencesManifest } from "./validate.js";
import type { ElementRecord, PinEvent, ReferenceItem, ReferencesManifest } from "./types.js";

const files = [
  { path: "z.ts", sha256: "b".repeat(64), bytes: 1, origin: "registry" },
  { path: "a.ts", sha256: "a".repeat(64), bytes: 1, origin: "registry" },
];
const canonical = `${"a".repeat(64)}  a.ts\n${"b".repeat(64)}  z.ts\n`;
const digest = `sha256:${createHash("sha256").update(canonical).digest("hex")}` as const;
const item: ReferenceItem = {
  registry: "stock", name: "example", version: "1.0.0", dir: "stock/example@1.0.0",
  type: "registry:ui", sourceUrl: "https://example.com/registry", license: "MIT", direct: true,
  slots: [], hash: digest, files,
};
const manifest: ReferencesManifest = {
  schema: "clossys.references-manifest/1", package: "designer", fetchedAt: "2026-11-01T00:00:00Z",
  hashAlgorithm: "sha256-tree/1",
  registries: { stock: { namespace: "stock", source: "https://example.com/registry", version: "1.0.0", license: "MIT", licenseFiles: ["LICENSE"] } },
  licenses: [], items: [item], skipped: [],
};

it("preserves the shared lineage, approval and upstream provenance type contracts", () => {
  const lineage: ElementRecord["lineage"] = {
    mode: "customized", path: "adopt", ownerRequest: "owner-request",
    adaptations: [{ kind: "data-fit", file: "a.ts", reason: "Fit the finite input.", hash: digest }],
    source: { registry: "stock", item: "example", version: "1.0.0", hash: digest },
  };
  const approval: PinEvent = {
    id: "pin-example", at: "2026-11-01T00:00:00Z", by: "owner", action: "pin", slot: "frames.example",
    element: "example", version: 1, hash: digest, approval: "approval-example",
  };
  const sanitized: ReferenceItem = {
    ...item, adaptations: [{ kind: "identity", reason: "Use a generic example.", approvedBy: "owner", approvedAt: "2026-11-01T00:00:00Z", upstream: { hash: digest, files } }],
  };
  expect(lineage.adaptations?.[0].hash).toBe(digest);
  expect(approval.approval).toBe("approval-example");
  expect(treeHash(sanitized.adaptations![0].upstream.files)).toBe(sanitized.adaptations![0].upstream.hash);
});

it("uses sorted sha256-tree/1 entries with two spaces and a trailing newline", () => {
  expect(treeHash(files)).toBe(digest);
  expect(treeHash([...files].reverse())).toBe(digest);
  expect(treeHash(files)).not.toBe(`sha256:${files[0].sha256}`);
  expect(treeHash(files.map(file => ({ ...file, path: `renamed/${file.path}` })))).not.toBe(digest);
});

it("retains native manifest schema and semantic hash validation", () => {
  expect(validateReferencesManifest(manifest)).toMatchObject({ ok: true });
  const result = validateReferencesManifest({ ...manifest, items: [{ ...item, hash: `sha256:${"0".repeat(64)}` }] });
  expect(result).toMatchObject({ ok: false, issues: [{ path: "$.items[0].hash", message: "does not match its files" }] });
  expect(validateReferencesManifest({ ...manifest, unexpected: true }).ok).toBe(false);
  expect(validateReferencesManifest({ ...manifest, items: [{ ...item, dir: "stock/other@1.0.0" }] }).ok).toBe(false);
});
