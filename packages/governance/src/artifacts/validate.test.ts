import { computeDigest } from "@vespeneventures/policy";
import { describe, expect, it } from "vitest";
import { readGovernedArtifactManifest, validateGovernedArtifactManifest, validateGovernedArtifactOptions } from "./validate.js";
import type { GovernedArtifactManifest } from "./types.js";

const CONTENT = "hello governed artifact";
const DIGEST = computeDigest(CONTENT);

function validManifest(): GovernedArtifactManifest {
  return {
    kind: "widget-catalog",
    schemaVersion: "1",
    checksum: { algorithm: "sha256", digest: DIGEST },
    provenance: { source: "https://example.invalid/repo", revision: "abc123" },
  };
}

describe("validateGovernedArtifactManifest", () => {
  it("accepts a fully valid manifest", () => {
    expect(validateGovernedArtifactManifest(validManifest())).toEqual([]);
  });

  it("accepts a valid manifest with optional recordedAt", () => {
    const manifest = validManifest();
    (manifest.provenance as { recordedAt?: string }).recordedAt = "2026-08-13T00:00:00Z";
    expect(validateGovernedArtifactManifest(manifest)).toEqual([]);
  });

  it("accepts recordedAt with millisecond precision and an explicit offset", () => {
    const manifest = validManifest();
    (manifest.provenance as { recordedAt?: string }).recordedAt = "2026-08-13T00:00:00.123+02:00";
    expect(validateGovernedArtifactManifest(manifest)).toEqual([]);
  });

  it.each([
    [undefined, "artifact/manifest-shape"],
    [null, "artifact/manifest-shape"],
    ["not an object", "artifact/manifest-shape"],
    [42, "artifact/manifest-shape"],
    [[1, 2, 3], "artifact/manifest-shape"],
  ])("rejects a non-object manifest %p", (value, expectedRule) => {
    const findings = validateGovernedArtifactManifest(value);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.rule).toBe(expectedRule);
    expect(findings[0]?.severity).toBe("error");
  });

  it("rejects an unknown top-level field — the manifest contract is closed", () => {
    const manifest = { ...validManifest(), extra: "nope" };
    const findings = validateGovernedArtifactManifest(manifest);
    expect(findings.map((f) => f.rule)).toContain("artifact/manifest-unknown-field");
    expect(findings.find((f) => f.rule === "artifact/manifest-unknown-field")?.path).toBe("$.extra");
  });

  it("rejects a missing kind", () => {
    const manifest = validManifest() as Record<string, unknown>;
    delete manifest.kind;
    expect(validateGovernedArtifactManifest(manifest).map((f) => f.rule)).toEqual(["artifact/kind-shape"]);
  });

  it("rejects a blank kind", () => {
    const manifest = { ...validManifest(), kind: "   " };
    expect(validateGovernedArtifactManifest(manifest).map((f) => f.rule)).toEqual(["artifact/kind-shape"]);
  });

  it("rejects a non-string kind", () => {
    const manifest = { ...validManifest(), kind: 42 };
    expect(validateGovernedArtifactManifest(manifest).map((f) => f.rule)).toEqual(["artifact/kind-shape"]);
  });

  it("rejects a missing schemaVersion", () => {
    const manifest = validManifest() as Record<string, unknown>;
    delete manifest.schemaVersion;
    expect(validateGovernedArtifactManifest(manifest).map((f) => f.rule)).toEqual(["artifact/schema-version-shape"]);
  });

  it("rejects a blank schemaVersion", () => {
    const manifest = { ...validManifest(), schemaVersion: "" };
    expect(validateGovernedArtifactManifest(manifest).map((f) => f.rule)).toEqual(["artifact/schema-version-shape"]);
  });

  it("rejects a missing checksum", () => {
    const manifest = validManifest() as Record<string, unknown>;
    delete manifest.checksum;
    expect(validateGovernedArtifactManifest(manifest).map((f) => f.rule)).toEqual(["artifact/checksum-shape"]);
  });

  it("rejects a non-object checksum", () => {
    const manifest = { ...validManifest(), checksum: "sha256:abc" };
    expect(validateGovernedArtifactManifest(manifest).map((f) => f.rule)).toEqual(["artifact/checksum-shape"]);
  });

  it("rejects an unknown checksum field — the checksum contract is closed", () => {
    const manifest = { ...validManifest(), checksum: { ...validManifest().checksum, extra: true } };
    const findings = validateGovernedArtifactManifest(manifest);
    expect(findings.map((f) => f.rule)).toContain("artifact/checksum-unknown-field");
    expect(findings.find((f) => f.rule === "artifact/checksum-unknown-field")?.path).toBe("checksum.extra");
  });

  it("rejects an unsupported checksum algorithm, delegated to policy's own validateBindingShape", () => {
    const manifest = { ...validManifest(), checksum: { algorithm: "md5", digest: DIGEST } };
    const findings = validateGovernedArtifactManifest(manifest);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.rule).toBe("digest-algorithm-known");
    expect(findings[0]?.path).toBe("checksum.algorithm");
  });

  it("rejects a malformed digest (wrong length), delegated to policy's own validateBindingShape", () => {
    const manifest = { ...validManifest(), checksum: { algorithm: "sha256", digest: "abc123" } };
    const findings = validateGovernedArtifactManifest(manifest);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.rule).toBe("digest-shape");
    expect(findings[0]?.path).toBe("checksum.digest");
  });

  it("rejects a digest containing uppercase hex characters", () => {
    const manifest = { ...validManifest(), checksum: { algorithm: "sha256", digest: DIGEST.toUpperCase() } };
    expect(validateGovernedArtifactManifest(manifest).map((f) => f.rule)).toEqual(["digest-shape"]);
  });

  it("rejects a missing provenance", () => {
    const manifest = validManifest() as Record<string, unknown>;
    delete manifest.provenance;
    expect(validateGovernedArtifactManifest(manifest).map((f) => f.rule)).toEqual(["artifact/provenance-shape"]);
  });

  it("rejects a non-object provenance", () => {
    const manifest = { ...validManifest(), provenance: "nope" };
    expect(validateGovernedArtifactManifest(manifest).map((f) => f.rule)).toEqual(["artifact/provenance-shape"]);
  });

  it("rejects an unknown provenance field — the provenance contract is closed", () => {
    const manifest = { ...validManifest(), provenance: { ...validManifest().provenance, extra: true } };
    const findings = validateGovernedArtifactManifest(manifest);
    expect(findings.map((f) => f.rule)).toContain("artifact/provenance-unknown-field");
    expect(findings.find((f) => f.rule === "artifact/provenance-unknown-field")?.path).toBe("provenance.extra");
  });

  it("rejects a missing provenance.source", () => {
    const manifest = { ...validManifest(), provenance: { revision: "abc123" } };
    expect(validateGovernedArtifactManifest(manifest).map((f) => f.rule)).toEqual(["artifact/provenance-source"]);
  });

  it("rejects a blank provenance.source", () => {
    const manifest = { ...validManifest(), provenance: { source: "  ", revision: "abc123" } };
    expect(validateGovernedArtifactManifest(manifest).map((f) => f.rule)).toEqual(["artifact/provenance-source"]);
  });

  it("rejects a missing provenance.revision", () => {
    const manifest = { ...validManifest(), provenance: { source: "s" } };
    expect(validateGovernedArtifactManifest(manifest).map((f) => f.rule)).toEqual(["artifact/provenance-revision"]);
  });

  it("rejects a blank provenance.revision", () => {
    const manifest = { ...validManifest(), provenance: { source: "s", revision: "   " } };
    expect(validateGovernedArtifactManifest(manifest).map((f) => f.rule)).toEqual(["artifact/provenance-revision"]);
  });

  it("rejects both provenance fields missing at once", () => {
    const manifest = { ...validManifest(), provenance: {} };
    expect(validateGovernedArtifactManifest(manifest).map((f) => f.rule).sort()).toEqual(["artifact/provenance-revision", "artifact/provenance-source"]);
  });

  it.each(["not a timestamp", "2026-08-13", "2026-13-01T00:00:00Z", "2026-08-13T25:00:00Z", "2026-08-13T00:00:00"])(
    "rejects a malformed recordedAt %p",
    (recordedAt) => {
      const manifest = { ...validManifest(), provenance: { ...validManifest().provenance, recordedAt } };
      expect(validateGovernedArtifactManifest(manifest).map((f) => f.rule)).toEqual(["artifact/provenance-recorded-at"]);
    },
  );

  it("reports every independently checkable problem at once, not just the first", () => {
    // digest-shape and digest-algorithm-known are mutually exclusive in
    // policy's own validateBindingShape (digest length is only checkable
    // once the algorithm itself is known), so this uses a recognized
    // algorithm with a malformed digest to exercise digest-shape alongside
    // every other independently checkable problem.
    const manifest = { kind: "", schemaVersion: "", checksum: { algorithm: "sha256", digest: "x" }, provenance: {} };
    const findings = validateGovernedArtifactManifest(manifest);
    const rules = findings.map((f) => f.rule).sort();
    expect(rules).toEqual([
      "artifact/kind-shape",
      "artifact/provenance-revision",
      "artifact/provenance-source",
      "artifact/schema-version-shape",
      "digest-shape",
    ]);
  });

  it("never includes manifest content, digest values, source, or revision in any finding message", () => {
    const secretSource = "https://internal.example.invalid/confidential-source-label";
    const secretRevision = "super-secret-revision-token";
    const manifest = { ...validManifest(), checksum: { algorithm: "md5", digest: "bad" }, provenance: { source: secretSource, revision: secretRevision } };
    const findings = validateGovernedArtifactManifest(manifest);
    for (const f of findings) {
      expect(f.message).not.toContain(secretSource);
      expect(f.message).not.toContain(secretRevision);
      expect(f.message).not.toContain(DIGEST);
    }
  });

  describe("accessor / proxy safety", () => {
    it("rejects a manifest whose kind is a getter rather than a data property", () => {
      const manifest: Record<string, unknown> = { ...validManifest() };
      Object.defineProperty(manifest, "kind", { get: () => "widget-catalog", enumerable: true, configurable: true });
      expect(validateGovernedArtifactManifest(manifest).map((f) => f.rule)).toEqual(["artifact/field-accessor"]);
    });

    it("rejects a manifest whose checksum.digest is a getter", () => {
      const checksum: Record<string, unknown> = { algorithm: "sha256" };
      Object.defineProperty(checksum, "digest", { get: () => DIGEST, enumerable: true, configurable: true });
      const manifest = { ...validManifest(), checksum };
      const findings = validateGovernedArtifactManifest(manifest);
      expect(findings.map((f) => f.rule)).toEqual(["artifact/field-accessor"]);
      expect(findings[0]?.path).toBe("checksum.digest");
    });

    it("rejects a manifest whose provenance.source is a getter", () => {
      const provenance: Record<string, unknown> = { revision: "abc123" };
      Object.defineProperty(provenance, "source", { get: () => "s", enumerable: true, configurable: true });
      const manifest = { ...validManifest(), provenance };
      const findings = validateGovernedArtifactManifest(manifest);
      expect(findings.map((f) => f.rule)).toEqual(["artifact/field-accessor"]);
    });

    it("does not throw and reports a finding for a Proxy manifest that throws on property access", () => {
      const hostile = new Proxy(
        {},
        {
          get() {
            throw new Error("hostile getter");
          },
          ownKeys() {
            throw new Error("hostile ownKeys");
          },
        },
      );
      const findings = validateGovernedArtifactManifest(hostile);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.rule).toBe("artifact/manifest-shape");
    });

    it("does not read the same digest field twice with different results (TOCTOU safety)", () => {
      // A data property read via getOwnPropertyDescriptor cannot itself
      // "change value on the second read" the way a getter could, so this
      // asserts the actual guarantee the snapshot exists to provide: the
      // returned snapshot's checksum matches what was validated, not
      // whatever `manifest.checksum` might evaluate to on a later read.
      const manifest = validManifest();
      const read = readGovernedArtifactManifest(manifest);
      expect(read.manifest?.checksum.digest).toBe(DIGEST);
      // Mutating the original object after the fact must not affect the
      // already-produced snapshot.
      (manifest as { checksum: { digest: string } }).checksum.digest = "0".repeat(64);
      expect(read.manifest?.checksum.digest).toBe(DIGEST);
    });
  });
});

