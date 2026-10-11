import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  BY_DESIGN_REFUSALS,
  MIN_REFUSAL_MARKER_LENGTH,
  OPTIONAL_PEER_POLICY,
  byDesignRefusalFinding,
  credentiallessEnv,
  discoverPublishablePackages,
  inspectPackedExports,
  installedIdentityFindings,
  installedPackageRoots,
  importSpecifier,
  judgeRuntimeImport,
  omissionRowDrifted,
  parsePackedConsumerArgs,
  probeInstalledBin,
  runPackedConsumerReadiness,
  runProcess,
  unmeasuredRefusalFindings,
  validateByDesignRefusals,
  validateOptionalPeerPolicy,
} from "./packed-consumer-readiness.mjs";

// os.tmpdir() on macOS resolves under /var/folders, which is itself a
// symlink to /private/var/folders. Node always realpaths the main ESM
// module for import.meta.url, so a fixture root built from the raw
// mkdtemp() result makes even a plain, non-symlinked direct invocation
// look like it went through a symlink. Canonicalizing the root right after
// mkdtemp keeps that distinction meaningful for what these tests actually
// probe: a deliberately introduced node_modules/.bin symlink, not an
// incidental ancestor symlink in $TMPDIR.
async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "packed-consumer-test-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("credentiallessEnv removes credentials and every case variant of ambient npm configuration", () => {
  const env = credentiallessEnv({
    PATH: "/bin",
    NODE_AUTH_TOKEN: "sensitive",
    GH_PACKAGES_TOKEN: "sensitive",
    npm_config_userconfig: "/ambient",
    NPM_CONFIG_USERCONFIG: "/ambient-override",
    NpM_CoNfIg_ReGiStRy: "https://example.invalid/",
  }, "/clean/npmrc", "/clean/cache", "/clean/global-npmrc");
  assert.equal(env.PATH, "/bin");
  assert.equal(env.NODE_AUTH_TOKEN, undefined);
  assert.equal(env.GH_PACKAGES_TOKEN, undefined);
  assert.equal(env.npm_config_userconfig, "/clean/npmrc");
  assert.equal(env.npm_config_globalconfig, "/clean/global-npmrc");
  assert.equal(env.npm_config_cache, "/clean/cache");
  assert.equal(env.npm_config_ignore_scripts, "true");
  assert.equal(env.npm_config_always_auth, "false");
  assert.deepEqual(Object.keys(env).filter((key) => /^npm_config_/i.test(key)).sort(), [
    "npm_config_always_auth",
    "npm_config_audit",
    "npm_config_cache",
    "npm_config_fund",
    "npm_config_globalconfig",
    "npm_config_ignore_scripts",
    "npm_config_registry",
    "npm_config_userconfig",
  ]);
});

test("real npm cannot normalize later uppercase overrides back into the credentialless config", async (t) => {
  const root = await fixture(t);
  const npmrc = join(root, "isolated.npmrc");
  const globalNpmrc = join(root, "isolated-global.npmrc");
  const hostileNpmrc = join(root, "ambient.npmrc");
  const hostileGlobalNpmrc = join(root, "ambient-global.npmrc");
  const cache = join(root, "cache");
  await mkdir(cache);
  await writeFile(npmrc, "registry=https://registry.npmjs.org/\n");
  await writeFile(globalNpmrc, "");
  await writeFile(hostileNpmrc, "registry=https://example.invalid/user/\n");
  await writeFile(hostileGlobalNpmrc, "registry=https://example.invalid/global/\n");

  const env = credentiallessEnv({
    PATH: process.env.PATH,
    npm_config_registry: "https://registry.npmjs.org/",
    npm_config_userconfig: npmrc,
    npm_config_globalconfig: globalNpmrc,
    NPM_CONFIG_REGISTRY: "https://example.invalid/override/",
    NPM_CONFIG_USERCONFIG: hostileNpmrc,
    NPM_CONFIG_GLOBALCONFIG: hostileGlobalNpmrc,
  }, npmrc, cache, globalNpmrc);

  for (const [key, expected] of [
    ["registry", "https://registry.npmjs.org/"],
    ["userconfig", npmrc],
    ["globalconfig", globalNpmrc],
  ]) {
    const result = await runProcess("npm", ["config", "get", key], { cwd: root, env });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout.trim(), expected);
  }
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
  assert.deepEqual(result.runtimeTargets, [{ specifier: "@example/pkg", condition: "default" }]);
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
  const conditional = await inspectPackedExports(root, {
    name: "@example/pkg",
    exports: {
      "./web": { "react-server": "./dist/server.js", import: "./dist/index.js" },
    },
  });
  assert.deepEqual(conditional.runtimeTargets, [
    { specifier: "@example/pkg/web", condition: "default" },
    { specifier: "@example/pkg/web", condition: "react-server" },
  ]);
  assert.deepEqual(conditional.rawRuntimeTargets, conditional.runtimeTargets);
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

  const conditional = [{ manifest: {
    name: "@example/conditional",
    exports: { "./web": { "react-server": "./dist/server.js", import: "./dist/web.js" } },
    peerDependenciesMeta: { react: { optional: true } },
  } }];
  const conditionAware = { "@example/conditional": { react: {
    "@example/conditional/web": { default: "imports", "react-server": "rejects" },
  } } };
  assert.deepEqual(validateOptionalPeerPolicy(conditional, conditionAware), []);
  assert.ok(validateOptionalPeerPolicy(conditional, { "@example/conditional": { react: {
    "@example/conditional/web": { default: "imports" },
  } } }).some((finding) => finding.includes("incomplete or stale condition outcomes")));
  assert.ok(validateOptionalPeerPolicy(conditional, { "@example/conditional": { react: {
    "@example/conditional/web": { default: "imports", "react-server": "imports", browser: "imports" },
  } } }).some((finding) => finding.includes("incomplete or stale condition outcomes")));

  // #533: a bare outcome string is one claim covering every condition the
  // export declares, so it is a shorthand only when `default` is the only
  // one. `react-server` resolves a DIFFERENT file, and this branch used to
  // return before the exact-coverage check below it — the one way a
  // condition-bearing export could opt out of being measured per condition.
  // The frozen aggregate plan carried a private copy of this rule against the
  // source tree; here it runs against the manifest each caller measured.
  for (const collapsed of ["imports", "rejects"]) {
    assert.ok(validateOptionalPeerPolicy(conditional, { "@example/conditional": { react: {
      "@example/conditional/web": collapsed,
    } } }).some((finding) => finding === "@example/conditional omission row react @example/conditional/web collapses its default/react-server outcomes into one string"));
  }
  // ...and stays a shorthand where there is genuinely one condition.
  assert.deepEqual(validateOptionalPeerPolicy(packages, green), []);
  assert.ok(validateOptionalPeerPolicy(packages, { "@example/pkg": { react: { "@example/pkg": "sometimes" } } })
    .some((finding) => finding.includes("has invalid outcome")));
});

