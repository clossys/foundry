import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { snapshotMain } from "./apply-plan-cli.js";
import { assertImplementedContract } from "./generated/contract-schema.generated.js";
import { PACKAGE_SCOPE } from "./generated/package-scope.generated.js";
import { PLAN_CONTRACTS } from "./generated/plan-contracts.generated.js";
import {
  MAX_RESPONSE_BYTES,
  REGISTRY_SNAPSHOT_REL,
  RegistrySnapshotError,
  canonicalRegistrySnapshot,
  nodeFetchTransport,
  packumentUrl,
  projectPackument,
  registryEncodedName,
  registrySnapshotViolations,
  requestedPackageNames,
  serializeRegistrySnapshot,
  takeRegistrySnapshot,
  writeRegistrySnapshot,
  type RegistrySnapshot,
  type Transport,
} from "./registry-snapshot.js";

/*
 * Issue #1178: the registry snapshot step. Every registry read in these
 * tests goes through an injected transport; the global fetch is replaced by
 * one that fails the test, so no test can reach the network. node:fs is
 * wrapped, passing every call through, so a test can see every path the
 * code under test touches and make one operation fail.
 */
const fsHooks = vi.hoisted(() => ({ paths: [] as string[], fail: undefined as string | undefined }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const wrapped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(actual)) {
    if (typeof value !== "function" || !/^[a-z]/.test(key)) {
      wrapped[key] = value;
      continue;
    }
    wrapped[key] = (...args: unknown[]) => {
      const first = args[0];
      if (typeof first === "string" || first instanceof URL) fsHooks.paths.push(first instanceof URL ? first.pathname : first);
      if (fsHooks.fail === key) throw Object.assign(new Error(`${key} failed (test)`), { code: "EIO" });
      return (value as (...inner: unknown[]) => unknown)(...args);
    };
  }
  return { ...wrapped, default: wrapped };
});

const REGISTRY = PACKAGE_SCOPE.registry;
const SCOPE = PACKAGE_SCOPE.scope;
const DESIGNER = `${SCOPE}/designer`;
const STARTER = `${SCOPE}/starter`;
const FIXED_NOW = "2026-09-24T12:00:00.000Z";
const FETCHED_BY = { name: `${SCOPE}/launcher`, version: "0.3.1" };
const INTEGRITY = `sha512-${createHash("sha512").update("made-up tarball bytes").digest("base64")}`;
const BODY_MARKER = "BODY-MARKER-never-printed";

