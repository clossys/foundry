import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";

const DEFAULT_TIMEOUT_MS = 5_000;
const CREDENTIAL_ENV = /(?:^|_)(?:AUTH|TOKEN|PASSWORD|OTP)(?:_|$)/i;

const omissionRow = (specifiers, rejected = []) => Object.fromEntries(
  specifiers.map((specifier) => [specifier, rejected.includes(specifier) ? "rejects" : "imports"]),
);

const bouncerExports = [
  "@clossys/bouncer",
  "@clossys/bouncer/agent",
  "@clossys/bouncer/providers/clerk",
  "@clossys/bouncer/providers/clerk/web",
  "@clossys/bouncer/providers/clerk/web/client",
  "@clossys/bouncer/providers/clerk/web/proxy",
  "@clossys/bouncer/providers/clerk/web/server",
];
const bouncerWebExports = bouncerExports.filter((specifier) => specifier.includes("/web"));
const designerExports = [
  "@clossys/designer/atoms",
  "@clossys/designer/atoms/server",
  "@clossys/designer/blocks",
  "@clossys/designer/blocks/server",
  "@clossys/designer/charts",
  "@clossys/designer/charts/server",
  "@clossys/designer/gate",
  "@clossys/designer/icons",
  "@clossys/designer/render-environment",
  "@clossys/designer/shell",
  "@clossys/designer/shell/server",
  "@clossys/designer/theme",
  "@clossys/designer/theme/server",
  "@clossys/designer/tokens",
];
const designerClientExports = [
  "@clossys/designer/atoms",
  "@clossys/designer/blocks",
  "@clossys/designer/shell",
  "@clossys/designer/theme",
];
const designerReactExports = [
  "@clossys/designer/atoms",
  "@clossys/designer/atoms/server",
  "@clossys/designer/blocks",
  "@clossys/designer/blocks/server",
  "@clossys/designer/charts",
  "@clossys/designer/charts/server",
  "@clossys/designer/shell",
  "@clossys/designer/shell/server",
  "@clossys/designer/theme",
];
const publisherExports = [
  "@clossys/publisher/core",
  "@clossys/publisher/document",
  "@clossys/publisher/email",
  "@clossys/publisher/image",
  "@clossys/publisher/media",
  "@clossys/publisher/print",
  "@clossys/publisher/record",
  "@clossys/publisher/slides",
  "@clossys/publisher/web",
];

/**
 * Expected import behavior when exactly one optional peer is absent. This is
 * deliberately explicit: a manifest can say that a peer is optional, but it
 * cannot say which public entry points are expected to remain usable without
 * that peer.
 */
export const OPTIONAL_PEER_POLICY = {
  "@clossys/bouncer": {
    "@clerk/nextjs": omissionRow(bouncerExports, bouncerWebExports),
    next: omissionRow(bouncerExports, bouncerWebExports),
    react: omissionRow(bouncerExports, bouncerWebExports),
    "react-dom": omissionRow(bouncerExports, bouncerWebExports),
    svix: omissionRow(bouncerExports, ["@clossys/bouncer/providers/clerk"]),
  },
  "@clossys/butler": {
    react: {
      "@clossys/butler": "imports",
      "@clossys/butler/inbound": "imports",
      "@clossys/butler/web": "rejects",
    },
    "react-dom": {
      "@clossys/butler": "imports",
      "@clossys/butler/inbound": "imports",
      "@clossys/butler/web": "imports",
    },
  },
  "@clossys/controller": {
    typescript: {
      "@clossys/controller": "imports",
      "@clossys/controller/artifacts": "imports",
      "@clossys/controller/catalog": "imports",
      "@clossys/controller/cleanup": "imports",
      "@clossys/controller/composition": "imports",
      "@clossys/controller/conventions": "imports",
      "@clossys/controller/gates": "imports",
      "@clossys/controller/gates/secrets": "rejects",
      "@clossys/controller/policy": "imports",
      "@clossys/controller/positions": "imports",
      "@clossys/controller/release": "imports",
      "@clossys/controller/repository": "imports",
      "@clossys/controller/review": "imports",
      "@clossys/controller/review/github": "imports",
    },
  },
  "@clossys/designer": {
    "@internationalized/date": omissionRow(designerExports, designerClientExports),
    react: omissionRow(designerExports, designerReactExports),
    "react-aria-components": omissionRow(designerExports, designerClientExports),
    "react-dom": omissionRow(designerExports, designerClientExports),
    "tailwind-merge": omissionRow(designerExports, designerReactExports),
    tailwindcss: omissionRow(designerExports),
  },
  "@clossys/keeper": {
    react: { "@clossys/keeper": "imports", "@clossys/keeper/web": "rejects" },
    "react-dom": { "@clossys/keeper": "imports", "@clossys/keeper/web": "imports" },
  },
  "@clossys/messenger": {
    resend: { "@clossys/messenger": "imports", "@clossys/messenger/providers/resend": "rejects" },
  },
  "@clossys/publisher": {
    "@internationalized/date": omissionRow(publisherExports, ["@clossys/publisher/web"]),
    react: omissionRow(publisherExports, ["@clossys/publisher/document", "@clossys/publisher/web"]),
    "react-aria-components": omissionRow(publisherExports, ["@clossys/publisher/web"]),
    "react-dom": omissionRow(publisherExports, ["@clossys/publisher/web"]),
    "tailwind-merge": omissionRow(publisherExports, ["@clossys/publisher/web"]),
    tailwindcss: omissionRow(publisherExports),
  },
};