// #533/#949: adding an export subpath to a package with an optional peer must
// land here — a mutable record that describes today's source — rather than in
// the frozen aggregate canary plan, which measures already-published tarballs
// and cannot be edited at all. The finding a new subpath raises has to be
// clearable by editing the policy, or the gate is a constraint on package
// design rather than a check.
test("a new export subpath is a clearable optional-peer policy finding, not an unclearable one", () => {
  const manifest = (exports) => ({
    name: "@example/pkg",
    version: "1.0.0",
    exports,
    peerDependenciesMeta: { react: { optional: true } },
  });
  const before = [{ manifest: manifest({ ".": { import: "./dist/index.js" } }) }];
  const after = [{ manifest: manifest({ ".": { import: "./dist/index.js" }, "./added": { import: "./dist/added.js" } }) }];
  const policy = { "@example/pkg": { react: { "@example/pkg": "imports" } } };

  assert.deepEqual(validateOptionalPeerPolicy(before, policy), []);
  assert.deepEqual(validateOptionalPeerPolicy(after, policy), ["@example/pkg omission row react misses @example/pkg/added"]);
  policy["@example/pkg"].react["@example/pkg/added"] = "imports";
  assert.deepEqual(validateOptionalPeerPolicy(after, policy), []);
});

test("the repository omission matrix is closed against every current publishable manifest", async () => {
  const packages = await discoverPublishablePackages(process.cwd());
  // The count this asserted (issue #1504) tracked packages/ and had to be
  // bumped on every new package, but a count alone is not what closes the
  // gap: validateOptionalPeerPolicy's stale-policy-row direction only fires
  // for a package OPTIONAL_PEER_POLICY still names, and most publishable
  // packages have no row there at all (issue #1504 review). A
  // discoverPublishablePackages bug that silently drops one of THOSE
  // uncovered packages would produce zero findings below either. So the
  // expected name set is read independently here -- every packages/*
  // directory with a package.json whose "private" is not true, parsed
  // straight off disk rather than through discoverPublishablePackages --
  // and checked against what discovery actually returned.
  const packagesDir = join(process.cwd(), "packages");
  const expectedNames = [];
  for (const entry of await readdir(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    let manifest;
    try {
      manifest = JSON.parse(await readFile(join(packagesDir, entry.name, "package.json"), "utf8"));
    } catch {
      continue;
    }
    if (manifest.private !== true) expectedNames.push(manifest.name);
  }
  assert.deepEqual(packages.map((entry) => entry.manifest.name).sort(), expectedNames.sort());
  assert.deepEqual(validateOptionalPeerPolicy(packages, OPTIONAL_PEER_POLICY), []);
  assert.deepEqual(validateByDesignRefusals(packages, BY_DESIGN_REFUSALS), []);
  assert.deepEqual(validateOptionalPeerPolicy(packages, OPTIONAL_PEER_POLICY, { refusals: BY_DESIGN_REFUSALS }), []);
});

test("Publisher's optional-peer matrix binds both default and react-server web outcomes", () => {
  const publisherExports = [
    "@clossys/publisher/assessment",
    "@clossys/publisher/core",
    "@clossys/publisher/document",
    "@clossys/publisher/email",
    "@clossys/publisher/image",
    "@clossys/publisher/materials",
    "@clossys/publisher/media",
    "@clossys/publisher/pack",
    "@clossys/publisher/print",
    "@clossys/publisher/record",
    "@clossys/publisher/slides",
    "@clossys/publisher/surfaces",
    "@clossys/publisher/templates",
    "@clossys/publisher/testing",
    "@clossys/publisher/web",
    "@clossys/publisher/web/client",
  ];
  const expected = (rejected = [], web = { default: "imports", "react-server": "imports" }, client = "imports") => ({
    ...Object.fromEntries(
    publisherExports.map((specifier) => [specifier, rejected.includes(specifier) ? "rejects" : "imports"]),
    ),
    "@clossys/publisher/web": web,
    "@clossys/publisher/web/client": client,
  });
  const rows = OPTIONAL_PEER_POLICY["@clossys/publisher"];

  assert.deepEqual(rows["@internationalized/date"], expected([], { default: "rejects", "react-server": "imports" }, "rejects"));
  assert.deepEqual(rows.react, expected(["@clossys/publisher/document", "@clossys/publisher/testing"], { default: "rejects", "react-server": "rejects" }, "rejects"));
  assert.deepEqual(rows["react-aria-components"], expected([], { default: "rejects", "react-server": "imports" }, "rejects"));
  assert.deepEqual(rows["react-dom"], expected(["@clossys/publisher/testing"], { default: "rejects", "react-server": "imports" }, "rejects"));
  assert.deepEqual(rows["tailwind-merge"], expected([], { default: "imports", "react-server": "imports" }));
  assert.deepEqual(rows.tailwindcss, expected());
});

test("condition-aware optional-peer execution launches both default and react-server imports", async (t) => {
  const root = await fixture(t);
  const packageRoot = join(root, "node_modules", "@example", "conditional");
  await mkdir(join(packageRoot, "dist"), { recursive: true });
  await writeFile(join(root, "package.json"), '{"type":"module"}\n');
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({
    name: "@example/conditional",
    type: "module",
    exports: { "./web": { "react-server": "./dist/server.js", import: "./dist/default.js" } },
  }));
  await writeFile(join(packageRoot, "dist", "default.js"), 'throw new Error("default omission");\n');
  await writeFile(join(packageRoot, "dist", "server.js"), 'export const condition = "react-server";\n');

  const defaultResult = await importSpecifier("@example/conditional/web", root, process.env);
  const serverResult = await importSpecifier("@example/conditional/web", root, process.env, "react-server");
  assert.equal(defaultResult.exitCode, 1);
  assert.match(defaultResult.stderr, /default omission/);
  assert.equal(serverResult.exitCode, 0, serverResult.stderr);
});