const REPOSITORY_ROOT = new URL("../../../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, REPOSITORY_ROOT), "utf8");

const roots: string[] = [];
function tempDir(): string {
  const root = mkdtempSync(join(tmpdir(), "registry-snapshot-"));
  roots.push(root);
  return root;
}

beforeEach(() => {
  fsHooks.fail = undefined;
  vi.stubGlobal("fetch", () => {
    throw new Error("a test reached the real fetch");
  });
});

afterEach(() => {
  fsHooks.fail = undefined;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A realistic full registry document: three versions, two dist-tags, and fields the snapshot never records. */
function packumentOf(name: string, latest = "1.2.0"): Record<string, unknown> {
  const tarball = (version: string) => `${REGISTRY}/${name}/-/${name.split("/")[1]}-${version}.tgz`;
  return {
    _id: name,
    _rev: "12-abc",
    name,
    description: BODY_MARKER,
    "dist-tags": { latest, next: "2.0.0-beta.1" },
    versions: {
      "1.1.0": { name, version: "1.1.0", dist: { integrity: "sha512-older", tarball: tarball("1.1.0"), shasum: "aa" }, deprecated: "old" },
      [latest]: {
        name,
        version: latest,
        description: BODY_MARKER,
        scripts: { postinstall: "echo never recorded" },
        dependencies: { "left-pad": "^1.0.0" },
        dist: {
          integrity: INTEGRITY,
          shasum: "bb",
          tarball: tarball(latest),
          fileCount: 12,
          signatures: [{ keyid: "SHA256:example", sig: "example" }],
          attestations: { url: `${REGISTRY}/-/npm/v1/attestations/${name}@${latest}`, provenance: { predicateType: "https://slsa.dev/provenance/v1" } },
        },
      },
      "2.0.0-beta.1": { name, version: "2.0.0-beta.1", dist: { integrity: "sha512-beta", tarball: tarball("2.0.0-beta.1") } },
    },
    time: { created: "2026-01-01T00:00:00.000Z", modified: "2026-09-02T00:00:00.000Z", "1.1.0": "2026-06-01T00:00:00.000Z", [latest]: "2026-09-01T10:00:00.000Z", "2.0.0-beta.1": "2026-09-02T00:00:00.000Z" },
    readme: BODY_MARKER,
    maintainers: [{ name: "example", email: "maintainer@example.com" }],
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

/** A transport that answers by package name and records every request exactly as it was handed over. */
function fakeRegistry(answer: (name: string) => Response | Promise<Response>): { transport: Transport; calls: Call[] } {
  const calls: Call[] = [];
  const transport: Transport = async (url, init) => {
    calls.push({ url: url.href, init });
    return answer(decodeURIComponent(url.pathname.slice(1)));
  };
  return { transport, calls };
}

const options = (transport: Transport) => ({ transport, now: () => FIXED_NOW, fetchedBy: FETCHED_BY });

function writeRequest(directory: string, request: unknown): string {
  const path = join(directory, "request.json");
  writeFileSync(path, typeof request === "string" ? request : JSON.stringify(request));
  return path;
}

describe("the registry path of a package name", () => {
  it("keeps a scoped name's @ literal and percent-encodes only the slash, under the packed registry", () => {
    expect(registryEncodedName(DESIGNER)).toBe(`${SCOPE}%2Fdesigner`);
    expect(packumentUrl(REGISTRY, DESIGNER).href).toBe(`${REGISTRY}/${SCOPE}%2Fdesigner`);
    expect(packumentUrl(`${REGISTRY}/`, DESIGNER).href).toBe(`${REGISTRY}/${SCOPE}%2Fdesigner`);
    expect(registryEncodedName(`${SCOPE}/de signer?x#y`)).toBe(`${SCOPE}%2Fde%20signer%3Fx%23y`);
    expect(registryEncodedName("plain")).toBe("plain");
  });

  it("is the same function as Integrator's registryEncodedName, which this package copies rather than depends on", () => {
    const body = (source: string): string => {
      const signature = /function registryEncodedName\(name: string\): string \{\n/.exec(source);
      expect(signature).not.toBeNull();
      const start = (signature?.index ?? 0) + (signature?.[0].length ?? 0);
      return source.slice(start, source.indexOf("\n}\n", start));
    };
    const ours = body(readFileSync(new URL("./registry-snapshot.ts", import.meta.url), "utf8"));
    expect(ours).toContain("%2F");
    expect(ours).toBe(body(read("packages/integrator/src/provenance-check.ts")));
  });

  it("reads the registry from the packed package-scope.json, never a value written into the source", () => {
    const scope = JSON.parse(read("package-scope.json")) as { scope: string; registry: string };
    expect(PACKAGE_SCOPE).toEqual({ scope: scope.scope, registry: scope.registry });
    expect(readFileSync(new URL("./registry-snapshot.ts", import.meta.url), "utf8")).not.toContain(scope.registry);
  });
});

describe("the snapshot request", () => {
  it("accepts advisor-package-request's report, or just its names", () => {
    expect(requestedPackageNames({ state: "satisfied", names: [DESIGNER, STARTER], findings: [] })).toEqual([DESIGNER, STARTER]);
    expect(requestedPackageNames({ names: [STARTER] })).toEqual([STARTER]);
  });

  it("refuses anything else, naming positions only, never the request's text", () => {
    const cases: [unknown, RegExp][] = [
      [[DESIGNER], /must be a JSON object/],
      [{ state: "violated", findings: [{ rule: "x" }] }, /state is not satisfied/],
      [{ state: "satisfied", names: [DESIGNER], findings: [{ rule: "x" }] }, /findings must be an empty array/],
      [{ names: [DESIGNER], extra: BODY_MARKER }, /a field other than state, names and findings/],
      [{ names: [] }, /names must be a non-empty array/],
      [{ names: [DESIGNER, 7] }, /^names\[1\] is not a package name in the @\S+ scope$/],
      [{ names: [`@${BODY_MARKER.toLowerCase()}/designer`] }, /^names\[0\] is not a package name in the @\S+ scope$/],
      [{ names: ["left-pad"] }, /^names\[0\] is not a package name/],
      [{ names: [`${SCOPE}/../../etc`] }, /^names\[0\] is not a package name/],
      [{ names: [`${SCOPE}/${"a".repeat(214)}`] }, /^names\[0\] is not a package name/],
      [{ names: [STARTER, DESIGNER, STARTER] }, /^names\[2\] repeats names\[0\]$/],
      [{ names: [DESIGNER, , STARTER] }, /^names\[1\] is missing$/],
    ];
    for (const [request, expected] of cases) {
      let message = "";
      try {
        requestedPackageNames(request);
      } catch (cause) {
        expect(cause).toBeInstanceOf(RegistrySnapshotError);
        message = (cause as Error).message;
      }
      expect(message).toMatch(expected);
      expect(message.toLowerCase()).not.toContain(BODY_MARKER.toLowerCase());
    }
  });
});

describe("what a registry read sends (threat: a credential leaks)", () => {
  it("sends one GET per name, in name order, with only the accept headers, no credential, and redirects refused", async () => {
    const { transport, calls } = fakeRegistry((name) => jsonResponse(packumentOf(name)));
    await takeRegistrySnapshot([STARTER, DESIGNER], options(transport));
    expect(calls.map((call) => call.url)).toEqual([packumentUrl(REGISTRY, DESIGNER).href, packumentUrl(REGISTRY, STARTER).href]);
    for (const { url, init } of calls) {
      expect(new URL(url).origin).toBe(REGISTRY);
      expect(new URL(url).username + new URL(url).password).toBe("");
      expect(new URL(url).search).toBe("");
      expect(init.method).toBe("GET");
      expect(init.headers).toEqual({ accept: "application/json", "accept-encoding": "identity" });
      expect(Object.keys(init.headers as Record<string, string>).some((key) => key.toLowerCase() === "authorization")).toBe(false);
      expect(init.redirect).toBe("error");
      expect(init.credentials).toBe("omit");
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(Object.keys(init).sort()).toEqual(["credentials", "headers", "method", "redirect", "signal"]);
    }
  });

  it("asks for the body uncompressed, so the hash and the size cap apply to the exact bytes received", async () => {
    const { transport, calls } = fakeRegistry((name) => jsonResponse(packumentOf(name)));
    await takeRegistrySnapshot([DESIGNER, STARTER], options(transport));
    expect(calls).toHaveLength(2);
    for (const { init } of calls) expect((init.headers as Record<string, string>)["accept-encoding"]).toBe("identity");
  });

  it("still bounds a body a server compressed anyway: the cap counts the bytes read after decoding", async () => {
    const { gzipSync } = await import("node:zlib");
    const huge = JSON.stringify({ ...packumentOf(DESIGNER), readme: "x".repeat(MAX_RESPONSE_BYTES) });
    const compressed = gzipSync(huge);
    expect(compressed.byteLength).toBeLessThan(MAX_RESPONSE_BYTES / 100);
    const decoded = new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip")), { status: 200, headers: { "content-encoding": "gzip" } });
    const { transport } = fakeRegistry(() => decoded);
    await expect(takeRegistrySnapshot([DESIGNER], options(transport))).rejects.toThrow(/larger than 10 MiB/);
  });

  it("adds nothing from the environment: tokens in every variable npm reads never reach a request", async () => {
    const token = "test-only-not-a-real-token-env";
    for (const name of ["NPM_TOKEN", "NODE_AUTH_TOKEN", "npm_config__authToken", "NPM_CONFIG__AUTH", "GITHUB_TOKEN"]) vi.stubEnv(name, token);
    const { transport, calls } = fakeRegistry((name) => jsonResponse(packumentOf(name)));
    await takeRegistrySnapshot([DESIGNER], options(transport));
    expect(JSON.stringify(calls.map((call) => ({ url: call.url, headers: call.init.headers })))).not.toContain(token);
  });

  it("reads no .npmrc: with HOME, the npm config variables and the hub all pointing at one that holds a token, nothing opens it", async () => {
    const hub = tempDir();
    const token = "test-only-not-a-real-token-npmrc";
    const npmrc = join(hub, ".npmrc");
    writeFileSync(npmrc, `//registry.example.com/:_authToken=${token}\n_authToken=${token}\nregistry=https://registry.example.com/\n`);
    vi.stubEnv("HOME", hub);
    vi.stubEnv("USERPROFILE", hub);
    vi.stubEnv("NPM_CONFIG_USERCONFIG", npmrc);
    vi.stubEnv("npm_config_userconfig", npmrc);
    vi.stubEnv("NPM_CONFIG_GLOBALCONFIG", npmrc);
    vi.spyOn(process, "cwd").mockReturnValue(hub);
    const request = writeRequest(hub, { state: "satisfied", names: [DESIGNER], findings: [] });
    const { transport, calls } = fakeRegistry((name) => jsonResponse(packumentOf(name)));
    vi.spyOn(console, "log").mockImplementation(() => {});
    fsHooks.paths.length = 0;
    expect(await snapshotMain(["--request", request], { transport, now: () => FIXED_NOW })).toBe(0);
    expect(fsHooks.paths.length).toBeGreaterThan(0);
    expect(fsHooks.paths.filter((path) => path.includes(".npmrc"))).toEqual([]);
    const underHub = fsHooks.paths.filter((path) => path.startsWith(hub));
    expect(underHub.every((path) => path === request || dirname(path) === join(hub, "clossys", ".state", "apply") || path === join(hub, "clossys", ".state", "apply"))).toBe(true);
    expect(JSON.stringify(calls.map((call) => ({ url: call.url, headers: call.init.headers })))).not.toContain(token);
    expect(calls[0]?.url.startsWith(`${REGISTRY}/`)).toBe(true);
    expect(existsSync(join(hub, REGISTRY_SNAPSHOT_REL))).toBe(true);
  });

  it("the default transport is Node's own fetch, handed exactly the URL and init built here", async () => {
    const seen: [unknown, unknown][] = [];
    vi.stubGlobal("fetch", async (input: unknown, init: unknown) => {
      seen.push([input, init]);
      return jsonResponse(packumentOf(DESIGNER));
    });
    const url = packumentUrl(REGISTRY, DESIGNER);
    const init: RequestInit = { method: "GET", headers: { accept: "application/json", "accept-encoding": "identity" }, redirect: "error" };
    await nodeFetchTransport(url, init);
    expect(seen).toEqual([[url, init]]);
    seen.length = 0;
    await takeRegistrySnapshot([DESIGNER], { now: () => FIXED_NOW, fetchedBy: FETCHED_BY });
    expect((seen[0]?.[1] as RequestInit).redirect).toBe("error");
    expect(((seen[0]?.[1] as RequestInit).headers as Record<string, string>)["accept-encoding"]).toBe("identity");
  });
});

describe("what a snapshot records (threat: a packument selects something latest does not name)", () => {
  it("projects only the version latest names, and only the fields the contract declares", async () => {
    const { transport } = fakeRegistry((name) => jsonResponse(packumentOf(name)));
    const snapshot = await takeRegistrySnapshot([DESIGNER], options(transport));
    const sent = JSON.stringify(packumentOf(DESIGNER));
    expect(snapshot).toEqual({
      schemaVersion: 1,
      kind: "clossys.registry-snapshot",
      registry: REGISTRY,
      fetchedAt: FIXED_NOW,
      fetchedBy: FETCHED_BY,
      packages: [
        {
          name: DESIGNER,
          status: "found",
          latest: "1.2.0",
          versions: [
            { version: "1.2.0", integrity: INTEGRITY, tarball: `${REGISTRY}/${DESIGNER}/-/designer-1.2.0.tgz`, deprecated: false, publishedAt: "2026-09-01T10:00:00.000Z", hasAttestations: true },
          ],
          responseSha256: `sha256:${createHash("sha256").update(sent).digest("hex")}`,
        },
      ],
    });
    expect(serializeRegistrySnapshot(snapshot)).not.toContain(BODY_MARKER);
  });

  it("hashes the exact bytes received, whitespace and key order included", async () => {
    const pretty = `${JSON.stringify(packumentOf(DESIGNER), null, 4)}\n`;
    const { transport } = fakeRegistry(() => jsonResponse(pretty));
    const [entry] = (await takeRegistrySnapshot([DESIGNER], options(transport))).packages;
    expect(entry?.responseSha256).toBe(`sha256:${createHash("sha256").update(pretty).digest("hex")}`);
  });

  it("records a 404 as not-found, with no latest and no versions", async () => {
    const body = '{"error":"Not found"}';
    const { transport } = fakeRegistry(() => jsonResponse(body, 404));
    const snapshot = await takeRegistrySnapshot([DESIGNER], options(transport));
    expect(snapshot.packages).toEqual([{ name: DESIGNER, status: "not-found", latest: null, versions: [], responseSha256: `sha256:${createHash("sha256").update(body).digest("hex")}` }]);
  });

  it("records a latest that names an unlisted version with no versions, and no dist-tags as no latest, so a resolver refuses by name", () => {
    const missing = { ...packumentOf(DESIGNER), "dist-tags": { latest: "9.9.9" } };
    expect(projectPackument(DESIGNER, missing)).toEqual({ latest: "9.9.9", versions: [] });
    const { "dist-tags": _tags, ...untagged } = packumentOf(DESIGNER);
    expect(projectPackument(DESIGNER, untagged)).toEqual({ latest: null, versions: [] });
  });

  it("never reads an inherited or look-alike member: a __proto__ key holding a latest is not the latest", () => {
    const document = JSON.parse(`{"name":"${DESIGNER}","dist-tags":{"__proto__":{"latest":"1.1.0"}},"versions":{}}`) as unknown;
    expect(projectPackument(DESIGNER, document)).toEqual({ latest: null, versions: [] });
  });

  it("records deprecation as npm reads it, missing integrity and time as null, and no attestations as false", () => {
    const base = packumentOf(DESIGNER);
    const withLatest = (change: (entry: Record<string, unknown>) => void, document = structuredClone(base)) => {
      change((document.versions as Record<string, Record<string, unknown>>)["1.2.0"]!);
      return projectPackument(DESIGNER, document).versions[0];
    };
    expect(withLatest((entry) => (entry.deprecated = "use 2.x"))?.deprecated).toBe(true);
    expect(withLatest((entry) => (entry.deprecated = ""))?.deprecated).toBe(false);
    expect(withLatest((entry) => (entry.deprecated = true))?.deprecated).toBe(true);
    const bare = withLatest((entry) => {
      const dist = entry.dist as Record<string, unknown>;
      delete dist.integrity;
      delete dist.attestations;
    });
    expect(bare?.integrity).toBeNull();
    expect(bare?.hasAttestations).toBe(false);
    const { time: _time, ...timeless } = structuredClone(base);
    expect(projectPackument(DESIGNER, timeless).versions[0]?.publishedAt).toBeNull();
  });

  it("records attestations only when the registry lists where they are: an empty or url-less object lists none", () => {
    const withAttestations = (attestations: unknown) => {
      const document = packumentOf(DESIGNER);
      ((document.versions as Record<string, Record<string, Record<string, unknown>>>)["1.2.0"]!.dist!).attestations = attestations;
      return projectPackument(DESIGNER, document).versions[0]?.hasAttestations;
    };
    expect(withAttestations({})).toBe(false);
    expect(withAttestations({ url: "" })).toBe(false);
    expect(withAttestations({ url: "  " })).toBe(false);
    expect(withAttestations({ url: 5 })).toBe(false);
    expect(withAttestations({ provenance: { predicateType: "https://slsa.dev/provenance/v1" } })).toBe(false);
    expect(withAttestations(null)).toBe(false);
    const listed = ((packumentOf(DESIGNER).versions as Record<string, Record<string, Record<string, unknown>>>)["1.2.0"]!.dist!).attestations;
    expect(typeof (listed as { url?: unknown }).url).toBe("string");
    expect(withAttestations(listed)).toBe(true);
  });

  it("refuses a document for another package, a latest entry that names another version, or a field of the wrong type", async () => {
    const cases: [string, (document: Record<string, unknown>) => void, RegExp][] = [
      ["another package", (document) => (document.name = STARTER), /does not name the package that was requested/],
      ["no name", (document) => delete document.name, /does not name the package that was requested/],
      ["swapped entry", (document) => ((document.versions as Record<string, Record<string, unknown>>)["1.2.0"]!.version = "1.1.0"), /under a different version number/],
      ["latest not text", (document) => (document["dist-tags"] = { latest: 1 }), /latest dist-tag that is not a string/],
      ["tags not an object", (document) => (document["dist-tags"] = ["1.2.0"]), /dist-tags that are not an object/],
      ["versions not an object", (document) => (document.versions = []), /versions that are not an object/],
      ["entry not an object", (document) => ((document.versions as Record<string, unknown>)["1.2.0"] = "1.2.0"), /latest version as something that is not an object/],
      ["no tarball", (document) => delete ((document.versions as Record<string, Record<string, Record<string, unknown>>>)["1.2.0"]!.dist!.tarball), /no tarball URL/],
      ["integrity not text", (document) => ((document.versions as Record<string, Record<string, Record<string, unknown>>>)["1.2.0"]!.dist!.integrity = ["sha512-a"]), /integrity that is not a string/],
      ["deprecated a number", (document) => ((document.versions as Record<string, Record<string, unknown>>)["1.2.0"]!.deprecated = 1), /deprecated with something/],
      ["time not text", (document) => ((document.time as Record<string, unknown>)["1.2.0"] = 7), /publish time that is not a string/],
      ["attestations not an object", (document) => ((document.versions as Record<string, Record<string, Record<string, unknown>>>)["1.2.0"]!.dist!.attestations = true), /attestations that are not an object/],
    ];
    for (const [name, change, expected] of cases) {
      const document = packumentOf(DESIGNER);
      change(document);
      const { transport } = fakeRegistry(() => jsonResponse(document));
      await expect(takeRegistrySnapshot([DESIGNER], options(transport)), name).rejects.toThrow(expected);
    }
  });

  it("validates the projection against the contract, naming positions and never the served value", async () => {
    const cases: [(document: Record<string, unknown>) => void, RegExp][] = [
      [(document) => (document["dist-tags"] = { latest: `1.2.0 ${BODY_MARKER}` }), /snapshot\.packages\[0\]\.latest .*\(rule schema\)/],
      [(document) => ((document.time as Record<string, unknown>)["1.2.0"] = `yesterday ${BODY_MARKER}`), /snapshot\.packages\[0\]\.versions\[0\]\.publishedAt .*\(rule schema\)/],
      [(document) => ((document.versions as Record<string, Record<string, Record<string, unknown>>>)["1.2.0"]!.dist!.tarball = "  "), /snapshot\.packages\[0\]\.versions\[0\]\.tarball .*\(rule schema\)/],
    ];
    for (const [change, expected] of cases) {
      const document = packumentOf(DESIGNER);
      change(document);
      const { transport } = fakeRegistry(() => jsonResponse(document));
      const failure = await takeRegistrySnapshot([DESIGNER], options(transport)).then(() => undefined, (cause: unknown) => cause as Error);
      expect(failure).toBeInstanceOf(RegistrySnapshotError);
      expect(failure?.message).toMatch(expected);
      expect(failure?.message).not.toContain(BODY_MARKER);
    }
  });

  it("refuses a response that repeats a key, so no two readers of it could pick different latests", async () => {
    const text = JSON.stringify(packumentOf(DESIGNER)).replace('"dist-tags":{"latest":"1.2.0"', '"dist-tags":{"latest":"1.2.0","latest":"1.1.0"');
    const { transport } = fakeRegistry(() => jsonResponse(text));
    await expect(takeRegistrySnapshot([DESIGNER], options(transport))).rejects.toThrow(/response repeats a key in one object$/);
  });
});

describe("failures write nothing (threats: redirect, oversize, slow, non-JSON)", () => {
  const failures: [string, (name: string) => Response | Promise<Response>, RegExp][] = [
    ["a transport error", () => Promise.reject(new TypeError(`fetch failed ${BODY_MARKER}`)), /could not be reached, or answered with a redirect/],
    ["HTTP 500", () => jsonResponse(BODY_MARKER, 500), /answered HTTP 500; only 200 and 404 are recorded/],
    ["HTTP 503", () => jsonResponse(BODY_MARKER, 503), /answered HTTP 503/],
    ["HTTP 401", () => jsonResponse(BODY_MARKER, 401), /answered HTTP 401/],
    ["HTTP 204", () => new Response(null, { status: 204 }), /answered HTTP 204/],
    ["a non-JSON body", () => new Response(`<html>${BODY_MARKER}</html>`, { status: 200 }), /response is not valid JSON at position 0$/],
    ["a body that is not UTF-8", () => new Response(new Uint8Array([0x7b, 0xff, 0x7d]), { status: 200 }), /response is not valid UTF-8$/],
    ["a JSON body that is not a document", () => jsonResponse([BODY_MARKER]), /document is not a JSON object$/],
  ];

  for (const [name, answer, expected] of failures) {
    it(`${name}: the step stops, names the package and position, and quotes nothing it received`, async () => {
      const { transport } = fakeRegistry(answer);
      const failure = await takeRegistrySnapshot([DESIGNER], options(transport)).then(() => undefined, (cause: unknown) => cause as Error);
      expect(failure).toBeInstanceOf(RegistrySnapshotError);
      expect(failure?.message).toMatch(new RegExp(`^names\\[0\\] ${DESIGNER}: `));
      expect(failure?.message).toMatch(expected);
      expect(failure?.message).not.toContain(BODY_MARKER);
    });
  }

  it("stops at the first failure and fetches no further package", async () => {
    const { transport, calls } = fakeRegistry(() => jsonResponse("", 500));
    await expect(takeRegistrySnapshot([STARTER, DESIGNER], options(transport))).rejects.toThrow(/^names\[1\] /);
    expect(calls).toHaveLength(1);
  });

  it("refuses a redirect answer without following it", async () => {
    const { transport, calls } = fakeRegistry(() => new Response(null, { status: 302, headers: { location: "https://elsewhere.example.com/x" } }));
    await expect(takeRegistrySnapshot([DESIGNER], options(transport))).rejects.toThrow(/answered with a redirect \(HTTP 302\), which is refused and never followed/);
    expect(calls).toHaveLength(1);
  });

  it("refuses a response a transport reports it reached by redirect, even with a 200", async () => {
    const { transport } = fakeRegistry((name) => Object.defineProperty(jsonResponse(packumentOf(name)), "redirected", { value: true }));
    await expect(takeRegistrySnapshot([DESIGNER], options(transport))).rejects.toThrow(/answered with a redirect, which is refused/);
  });

  it("gives up on a registry that never answers, whether or not the transport honours the abort signal", async () => {
    const silent: Transport = () => new Promise<Response>(() => {});
    await expect(takeRegistrySnapshot([DESIGNER], { ...options(silent), timeoutMs: 20 })).rejects.toThrow(/did not answer within 0\.02 s/);
    const honouring: Transport = (_url, init) =>
      new Promise<Response>((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    await expect(takeRegistrySnapshot([DESIGNER], { ...options(honouring), timeoutMs: 20 })).rejects.toThrow(/did not answer within/);
  });

  it("gives up on a body that stops arriving part way, and cancels it", async () => {
    let cancelled = false;
    const stalled = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"name":'));
      },
      cancel() {
        cancelled = true;
      },
    });
    const { transport } = fakeRegistry(() => new Response(stalled, { status: 200 }));
    await expect(takeRegistrySnapshot([DESIGNER], { ...options(transport), timeoutMs: 30 })).rejects.toThrow(/did not finish its response within/);
    expect(cancelled).toBe(true);
  });

  it("stops reading an endless body just past 10 MiB, while streaming, and cancels it", async () => {
    const chunk = new Uint8Array(64 * 1024).fill(0x20);
    let pulled = 0;
    let cancelled = false;
    const endless = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulled += chunk.byteLength;
          controller.enqueue(chunk);
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const { transport } = fakeRegistry(() => new Response(endless, { status: 200 }));
    await expect(takeRegistrySnapshot([DESIGNER], options(transport))).rejects.toThrow(/larger than 10 MiB and was not read past that/);
    expect(MAX_RESPONSE_BYTES).toBe(10 * 1024 * 1024);
    expect(pulled).toBeGreaterThan(MAX_RESPONSE_BYTES);
    expect(pulled).toBeLessThanOrEqual(MAX_RESPONSE_BYTES + 2 * chunk.byteLength);
    expect(cancelled).toBe(true);
  });

  it("refuses a declared length over the cap before reading the body", async () => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(1));
      },
    }, { highWaterMark: 0 });
    const response = new Response(body, { status: 200, headers: { "content-length": String(MAX_RESPONSE_BYTES + 1) } });
    const { transport } = fakeRegistry(() => response);
    await expect(takeRegistrySnapshot([DESIGNER], options(transport))).rejects.toThrow(/larger than 10 MiB/);
    expect(pulled).toBe(0);
  });

  it("accepts a document of exactly 10 MiB and refuses one byte more", async () => {
    const sized = (bytes: number): string => {
      const document = { ...packumentOf(DESIGNER), readme: "" };
      const padding = bytes - Buffer.byteLength(JSON.stringify(document));
      return JSON.stringify({ ...document, readme: "x".repeat(padding) });
    };
    const exact = sized(MAX_RESPONSE_BYTES);
    expect(Buffer.byteLength(exact)).toBe(MAX_RESPONSE_BYTES);
    const { transport: fits } = fakeRegistry(() => new Response(exact, { status: 200 }));
    await expect(takeRegistrySnapshot([DESIGNER], options(fits))).resolves.toBeDefined();
    const { transport: over } = fakeRegistry(() => new Response(sized(MAX_RESPONSE_BYTES + 1), { status: 200 }));
    await expect(takeRegistrySnapshot([DESIGNER], options(over))).rejects.toThrow(/larger than 10 MiB/);
  });
});

