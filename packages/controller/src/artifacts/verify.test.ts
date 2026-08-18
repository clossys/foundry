import { computeDigest } from "../policy/index.js";
import { describe, expect, it } from "vitest";
import { verifyGovernedArtifact, verifyGovernedArtifacts } from "./verify.js";
import type { GovernedArtifactManifest, GovernedArtifactVerificationOptions } from "./types.js";

const CONTENT = "the exact bytes this artifact was checksummed over";
const DIGEST = computeDigest(CONTENT);

function validManifest(): GovernedArtifactManifest {
  return {
    kind: "widget-catalog",
    schemaVersion: "2",
    checksum: { algorithm: "sha256", digest: DIGEST },
    provenance: { source: "https://example.invalid/repo", revision: "abc123" },
  };
}

function validOptions(): GovernedArtifactVerificationOptions {
  return { artifactKind: "widget-catalog", supportedSchemaVersions: ["1", "2"] };
}

describe("verifyGovernedArtifact — happy path", () => {
  it("returns [] for a fully valid artifact", () => {
    expect(verifyGovernedArtifact(validManifest(), CONTENT, validOptions())).toEqual([]);
  });

  it("accepts a Uint8Array content input hashed byte-for-byte", () => {
    const bytes = new TextEncoder().encode(CONTENT);
    expect(verifyGovernedArtifact(validManifest(), bytes, validOptions())).toEqual([]);
  });

  it("treats equivalent bytes under string and Uint8Array forms as matching (same digest either way)", () => {
    const manifest = validManifest();
    const asString = verifyGovernedArtifact(manifest, CONTENT, validOptions());
    const asBytes = verifyGovernedArtifact(manifest, new TextEncoder().encode(CONTENT), validOptions());
    expect(asString).toEqual([]);
    expect(asBytes).toEqual([]);
  });
});

describe("verifyGovernedArtifact — fail-closed per stage", () => {
  it("stage 1: rejects an invalid options object before touching the manifest at all", () => {
    // supportedSchemaVersions empty is an options problem; the manifest
    // itself is otherwise perfectly valid, proving the options check runs
    // (and short-circuits) independently of manifest content.
    const findings = verifyGovernedArtifact(validManifest(), CONTENT, { artifactKind: "widget-catalog", supportedSchemaVersions: [] });
    expect(findings).toEqual([
      {
        rule: "artifact/options-supported-versions-empty",
        severity: "error",
        path: "supportedSchemaVersions",
        message: expect.any(String),
      },
    ]);
  });

  it("stage 1: an empty supportedSchemaVersions is never treated as an assumed pass, even for byte-identical content", () => {
    const findings = verifyGovernedArtifact(validManifest(), CONTENT, { artifactKind: "widget-catalog", supportedSchemaVersions: [] });
    expect(findings.length).toBeGreaterThan(0);
  });

  it("stage 2: rejects a structurally malformed manifest before checking kind, schema version, or checksum", () => {
    const findings = verifyGovernedArtifact({ kind: "widget-catalog" }, CONTENT, validOptions());
    const rules = findings.map((f) => f.rule);
    expect(rules).toContain("artifact/schema-version-shape");
    expect(rules).not.toContain("artifact/kind-mismatch");
    expect(rules).not.toContain("artifact/schema-version-unsupported");
    expect(rules).not.toContain("digest-mismatch");
  });

  it("stage 3: rejects a wrong artifact kind even when schema version and checksum both would have passed", () => {
    const manifest = { ...validManifest(), kind: "other-kind" };
    const findings = verifyGovernedArtifact(manifest, CONTENT, validOptions());
    expect(findings).toEqual([
      { rule: "artifact/kind-mismatch", severity: "error", path: "kind", message: expect.any(String) },
    ]);
  });

  it("stage 3 precedence: kind is rejected BEFORE schema version is even inspected", () => {
    // Both kind AND schemaVersion are wrong here. Only the kind-mismatch
    // finding must appear — proof the ordering actually short-circuits
    // rather than merely happening to produce the same result.
    const manifest = { ...validManifest(), kind: "other-kind", schemaVersion: "999-unsupported" };
    const findings = verifyGovernedArtifact(manifest, CONTENT, validOptions());
    expect(findings).toEqual([
      { rule: "artifact/kind-mismatch", severity: "error", path: "kind", message: expect.any(String) },
    ]);
  });

  it("stage 3 precedence: kind is rejected BEFORE the checksum is ever computed", () => {
    // Wrong kind AND wrong content. If checksum ran first this would surface
    // digest-mismatch; it must not.
    const manifest = { ...validManifest(), kind: "other-kind" };
    const findings = verifyGovernedArtifact(manifest, "completely different bytes", validOptions());
    expect(findings).toEqual([
      { rule: "artifact/kind-mismatch", severity: "error", path: "kind", message: expect.any(String) },
    ]);
  });

  it("stage 4: rejects an unsupported schema version even when the checksum matches exactly (#195's core complaint)", () => {
    const manifest = { ...validManifest(), schemaVersion: "999-unsupported" };
    const findings = verifyGovernedArtifact(manifest, CONTENT, validOptions());
    expect(findings).toEqual([
      { rule: "artifact/schema-version-unsupported", severity: "error", path: "schemaVersion", message: expect.any(String) },
    ]);
  });

  it("stage 4 precedence: schema version is rejected BEFORE the checksum is ever computed", () => {
    const manifest = { ...validManifest(), schemaVersion: "999-unsupported" };
    const findings = verifyGovernedArtifact(manifest, "completely different bytes — checksum would also fail", validOptions());
    // If checksum ran first or in addition, a digest-mismatch finding would
    // appear alongside schema-version-unsupported. It must not.
    expect(findings).toEqual([
      { rule: "artifact/schema-version-unsupported", severity: "error", path: "schemaVersion", message: expect.any(String) },
    ]);
  });

  it("stage 5: detects a one-byte content change through policy's own digest-mismatch finding", () => {
    const findings = verifyGovernedArtifact(validManifest(), `${CONTENT}!`, validOptions());
    expect(findings).toHaveLength(1);
    expect(findings[0]?.rule).toBe("digest-mismatch");
    expect(findings[0]?.severity).toBe("error");
  });

  it("stage 5 only runs once kind and schema version both already passed", () => {
    // A correctly-kinded, correctly-versioned manifest with wrong content
    // must produce ONLY digest-mismatch — proof checksum verification is
    // reached and is the sole remaining check once stages 1-4 are clean.
    const findings = verifyGovernedArtifact(validManifest(), "wrong bytes entirely", validOptions());
    expect(findings.map((f) => f.rule)).toEqual(["digest-mismatch"]);
  });

  it("two differently serialized JSON values that parse to the same object do not compare equal — no implicit canonicalization", () => {
    const payload = { a: 1, b: 2 };
    const compact = JSON.stringify(payload);
    const spaced = JSON.stringify(payload, null, 2);
    expect(compact).not.toBe(spaced);

    const manifest: GovernedArtifactManifest = {
      ...validManifest(),
      checksum: { algorithm: "sha256", digest: computeDigest(compact) },
    };
    expect(verifyGovernedArtifact(manifest, compact, validOptions())).toEqual([]);
    // The spaced serialization is semantically identical JSON but different
    // BYTES; this contract must not silently reparse/re-canonicalize and
    // treat them as the same artifact.
    expect(verifyGovernedArtifact(manifest, spaced, validOptions()).map((f) => f.rule)).toEqual(["digest-mismatch"]);
  });
});