// By-design refusals. One synthetic package carries the three shapes a real
// refusal takes: a client-only subpath that refuses `react-server`, a
// development-only subpath that refuses everything except `development`, and
// a server-only subpath that refuses `browser`. Every refusal module throws a
// message naming its subpath and condition, never a peer.
const REFUSALS_PACKAGE = "@example/refusals";
const CLIENT_SERVER_MARKER = 'client subpath is client-only and refuses the "react-server" condition';
const PREVIEW_SERVER_MARKER = 'preview subpath is client-only and refuses the "react-server" condition';
const PREVIEW_DEFAULT_MARKER = 'preview subpath resolves only under the "development" condition';
const COPY_BROWSER_MARKER = 'copy subpath is server-only and refuses the "browser" condition';
const refusalsExports = {
  ".": "./dist/index.js",
  "./client": { "react-server": "./dist/client/refuse-react-server.js", default: "./dist/client/index.js" },
  "./preview": {
    "react-server": "./dist/preview/refuse-react-server.js",
    development: "./dist/preview/index.js",
    default: "./dist/preview/refuse-non-development.js",
  },
  "./copy": { browser: "./dist/copy/refuse-browser.js", default: "./dist/copy/index.js" },
};
const declaredRefusals = {
  "@example/refusals/client": { "react-server": CLIENT_SERVER_MARKER },
  "@example/refusals/preview": { "react-server": PREVIEW_SERVER_MARKER, default: PREVIEW_DEFAULT_MARKER },
  "@example/refusals/copy": { browser: COPY_BROWSER_MARKER },
};
const refusalsManifest = {
  name: REFUSALS_PACKAGE,
  version: "1.0.0",
  type: "module",
  exports: refusalsExports,
  peerDependenciesMeta: { "absent-peer": { optional: true } },
};
const throwing = (marker) => `throw new Error(${JSON.stringify(`${REFUSALS_PACKAGE}: the ${marker}.`)});\nexport {};\n`;

async function refusalsConsumer(t, extraFiles = {}) {
  const root = await fixture(t);
  const packageRoot = join(root, "node_modules", "@example", "refusals");
  const peerRoot = join(root, "node_modules", "absent-peer");
  await writeFile(join(root, "package.json"), '{"type":"module"}\n');
  await mkdir(peerRoot, { recursive: true });
  await writeFile(join(peerRoot, "package.json"), '{"name":"absent-peer","version":"1.0.0","type":"module","exports":"./index.js"}\n');
  await writeFile(join(peerRoot, "index.js"), "export const peer = true;\n");
  const files = {
    "index.js": "export const root = true;\n",
    "client/index.js": 'import "absent-peer";\nexport const client = true;\n',
    "client/refuse-react-server.js": throwing(CLIENT_SERVER_MARKER),
    "preview/index.js": "export const preview = true;\n",
    "preview/refuse-react-server.js": throwing(PREVIEW_SERVER_MARKER),
    "preview/refuse-non-development.js": throwing(PREVIEW_DEFAULT_MARKER),
    "copy/index.js": "export const copy = true;\n",
    "copy/refuse-browser.js": throwing(COPY_BROWSER_MARKER),
    ...extraFiles,
  };
  for (const [name, source] of Object.entries(files)) {
    await mkdir(dirname(join(packageRoot, "dist", name)), { recursive: true });
    await writeFile(join(packageRoot, "dist", name), source);
  }
  await writeFile(join(packageRoot, "package.json"), JSON.stringify(refusalsManifest));
  return { root, packageRoot, peerRoot };
}