describe("canonical, deterministic output (threat: the same answers give different bytes)", () => {
  const chunked = (text: string, size: number): Response => {
    const bytes = new TextEncoder().encode(text);
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (let offset = 0; offset < bytes.length; offset += size) controller.enqueue(bytes.slice(offset, offset + size));
          controller.close();
        },
      }),
      { status: 200 },
    );
  };

  it("writes packages sorted by name whatever the request's order, and the same bytes for the same answers", async () => {
    const names = [`${SCOPE}/publisher`, STARTER, DESIGNER, `${SCOPE}/customer`];
    const texts = new Map(names.map((name) => [name, JSON.stringify(packumentOf(name))]));
    const first = await takeRegistrySnapshot(names, options(fakeRegistry((name) => chunked(texts.get(name)!, 7)).transport));
    const second = await takeRegistrySnapshot([...names].reverse(), options(fakeRegistry((name) => chunked(texts.get(name)!, 4096)).transport));
    expect(first.packages.map((entry) => entry.name)).toEqual([...names].sort());
    expect(serializeRegistrySnapshot(second)).toBe(serializeRegistrySnapshot(first));
    const later = await takeRegistrySnapshot(names, { ...options(fakeRegistry((name) => jsonResponse(texts.get(name)!)).transport), now: () => "2026-09-25T00:00:00.000Z" });
    expect({ ...later, fetchedAt: FIXED_NOW }).toEqual(first);
  });

  it("puts a snapshot in the contract's canonical order, the order the shared corpus's canonical subjects list", () => {
    for (const entry of CORPUS.digests) {
      const subject = JSON.parse(entry.canonical) as { packages: { name: string; versions: { version: string }[] }[] };
      const canonical = canonicalRegistrySnapshot(entry.snapshot);
      expect(canonical.packages.map((item) => item.name), entry.name).toEqual(subject.packages.map((item) => item.name));
      expect(canonical.packages.map((item) => item.versions.map((version) => version.version)), entry.name).toEqual(subject.packages.map((item) => item.versions.map((version) => version.version)));
    }
  });

  it("records who fetched it from this package's own package.json when not told", async () => {
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { name: string; version: string };
    const { transport } = fakeRegistry((name) => jsonResponse(packumentOf(name)));
    const snapshot = await takeRegistrySnapshot([DESIGNER], { transport, now: () => FIXED_NOW });
    expect(snapshot.fetchedBy).toEqual({ name: manifest.name, version: manifest.version });
  });
});