export function parsePackedConsumerArgs(args) {
  const parsed = { selected: undefined, root: undefined, skipBuild: false, keep: false };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (!["--package", "--root", "--skip-build", "--keep"].includes(flag)) {
      throw new Error(`unknown argument ${flag}`);
    }
    if (seen.has(flag)) throw new Error(`duplicate argument ${flag}`);
    seen.add(flag);
    if (flag === "--package" || flag === "--root") {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
      if (flag === "--package") parsed.selected = value;
      else parsed.root = value;
    } else if (flag === "--skip-build") parsed.skipBuild = true;
    else parsed.keep = true;
  }
  return parsed;
}

function json(path) {
  return readFile(path, "utf8").then(JSON.parse);
}

function inside(root, path) {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !rel.startsWith(sep));
}

export function credentiallessEnv(base, npmrc, cache, globalConfig = npmrc) {
  const env = {};
  for (const [key, value] of Object.entries(base)) {
    if (!CREDENTIAL_ENV.test(key) && !/^npm_config_/i.test(key)) env[key] = value;
  }
  return {
    ...env,
    npm_config_userconfig: npmrc,
    npm_config_globalconfig: globalConfig,
    npm_config_cache: cache,
    npm_config_registry: "https://registry.npmjs.org/",
    npm_config_always_auth: "false",
    npm_config_ignore_scripts: "true",
    npm_config_audit: "false",
    npm_config_fund: "false",
  };
}

export async function discoverPublishablePackages(root, selected) {
  const packagesRoot = join(root, "packages");
  const entries = [];
  for (const item of await readdir(packagesRoot, { withFileTypes: true })) {
    if (!item.isDirectory()) continue;
    try {
      const manifest = await json(join(packagesRoot, item.name, "package.json"));
      if (manifest.private !== true) entries.push({ directory: item.name, path: join(packagesRoot, item.name), manifest });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  entries.sort((left, right) => left.directory.localeCompare(right.directory));
  if (!selected) return entries;

  const byName = new Map(entries.map((entry) => [entry.manifest.name, entry]));
  const initial = entries.find((entry) => (
    entry.directory === selected || entry.manifest.name === selected || entry.manifest.name === `@clossys/${selected}`
  ));
  if (!initial) throw new Error(`unknown publishable package ${selected}`);

  const wanted = new Set();
  const visit = (entry) => {
    if (wanted.has(entry.manifest.name)) return;
    wanted.add(entry.manifest.name);
    for (const name of Object.keys(entry.manifest.dependencies ?? {})) {
      const dependency = byName.get(name);
      if (dependency) visit(dependency);
    }
  };
  visit(initial);
  return entries.filter((entry) => wanted.has(entry.manifest.name));
}

function leafTargets(value, targets = []) {
  if (typeof value === "string") targets.push(value);
  else if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const nested of Object.values(value)) leafTargets(nested, targets);
  }
  return targets;
}