const judgeAll = async (shape, consumer, refusals, peer) => {
  const outcomes = {};
  for (const target of shape.rawRuntimeTargets) {
    outcomes[`${target.condition} ${target.specifier}`] = await judgeRuntimeImport({
      packageName: REFUSALS_PACKAGE,
      ...target,
      marker: refusals[target.specifier]?.[target.condition],
      peer,
      consumer,
      env: process.env,
    });
  }
  return outcomes;
};

test("a declared refusal is measured per condition and must throw its marker with or without the omitted peer", async (t) => {
  const { root, packageRoot, peerRoot } = await refusalsConsumer(t);

  // Undeclared, `development` and `browser` still fold into `default`, as before.
  const folded = await inspectPackedExports(packageRoot, refusalsManifest);
  assert.deepEqual(folded.runtimeTargets.map((item) => `${item.condition} ${item.specifier}`), [
    "default @example/refusals",
    "default @example/refusals/client",
    "react-server @example/refusals/client",
    "default @example/refusals/copy",
    "default @example/refusals/preview",
    "react-server @example/refusals/preview",
  ]);

  // Declared, each of the specifier's conditions is its own measured target.
  const shape = await inspectPackedExports(packageRoot, refusalsManifest, declaredRefusals);
  assert.deepEqual(unmeasuredRefusalFindings(REFUSALS_PACKAGE, shape, declaredRefusals), []);
  const expected = (clientDefault) => ({
    "default @example/refusals": "imports",
    "default @example/refusals/client": clientDefault,
    "react-server @example/refusals/client": "refuses",
    "browser @example/refusals/copy": "refuses",
    "default @example/refusals/copy": "imports",
    "default @example/refusals/preview": "refuses",
    "development @example/refusals/preview": "imports",
    "react-server @example/refusals/preview": "refuses",
  });
  assert.deepEqual(await judgeAll(shape, root, declaredRefusals), expected("imports"));

  // The omission run: an undeclared target may reject by naming the peer; a
  // declared refusal still throws exactly its marker and is recorded `refuses`.
  await rm(peerRoot, { recursive: true, force: true });
  assert.deepEqual(await judgeAll(shape, root, declaredRefusals, "absent-peer"), expected("rejects"));
});

test("an undeclared refusal is still a finding in both runs", async (t) => {
  const { root } = await refusalsConsumer(t);
  const target = { packageName: REFUSALS_PACKAGE, specifier: "@example/refusals/client", condition: "react-server", consumer: root, env: process.env };
  await assert.rejects(() => judgeRuntimeImport(target), /react-server @example\/refusals\/client runtime import failed: .*refuses the "react-server" condition/s);
  await assert.rejects(() => judgeRuntimeImport({ ...target, peer: "absent-peer" }), /omission row absent-peer makes react-server @example\/refusals\/client fail without naming the omitted peer/);
});

test("a declared refusal that imports, or throws anything but its marker, is a finding", async (t) => {
  const { root } = await refusalsConsumer(t, {
    "client/refuse-react-server.js": `console.error(${JSON.stringify(CLIENT_SERVER_MARKER)});\nnull.crash;\n`,
    "copy/refuse-browser.js": 'import "absent-peer/missing-entry";\nexport {};\n',
    // Breakage that is not a module error: a refusal module that reads a
    // file the package never shipped. The ENOENT message carries the file's
    // path, which here contains the condition name.
    "preview/refuse-non-development.js": 'import { readFileSync } from "node:fs";\nreadFileSync(new URL("./browser-refusal-messages.json", import.meta.url));\nexport {};\n',
  });
  const judge = (specifier, condition, marker, peer) => judgeRuntimeImport({ packageName: REFUSALS_PACKAGE, specifier, condition, marker, peer, consumer: root, env: process.env });
  for (const peer of [undefined, "absent-peer"]) {
    // Stale: the declared target imports.
    await assert.rejects(() => judge("@example/refusals", "default", "anything", peer), /declared by-design refusal imports although it is declared to refuse by design/);
    // Wrong marker: a real refusal, but another condition's.
    await assert.rejects(() => judge("@example/refusals/preview", "react-server", PREVIEW_DEFAULT_MARKER, peer), /declared by-design refusal threw a different error than its declared refusal/);
    // A crash that prints the marker before throwing a TypeError.
    await assert.rejects(() => judge("@example/refusals/client", "react-server", CLIENT_SERVER_MARKER, peer), /threw a different error than its declared refusal: .*null/);
  }
  // A Node module error whose own message quotes the marker (here, the
  // refusing module's own path) is breakage, not the declared refusal.
  await assert.rejects(() => judge("@example/refusals/copy", "browser", "dist/copy/refuse-browser", undefined), /failed with error code ERR_[A-Z_]+, which is breakage, not its declared refusal: .*dist\/copy\/refuse-browser/);
  // Any coded error is breakage, not only a Node module error: an ENOENT
  // whose path quotes the marker does not pass for the declared refusal.
  await assert.rejects(() => judge("@example/refusals/preview", "default", "dist/preview/browser-refusal-messages", undefined), /failed with error code ENOENT, which is breakage, not its declared refusal: .*browser-refusal-messages\.json/);
});