describe("the write (threat: a half-written snapshot)", () => {
  async function aSnapshot(): Promise<RegistrySnapshot> {
    return takeRegistrySnapshot([DESIGNER, STARTER], options(fakeRegistry((name) => jsonResponse(packumentOf(name))).transport));
  }

  it("writes two-space JSON with a final newline, through a temporary file in the same directory renamed over the target", async () => {
    const directory = join(tempDir(), "clossys", ".state", "apply");
    const target = join(directory, "registry-snapshot.json");
    const snapshot = await aSnapshot();
    fsHooks.paths.length = 0;
    writeRegistrySnapshot(target, snapshot);
    const text = readFileSync(target, "utf8");
    expect(text).toBe(`${JSON.stringify(snapshot, null, 2)}\n`);
    expect(registrySnapshotViolations(JSON.parse(text))).toEqual([]);
    const temporary = fsHooks.paths.find((path) => path.endsWith(".tmp"));
    expect(temporary).toBeDefined();
    expect(dirname(temporary!)).toBe(directory);
    expect(readdirSync(directory)).toEqual(["registry-snapshot.json"]);
  });

  for (const step of ["writeSync", "fsyncSync", "renameSync"]) {
    it(`leaves the previous snapshot whole and no temporary file behind when ${step} fails`, async () => {
      const directory = tempDir();
      const target = join(directory, "registry-snapshot.json");
      writeFileSync(target, "previous snapshot\n");
      const snapshot = await aSnapshot();
      fsHooks.fail = step;
      expect(() => writeRegistrySnapshot(target, snapshot)).toThrow(/failed \(test\)/);
      fsHooks.fail = undefined;
      expect(readFileSync(target, "utf8")).toBe("previous snapshot\n");
      expect(readdirSync(directory)).toEqual(["registry-snapshot.json"]);
    });
  }

  it("writes nothing for a snapshot the contract refuses", async () => {
    const directory = tempDir();
    const target = join(directory, "registry-snapshot.json");
    const snapshot = { ...(await aSnapshot()), extra: true } as unknown as RegistrySnapshot;
    expect(() => writeRegistrySnapshot(target, snapshot)).toThrow(/does not validate against the registry snapshot contract.*snapshot has a field the contract does not declare/);
    expect(readdirSync(directory)).toEqual([]);
  });

  it("the CLI leaves an earlier snapshot untouched when a fetch fails", async () => {
    const hub = tempDir();
    const target = join(hub, REGISTRY_SNAPSHOT_REL);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, "earlier snapshot\n");
    const request = writeRequest(hub, { names: [DESIGNER] });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { transport } = fakeRegistry(() => jsonResponse("", 503));
    expect(await snapshotMain(["--request", request], { transport, cwd: hub, now: () => FIXED_NOW })).toBe(2);
    expect(readFileSync(target, "utf8")).toBe("earlier snapshot\n");
    expect(readdirSync(dirname(target))).toEqual(["registry-snapshot.json"]);
    expect(String(err.mock.calls[0]?.[0])).toMatch(/no snapshot was written$/);
  });
});

