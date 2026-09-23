import { describe, expect, it } from "vitest";
import { checkInstalledPackagesProvenance } from "./provenance-check.js";
import type { Transport } from "./reachability.js";

const NAME = "@clossys/advisor";
const VERSION = "0.1.4";
const LATEST = "0.1.4";
const SOURCE_SHA = "a".repeat(40);
const DIGEST_HEX = "b".repeat(128);
const INTEGRITY = `sha512-${Buffer.from(DIGEST_HEX, "hex").toString("base64")}`;

function statement(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _type: "https://in-toto.io/Statement/v1",
    subject: [{ name: `pkg:npm/%40clossys/advisor@${VERSION}`, digest: { sha512: DIGEST_HEX } }],
    predicateType: "https://slsa.dev/provenance/v1",
    predicate: {
      buildDefinition: {
        buildType: "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
        externalParameters: {
          workflow: { ref: "refs/heads/main", repository: "https://github.com/clossys/foundry", path: ".github/workflows/publish.yml" },
        },
        internalParameters: { github: { event_name: "workflow_dispatch" } },
        resolvedDependencies: [{ uri: "git+https://github.com/clossys/foundry@refs/heads/main", digest: { gitCommit: SOURCE_SHA } }],
      },
      runDetails: {
        builder: { id: "https://github.com/actions/runner/github-hosted" },
        metadata: { invocationId: "https://github.com/clossys/foundry/actions/runs/123/attempts/1" },
      },
    },
    ...overrides,
  };
}

function packument(version = VERSION, latest = LATEST, integrity = INTEGRITY): Record<string, unknown> {
  return { name: NAME, "dist-tags": { latest }, versions: { [version]: { name: NAME, version, dist: { integrity } } } };
}