test("a refusal report is read only from the probe's own final line on its own exit path", async (t) => {
  const marker = PREVIEW_DEFAULT_MARKER;
  const report = `foundry-by-design-refusal:${JSON.stringify({ code: null, message: `the ${marker}.` })}`;
  const reached = { exitCode: 86, signal: null, stdout: "", stderr: `\n${report}\n`, timedOut: false };
  assert.equal(byDesignRefusalFinding(reached, marker), null);
  assert.match(byDesignRefusalFinding({ ...reached, exitCode: null, timedOut: true }, marker), /timed out/);
  assert.match(byDesignRefusalFinding({ ...reached, exitCode: null, launchError: "spawn failed" }, marker), /could not be launched/);
  assert.match(byDesignRefusalFinding({ ...reached, exitCode: 1 }, marker), /ended with exit 1 before throwing at import/);
  assert.match(byDesignRefusalFinding({ ...reached, exitCode: null, signal: "SIGKILL" }, marker), /signal SIGKILL/);
  assert.match(byDesignRefusalFinding({ ...reached, stderr: `${report}\nlater output\n` }, marker), /without a readable refusal report/);
  assert.match(byDesignRefusalFinding({ ...reached, stdout: report, stderr: marker }, marker), /without a readable refusal report/);
  assert.match(byDesignRefusalFinding({ ...reached, stderr: report.replace('"code":null', '"code":"MODULE_NOT_FOUND"') }, marker), /error code MODULE_NOT_FOUND, which is breakage/);
  assert.match(byDesignRefusalFinding({ ...reached, stderr: report.replace('"code":null', '"code":"ENOENT"') }, marker), /error code ENOENT, which is breakage/);

  // Real processes: a module that prints a forged report and then hangs, or
  // exits on its own, never reaches the probe's own exit path.
  const root = await fixture(t);
  const packageRoot = join(root, "node_modules", "@example", "forged");
  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(root, "package.json"), '{"type":"module"}\n');
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name: "@example/forged", type: "module", exports: { "./hang": "./hang.js", "./exit": "./exit.js" } }));
  const forge = `import { writeSync } from "node:fs";\nwriteSync(2, ${JSON.stringify(`\n${report}\n`)});\n`;
  await writeFile(join(packageRoot, "hang.js"), `${forge}setInterval(() => {}, 1000);\nawait new Promise(() => {});\n`);
  await writeFile(join(packageRoot, "exit.js"), `${forge}process.exit(1);\n`);
  const judge = (specifier, timeout) => judgeRuntimeImport({ packageName: "@example/forged", specifier, condition: "default", marker, consumer: root, env: process.env, timeout });
  // Only the hang case is bounded short, since it can only end by timing out;
  // the exit case keeps the default bound so a slow machine cannot turn it
  // into a timeout.
  await assert.rejects(() => judge("@example/forged/hang", 500), /declared by-design refusal timed out/);
  await assert.rejects(() => judge("@example/forged/exit"), /declared by-design refusal ended with exit 1/);
});

test("by-design refusal declarations are closed against the manifest", () => {
  const packages = [{ manifest: refusalsManifest }];
  assert.deepEqual(validateByDesignRefusals(packages, { [REFUSALS_PACKAGE]: declaredRefusals }), []);
  const findings = (declared, options) => validateByDesignRefusals(packages, declared, options);
  assert.deepEqual(findings({ "@example/gone": {} }), ["@example/gone by-design refusals are stale"]);
  assert.deepEqual(findings({ "@example/gone": {} }, { allowUnselected: true }), []);
  assert.deepEqual(findings({ [REFUSALS_PACKAGE]: { "@example/refusals/removed": { default: "removed subpath refuses every condition" } } }), [
    "@example/refusals by-design refusal @example/refusals/removed default is stale: the manifest exports no default runtime target for it",
  ]);
  assert.deepEqual(findings({ [REFUSALS_PACKAGE]: { "@example/refusals/client": { browser: 'refuses the "browser" condition' } } }), [
    "@example/refusals by-design refusal @example/refusals/client browser is stale: the manifest exports no browser runtime target for it",
  ]);
  assert.deepEqual(findings({ [REFUSALS_PACKAGE]: { "@example/refusals/client": { worker: 'refuses the "worker" condition' } } }), [
    "@example/refusals by-design refusal @example/refusals/client names unsupported condition worker",
  ]);
  assert.deepEqual(findings({ [REFUSALS_PACKAGE]: { "@example/refusals/client": { "react-server": " " } } }), [
    "@example/refusals by-design refusal @example/refusals/client react-server needs a non-empty refusal marker",
  ]);
  assert.deepEqual(findings({ [REFUSALS_PACKAGE]: { "@example/refusals/client": { "react-server": "client subpath is client-only" } } }), [
    "@example/refusals by-design refusal @example/refusals/client react-server marker must name the react-server condition",
  ]);
  // A marker that is only the condition name, or any other short fragment,
  // could match a path or a stray word rather than a refusal message.
  assert.equal(MIN_REFUSAL_MARKER_LENGTH, 16);
  for (const marker of ["react-server", ' "react-server" ', "refuses r-server"]) {
    const expected = marker.trim().length < MIN_REFUSAL_MARKER_LENGTH
      ? ["@example/refusals by-design refusal @example/refusals/client react-server marker is shorter than 16 characters and cannot identify a refusal message"]
      : ["@example/refusals by-design refusal @example/refusals/client react-server marker must name the react-server condition"];
    assert.deepEqual(findings({ [REFUSALS_PACKAGE]: { "@example/refusals/client": { "react-server": marker } } }), expected);
  }
  assert.deepEqual(findings({ [REFUSALS_PACKAGE]: { "@example/refusals/preview": { default: "development only" } } }), []);
  assert.deepEqual(findings({ [REFUSALS_PACKAGE]: { "@example/refusals/preview": { default: "dev-only subpath" } } }), []);
  assert.deepEqual(findings({ [REFUSALS_PACKAGE]: { "@example/refusals/preview": { default: "dev-only subpat" } } }), [
    "@example/refusals by-design refusal @example/refusals/preview default marker is shorter than 16 characters and cannot identify a refusal message",
  ]);
  assert.deepEqual(findings({ [REFUSALS_PACKAGE]: { "@example/refusals/client": {} } }), [
    "@example/refusals by-design refusal @example/refusals/client must map at least one condition to a refusal marker",
  ]);
  // A declaration the packed shape never imports (a Next-context or wildcard
  // subpath) cannot stand in for a measurement either.
  assert.deepEqual(unmeasuredRefusalFindings(REFUSALS_PACKAGE, { rawRuntimeTargets: [] }, { "@example/refusals/client": { "react-server": CLIENT_SERVER_MARKER } }), [
    "@example/refusals by-design refusal @example/refusals/client react-server is never measured as a raw runtime import",
  ]);
});