function exportEntries(manifest) {
  if (typeof manifest.exports === "string" || Array.isArray(manifest.exports)) return [[".", manifest.exports]];
  return Object.entries(manifest.exports ?? {});
}

function exportSpecifier(name, key, substitution) {
  if (key === ".") return name;
  if (!key.startsWith("./")) throw new Error(`${name} export ${key} is not package-relative`);
  const subpath = key.slice(2).replaceAll("*", substitution ?? "");
  return `${name}/${subpath}`;
}

function runtimeTarget(target) {
  return /\.(?:c|m)?js$/i.test(target);
}

function packedNextContexts(manifest, runtimeSpecifiers) {
  const verification = manifest.foundryReleaseVerification;
  if (verification === undefined) return { client: [], server: [], proxy: [], all: [] };
  if (!verification || typeof verification !== "object" || Array.isArray(verification)) {
    throw new Error(`${manifest.name} foundryReleaseVerification must be an object`);
  }
  const verificationKeys = Object.keys(verification);
  if (verificationKeys.some((key) => key !== "next")) {
    throw new Error(`${manifest.name} foundryReleaseVerification has an unsupported context row`);
  }
  const next = verification.next;
  if (!next || typeof next !== "object" || Array.isArray(next)) {
    throw new Error(`${manifest.name} foundryReleaseVerification.next must be an object`);
  }
  const allowed = ["clientSubpaths", "serverSubpaths", "proxySubpaths"];
  if (Object.keys(next).some((key) => !allowed.includes(key))) {
    throw new Error(`${manifest.name} foundryReleaseVerification.next has an unsupported context row`);
  }
  const contexts = {};
  const seen = new Set();
  for (const [kind, field] of [["client", "clientSubpaths"], ["server", "serverSubpaths"], ["proxy", "proxySubpaths"]]) {
    const subpaths = next[field] ?? [];
    if (!Array.isArray(subpaths) || subpaths.some((subpath) => typeof subpath !== "string" || subpath.length === 0)) {
      throw new Error(`${manifest.name} ${field} must be an array of declared subpaths`);
    }
    contexts[kind] = [];
    for (const subpath of subpaths) {
      const specifier = exportSpecifier(manifest.name, subpath);
      if (seen.has(specifier)) throw new Error(`${manifest.name} Next context duplicates ${subpath}`);
      if (!runtimeSpecifiers.includes(specifier)) throw new Error(`${manifest.name} Next context names undeclared runtime export ${subpath}`);
      seen.add(specifier);
      contexts[kind].push(specifier);
    }
  }
  const all = [...seen].sort();
  if (all.length === 0) throw new Error(`${manifest.name} foundryReleaseVerification.next declares no framework exports`);
  return { ...contexts, all };
}

function patternRegex(pattern) {
  const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, "\\$&").replaceAll("*", "(.*)");
  return new RegExp(`^${escaped}$`);
}

async function filesBelow(root) {
  const files = [];
  const walk = async (directory) => {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (item.name === "node_modules") continue;
      const path = join(directory, item.name);
      if (item.isDirectory()) await walk(path);
      else files.push(path);
    }
  };
  await walk(root);
  return files;
}

async function checkedTarget(packageRoot, packageReal, target) {
  if (!target.startsWith("./")) throw new Error(`export target ${target} is not package-relative`);
  if (target.slice(2).split("/").includes("node_modules")) throw new Error(`export target ${target} resolves through an installed dependency`);
  const path = resolve(packageRoot, target);
  if (!inside(packageRoot, path)) throw new Error(`export target ${target} escapes the installed package`);
  const targetStat = await stat(path).catch((error) => {
    if (error.code === "ENOENT") throw new Error(`export target ${target} does not resolve`);
    throw error;
  });
  if (!targetStat.isFile()) throw new Error(`export target ${target} is not a file`);
  const targetReal = await realpath(path);
  if (!inside(packageReal, targetReal)) throw new Error(`export target ${target} resolves outside the installed package`);
  return path;
}