describe("validateGovernedArtifactOptions", () => {
  const validOptions = { artifactKind: "widget-catalog", supportedSchemaVersions: ["1", "2"] };

  it("accepts fully valid options", () => {
    expect(validateGovernedArtifactOptions(validOptions)).toEqual([]);
  });

  it.each([[undefined], [null], ["nope"], [42], [[]]])("rejects non-object options %p", (value) => {
    expect(validateGovernedArtifactOptions(value).map((f) => f.rule)).toEqual(["artifact/options-shape"]);
  });

  it("rejects an unknown option field — the options contract is closed", () => {
    const findings = validateGovernedArtifactOptions({ ...validOptions, extra: true });
    expect(findings.map((f) => f.rule)).toContain("artifact/options-unknown-field");
  });

  it("rejects a missing artifactKind", () => {
    expect(validateGovernedArtifactOptions({ supportedSchemaVersions: ["1"] }).map((f) => f.rule)).toEqual(["artifact/options-kind-blank"]);
  });

  it("rejects a blank artifactKind", () => {
    expect(validateGovernedArtifactOptions({ ...validOptions, artifactKind: "  " }).map((f) => f.rule)).toEqual(["artifact/options-kind-blank"]);
  });

  it("rejects a non-array supportedSchemaVersions", () => {
    expect(validateGovernedArtifactOptions({ ...validOptions, supportedSchemaVersions: "1" }).map((f) => f.rule)).toEqual([
      "artifact/options-supported-versions-shape",
    ]);
  });

  it("rejects an EMPTY supportedSchemaVersions as a configuration error, never an assumed pass", () => {
    const findings = validateGovernedArtifactOptions({ ...validOptions, supportedSchemaVersions: [] });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.rule).toBe("artifact/options-supported-versions-empty");
    expect(findings[0]?.severity).toBe("error");
  });

  it("rejects a blank entry within supportedSchemaVersions", () => {
    const findings = validateGovernedArtifactOptions({ ...validOptions, supportedSchemaVersions: ["1", "  ", "2"] });
    expect(findings.map((f) => f.rule)).toEqual(["artifact/options-supported-version-blank"]);
    expect(findings[0]?.path).toBe("supportedSchemaVersions[1]");
  });

  it("rejects a non-string entry within supportedSchemaVersions", () => {
    const findings = validateGovernedArtifactOptions({ ...validOptions, supportedSchemaVersions: ["1", 2] });
    expect(findings.map((f) => f.rule)).toEqual(["artifact/options-supported-version-blank"]);
  });

  it("rejects an options object whose artifactKind is a getter", () => {
    const options: Record<string, unknown> = { supportedSchemaVersions: ["1"] };
    Object.defineProperty(options, "artifactKind", { get: () => "kind", enumerable: true, configurable: true });
    expect(validateGovernedArtifactOptions(options).map((f) => f.rule)).toEqual(["artifact/field-accessor"]);
  });
});
