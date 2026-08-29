import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { validateReleaseQualificationContract } from "./release-qualification-contract.mjs";
import { parseStrictJson } from "./candidate-qualification.mjs";

const exec = promisify(execFile);
const hash = (algorithm, value) => createHash(algorithm).update(value).digest("hex");
const streamHash = (root, value) => hash("sha256", String(value)
  .split(root).join("$TEMP")
  .replace(/npm notice[^\n]*\n/g, "")
  .replace(/\b(?:added|removed|changed) \d+ packages?(?:, and audited \d+ packages?)? in [^\n]+\n?/g, "")
  .replace(/\n?\d+ packages? (?:are|is) looking for funding\n(?: {2}run `npm fund` for details\n)?/g, "")
  .replace(/\n?found 0 vulnerabilities\n?/g, ""));
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableJson(value[key])]));
  return value;
}

function consumerDigest(root, value) {
  const normalized = String(value).split(root).join("$TEMP");
  try {
    const parsed = JSON.parse(normalized);
    // npm synthesizes this from the random temporary consumer directory name.
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.prototype.hasOwnProperty.call(parsed, "name")) delete parsed.name;
    return hash("sha256", JSON.stringify(stableJson(parsed)));
  } catch { return hash("sha256", normalized); }
}

const CREDENTIAL_ENV = ["NODE_AUTH_TOKEN", "NPM_TOKEN", "GH_PACKAGES_TOKEN", "GITHUB_TOKEN", "GH_TOKEN"];
const TEMPLATE = /\{\{([A-Z_]+)\}\}/g;

export function assertCredentialFree(env = process.env) {
  if (CREDENTIAL_ENV.some((name) => typeof env[name] === "string" && env[name].length > 0)) throw new Error("qualification runner refuses credential-bearing parent environment");
}

function sanitizedEnv(root) {
  // Deliberately do not spread process.env: candidates never inherit credentials.
  const env = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: root,
    TMPDIR: root,
    TEMP: root,
    TMP: root,
    npm_config_userconfig: join(root, "npmrc"),
    npm_config_cache: join(root, "cache"),
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_update_notifier: "false",
  };
  return env;
}

function packageScope(name) {
  const match = /^(@[a-z0-9][a-z0-9._-]{0,213})\/[a-z0-9][a-z0-9._-]{0,213}$/.exec(name);
  return match?.[1] ?? null;
}

function npmIntegrity(hex) { return `sha512-${Buffer.from(hex, "hex").toString("base64")}`; }

function renderFixture(value, variables) {
  const rendered = String(value).replace(TEMPLATE, (_match, key) => {
    if (!hasOwn(variables, key)) throw new Error(`unknown qualification fixture template ${key}`);
    return variables[key];
  });
  if (/\{\{[A-Z_]+\}\}/.test(rendered)) throw new Error("unresolved qualification fixture template");
  return rendered;
}

async function caseArgument(root, descriptor) {
  if (typeof descriptor.literal === "string") return descriptor.literal;
  const relative = descriptor.fixture ?? descriptor.fixtureDirectory;
  const path = resolve(root, "fixtures", relative);
  if (!path.startsWith(`${resolve(root, "fixtures")}${sep}`)) throw new Error("case fixture argument escapes fixture root");
  const state = await lstat(path);
  if (state.isSymbolicLink() || (descriptor.fixture !== undefined ? !state.isFile() : !state.isDirectory())) throw new Error("case fixture argument has the wrong filesystem type");
  return path;
}

function overlayPackageRoot(root, target) {
  if (!target.startsWith("node_modules/")) return null;
  const parts = target.split("/");
  const count = parts[1]?.startsWith("@") ? 3 : 2;
  return resolve(root, ...parts.slice(0, count));
}