interface Corpus {
  digests: { name: string; snapshot: RegistrySnapshot; canonical: string; digest: string }[];
  invalid: { name: string; snapshot: unknown; violations: { rule: string; path: string }[] }[];
}
const CORPUS = JSON.parse(read("docs/contracts/registry-snapshot.fixture.json")) as Corpus;

describe("the shared registry snapshot contract and corpus", () => {
  it("is packed unchanged, and uses only keywords the checker implements", () => {
    expect(PLAN_CONTRACTS["registry-snapshot.json"]).toEqual(JSON.parse(read("docs/contracts/registry-snapshot.json")));
    expect(() => assertImplementedContract(PLAN_CONTRACTS["registry-snapshot.json"]!)).not.toThrow();
  });

  it("accepts every valid corpus snapshot", () => {
    for (const entry of CORPUS.digests) expect(registrySnapshotViolations(entry.snapshot), entry.name).toEqual([]);
  });

  it("refuses every invalid corpus snapshot with exactly the corpus's rules and positions", () => {
    const sorted = (items: readonly { rule: string; path: string }[]) => [...items].map(({ rule, path }) => `${rule} ${path}`).sort();
    for (const entry of CORPUS.invalid) {
      expect(sorted(registrySnapshotViolations(entry.snapshot)), entry.name).toEqual(sorted(entry.violations));
    }
  });
});