export async function inspectPackedExports(packageRoot, manifest) {
  const packageReal = await realpath(packageRoot);
  const allFiles = await filesBelow(packageRoot);
  const runtimeSpecifiers = new Set();
  const staticTargets = [];

  for (const [key, value] of exportEntries(manifest)) {
    for (const target of leafTargets(value)) {
      const stars = (target.match(/\*/g) ?? []).length;
      const keyStars = (key.match(/\*/g) ?? []).length;
      if (stars === 0) {
        await checkedTarget(packageRoot, packageReal, target);
        staticTargets.push({ key, target });
        if (runtimeTarget(target)) runtimeSpecifiers.add(exportSpecifier(manifest.name, key));
        continue;
      }
      if (stars !== 1 || keyStars !== 1) throw new Error(`export pattern ${key} -> ${target} must contain one wildcard`);
      const regex = patternRegex(target);
      const matches = [];
      for (const file of allFiles) {
        const packageTarget = `./${relative(packageRoot, file).split(sep).join("/")}`;
        const match = packageTarget.match(regex);
        if (!match) continue;
        await checkedTarget(packageRoot, packageReal, packageTarget);
        matches.push({ target: packageTarget, substitution: match[1] });
      }
      if (matches.length === 0) throw new Error(`export target pattern ${target} resolves no files`);
      for (const match of matches) {
        staticTargets.push({ key, target: match.target });
        if (runtimeTarget(match.target)) runtimeSpecifiers.add(exportSpecifier(manifest.name, key, match.substitution));
      }
    }
  }
  const allRuntimeSpecifiers = [...runtimeSpecifiers].sort();
  const nextContexts = packedNextContexts(manifest, allRuntimeSpecifiers);
  return {
    runtimeSpecifiers: allRuntimeSpecifiers,
    rawRuntimeSpecifiers: allRuntimeSpecifiers.filter((specifier) => !nextContexts.all.includes(specifier)),
    nextContexts,
    staticTargets: staticTargets.sort((left, right) => left.target.localeCompare(right.target)),
  };
}

function declaredRuntimeSpecifiers(manifest) {
  const specifiers = [];
  for (const [key, value] of exportEntries(manifest)) {
    if (key.includes("*")) continue;
    if (leafTargets(value).some(runtimeTarget)) specifiers.push(exportSpecifier(manifest.name, key));
  }
  return specifiers.sort();
}

export function validateOptionalPeerPolicy(packages, policy, { allowUnselected = false } = {}) {
  const findings = [];
  const selected = new Map(packages.map((entry) => [entry.manifest.name, entry.manifest]));
  for (const manifest of selected.values()) {
    const optional = Object.entries(manifest.peerDependenciesMeta ?? {})
      .filter(([, metadata]) => metadata?.optional === true)
      .map(([name]) => name)
      .sort();
    const rows = policy[manifest.name] ?? {};
    for (const peer of optional) {
      if (!Object.hasOwn(rows, peer)) findings.push(`${manifest.name} optional peer ${peer} has no omission row`);
    }
    for (const peer of Object.keys(rows).sort()) {
      if (!optional.includes(peer)) findings.push(`${manifest.name} omission row ${peer} is stale`);
      const expectedSpecifiers = declaredRuntimeSpecifiers(manifest);
      const actualSpecifiers = Object.keys(rows[peer] ?? {}).sort();
      for (const specifier of expectedSpecifiers) {
        if (!actualSpecifiers.includes(specifier)) findings.push(`${manifest.name} omission row ${peer} misses ${specifier}`);
      }
      for (const specifier of actualSpecifiers) {
        if (!expectedSpecifiers.includes(specifier)) findings.push(`${manifest.name} omission row ${peer} has stale export ${specifier}`);
        else if (!["imports", "rejects"].includes(rows[peer][specifier])) findings.push(`${manifest.name} omission row ${peer} has invalid outcome for ${specifier}`);
      }
    }
  }
  for (const packageName of Object.keys(policy).sort()) {
    if (!selected.has(packageName) && !allowUnselected) findings.push(`${packageName} omission policy is stale`);
  }
  return findings;
}