function attestationsBody(stmt: unknown = statement()): Record<string, unknown> {
  return {
    attestations: [
      { predicateType: "https://slsa.dev/provenance/v1", bundle: { dsseEnvelope: { payload: Buffer.from(JSON.stringify(stmt)).toString("base64") } } },
    ],
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

/** Routes a packument request to `packumentBody` and an attestations request to `attestationsBodyValue`, by path shape. */
function routedTransport(packumentBody: unknown, attestationsBodyValue: unknown, packumentStatus = 200, attestationsStatus = 200): Transport {
  return async (input) => {
    const url = String(input);
    if (url.includes("/-/npm/v1/attestations/")) return jsonResponse(attestationsStatus, attestationsBodyValue);
    return jsonResponse(packumentStatus, packumentBody);
  };
}

describe("checkInstalledPackagesProvenance", () => {
  it("verifies a correctly provenance-bound, current installed package", async () => {
    const transport = routedTransport(packument(), attestationsBody());
    const result = await checkInstalledPackagesProvenance({
      packages: [{ name: NAME, installedVersion: VERSION }],
      transport,
      registryBaseUrl: "https://registry.example",
    });
    expect(result.state).toBe("verified");
    expect(result.packages).toEqual([
      { name: NAME, installedVersion: VERSION, latestVersion: LATEST, currencyDistance: "current", state: "verified", reasons: [] },
    ]);
  });

  it("requests the attestations endpoint at the exact scoped path", async () => {
    const requested: string[] = [];
    const transport: Transport = async (input) => {
      requested.push(String(input));
      if (String(input).includes("/-/npm/v1/attestations/")) return jsonResponse(200, attestationsBody());
      return jsonResponse(200, packument());
    };
    await checkInstalledPackagesProvenance({ packages: [{ name: NAME, installedVersion: VERSION }], transport, registryBaseUrl: "https://registry.example" });
    expect(requested).toContain(`https://registry.example/-/npm/v1/attestations/@clossys%2Fadvisor@${VERSION}`);
  });

  it("is violated on a missing attestation (empty attestations array)", async () => {
    const transport = routedTransport(packument(), { attestations: [] });
    const result = await checkInstalledPackagesProvenance({ packages: [{ name: NAME, installedVersion: VERSION }], transport });
    expect(result.state).toBe("violated");
    expect(result.packages[0]!.state).toBe("violated");
  });

  it("is violated on a tarball digest mismatch", async () => {
    const wrongDigest = `sha512-${Buffer.from("c".repeat(128), "hex").toString("base64")}`;
    const transport = routedTransport(packument(VERSION, LATEST, wrongDigest), attestationsBody());
    const result = await checkInstalledPackagesProvenance({ packages: [{ name: NAME, installedVersion: VERSION }], transport });
    expect(result.state).toBe("violated");
  });

  it("is violated when the statement names a foreign repository or workflow", async () => {
    const stmt = statement();
    const buildDefinition = (stmt.predicate as Record<string, unknown>).buildDefinition as Record<string, unknown>;
    const externalParameters = buildDefinition.externalParameters as Record<string, unknown>;
    externalParameters.workflow = { ref: "refs/heads/main", repository: "https://github.com/other/platform", path: ".github/workflows/publish.yml" };
    const transport = routedTransport(packument(), attestationsBody(stmt));
    const result = await checkInstalledPackagesProvenance({ packages: [{ name: NAME, installedVersion: VERSION }], transport });
    expect(result.state).toBe("violated");
    expect(result.packages[0]!.reasons.join(" ")).toMatch(/publish workflow/);
  });

  it("is indeterminate, not a pass, when the registry is unreachable", async () => {
    const throws: Transport = async () => {
      throw new Error("network down");
    };
    const result = await checkInstalledPackagesProvenance({ packages: [{ name: NAME, installedVersion: VERSION }], transport: throws });
    expect(result.state).toBe("indeterminate");
    expect(result.packages[0]!.state).toBe("indeterminate");
  });

  it("is indeterminate on a registry error status (e.g. 500) for either endpoint", async () => {
    const transport = routedTransport(packument(), attestationsBody(), 200, 502);
    const result = await checkInstalledPackagesProvenance({ packages: [{ name: NAME, installedVersion: VERSION }], transport });
    expect(result.state).toBe("indeterminate");
  });

  it("is indeterminate -- never a vacuous pass -- for zero installed @clossys packages", async () => {
    const transport: Transport = async () => jsonResponse(200, {});
    const result = await checkInstalledPackagesProvenance({ packages: [], transport });
    expect(result).toEqual({ state: "indeterminate", registryBaseUrl: "https://registry.npmjs.org", packages: [] });
  });

  it("is violated on a stale pin against a declared currency policy, even with verified provenance", async () => {
    const transport = routedTransport(packument("0.2.0", "0.2.0", INTEGRITY), attestationsBody(statement({ subject: [{ name: `pkg:npm/%40clossys/advisor@0.2.0`, digest: { sha512: DIGEST_HEX } }] })));
    const result = await checkInstalledPackagesProvenance({
      packages: [{ name: NAME, installedVersion: "0.2.0" }],
      transport,
      currencyPolicy: { pins: { [NAME]: "0.1.9" } },
    });
    expect(result.state).toBe("violated");
    expect(result.packages[0]!.reasons.join(" ")).toMatch(/declared currency policy pins/);
  });

  it("does not block on currency drift when no policy pin is declared for the package -- only reports it", async () => {
    const transport = routedTransport(packument(VERSION, "9.0.0", INTEGRITY), attestationsBody());
    const result = await checkInstalledPackagesProvenance({ packages: [{ name: NAME, installedVersion: VERSION }], transport });
    expect(result.state).toBe("verified");
    expect(result.packages[0]!.latestVersion).toBe("9.0.0");
    expect(result.packages[0]!.currencyDistance).toBe("major");
  });

  it("indeterminate wins over violated across a mixed batch, and every package's own report still comes back", async () => {
    const violatedTransport: Transport = async (input) => {
      if (String(input).includes("/-/npm/v1/attestations/")) return jsonResponse(200, { attestations: [] });
      return jsonResponse(200, packument());
    };
    const unreachableTransport: Transport = async () => {
      throw new Error("boom");
    };
    const transport: Transport = async (input, init) => {
      const url = String(input);
      if (url.includes("other")) return unreachableTransport(input, init);
      return violatedTransport(input, init);
    };
    const result = await checkInstalledPackagesProvenance({
      packages: [
        { name: NAME, installedVersion: VERSION },
        { name: "@example-scope/other", installedVersion: "1.0.0" },
      ],
      transport,
    });
    expect(result.state).toBe("indeterminate");
    expect(result.packages.find((p) => p.name === NAME)?.state).toBe("violated");
    expect(result.packages.find((p) => p.name === "@example-scope/other")?.state).toBe("indeterminate");
  });

  it("checks every package independently, concurrently, so one failure never skips another", async () => {
    const transport: Transport = async (input) => {
      if (String(input).includes("bad")) throw new Error("boom");
      if (String(input).includes("/-/npm/v1/attestations/")) return jsonResponse(200, attestationsBody());
      return jsonResponse(200, packument());
    };
    const result = await checkInstalledPackagesProvenance({
      packages: [
        { name: NAME, installedVersion: VERSION },
        { name: "@example-scope/bad", installedVersion: "1.0.0" },
      ],
      transport,
    });
    expect(result.packages.find((p) => p.name === NAME)?.state).toBe("verified");
    expect(result.packages.find((p) => p.name === "@example-scope/bad")?.state).toBe("indeterminate");
  });
});