test("the packed-consumer run applies declarations to the packed tarball's own imports", async (t) => {
  // A real pack, install and peer-omission run of the synthetic package, so
  // the run itself is shown consuming the declarations, not only the helpers
  // above. It stays offline: the run installs each optional peer as
  // `<name>@<version>` read from the root's own node_modules, and this
  // fixture's root copy records a `file:` tarball spec as that version, so npm
  // installs the peer from disk instead of the registry.
  const root = await fixture(t);
  const peerSource = join(root, "peer-source");
  await mkdir(peerSource);
  await writeFile(join(peerSource, "package.json"), '{"name":"absent-peer","version":"1.0.0","type":"module","exports":"./index.js"}\n');
  await writeFile(join(peerSource, "index.js"), "export const peer = true;\n");
  const peerPack = await runProcess("npm", ["pack", "--ignore-scripts", "--pack-destination", root], { cwd: peerSource, timeout: 60_000 });
  assert.equal(peerPack.exitCode, 0, peerPack.stderr);
  await mkdir(join(root, "node_modules", "absent-peer"), { recursive: true });
  await writeFile(join(root, "node_modules", "absent-peer", "package.json"), JSON.stringify({ name: "absent-peer", version: `file:${join(root, "absent-peer-1.0.0.tgz")}` }));

  const packageRoot = join(root, "packages", "refusals");
  const manifest = { ...refusalsManifest, files: ["dist"], peerDependencies: { "absent-peer": "^1.0.0" } };
  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(packageRoot, "package.json"), JSON.stringify(manifest));
  for (const [name, source] of Object.entries({
    "index.js": "export const root = true;\n",
    "client/index.js": 'import "absent-peer";\nexport const client = true;\n',
    "client/refuse-react-server.js": throwing(CLIENT_SERVER_MARKER),
    "preview/index.js": "export const preview = true;\n",
    "preview/refuse-react-server.js": throwing(PREVIEW_SERVER_MARKER),
    "preview/refuse-non-development.js": throwing(PREVIEW_DEFAULT_MARKER),
    "copy/index.js": "export const copy = true;\n",
    "copy/refuse-browser.js": throwing(COPY_BROWSER_MARKER),
  })) {
    await mkdir(dirname(join(packageRoot, "dist", name)), { recursive: true });
    await writeFile(join(packageRoot, "dist", name), source);
  }
  // The row is written out of sorted order on purpose: key order is not part
  // of an omission row, so the drift check must not depend on it.
  const policy = { [REFUSALS_PACKAGE]: { "absent-peer": {
    "@example/refusals/preview": { "react-server": "refuses", development: "imports", default: "refuses" },
    "@example/refusals/client": { "react-server": "refuses", default: "rejects" },
    "@example/refusals": "imports",
    "@example/refusals/copy": { default: "imports", browser: "refuses" },
  } } };
  const run = (refusals) => runPackedConsumerReadiness({ root, skipBuild: true, policy, refusals });

  const result = await run({ [REFUSALS_PACKAGE]: declaredRefusals });
  assert.equal(result.runtimeImports, 8);
  assert.equal(result.omissionRows, 1);
  // A declaration finding is reported as a refusal closure failure, not as
  // an optional-peer policy one.
  await assert.rejects(() => run({ [REFUSALS_PACKAGE]: { ...declaredRefusals, "@example/refusals/removed": { default: "removed subpath refuses every condition" } } }), (error) => {
    assert.match(error.message, /^by-design refusals are not closed:\n- .*removed default is stale/);
    assert.doesNotMatch(error.message, /optional-peer policy/);
    return true;
  });
  // Without the declarations the `refuses` cells are refused before anything
  // is imported; and with a row closed the old way (refusals as `rejects`,
  // `development` and `browser` folded) the refusal modules fail the
  // every-target-imports rule, exactly as an undeclared refusal always has.
  await assert.rejects(() => run({}), /^Error: optional-peer policy is not closed:\n- .*records refuses for react-server, which declares no refusal by design/s);
  const folded = { [REFUSALS_PACKAGE]: { "absent-peer": {
    "@example/refusals": "imports",
    "@example/refusals/client": { default: "rejects", "react-server": "rejects" },
    "@example/refusals/copy": "imports",
    "@example/refusals/preview": { default: "rejects", "react-server": "rejects" },
  } } };
  await assert.rejects(() => runPackedConsumerReadiness({ root, skipBuild: true, policy: folded, refusals: {} }), /runtime import failed/);
});