export function runProcess(file, args, { cwd, env, timeout = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolveResult) => {
    execFile(file, args, { cwd, env, timeout, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (!error) return resolveResult({ exitCode: 0, stdout, stderr, timedOut: false, launchError: undefined });
      const timedOut = error.killed === true || error.signal === "SIGTERM";
      const exitCode = typeof error.code === "number" ? error.code : null;
      const launchError = typeof error.code === "string" && !timedOut ? error.message : undefined;
      return resolveResult({ exitCode, stdout: stdout ?? "", stderr: stderr ?? "", timedOut, launchError });
    });
  });
}

export function installedIdentityFindings({ packedManifest, installedManifest, dependencySpec, consumer, tarball }) {
  const findings = [];
  if (installedManifest?.name !== packedManifest?.name || installedManifest?.version !== packedManifest?.version) {
    findings.push(`${packedManifest?.name ?? "package"} installed identity does not match packed ${packedManifest?.name}@${packedManifest?.version}`);
  }
  if (typeof dependencySpec !== "string" || !dependencySpec.startsWith("file:")) {
    findings.push(`${packedManifest?.name ?? "package"} dependency does not select an exact local tarball`);
  } else if (resolve(consumer, dependencySpec.slice("file:".length)) !== resolve(tarball)) {
    findings.push(`${packedManifest?.name ?? "package"} dependency selects a different local tarball`);
  }
  return findings;
}