describe("verifyGovernedArtifact — never claims more than it proves", () => {
  it("a clean result says nothing about provenance authenticity — any source/revision string passes as long as it is well-shaped", () => {
    const manifest = { ...validManifest(), provenance: { source: "completely-unverifiable-source", revision: "unverifiable-revision" } };
    expect(verifyGovernedArtifact(manifest, CONTENT, validOptions())).toEqual([]);
  });

  it("never includes artifact bytes, digest values, source, or revision in any finding message", () => {
    const secretSource = "https://internal.example.invalid/confidential-source-label";
    const secretRevision = "confidential-revision-marker";
    const manifest = { ...validManifest(), provenance: { source: secretSource, revision: secretRevision } };
    const badContent = "not the right bytes at all, and definitely secret-looking-content-xyz";
    const findings = verifyGovernedArtifact(manifest, badContent, validOptions());
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.message).not.toContain(secretSource);
      expect(f.message).not.toContain(secretRevision);
      expect(f.message).not.toContain(DIGEST);
      expect(f.message).not.toContain(badContent);
    }
  });
});

describe("verifyGovernedArtifacts — batch", () => {
  it("fails closed on an EMPTY artifact set — never reports clean", () => {
    const findings = verifyGovernedArtifacts([], validOptions());
    expect(findings).toEqual([
      { rule: "artifact/empty-batch", severity: "error", path: "$", message: expect.any(String) },
    ]);
  });

  it("verifies every entry and prefixes findings with that entry's id", () => {
    const findings = verifyGovernedArtifacts(
      [
        { id: "good", manifest: validManifest(), content: CONTENT },
        { id: "bad-kind", manifest: { ...validManifest(), kind: "other" }, content: CONTENT },
      ],
      validOptions(),
    );
    expect(findings).toEqual([{ rule: "artifact/kind-mismatch", severity: "error", path: "bad-kind:kind", message: expect.any(String) }]);
  });

  it("returns [] only when every entry verifies cleanly", () => {
    const findings = verifyGovernedArtifacts(
      [
        { id: "one", manifest: validManifest(), content: CONTENT },
        { id: "two", manifest: validManifest(), content: CONTENT },
      ],
      validOptions(),
    );
    expect(findings).toEqual([]);
  });

  it("reports a duplicate batch entry id as its own finding", () => {
    const findings = verifyGovernedArtifacts(
      [
        { id: "dup", manifest: validManifest(), content: CONTENT },
        { id: "dup", manifest: validManifest(), content: CONTENT },
      ],
      validOptions(),
    );
    expect(findings).toEqual([{ rule: "artifact/duplicate-batch-id", severity: "error", path: "dup", message: expect.any(String) }]);
  });

  it("a manifest whose kind matches nothing supported does not report clean, even inside a non-empty batch", () => {
    const findings = verifyGovernedArtifacts([{ id: "unsupported", manifest: { ...validManifest(), kind: "never-heard-of-it" }, content: CONTENT }], validOptions());
    expect(findings.map((f) => f.rule)).toEqual(["artifact/kind-mismatch"]);
  });
});
