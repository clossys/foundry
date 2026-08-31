import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  OPTIONAL_PEER_POLICY,
  credentiallessEnv,
  discoverPublishablePackages,
  inspectPackedExports,
  installedIdentityFindings,
  installedPackageRoots,
  parsePackedConsumerArgs,
  runProcess,
  validateOptionalPeerPolicy,
} from "./packed-consumer-readiness.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "packed-consumer-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("credentiallessEnv removes ambient credential-shaped variables and pins isolated npm state", () => {
  const env = credentiallessEnv({
    PATH: "/bin",
    NODE_AUTH_TOKEN: "sensitive",
    GH_PACKAGES_TOKEN: "sensitive",
    npm_config_userconfig: "/ambient",
  }, "/clean/npmrc", "/clean/cache", "/clean/global-npmrc");
  assert.equal(env.PATH, "/bin");
  assert.equal(env.NODE_AUTH_TOKEN, undefined);
  assert.equal(env.GH_PACKAGES_TOKEN, undefined);
  assert.equal(env.npm_config_userconfig, "/clean/npmrc");
  assert.equal(env.npm_config_globalconfig, "/clean/global-npmrc");
  assert.equal(env.npm_config_cache, "/clean/cache");
  assert.equal(env.npm_config_ignore_scripts, "true");
  assert.equal(env.npm_config_always_auth, "false");
});

test("the CLI is closed and exposes no probe that can weaken a failure", () => {
  assert.deepEqual(parsePackedConsumerArgs(["--package", "architect", "--skip-build"]), {
    selected: "architect",
    root: undefined,
    skipBuild: true,
    keep: false,
  });
  assert.throws(() => parsePackedConsumerArgs(["--probe"]), /unknown argument/);
  assert.throws(() => parsePackedConsumerArgs(["--package"]), /requires a value/);
  assert.throws(() => parsePackedConsumerArgs(["--keep", "--keep"]), /duplicate argument/);
});

test("discoverPublishablePackages covers every non-private package and selects first-party closure", async (t) => {
  const root = await fixture(t);
  for (const [directory, manifest] of [
    ["app", { name: "@example/app", version: "1.0.0", dependencies: { "@example/core": "^1.0.0" } }],
    ["core", { name: "@example/core", version: "1.0.0" }],
    ["private", { name: "@example/private", version: "1.0.0", private: true }],
  ]) {
    await mkdir(join(root, "packages", directory), { recursive: true });
    await writeFile(join(root, "packages", directory, "package.json"), JSON.stringify(manifest));
  }
  assert.deepEqual((await discoverPublishablePackages(root)).map((entry) => entry.manifest.name), ["@example/app", "@example/core"]);
  assert.deepEqual((await discoverPublishablePackages(root, "app")).map((entry) => entry.manifest.name), ["@example/app", "@example/core"]);
  assert.deepEqual((await discoverPublishablePackages(root, "@example/core")).map((entry) => entry.manifest.name), ["@example/core"]);
  await assert.rejects(() => discoverPublishablePackages(root, "missing"), /unknown publishable package/);
});

test("inspectPackedExports imports runtime subpaths and resolves every static target", async (t) => {
  const root = await fixture(t);
  await mkdir(join(root, "dist"));
  await mkdir(join(root, "assets"));
  await writeFile(join(root, "dist", "index.js"), "export {};\n");
  await writeFile(join(root, "dist", "index.d.ts"), "export {};\n");
  await writeFile(join(root, "dist", "client.js"), "export {};\n");
  await writeFile(join(root, "dist", "server.js"), "export {};\n");
  await writeFile(join(root, "dist", "proxy.js"), "export {};\n");
  await writeFile(join(root, "assets", "one.css"), "a{}\n");
  const result = await inspectPackedExports(root, {
    name: "@example/pkg",
    exports: {
      ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
      "./assets/*": "./assets/*",
    },
  });
  assert.deepEqual(result.runtimeSpecifiers, ["@example/pkg"]);
  assert.deepEqual(result.staticTargets.map((item) => item.target), ["./assets/one.css", "./dist/index.d.ts", "./dist/index.js"]);

  const contextual = await inspectPackedExports(root, {
    name: "@example/pkg",
    exports: {
      ".": "./dist/index.js",
      "./client": "./dist/client.js",
      "./proxy": "./dist/proxy.js",
      "./server": "./dist/server.js",
    },
    foundryReleaseVerification: { next: {
      clientSubpaths: ["./client"],
      serverSubpaths: ["./server"],
      proxySubpaths: ["./proxy"],
    } },
  });
  assert.deepEqual(contextual.rawRuntimeSpecifiers, ["@example/pkg"]);
  assert.deepEqual(contextual.nextContexts, {
    client: ["@example/pkg/client"],
    server: ["@example/pkg/server"],
    proxy: ["@example/pkg/proxy"],
    all: ["@example/pkg/client", "@example/pkg/proxy", "@example/pkg/server"],
  });
  assert.deepEqual([...contextual.rawRuntimeSpecifiers, ...contextual.nextContexts.all].sort(), contextual.runtimeSpecifiers);
  await assert.rejects(() => inspectPackedExports(root, {
    name: "@example/pkg",
    exports: { "./client": "./dist/client.js" },
    foundryReleaseVerification: { next: { clientSubpaths: ["./client"], serverSubpaths: ["./client"] } },
  }), /duplicates/);
  await assert.rejects(() => inspectPackedExports(root, {
    name: "@example/pkg",
    exports: { "./client": "./dist/client.js" },
    foundryReleaseVerification: { next: { clientSubpaths: ["./missing"] } },
  }), /undeclared runtime export/);
  await assert.rejects(() => inspectPackedExports(root, {
    name: "@example/pkg",
    exports: { "./client": "./dist/client.js" },
    foundryReleaseVerification: { next: { clientSubpaths: ["./client"], edgeSubpaths: [] } },
  }), /unsupported context row/);
});

