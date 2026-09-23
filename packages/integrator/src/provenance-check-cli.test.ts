import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProvenanceCliInputError, main } from "./provenance-check-cli.js";
import type { Transport } from "./reachability.js";

// Hermetic: every test operates on its own `mkdtemp` directory, removed
// afterward, and calls the exported `main(argv, transport)` directly rather
// than spawning the real CLI process or the real network -- the same
// discipline `cli.test.ts` and `package-currency-rate-cli.test.ts` use.

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "integrator-provenance-cli-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function write(name: string, value: unknown): void {
  writeFileSync(join(dir, name), typeof value === "string" ? value : JSON.stringify(value));
}

function npmLockfile(packages: Record<string, { version?: string }>): unknown {
  return { lockfileVersion: 3, packages: { "": {}, ...packages } };
}

const VERSION = "0.1.4";
const DIGEST_HEX = "b".repeat(128);
const INTEGRITY = `sha512-${Buffer.from(DIGEST_HEX, "hex").toString("base64")}`;
const NAME = "@clossys/advisor";

function statement(): Record<string, unknown> {
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
        resolvedDependencies: [{ uri: "git+https://github.com/clossys/foundry@refs/heads/main", digest: { gitCommit: "a".repeat(40) } }],
      },
      runDetails: {
        builder: { id: "https://github.com/actions/runner/github-hosted" },
        metadata: { invocationId: "https://github.com/clossys/foundry/actions/runs/123/attempts/1" },
      },
    },
  };
}

function verifiedTransport(): Transport {
  return async (input) => {
    const url = String(input);
    if (url.includes("/-/npm/v1/attestations/")) {
      return new Response(
        JSON.stringify({ attestations: [{ predicateType: "https://slsa.dev/provenance/v1", bundle: { dsseEnvelope: { payload: Buffer.from(JSON.stringify(statement())).toString("base64") } } }] }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ name: NAME, "dist-tags": { latest: VERSION }, versions: { [VERSION]: { name: NAME, version: VERSION, dist: { integrity: INTEGRITY } } } }), { status: 200 });
  };
}

describe("main — argument handling", () => {
  it("--help returns 0 without touching the filesystem or network", async () => {
    const failTransport: Transport = async () => {
      throw new Error("must not be called");
    };
    expect(await main(["--help"], failTransport)).toBe(0);
  });

  it("throws ProvenanceCliInputError on an unknown flag", async () => {
    await expect(main(["--bogus"])).rejects.toThrow(ProvenanceCliInputError);
  });

  it("throws ProvenanceCliInputError when --cwd is missing its argument", async () => {
    await expect(main(["--cwd"])).rejects.toThrow(ProvenanceCliInputError);
  });
});

describe("main — installed inventory", () => {
  it("is indeterminate (exit 2) when no manifest is found under --cwd", async () => {
    expect(await main(["--cwd", dir], verifiedTransport())).toBe(2);
  });

  it("is indeterminate (exit 2) for zero installed @clossys packages -- never a vacuous pass", async () => {
    write("package.json", { dependencies: { "left-pad": "^1.0.0" } });
    write("package-lock.json", npmLockfile({ "node_modules/left-pad": { version: "1.0.0" } }));
    expect(await main(["--cwd", dir], verifiedTransport())).toBe(2);
  });

  it("verifies (exit 0) an installed @clossys package with sound provenance", async () => {
    write("package.json", { dependencies: { [NAME]: `^${VERSION}` } });
    write("package-lock.json", npmLockfile({ [`node_modules/${NAME}`]: { version: VERSION } }));
    expect(await main(["--cwd", dir], verifiedTransport())).toBe(0);
  });

  it("reads a pnpm lockfile too -- pnpm has no npm audit signatures, which is exactly why this bin exists", async () => {
    write("package.json", { dependencies: { [NAME]: `^${VERSION}` } });
    write(
      "pnpm-lock.yaml",
      `lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      '${NAME}':\n        specifier: ^${VERSION}\n        version: ${VERSION}\n`,
    );
    expect(await main(["--cwd", dir], verifiedTransport())).toBe(0);
  });

  it("is violated (exit 1) when the attestations endpoint has no provenance for the installed version", async () => {
    write("package.json", { dependencies: { [NAME]: `^${VERSION}` } });
    write("package-lock.json", npmLockfile({ [`node_modules/${NAME}`]: { version: VERSION } }));
    const transport: Transport = async (input) => {
      const url = String(input);
      if (url.includes("/-/npm/v1/attestations/")) return new Response(JSON.stringify({ attestations: [] }), { status: 200 });
      return new Response(JSON.stringify({ name: NAME, "dist-tags": { latest: VERSION }, versions: { [VERSION]: { name: NAME, version: VERSION, dist: { integrity: INTEGRITY } } } }), { status: 200 });
    };
    expect(await main(["--cwd", dir], transport)).toBe(1);
  });

  it("is indeterminate (exit 2) when the registry is unreachable -- never a pass", async () => {
    write("package.json", { dependencies: { [NAME]: `^${VERSION}` } });
    write("package-lock.json", npmLockfile({ [`node_modules/${NAME}`]: { version: VERSION } }));
    const throws: Transport = async () => {
      throw new Error("network down");
    };
    expect(await main(["--cwd", dir], throws)).toBe(2);
  });
});

describe("main — currency policy", () => {
  it("is violated (exit 1) on a stale pin against a declared currency policy", async () => {
    write("package.json", { dependencies: { [NAME]: `^${VERSION}` } });
    write("package-lock.json", npmLockfile({ [`node_modules/${NAME}`]: { version: VERSION } }));
    write("policy.json", { pins: { [NAME]: "9.9.9" } });
    expect(await main(["--cwd", dir, "--currency-policy", join(dir, "policy.json")], verifiedTransport())).toBe(1);
  });

  it("throws ProvenanceCliInputError on a malformed currency-policy file", async () => {
    write("package.json", { dependencies: { [NAME]: `^${VERSION}` } });
    write("package-lock.json", npmLockfile({ [`node_modules/${NAME}`]: { version: VERSION } }));
    write("policy.json", { pins: "not-an-object" });
    await expect(main(["--cwd", dir, "--currency-policy", join(dir, "policy.json")], verifiedTransport())).rejects.toThrow(ProvenanceCliInputError);
  });

  it("throws ProvenanceCliInputError when the currency-policy file does not exist", async () => {
    write("package.json", { dependencies: { [NAME]: `^${VERSION}` } });
    write("package-lock.json", npmLockfile({ [`node_modules/${NAME}`]: { version: VERSION } }));
    await expect(main(["--cwd", dir, "--currency-policy", join(dir, "missing.json")], verifiedTransport())).rejects.toThrow(ProvenanceCliInputError);
  });
});