export function installNpmrc(registry) {
  if (!registry || typeof registry.scope !== "string" || typeof registry.registry !== "string") throw new Error("scoped registry configuration is required");
  let url;
  try { url = new URL(registry.registry); } catch { throw new Error("registry must be an HTTPS URL"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("registry must be a clean HTTPS URL");
  const pathname = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  return `${registry.scope}:registry=${url.toString()}\n`;
}

export async function runProcess(file, args, options = {}) {
  try {
    const result = await exec(file, args, {
      ...options,
      timeout: options.timeout ?? 30_000,
      killSignal: "SIGKILL",
      maxBuffer: 1_000_000,
    });
    return { exitCode: 0, signal: null, launchError: false, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      exitCode: Number.isInteger(error.code) ? error.code : null,
      signal: error.signal ?? (error.killed ? "SIGKILL" : null),
      launchError: !Number.isInteger(error.code) && !error.signal,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

function normalizedBins(manifest) {
  if (typeof manifest.bin === "string") return { [manifest.name]: manifest.bin };
  return manifest.bin && typeof manifest.bin === "object" && !Array.isArray(manifest.bin) ? manifest.bin : {};
}

function sameBinMap(left, right) {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return JSON.stringify(leftKeys) === JSON.stringify(rightKeys)
    && leftKeys.every((key) => left[key] === right[key]);
}

function sameBinKeys(left, right) {
  return JSON.stringify(Object.keys(left).sort()) === JSON.stringify(Object.keys(right).sort());
}

function observation(root, id, kind, expectedExitCode, result) {
  return {
    id,
    kind,
    launch: ["install", "uninstall", "reinstall"].includes(kind) ? "npm-fixed" : "node-direct",
    expectedExitCode,
    observedExitCode: result.exitCode,
    signal: result.signal,
    launchError: result.launchError,
    stdoutSha256: streamHash(root, result.stdout),
    stderrSha256: streamHash(root, result.stderr),
  };
}

async function containedRegularFile(root, target) {
  const resolved = resolve(root, target);
  if (!resolved.startsWith(`${root}${sep}`)) return null;
  try {
    const state = await lstat(resolved);
    return state.isFile() && !state.isSymbolicLink() ? resolved : null;
  } catch {
    return null;
  }
}

async function packedManifest(tarball) {
  const result = await runProcess("tar", ["-xOf", tarball, "package/package.json"]);
  if (result.exitCode !== 0 || result.launchError) throw new Error("cannot inspect the supplied tarball package manifest");
  try {
    return parseStrictJson(result.stdout);
  } catch {
    throw new Error("packed package manifest is not valid JSON");
  }
}

const JS_TARGET = /\.(?:m?js|cjs)$/;
const KNOWN_CONDITIONS = new Set(["types", "import", "default"]);

async function packageFiles(root, current = root, output = []) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    const state = await lstat(path);
    if (state.isSymbolicLink()) throw new Error("installed package contains a symbolic link");
    if (state.isDirectory()) await packageFiles(root, path, output);
    else if (state.isFile()) output.push(`./${path.slice(root.length + 1).split(sep).join("/")}`);
  }
  return output.sort();
}

function targetShape(target) {
  if (typeof target !== "string" || !target.startsWith("./") || target.includes("\\") || target.split("/").includes("..")) throw new Error("invalid export target");
  const stars = [...target].filter((character) => character === "*").length;
  if (stars > 1) throw new Error("export targets may contain at most one wildcard");
  return stars;
}

function entriesFromExports(exportsField) {
  if (typeof exportsField === "string" || (exportsField && typeof exportsField === "object" && !Array.isArray(exportsField) && !Object.keys(exportsField).some((key) => key.startsWith(".")))) return [{ key: ".", value: exportsField }];
  if (!exportsField || typeof exportsField !== "object" || Array.isArray(exportsField)) throw new Error("packed manifest exports must be a string or object");
  const keys = Object.keys(exportsField).sort();
  if (keys.length === 0 || !keys.every((key) => key === "." || key.startsWith("./"))) throw new Error("invalid export key");
  return keys.map((key) => ({ key, value: exportsField[key] }));
}

function targetsFromEntry(entry) {
  if (typeof entry.value === "string") return [{ condition: "string", target: entry.value, runtime: JS_TARGET.test(entry.value) }];
  if (!entry.value || typeof entry.value !== "object" || Array.isArray(entry.value)) throw new Error("unsupported export shape");
  const keys = Object.keys(entry.value).sort();
  if (keys.length === 0 || !keys.every((key) => KNOWN_CONDITIONS.has(key)) || (!hasOwn(entry.value, "import") && !hasOwn(entry.value, "default"))) throw new Error("unsupported export conditions");
  return keys.map((condition) => ({
    condition,
    target: entry.value[condition],
    runtime: condition === "import" || (condition === "default" && !hasOwn(entry.value, "import")),
  }));
}

function wildcardPattern(target) {
  const [before, after] = target.split("*");
  return { before, after, expression: new RegExp(`^${before.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(.*)${after.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) };
}

async function exportCoverage(manifest, installed, root, timeoutMs) {
  const files = await packageFiles(installed);
  const declared = entriesFromExports(manifest.exports);
  const coverage = { declaredExportKeys: declared.length, concreteTargets: 0, runtimeImports: 0, staticTargets: 0, failed: 0, installedManifestSha256: hash("sha256", await readFile(join(installed, "package.json")) ) };
  const operations = [];
  let targetIndex = 0;
  for (const entry of declared) for (const descriptor of targetsFromEntry(entry)) {
    const stars = targetShape(descriptor.target);
    const keyStars = [...entry.key].filter((character) => character === "*").length;
    if (stars !== keyStars || stars > 1) throw new Error("export wildcard shape is invalid");
    const concrete = stars === 0 ? [{ target: descriptor.target, capture: "" }] : files.map((file) => {
      const match = wildcardPattern(descriptor.target).expression.exec(file);
      return match ? { target: file, capture: match[1] } : null;
    }).filter(Boolean);
    if (concrete.length === 0) throw new Error("export wildcard has no packaged files");
    for (const item of concrete) {
      const target = await containedRegularFile(installed, item.target);
      const id = targetIndex++;
      coverage.concreteTargets += 1;
      if (!target) { coverage.failed += 1; continue; }
      if (descriptor.runtime) {
        const suffix = entry.key === "." ? "" : `/${entry.key.slice(2).replace("*", item.capture)}`;
        const result = await runProcess(process.execPath, ["--input-type=module", "--eval", `import(${JSON.stringify(`${manifest.name}${suffix}`)})`], { cwd: root, env: sanitizedEnv(root), timeout: timeoutMs });
        operations.push({ id: `import:${id}`, result });
        coverage.runtimeImports += 1;
        if (result.exitCode !== 0 || result.signal || result.launchError) coverage.failed += 1;
      } else coverage.staticTargets += 1;
    }
  }
  return { coverage, operations };
}

/** Execute the fixed, data-only contract against exactly one local tarball. */
export async function runCandidateQualification({ tarball, policy, adapter, fixtures, manifestBins, registry, timeoutMs }) {
  assertCredentialFree();
  const bytes = await readFile(tarball);
  const tarballDigests = { sha1: hash("sha1", bytes), sha256: hash("sha256", bytes), sha512: hash("sha512", bytes) };
  const root = await mkdtemp(join(tmpdir(), "foundry-candidate-"));
  const artifact = join(root, "artifact", "candidate.tgz");
  await mkdir(join(root, "artifact")); await writeFile(artifact, bytes);
  const manifest = await packedManifest(artifact);
  if (adapter.package !== manifest.name) throw new Error("adapter package must equal packed manifest name");
  if (registry?.scope !== packageScope(manifest.name)) throw new Error("registry scope must match candidate package scope");
  const packedBins = normalizedBins(manifest);
  const contract = validateReleaseQualificationContract({ policy, adapter, fixtures, manifestBins: packedBins, peerDependencies: manifest.peerDependencies ?? {}, peerDependenciesMeta: manifest.peerDependenciesMeta ?? {} });
  if (contract.length) throw new Error(`invalid qualification contract: ${contract.map((item) => item.rule).join(",")}`);
  if (!sameBinMap(packedBins, manifestBins) || !sameBinKeys(packedBins, adapter.bins)) throw new Error("adapter must probe exactly the packed manifest bin map");

  const packagePolicy = policy.packages[adapter.package];
  const transcript = {
    schema: "foundry-candidate-qualification-transcript-v1",
    version: 1,
    candidate: { name: manifest.name, version: manifest.version },
    archetype: adapter.archetype,
    tarball: tarballDigests,
    peerInstall: Object.fromEntries(Object.entries(adapter.peerInstall ?? {}).sort(([left], [right]) => left.localeCompare(right))),
    consumer: null,
    coverage: null,
    observations: [],
    dimensions: ["position", "completion", "rollback", "duplicate", "cadence", "closeWindow"].map((dimension) => {
      const rule = packagePolicy.dimensions[dimension];
      if (rule.status === "unsupported") return { dimension, status: "unsupported", reason: rule.reason };
      if (dimension === "rollback") return { dimension, status: "supported", evidence: ["uninstall", "reinstall"] };
      const group = adapter.dimensionEvidence.duplicate;
      return { dimension, status: "supported", evidence: adapter.cases.filter((item) => item.group === group && [0, 1].includes(item.exitCode)).map((item) => "case:" + item.id) };
    }),
    restoration: null,
    mismatches: [],
    ok: false,
  };
  try {
    await mkdir(join(root, "fixtures"));
    const variables = { CANDIDATE_NAME: manifest.name, CANDIDATE_VERSION: manifest.version, CANDIDATE_INTEGRITY: npmIntegrity(tarballDigests.sha512), NOW: new Date().toISOString() };
    for (const fixture of adapter.fixtures) {
      const target = join(root, "fixtures", fixture);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, renderFixture(await readFile(fixtures[fixture].path, "utf8"), variables));
    }
    const npmrc = join(root, "npmrc");
    await writeFile(npmrc, installNpmrc(registry));
    await writeFile(join(root, "package.json"), "{\"private\":true}\n");

    const peerArgs = Object.entries(adapter.peerInstall ?? {}).sort(([left], [right]) => left.localeCompare(right)).map(([name, version]) => `${name}@${version}`);
    const install = await runProcess("npm", ["install", "--ignore-scripts", "--save-exact", "file:./artifact/candidate.tgz", ...peerArgs], {
      cwd: root, env: sanitizedEnv(root), timeout: timeoutMs,
    });
    transcript.observations.push(observation(root, "install", "install", 0, install));
    if (install.exitCode !== 0 || install.signal || install.launchError) transcript.mismatches.push("install");
    // This file may temporarily contain an install credential. Candidate code sees
    // neither it nor the credential-bearing environment, even after an install error.
    await writeFile(npmrc, "");

    const installed = join(root, "node_modules", ...manifest.name.split("/"));
    let installedManifest;
    try {
      installedManifest = JSON.parse(await readFile(join(installed, "package.json"), "utf8"));
    } catch {
      throw new Error("candidate package was not installed from the supplied tarball");
    }
    const installedBins = normalizedBins(installedManifest);
    if (!sameBinMap(packedBins, installedBins)) transcript.mismatches.push("installed-bin-map");
    const lifecycleScriptsDisabled = (await containedRegularFile(installed, "preinstall-marker")) === null;
    if (!lifecycleScriptsDisabled) transcript.mismatches.push("lifecycle-scripts-ran");

    const targets = {};
    for (const bin of Object.keys(packedBins).sort()) {
      const target = await containedRegularFile(installed, packedBins[bin]);
      if (!target) transcript.mismatches.push(`bin:${bin}`);
      else targets[bin] = target;
    }
    const exported = await exportCoverage(manifest, installed, root, timeoutMs);
    for (const operation of exported.operations) {
      transcript.observations.push(observation(root, operation.id, "import", 0, operation.result));
      if (operation.result.exitCode !== 0 || operation.result.signal || operation.result.launchError) transcript.mismatches.push(operation.id);
    }
    if (exported.coverage.failed !== 0) transcript.mismatches.push("export-coverage");
    for (const bin of Object.keys(adapter.bins).sort()) {
      const result = targets[bin]
        ? await runProcess(process.execPath, [targets[bin], "--help"], { cwd: root, env: sanitizedEnv(root), timeout: timeoutMs })
        : { exitCode: null, signal: null, launchError: true, stdout: "", stderr: "missing contained bin target" };
      transcript.observations.push(observation(root, `help:${bin}`, "help", adapter.bins[bin], result));
      if (result.exitCode !== adapter.bins[bin] || result.signal || result.launchError) transcript.mismatches.push(`help:${bin}`);
    }
    const caseBase = { manifest: await readFile(join(root, "package.json"), "utf8"), lock: await readFile(join(root, "package-lock.json"), "utf8") };
    const overlayRoots = new Set();
    for (const item of adapter.consumerOverlay ?? []) {
      const target = resolve(root, item.target);
      if (!target.startsWith(`${root}${sep}`)) throw new Error("consumer overlay escapes disposable root");
      const packageRoot = overlayPackageRoot(root, item.target);
      if (packageRoot) overlayRoots.add(packageRoot);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(join(root, "fixtures", item.fixture), target);
    }
    for (const item of adapter.cases) {
      const args = item.fixtureArgs
        ? item.fixtureArgs.map((fixture) => join(root, "fixtures", fixture))
        : await Promise.all(item.args.map((descriptor) => caseArgument(root, descriptor)));
      const result = targets[item.bin]
        ? await runProcess(process.execPath, [targets[item.bin], ...args], { cwd: root, env: sanitizedEnv(root), timeout: timeoutMs })
        : { exitCode: null, signal: null, launchError: true, stdout: "", stderr: "missing contained bin target" };
      transcript.observations.push(observation(root, `case:${item.id}`, "case", item.exitCode, result));
      if (result.exitCode !== item.exitCode || result.signal || result.launchError) transcript.mismatches.push(`case:${item.id}`);
    }

    await writeFile(join(root, "package.json"), caseBase.manifest);
    await writeFile(join(root, "package-lock.json"), caseBase.lock);
    for (const packageRoot of overlayRoots) await rm(packageRoot, { recursive: true, force: true });

    const before = { manifest: await readFile(join(root, "package.json"), "utf8"), lock: await readFile(join(root, "package-lock.json"), "utf8") };
    const uninstall = await runProcess("npm", ["uninstall", manifest.name, "--ignore-scripts"], { cwd: root, env: sanitizedEnv(root), timeout: timeoutMs });
    transcript.observations.push(observation(root, "uninstall", "uninstall", 0, uninstall));
    let packageAbsentAfterUninstall = false;
    try { await lstat(installed); } catch { packageAbsentAfterUninstall = true; }
    const reinstall = await runProcess("npm", ["install", "--ignore-scripts", "--save-exact", "file:./artifact/candidate.tgz"], { cwd: root, env: sanitizedEnv(root), timeout: timeoutMs });
    transcript.observations.push(observation(root, "reinstall", "reinstall", 0, reinstall));
    const after = { manifest: await readFile(join(root, "package.json"), "utf8"), lock: await readFile(join(root, "package-lock.json"), "utf8") };
    const restored = before.manifest === after.manifest && before.lock === after.lock;
    if (uninstall.exitCode !== 0 || reinstall.exitCode !== 0 || !packageAbsentAfterUninstall || !restored) transcript.mismatches.push("restoration");

    transcript.consumer = { manifestSha256: consumerDigest(root, before.manifest), lockfileSha256: consumerDigest(root, before.lock) };
    transcript.coverage = { ...exported.coverage, bins: Object.keys(packedBins).length, lifecycleScriptsDisabled };
    transcript.restoration = { manifestRestored: restored, lockfileRestored: restored, packageAbsentAfterUninstall };
    transcript.mismatches.sort();
    transcript.ok = transcript.mismatches.length === 0;
    transcript.canonicalSha256 = hash("sha256", JSON.stringify(transcript));
    return transcript;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