test("inspectPackedExports rejects escaping, missing, empty-wildcard, and symlinked-out targets", async (t) => {
  const root = await fixture(t);
  const outside = await fixture(t);
  await writeFile(join(outside, "outside.js"), "export {};\n");
  await symlink(join(outside, "outside.js"), join(root, "linked.js"));
  await mkdir(join(root, "node_modules", "dependency"), { recursive: true });
  await writeFile(join(root, "node_modules", "dependency", "index.js"), "export {};\n");
  await assert.rejects(() => inspectPackedExports(root, { name: "@example/pkg", exports: { ".": "../outside.js" } }), /not package-relative|escapes/);
  await assert.rejects(() => inspectPackedExports(root, { name: "@example/pkg", exports: { ".": "./missing.js" } }), /does not resolve/);
  await assert.rejects(() => inspectPackedExports(root, { name: "@example/pkg", exports: { "./empty/*": "./empty/*" } }), /resolves no files/);
  await assert.rejects(() => inspectPackedExports(root, { name: "@example/pkg", exports: { ".": "./linked.js" } }), /outside the installed package/);
  await assert.rejects(() => inspectPackedExports(root, { name: "@example/pkg", exports: { ".": "./node_modules/dependency/index.js" } }), /installed dependency/);
});

test("installed identity must match the packed tuple and select the exact local tarball", () => {
  const input = {
    packedManifest: { name: "@example/pkg", version: "1.2.3" },
    installedManifest: { name: "@example/pkg", version: "1.2.3" },
    dependencySpec: "file:../pkg.tgz",
    consumer: "/tmp/consumer",
    tarball: "/tmp/pkg.tgz",
  };
  assert.deepEqual(installedIdentityFindings(input), []);
  assert.match(installedIdentityFindings({ ...input, installedManifest: { name: "@example/pkg", version: "9.9.9" } })[0], /installed identity/);
  assert.match(installedIdentityFindings({ ...input, dependencySpec: "1.2.3" })[0], /exact local tarball/);
  assert.match(installedIdentityFindings({ ...input, dependencySpec: "file:../other.tgz" })[0], /different local tarball/);
});

test("optional-peer policy is closed in both directions against packed metadata", () => {
  const packages = [{ manifest: {
    name: "@example/pkg",
    exports: { ".": { import: "./dist/index.js" } },
    peerDependenciesMeta: { react: { optional: true } },
  } }];
  const green = { "@example/pkg": { react: { "@example/pkg": "imports" } } };
  assert.deepEqual(validateOptionalPeerPolicy(packages, green), []);
  assert.deepEqual(validateOptionalPeerPolicy(packages, { "@example/pkg": {} }), ["@example/pkg optional peer react has no omission row"]);
  assert.ok(validateOptionalPeerPolicy(packages, { "@example/pkg": { react: {}, stale: {} } }).some((finding) => finding.includes("stale")));
  assert.deepEqual(validateOptionalPeerPolicy([], green), ["@example/pkg omission policy is stale"]);
});

test("the repository omission matrix is closed against every current publishable manifest", async () => {
  const packages = await discoverPublishablePackages(process.cwd());
  assert.equal(packages.length, 19);
  assert.deepEqual(validateOptionalPeerPolicy(packages, OPTIONAL_PEER_POLICY), []);
});

test("installedPackageRoots finds nested copies so a transitive peer cannot produce a false green", async (t) => {
  const root = await fixture(t);
  const top = join(root, "node_modules", "react");
  const nested = join(root, "node_modules", "consumer", "node_modules", "react");
  await mkdir(top, { recursive: true });
  await mkdir(nested, { recursive: true });
  await writeFile(join(top, "package.json"), '{"name":"react","version":"1.0.0"}');
  await writeFile(join(root, "node_modules", "consumer", "package.json"), '{"name":"consumer","version":"1.0.0"}');
  await writeFile(join(nested, "package.json"), '{"name":"react","version":"2.0.0"}');
  assert.deepEqual((await installedPackageRoots(join(root, "node_modules"), "react")).sort(), [nested, top].sort());
});

test("bounded execution distinguishes a reached nonzero bin from a timeout", async () => {
  const reached = await runProcess(process.execPath, ["--eval", "process.exit(3)"]);
  assert.equal(reached.exitCode, 3);
  assert.equal(reached.timedOut, false);
  assert.equal(reached.launchError, undefined);
  const timedOut = await runProcess(process.execPath, ["--eval", "setInterval(() => {}, 1000)"], { timeout: 20 });
  assert.equal(timedOut.timedOut, true);
});