test("the packed-consumer run refuses a declaration on a Next-context or wildcard subpath", async (t) => {
  // Neither is ever imported as a raw runtime target: a Next-context subpath
  // is evaluated through its framework contexts, and a wildcard key is not a
  // literal export. A declaration on either must fail the run rather than
  // stand in for a measurement.
  const root = await fixture(t);
  const packageRoot = join(root, "packages", "next-refusal");
  const marker = 'client subpath is client-only and refuses the "react-server" condition';
  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({
    name: "@example/next-refusal",
    version: "1.0.0",
    type: "module",
    files: ["dist"],
    exports: {
      "./client": { "react-server": "./dist/client/refuse-react-server.js", default: "./dist/client/index.js" },
      "./items/*": "./dist/items/*.js",
    },
    foundryReleaseVerification: { next: { clientSubpaths: ["./client"] } },
  }));
  for (const [name, source] of Object.entries({
    "client/index.js": "export const client = true;\n",
    "client/refuse-react-server.js": `throw new Error(${JSON.stringify(marker)});\nexport {};\n`,
    "items/a.js": "export const a = true;\n",
  })) {
    await mkdir(dirname(join(packageRoot, "dist", name)), { recursive: true });
    await writeFile(join(packageRoot, "dist", name), source);
  }
  const run = (declared) => runPackedConsumerReadiness({ root, skipBuild: true, policy: {}, refusals: { "@example/next-refusal": declared } });
  await assert.rejects(() => run({ "@example/next-refusal/client": { "react-server": marker } }),
    /^Error: by-design refusals are not closed:\n- @example\/next-refusal by-design refusal @example\/next-refusal\/client react-server is never measured as a raw runtime import$/);
  await assert.rejects(() => run({ "@example/next-refusal/items/a": { default: "items subpath refuses every condition" } }),
    /^Error: by-design refusals are not closed:\n- @example\/next-refusal by-design refusal @example\/next-refusal\/items\/a default is stale: the manifest exports no default runtime target for it$/);
});

test("an omission row records refuses exactly where a refusal is declared", () => {
  const packages = [{ manifest: refusalsManifest }];
  const refusals = { [REFUSALS_PACKAGE]: declaredRefusals };
  const row = (overrides = {}) => ({ "@example/refusals": { "absent-peer": {
    "@example/refusals": "imports",
    "@example/refusals/client": { default: "rejects", "react-server": "refuses" },
    "@example/refusals/copy": { browser: "refuses", default: "imports" },
    "@example/refusals/preview": { default: "refuses", development: "imports", "react-server": "refuses" },
    ...overrides,
  } } });
  assert.deepEqual(validateOptionalPeerPolicy(packages, row(), { refusals }), []);
  const prefix = "@example/refusals omission row absent-peer";
  // `refuses` on an undeclared cell, or anywhere when nothing is declared.
  assert.deepEqual(validateOptionalPeerPolicy(packages, row({ "@example/refusals": "refuses" }), { refusals }), [
    `${prefix} @example/refusals records refuses for default, which declares no refusal by design`,
  ]);
  assert.deepEqual(validateOptionalPeerPolicy(packages, row({ "@example/refusals/copy": { browser: "refuses", default: "refuses" } }), { refusals }), [
    `${prefix} @example/refusals/copy records refuses for default, which declares no refusal by design`,
  ]);
  assert.ok(validateOptionalPeerPolicy(packages, row({ "@example/refusals/client": { default: "rejects", "react-server": "refuses" } }))
    .includes(`${prefix} @example/refusals/client records refuses for react-server, which declares no refusal by design`));
  // A declared cell must read `refuses`, never a peer outcome.
  assert.deepEqual(validateOptionalPeerPolicy(packages, row({ "@example/refusals/client": { default: "rejects", "react-server": "rejects" } }), { refusals }), [
    `${prefix} @example/refusals/client must record refuses for its declared react-server refusal`,
  ]);
  // A declared specifier's `development` and `browser` targets are conditions
  // the row must cover, so a row folded the old way is incomplete.
  assert.deepEqual(validateOptionalPeerPolicy(packages, row({ "@example/refusals/preview": { default: "refuses", "react-server": "refuses" } }), { refusals }), [
    `${prefix} @example/refusals/preview has incomplete or stale condition outcomes`,
    `${prefix} @example/refusals/preview has invalid development outcome`,
  ]);
  assert.deepEqual(validateOptionalPeerPolicy(packages, row({ "@example/refusals/copy": "imports" }), { refusals }), [
    `${prefix} @example/refusals/copy collapses its browser/default outcomes into one string`,
  ]);
});