export async function installedPackageRoots(nodeModules, name) {
  const roots = [];
  const inspectPackage = async (path) => {
    try {
      const manifest = await json(join(path, "package.json"));
      if (manifest.name === name) roots.push(path);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await walk(join(path, "node_modules"));
  };
  const walk = async (directory) => {
    let items;
    try {
      items = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const item of items) {
      if (!item.isDirectory() || item.name === ".bin") continue;
      const path = join(directory, item.name);
      if (item.name.startsWith("@")) {
        let scoped = [];
        try { scoped = await readdir(path, { withFileTypes: true }); } catch (error) { if (error.code !== "ENOENT") throw error; }
        for (const child of scoped) if (child.isDirectory()) await inspectPackage(join(path, child.name));
      } else {
        await inspectPackage(path);
      }
    }
  };
  await walk(nodeModules);
  return roots;
}

function npmExecutable() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

async function npm(env, cwd, args, timeout = 180_000) {
  const result = await runProcess(npmExecutable(), args, { cwd, env, timeout });
  if (result.exitCode !== 0 || result.timedOut || result.launchError) {
    throw new Error(`npm ${args[0]} failed: ${result.stderr || result.stdout || result.launchError || "timed out"}`);
  }
  return result;
}

async function packedManifest(tarball, env) {
  const result = await runProcess("tar", ["-xOf", tarball, "package/package.json"], { env, timeout: 30_000 });
  if (result.exitCode !== 0 || result.timedOut || result.launchError) {
    throw new Error(`could not read packed manifest from ${tarball}: ${result.stderr || result.launchError || "timed out"}`);
  }
  return JSON.parse(result.stdout);
}

async function packPackages(packDirectory, packages, env) {
  const packed = [];
  for (const entry of packages) {
    const result = await npm(env, entry.path, ["pack", "--json", "--ignore-scripts", "--pack-destination", packDirectory]);
    const report = JSON.parse(result.stdout);
    if (!Array.isArray(report) || report.length !== 1 || !report[0]?.filename) throw new Error(`${entry.manifest.name} npm pack returned an invalid report`);
    const tarball = join(packDirectory, report[0].filename);
    const manifest = await packedManifest(tarball, env);
    packed.push({ ...entry, tarball, packedManifest: manifest });
  }
  return packed;
}

async function writeConsumer(directory) {
  await writeFile(join(directory, "package.json"), `${JSON.stringify({ name: "foundry-packed-consumer", private: true, type: "module" }, null, 2)}\n`);
}

async function installConsumer(directory, packed, env) {
  await writeConsumer(directory);
  await npm(env, directory, ["install", "--ignore-scripts", "--omit=peer", "--no-package-lock", ...packed.map((entry) => entry.tarball)]);
}

async function exactPeerSpecs(root, peers) {
  const specs = [];
  for (const name of peers) {
    const manifest = await json(join(root, "node_modules", ...name.split("/"), "package.json"));
    specs.push(`${name}@${manifest.version}`);
  }
  return specs;
}

async function installPeers(root, consumer, peers, env) {
  if (peers.length === 0) return;
  await npm(env, consumer, ["install", "--ignore-scripts", "--no-save", "--legacy-peer-deps", ...await exactPeerSpecs(root, peers)]);
}

async function installedRoot(consumer, name) {
  return join(consumer, "node_modules", ...name.split("/"));
}

async function assertIdentities(consumer, packed) {
  const consumerManifest = await json(join(consumer, "package.json"));
  const findings = [];
  for (const entry of packed) {
    const installedManifest = await json(join(await installedRoot(consumer, entry.packedManifest.name), "package.json"));
    findings.push(...installedIdentityFindings({
      packedManifest: entry.packedManifest,
      installedManifest,
      dependencySpec: consumerManifest.dependencies?.[entry.packedManifest.name],
      consumer,
      tarball: entry.tarball,
    }));
  }
  if (findings.length > 0) throw new Error(`installed identity check failed:\n- ${findings.join("\n- ")}`);
}

async function importSpecifier(specifier, consumer, env) {
  return runProcess(process.execPath, ["--input-type=module", "--eval", `await import(${JSON.stringify(specifier)})`], { cwd: consumer, env });
}

function namespaceImports(specifiers) {
  return specifiers.map((specifier, index) => `import * as probe${index} from ${JSON.stringify(specifier)};\nvoid probe${index};`).join("\n");
}

async function writeNextFixture(consumer, contexts) {
  const app = join(consumer, "app");
  await mkdir(app, { recursive: true });
  await writeFile(join(app, "layout.js"), 'import { createElement } from "react";\n\nexport default function RootLayout({ children }) {\n  return createElement("html", null, createElement("body", null, children));\n}\n');
  await writeFile(join(app, "client-probe.js"), `"use client";\n\n${namespaceImports(contexts.client)}\n\nexport function ClientProbe() { return null; }\n`);
  await writeFile(join(app, "server-probe.js"), `${namespaceImports(contexts.server)}\n\nexport const serverProbe = true;\n`);
  await writeFile(join(app, "page.js"), 'import { createElement } from "react";\nimport { ClientProbe } from "./client-probe";\nimport { serverProbe } from "./server-probe";\n\nexport const dynamic = "force-dynamic";\n\nexport default function Page() {\n  void serverProbe;\n  return createElement(ClientProbe);\n}\n');
  await writeFile(join(consumer, "proxy.js"), `${namespaceImports(contexts.proxy)}\n\nexport function proxy() { return new Response(null); }\n`);
}

async function runNextContexts(consumer, contexts, env) {
  await writeNextFixture(consumer, contexts);
  return runProcess(join(consumer, "node_modules", ".bin", "next"), ["build"], {
    cwd: consumer,
    env: { ...env, NEXT_TELEMETRY_DISABLED: "1" },
    timeout: 180_000,
  });
}

function allOptionalPeers(packed) {
  return [...new Set(packed.flatMap((entry) => Object.entries(entry.packedManifest.peerDependenciesMeta ?? {})
    .filter(([, metadata]) => metadata?.optional === true)
    .map(([name]) => name)))].sort();
}

export async function runPackedConsumerReadiness({ root, selected, skipBuild = false, policy = OPTIONAL_PEER_POLICY, keep = false }) {
  if (!skipBuild) {
    const build = await runProcess(npmExecutable(), ["run", "build"], { cwd: root, env: process.env, timeout: 180_000 });
    if (build.exitCode !== 0 || build.timedOut || build.launchError) throw new Error(`build failed: ${build.stderr || build.stdout || build.launchError || "timed out"}`);
  }
  const packages = await discoverPublishablePackages(root, selected);
  const scratch = await mkdtemp(join(tmpdir(), "foundry-packed-consumer-"));
  const npmrc = join(scratch, "credentialless.npmrc");
  const globalNpmrc = join(scratch, "credentialless-global.npmrc");
  const cache = join(scratch, "npm-cache");
  await mkdir(cache);
  await writeFile(npmrc, "registry=https://registry.npmjs.org/\nalways-auth=false\nignore-scripts=true\naudit=false\nfund=false\n");
  await writeFile(globalNpmrc, "");
  const env = credentiallessEnv(process.env, npmrc, cache, globalNpmrc);
  try {
    const packDirectory = join(scratch, "packs");
    await mkdir(packDirectory);
    const packed = await packPackages(packDirectory, packages, env);
    const packedPackages = packed.map((entry) => ({ ...entry, manifest: entry.packedManifest }));
    const policyFindings = validateOptionalPeerPolicy(packedPackages, policy, { allowUnselected: Boolean(selected) });
    if (policyFindings.length > 0) throw new Error(`optional-peer policy is not closed:\n- ${policyFindings.join("\n- ")}`);

    const peers = allOptionalPeers(packed);
    const consumer = join(scratch, "consumer");
    await mkdir(consumer);
    await installConsumer(consumer, packed, env);
    await installPeers(root, consumer, peers, env);
    await assertIdentities(consumer, packed);

    const exportsByPackage = new Map();
    let staticTargets = 0;
    let runtimeImports = 0;
    let frameworkExports = 0;
    for (const entry of packed) {
      const shape = await inspectPackedExports(await installedRoot(consumer, entry.packedManifest.name), entry.packedManifest);
      exportsByPackage.set(entry.packedManifest.name, shape);
      staticTargets += shape.staticTargets.length;
      for (const specifier of shape.rawRuntimeSpecifiers) {
        const result = await importSpecifier(specifier, consumer, env);
        if (result.exitCode !== 0 || result.timedOut || result.launchError) {
          throw new Error(`${specifier} runtime import failed: ${result.stderr || result.stdout || result.launchError || "timed out"}`);
        }
        runtimeImports += 1;
      }
      if (shape.nextContexts.all.length > 0) {
        const result = await runNextContexts(consumer, shape.nextContexts, env);
        if (result.exitCode !== 0 || result.timedOut || result.launchError) {
          throw new Error(`${entry.packedManifest.name} Next context build failed: ${result.stderr || result.stdout || result.launchError || "timed out"}`);
        }
        frameworkExports += shape.nextContexts.all.length;
      }
    }

    let bins = 0;
    for (const entry of packed) {
      const packageRoot = await installedRoot(consumer, entry.packedManifest.name);
      const packageReal = await realpath(packageRoot);
      for (const [name, target] of Object.entries(entry.packedManifest.bin ?? {})) {
        const targetPath = resolve(packageRoot, target);
        if (!inside(packageRoot, targetPath)) throw new Error(`${entry.packedManifest.name} bin ${name} escapes the installed package`);
        await stat(targetPath);
        if (!inside(packageReal, await realpath(targetPath))) throw new Error(`${entry.packedManifest.name} bin ${name} resolves outside the installed package`);
        const linkedBin = join(consumer, "node_modules", ".bin", name);
        if (await realpath(linkedBin) !== await realpath(targetPath)) throw new Error(`${entry.packedManifest.name} bin ${name} is not linked to its declared target`);
        const result = await runProcess(process.execPath, [targetPath, "--help"], { cwd: consumer, env });
        if (result.timedOut || result.launchError) throw new Error(`${entry.packedManifest.name} bin ${name} was not reached within ${DEFAULT_TIMEOUT_MS}ms`);
        bins += 1;
      }
    }

    const omission = [];
    const frameworkEvaluatorOmissions = [];
    for (const entry of packed) {
      const rows = policy[entry.packedManifest.name] ?? {};
      const packagePeers = Object.entries(entry.packedManifest.peerDependenciesMeta ?? {})
        .filter(([, metadata]) => metadata?.optional === true)
        .map(([name]) => name)
        .sort();
      for (const peer of packagePeers) {
        const matrixConsumer = join(scratch, `omit-${entry.directory}-${packagePeers.indexOf(peer)}`);
        await mkdir(matrixConsumer);
        await installConsumer(matrixConsumer, packed, env);
        await installPeers(root, matrixConsumer, peers, env);
        for (const packageRoot of await installedPackageRoots(join(matrixConsumer, "node_modules"), peer)) {
          await rm(packageRoot, { recursive: true, force: true });
        }
        if ((await installedPackageRoots(join(matrixConsumer, "node_modules"), peer)).length > 0) {
          throw new Error(`${entry.packedManifest.name} omission row ${peer} is false-green: the omitted peer is installed`);
        }
        const shape = exportsByPackage.get(entry.packedManifest.name) ?? { runtimeSpecifiers: [], rawRuntimeSpecifiers: [], nextContexts: { client: [], server: [], proxy: [], all: [] } };
        const observed = new Map();
        for (const specifier of shape.rawRuntimeSpecifiers) {
          const result = await importSpecifier(specifier, matrixConsumer, env);
          observed.set(specifier, result.exitCode === 0 ? "imports" : "rejects");
          if (result.timedOut || result.launchError) throw new Error(`${entry.packedManifest.name} omission row ${peer} could not evaluate ${specifier}`);
          if (result.exitCode !== 0 && !`${result.stderr}\n${result.stdout}`.includes(peer)) {
            throw new Error(`${entry.packedManifest.name} omission row ${peer} makes ${specifier} fail without naming the omitted peer`);
          }
        }
        if (shape.nextContexts.all.length > 0) {
          if (peer === "next") {
            const expectedFramework = new Set(shape.nextContexts.all.map((specifier) => rows[peer]?.[specifier]));
            if (expectedFramework.size !== 1 || !expectedFramework.has("rejects")) {
              throw new Error(`${entry.packedManifest.name} omission row next must fail closed for every declared Next context`);
            }
            for (const specifier of shape.nextContexts.all) observed.set(specifier, "rejects");
            frameworkEvaluatorOmissions.push({
              package: entry.packedManifest.name,
              peer,
              exports: [...shape.nextContexts.all],
              evidence: "packed Next-context declaration plus verified physical absence of the Next evaluator peer",
            });
          } else {
            const expectedFramework = new Set(shape.nextContexts.all.map((specifier) => rows[peer]?.[specifier]));
            if (expectedFramework.size !== 1 || !["imports", "rejects"].includes([...expectedFramework][0])) {
              throw new Error(`${entry.packedManifest.name} omission row ${peer} has mixed or missing Next-context outcomes`);
            }
            const result = await runNextContexts(matrixConsumer, shape.nextContexts, env);
            const outcome = result.exitCode === 0 ? "imports" : "rejects";
            if (result.timedOut || result.launchError) throw new Error(`${entry.packedManifest.name} omission row ${peer} could not evaluate its Next contexts`);
            if (outcome === "rejects" && !`${result.stderr}\n${result.stdout}`.includes(peer)) {
              throw new Error(`${entry.packedManifest.name} omission row ${peer} makes its Next contexts fail without naming the omitted peer`);
            }
            for (const specifier of shape.nextContexts.all) observed.set(specifier, outcome);
          }
        }
        const outcomes = Object.fromEntries(shape.runtimeSpecifiers.map((specifier) => [specifier, observed.get(specifier)]));
        omission.push({ package: entry.packedManifest.name, peer, outcomes });
        const expected = rows[peer];
        if (JSON.stringify(outcomes) !== JSON.stringify(expected)) {
          throw new Error(`${entry.packedManifest.name} omission row ${peer} drifted: expected ${JSON.stringify(expected)}, received ${JSON.stringify(outcomes)}`);
        }
      }
    }

    return { scratch, packages: packed.length, staticTargets, runtimeImports, frameworkExports, bins, omissionRows: omission.length, frameworkEvaluatorOmissions };
  } finally {
    if (!keep) await rm(scratch, { recursive: true, force: true });
  }
}
