import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  PUBLIC_NPM_REGISTRY,
  assessPublicNpmName,
  fetchPublicNpmPackument,
  probePublicNpmVersion,
  publicNpmPackageUrl,
  publicNpmRegistryProof,
  repositoryIdentityFromPackument,
  retryPostPublishPublicNpmArtifact,
  validatePublicNpmRegistryProof,
  verifyPublicNpmArtifact,
} from "./public-npm-registry.mjs";

const NAME = "@fixture/probe";
const VERSION = "1.2.3";

function response(status, body, headers = {}) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    async json() { return JSON.parse(bytes.toString("utf8")); },
    async arrayBuffer() { return bytes; },
  };
}

function queueFetch(entries, observations = []) {
  let index = 0;
  return async (url, options) => {
    observations.push({ url: String(url), options });
    const entry = entries[index++];
    if (entry instanceof Error) throw entry;
    if (!entry) throw new Error("unexpected extra fetch");
    return entry;
  };
}

function tarball() {
  const root = mkdtempSync(join(tmpdir(), "public-npm-registry-"));
  try {
    mkdirSync(join(root, "package"));
    writeFileSync(join(root, "package", "package.json"), `${JSON.stringify({ name: NAME, version: VERSION, type: "module" })}\n`);
    writeFileSync(join(root, "package", "index.js"), "export const ok = true;\n");
    const path = join(root, "candidate.tgz");
    execFileSync("tar", ["-czf", path, "-C", root, "package"]);
    return Buffer.from(readFileSync(path));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function metadata(bytes, overrides = {}) {
  const sha1 = createHash("sha1").update(bytes).digest("hex");
  const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  return {
    name: NAME,
    versions: {
      [VERSION]: {
        name: NAME,
        version: VERSION,
        repository: { type: "git", url: "git+https://github.com/fixture/platform.git" },
        dist: {
          tarball: `${PUBLIC_NPM_REGISTRY}/@fixture/probe/-/probe-${VERSION}.tgz`,
          shasum: sha1,
          integrity,
          ...overrides,
        },
      },
    },
  };
}

test("public npm package URLs are exact and reject alternate registries", () => {
  assert.equal(publicNpmPackageUrl(PUBLIC_NPM_REGISTRY, NAME), `${PUBLIC_NPM_REGISTRY}/%40fixture%2Fprobe`);
  assert.throws(() => publicNpmPackageUrl("https://registry.example.test", NAME), /supports only/);
  assert.throws(() => publicNpmPackageUrl(PUBLIC_NPM_REGISTRY, "unscoped"), /scoped/);
});

test("anonymous packument fetch sends no credential-bearing header", async () => {
  const observations = [];
  const result = await fetchPublicNpmPackument({ registry: PUBLIC_NPM_REGISTRY, name: NAME, fetchImpl: queueFetch([response(200, metadata(tarball()))], observations) });
  assert.equal(result.kind, "found");
  assert.deepEqual(Object.keys(observations[0].options.headers), ["Accept"]);
  assert.equal(observations[0].options.headers.Accept, "application/vnd.npm.install-v1+json");
  assert.equal(observations[0].options.redirect, "error");
});

test("public npm 404 is a definitive missing version while denial and transport failure remain distinct", async () => {
  const missing = await probePublicNpmVersion({ registry: PUBLIC_NPM_REGISTRY, name: NAME, version: VERSION, fetchImpl: queueFetch([response(404, {})]) });
  assert.deepEqual(missing, { kind: "known", hasVersion: false });
  const absentVersion = await probePublicNpmVersion({ registry: PUBLIC_NPM_REGISTRY, name: NAME, version: "9.9.9", fetchImpl: queueFetch([response(200, metadata(tarball()))]) });
  assert.deepEqual(absentVersion, { kind: "known", hasVersion: false });
  assert.deepEqual(await probePublicNpmVersion({ registry: PUBLIC_NPM_REGISTRY, name: NAME, version: VERSION, fetchImpl: queueFetch([response(403, {})]) }), { kind: "denied" });
  assert.deepEqual(await probePublicNpmVersion({ registry: PUBLIC_NPM_REGISTRY, name: NAME, version: VERSION, fetchImpl: queueFetch([response(429, {})]) }), { kind: "unreachable" });
  assert.deepEqual(await probePublicNpmVersion({ registry: PUBLIC_NPM_REGISTRY, name: NAME, version: VERSION, fetchImpl: queueFetch([new TypeError("offline")]) }), { kind: "unreachable" });
});

test("exact version metadata fails closed on malformed identity, SRI, shasum, and tarball origin", async () => {
  const bytes = tarball();
  for (const document of [
    { ...metadata(bytes), name: "@fixture/other" },
    metadata(bytes, { integrity: "sha256-not-enough" }),
    metadata(bytes, { shasum: "not-a-sha1" }),
    metadata(bytes, { tarball: "https://example.test/probe.tgz" }),
  ]) {
    const result = await probePublicNpmVersion({ registry: PUBLIC_NPM_REGISTRY, name: NAME, version: VERSION, fetchImpl: queueFetch([response(200, document)]) });
    assert.deepEqual(result, { kind: "unreachable" });
  }
});

test("served artifact proof binds packument digests, exact bytes, and packed manifest", async () => {
  const bytes = tarball();
  const observations = [];
  const result = await verifyPublicNpmArtifact({
    registry: PUBLIC_NPM_REGISTRY,
    name: NAME,
    version: VERSION,
    fetchImpl: queueFetch([response(200, metadata(bytes)), response(200, bytes, { "content-length": String(bytes.length) })], observations),
  });
  assert.equal(result.kind, "verified");
  assert.equal(result.evidence.access, "anonymous");
  assert.equal(result.evidence.name, NAME);
  assert.equal(result.evidence.version, VERSION);
  assert.equal(result.evidence.shasum, createHash("sha1").update(bytes).digest("hex"));
  assert.equal(result.evidence.sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.deepEqual(Object.keys(observations[1].options.headers), ["Accept"]);
  assert.deepEqual(validatePublicNpmRegistryProof(publicNpmRegistryProof(result.evidence), { name: NAME, version: VERSION, bytes }), []);
});

test("retained anonymous proof rejects changed identity, URLs, digest, packed manifest, or candidate bytes", async () => {
  const bytes = tarball();
  const result = await verifyPublicNpmArtifact({ registry: PUBLIC_NPM_REGISTRY, name: NAME, version: VERSION, fetchImpl: queueFetch([response(200, metadata(bytes)), response(200, bytes)]) });
  for (const mutate of [(proof) => { proof.evidence.name = "@fixture/other"; }, (proof) => { proof.evidence.packumentUrl = `${PUBLIC_NPM_REGISTRY}/fixture/probe`; }, (proof) => { proof.evidence.sha256 = "0".repeat(64); }, (proof) => { proof.evidence.packedManifestSha256 = "0".repeat(64); }, (proof) => { proof.evidence.access = "token"; }]) {
    const proof = publicNpmRegistryProof(structuredClone(result.evidence)); mutate(proof);
    assert.ok(validatePublicNpmRegistryProof(proof, { name: NAME, version: VERSION, bytes }).length > 0);
  }
  assert.ok(validatePublicNpmRegistryProof(publicNpmRegistryProof(result.evidence), { name: NAME, version: VERSION, bytes: Buffer.concat([bytes, Buffer.from("x")] ) }).some((item) => item.rule === "proof-digest"));
});

test("served artifact proof rejects changed bytes and a substituted packed manifest", async () => {
  const bytes = tarball();
  const changed = Buffer.concat([bytes, Buffer.from("changed")]);
  const digestMismatch = await verifyPublicNpmArtifact({ registry: PUBLIC_NPM_REGISTRY, name: NAME, version: VERSION, fetchImpl: queueFetch([response(200, metadata(bytes)), response(200, changed)]) });
  assert.equal(digestMismatch.kind, "mismatch");

  const root = mkdtempSync(join(tmpdir(), "public-npm-registry-wrong-"));
  let wrong;
  try {
    mkdirSync(join(root, "package"));
    writeFileSync(join(root, "package", "package.json"), JSON.stringify({ name: "@fixture/other", version: VERSION }));
    const path = join(root, "wrong.tgz");
    execFileSync("tar", ["-czf", path, "-C", root, "package"]);
    wrong = readFileSync(path);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  const manifestMismatch = await verifyPublicNpmArtifact({ registry: PUBLIC_NPM_REGISTRY, name: NAME, version: VERSION, fetchImpl: queueFetch([response(200, metadata(wrong)), response(200, wrong)]) });
  assert.equal(manifestMismatch.kind, "mismatch");
  assert.match(manifestMismatch.detail, /manifest/);
});

test("post-publish visibility retries only anonymous missing-version or 404 observations within its bounded window", async () => {
  const bytes = tarball();
  const waits = [];
  const result = await retryPostPublishPublicNpmArtifact({
    registry: PUBLIC_NPM_REGISTRY,
    name: NAME,
    version: VERSION,
    delays: [0, 7, 11],
    sleep: async (milliseconds) => { waits.push(milliseconds); },
    fetchImpl: queueFetch([
      response(404, {}),
      response(200, metadata(bytes)), response(404, {}),
      response(200, metadata(bytes)), response(200, bytes),
    ]),
  });
  assert.equal(result.kind, "verified");
  assert.deepEqual(waits, [7, 11]);
});

test("post-publish visibility exhausts a missing version without treating it as a successful publication", async () => {
  const waits = [];
  const result = await retryPostPublishPublicNpmArtifact({
    registry: PUBLIC_NPM_REGISTRY,
    name: NAME,
    version: VERSION,
    delays: [0, 3, 5],
    sleep: async (milliseconds) => { waits.push(milliseconds); },
    fetchImpl: queueFetch([response(404, {}), response(404, {}), response(404, {})]),
  });
  assert.deepEqual(result, { kind: "known", hasVersion: false });
  assert.deepEqual(waits, [3, 5]);
});

test("post-publish visibility never retries a wrong-digest registry response", async () => {
  const bytes = tarball();
  const waits = [];
  const result = await retryPostPublishPublicNpmArtifact({
    registry: PUBLIC_NPM_REGISTRY,
    name: NAME,
    version: VERSION,
    delays: [0, 9, 12],
    sleep: async (milliseconds) => { waits.push(milliseconds); },
    fetchImpl: queueFetch([response(200, metadata(bytes)), response(200, Buffer.concat([bytes, Buffer.from("wrong")]))]),
  });
  assert.equal(result.kind, "mismatch");
  assert.deepEqual(waits, []);
});

test("post-publish visibility never retries denial, transport, or malformed identity responses", async () => {
  const bytes = tarball();
  for (const [label, entries, expectedKind] of [
    ["401 denial", [response(401, {})], "denied"],
    ["403 denial", [response(403, {})], "denied"],
    ["429 transport", [response(429, {})], "unreachable"],
    ["500 transport", [response(500, {})], "unreachable"],
    ["thrown transport", [new TypeError("offline")], "unreachable"],
    ["malformed identity", [response(200, { ...metadata(bytes), name: "@fixture/other" })], "unreachable"],
  ]) {
    const waits = [];
    const result = await retryPostPublishPublicNpmArtifact({
      registry: PUBLIC_NPM_REGISTRY,
      name: NAME,
      version: VERSION,
      delays: [0, 9, 12],
      sleep: async (milliseconds) => { waits.push(milliseconds); },
      fetchImpl: queueFetch(entries),
    });
    assert.equal(result.kind, expectedKind, label);
    assert.deepEqual(waits, [], label);
  }
});

test("post-publish visibility refuses an unbounded retry schedule", async () => {
  await assert.rejects(
    retryPostPublishPublicNpmArtifact({ registry: PUBLIC_NPM_REGISTRY, name: NAME, version: VERSION, delays: [0, 180_001] }),
    /within three minutes/,
  );
});

test("repository identity is derived only from canonical GitHub repository metadata", () => {
  const document = metadata(tarball());
  assert.equal(repositoryIdentityFromPackument(document, VERSION), "fixture/platform");
  document.versions[VERSION].repository.url = "https://example.test/fixture/platform";
  assert.equal(repositoryIdentityFromPackument(document, VERSION), null);
});

test("public npm name ownership distinguishes unused, same-repository, foreign, and unreadable names", async () => {
  const thisRepo = "fixture/platform";
  assert.deepEqual(
    await assessPublicNpmName({ registry: PUBLIC_NPM_REGISTRY, name: NAME, version: VERSION, thisRepo, fetchImpl: async () => response(404, {}) }),
    { kind: "safe", found: false, existingRepo: null },
  );
  for (const [repository, kind] of [
    ["git+https://github.com/fixture/platform.git", "same-repo-version-bump"],
    ["https://github.com/other/project.git", "collision"],
    [undefined, "collision"],
  ]) {
    const document = metadata(tarball());
    document.versions[VERSION].repository = repository === undefined ? undefined : { url: repository };
    const result = await assessPublicNpmName({
      registry: PUBLIC_NPM_REGISTRY,
      name: NAME,
      version: VERSION,
      thisRepo,
      fetchImpl: async () => response(200, document),
    });
    assert.equal(result.kind, kind);
  }
  assert.equal(
    (await assessPublicNpmName({ registry: PUBLIC_NPM_REGISTRY, name: NAME, version: VERSION, thisRepo, fetchImpl: async () => response(403, {}) })).kind,
    "denied",
  );
});

test("public npm name ownership requests full metadata and admits an unpublished version only for one exact repository", async () => {
  const thisRepo = "fixture/platform";
  const observations = [];
  const owned = metadata(tarball());
  owned.repository = { type: "git", url: "git+https://github.com/fixture/platform.git" };
  delete owned.versions[VERSION].repository;
  const result = await assessPublicNpmName({
    registry: PUBLIC_NPM_REGISTRY,
    name: NAME,
    version: "1.2.4",
    thisRepo,
    fetchImpl: queueFetch([response(200, owned)], observations),
  });
  assert.deepEqual(result, { kind: "same-repo-version-bump", found: true, existingRepo: thisRepo });
  assert.deepEqual(Object.keys(observations[0].options.headers), ["Accept"]);
  assert.equal(observations[0].options.headers.Accept, "application/json");
  assert.equal(observations[0].options.redirect, "error");
});

test("public npm name ownership fails closed on absent, foreign, malformed, or mixed repository identity", async () => {
  const thisRepo = "fixture/platform";
  const owned = "git+https://github.com/fixture/platform.git";
  const foreign = "https://github.com/other/project.git";
  const cases = [
    (() => { const document = metadata(tarball()); delete document.versions[VERSION].repository; return document; })(),
    (() => { const document = metadata(tarball()); document.repository = { url: foreign }; document.versions[VERSION].repository = { url: foreign }; return document; })(),
    (() => { const document = metadata(tarball()); document.repository = { url: "not-a-repository" }; return document; })(),
    (() => { const document = metadata(tarball()); document.repository = { url: owned }; document.versions[VERSION].repository = { url: foreign }; return document; })(),
  ];
  for (const document of cases) {
    const result = await assessPublicNpmName({
      registry: PUBLIC_NPM_REGISTRY,
      name: NAME,
      version: "1.2.4",
      thisRepo,
      fetchImpl: async () => response(200, document),
    });
    assert.equal(result.kind, "collision");
  }
});