test("an omission row's drift check ignores key order and nothing else", () => {
  const observed = {
    "@example/refusals": "imports",
    "@example/refusals/client": { default: "rejects", "react-server": "refuses" },
  };
  assert.equal(omissionRowDrifted(observed, {
    "@example/refusals/client": { "react-server": "refuses", default: "rejects" },
    "@example/refusals": "imports",
  }), false);
  assert.equal(omissionRowDrifted(observed, {
    "@example/refusals/client": { "react-server": "refuses", default: "imports" },
    "@example/refusals": "imports",
  }), true);
  assert.equal(omissionRowDrifted(observed, { "@example/refusals": "imports" }), true);
  assert.equal(omissionRowDrifted(observed, { ...observed, "@example/refusals/copy": "imports" }), true);
  assert.equal(omissionRowDrifted(observed, { ...observed, "@example/refusals/client": "rejects" }), true);
});

test("a nested condition on a declared specifier is measured as its outer condition alone", () => {
  // `development` nested under `react-server` is a combination node only
  // resolves with both flags set; it is measured as `react-server`, so it
  // cannot be declared as a `development` refusal of its own.
  const manifest = {
    name: "@example/nested",
    version: "1.0.0",
    type: "module",
    exports: {
      "./widget": {
        "react-server": { development: "./dist/widget/server-dev.js", default: "./dist/widget/refuse-react-server.js" },
        default: "./dist/widget/index.js",
      },
    },
  };
  const marker = 'widget subpath refuses the "react-server" condition';
  const packages = [{ manifest }];
  assert.deepEqual(validateByDesignRefusals(packages, { "@example/nested": { "@example/nested/widget": { "react-server": marker } } }), []);
  assert.deepEqual(validateByDesignRefusals(packages, { "@example/nested": { "@example/nested/widget": { development: 'widget subpath refuses the "development" condition' } } }), [
    "@example/nested by-design refusal @example/nested/widget development is stale: the manifest exports no development runtime target for it",
  ]);
  const row = (outcomes) => ({ "@example/nested": { "absent-peer": { "@example/nested/widget": outcomes } } });
  const withPeer = [{ manifest: { ...manifest, peerDependenciesMeta: { "absent-peer": { optional: true } } } }];
  const refusals = { "@example/nested": { "@example/nested/widget": { "react-server": marker } } };
  assert.deepEqual(validateOptionalPeerPolicy(withPeer, row({ default: "imports", "react-server": "refuses" }), { refusals }), []);
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
  const unavailable = await runProcess("foundry-command-that-does-not-exist", []);
  assert.equal(unavailable.exitCode, null);
  assert.ok(unavailable.launchError);
});

test("installed-bin probe fails a detectMainModule guard that does not realpath argv[1]", async (t) => {
  // The #909 class: `import.meta.url` is always a realpath, so comparing it to
  // `resolve(argv[1])` without `realpathSync` treats a `node_modules/.bin`
  // symlink as "not the main module" and exits 0 with empty output. Launching
  // the realpath target cannot see that class; launching the linked path can.
  const root = await fixture(t);
  const packageRoot = join(root, "package");
  const consumer = join(root, "consumer");
  const linkedBin = join(consumer, "node_modules", ".bin", "probe-check");
  const targetPath = join(packageRoot, "cli.mjs");
  await mkdir(packageRoot);
  await mkdir(join(consumer, "node_modules", ".bin"), { recursive: true });

  const unresolvedArgvGuard = [
    "import { fileURLToPath } from 'node:url';",
    "import { resolve } from 'node:path';",
    "function detectMainModule() {",
    "  return fileURLToPath(import.meta.url) === resolve(process.argv[1]);",
    "}",
    "if (detectMainModule()) console.log('synthetic help');",
    "",
  ].join("\n");
  const realpathGuard = [
    "import { realpathSync } from 'node:fs';",
    "import { fileURLToPath } from 'node:url';",
    "import { resolve } from 'node:path';",
    "function detectMainModule() {",
    "  return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]));",
    "}",
    "if (detectMainModule()) console.log('synthetic help');",
    "",
  ].join("\n");

  await writeFile(targetPath, unresolvedArgvGuard);
  await symlink(targetPath, linkedBin);

  const viaTarget = await runProcess(process.execPath, [targetPath, "--help"], { cwd: consumer });
  assert.equal(viaTarget.exitCode, 0, viaTarget.stderr);
  assert.match(viaTarget.stdout, /synthetic help/);

  const viaLink = await runProcess(process.execPath, [linkedBin, "--help"], { cwd: consumer });
  assert.equal(viaLink.exitCode, 0, viaLink.stderr);
  assert.equal(viaLink.stdout, "");
  assert.equal(viaLink.stderr, "");

  await assert.rejects(
    () => probeInstalledBin({ linkedBin, targetPath, cwd: consumer }),
    /was reached with empty stdout and stderr/,
  );

  await writeFile(targetPath, realpathGuard);
  const control = await probeInstalledBin({ linkedBin, targetPath, cwd: consumer });
  assert.equal(control.exitCode, 0, control.stderr);
  assert.match(control.stdout, /synthetic help/);
});

test("normal parent exit reaps only its private process group", { skip: process.platform === "win32" }, async (t) => {
  const root = await fixture(t);
  const marker = join(root, "lingering-descendant-marker");
  const delayedWriter = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'unexpected'), 350);`;
  const parent = `require('node:child_process').spawn(process.execPath, ['--eval', ${JSON.stringify(delayedWriter)}], { stdio: 'ignore' }); process.exit(0);`;
  const result = await runProcess(process.execPath, ["--eval", parent], { timeout: 5_000 });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.signal, null);
  assert.equal(result.timedOut, false);
  await new Promise((resolveResult) => setTimeout(resolveResult, 700));
  await assert.rejects(() => readFile(marker), { code: "ENOENT" });
});
