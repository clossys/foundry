import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { validateReleaseQualificationContract } from "./release-qualification-contract.mjs";
import { parseStrictJson } from "./candidate-qualification.mjs";

const hash = (algorithm, value) => createHash(algorithm).update(value).digest("hex");
function normalizedStream(root, value, kind) {
  let normalized = String(value)
    .split(root).join("$TEMP")
    .replace(/npm notice[^\n]*\n/g, "")
    .replace(/\b(?:added|removed|changed) \d+ packages?(?:, and audited \d+ packages?)? in [^\n]+\n?/g, "")
    .replace(/\n?\d+ packages? (?:are|is) looking for funding\n(?: {2}run `npm fund` for details\n)?/g, "")
    .replace(/\n?found 0 vulnerabilities\n?/g, "");
  if (kind === "framework") {
    // Next reports machine-speed timings and worker counts. They are useful to
    // a human at execution time but cannot be part of replayable evidence.
    normalized = normalized
      .replace(/\busing \d+ workers?\b/gi, "using $WORKERS workers")
      .replace(/\b\d+(?:\.\d+)?(?:ms|s)\b/g, "$DURATION");
  }
  return normalized;
}
const streamHash = (root, value, kind) => hash("sha256", normalizedStream(root, value, kind));
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
export const QUALIFICATION_PHASE_TIMEOUTS = Object.freeze({ npm: 180_000, framework: 120_000, probe: 30_000 });

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
    npm_config_userconfig: join(root, "user-npmrc"),
    npm_config_globalconfig: join(root, "global-npmrc"),
    npm_config_cache: join(root, "cache"),
    npm_config_registry: "https://registry.npmjs.org/",
    npm_config_always_auth: "false",
    npm_config_ignore_scripts: "true",
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

async function readRegularFile(path, label) {
  const state = await lstat(path);
  if (!state.isFile() || state.isSymbolicLink()) throw new Error(`${label} must remain a contained regular file`);
  return readFile(path);
}

async function restoreRegularFile(path, bytes, label) {
  try {
    const state = await lstat(path);
    if (!state.isFile() || state.isSymbolicLink()) throw new Error(`${label} was replaced with a non-regular file during qualification`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (bytes === null) { await rm(path, { force: true }); return; }
  await writeFile(path, bytes, { flag: "w" });
}

async function caseArgument(root, fixtureRoot, descriptor) {
  if (typeof descriptor.literal === "string") return descriptor.literal;
  const relative = descriptor.fixture ?? descriptor.fixtureDirectory;
  const path = resolve(fixtureRoot, relative);
  if (!path.startsWith(`${resolve(fixtureRoot)}${sep}`)) throw new Error("case fixture argument escapes fixture root");
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

export async function assertConsumerOverlayRootsAbsent(roots, phase) {
  for (const root of roots) {
    try {
      await lstat(root);
      throw new Error(`consumer overlay ${phase}: target package root already exists`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
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
  const timeout = options.timeout ?? 30_000;
  const { timeout: _ignoredTimeout, ...spawnOptions } = options;
  const grouped = process.platform !== "win32";
  const maxBytes = 1_000_000;
  return new Promise((finish) => {
    let child;
    let settled = false;
    let timedOut = false;
    let overflow = false;
    let spawnError = null;
    let closedResult = null;
    let terminationStarted = false;
    let terminationComplete = false;
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let timeoutTimer;
    const maybeFinish = () => {
      if (settled || closedResult === null || (terminationStarted && !terminationComplete)) return;
      settled = true;
      clearTimeout(timeoutTimer);
      const { code, signal } = closedResult;
      finish({
        exitCode: timedOut || overflow ? null : Number.isInteger(code) ? code : null,
        signal: signal ?? (terminationStarted ? "SIGKILL" : null),
        launchError: spawnError !== null || overflow,
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8"),
      });
    };
    const terminate = () => {
      try {
        if (grouped && Number.isInteger(child?.pid)) process.kill(-child.pid, "SIGKILL");
        else child?.kill("SIGKILL");
      } catch (error) {
        if (error?.code !== "ESRCH") spawnError ??= error;
      }
    };
    const beginTermination = () => {
      if (terminationStarted) return;
      terminationStarted = true;
      terminate();
      terminationComplete = true;
      maybeFinish();
    };
    const append = (current, chunk) => {
      const next = Buffer.concat([current, chunk]);
      if (next.length <= maxBytes) return next;
      overflow = true;
      beginTermination();
      return next.subarray(0, maxBytes);
    };
    try {
      child = spawn(file, args, { ...spawnOptions, detached: grouped, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      finish({ exitCode: null, signal: null, launchError: true, stdout: "", stderr: error instanceof Error ? error.message : String(error) });
      return;
    }
    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });
    child.on("error", (error) => { spawnError = error; });
    timeoutTimer = setTimeout(() => {
      timedOut = true;
      beginTermination();
    }, timeout);
    child.on("close", (code, signal) => {
      closedResult = { code, signal };
      clearTimeout(timeoutTimer);
      maybeFinish();
    });
  });
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
    launch: ["install", "uninstall", "reinstall"].includes(kind) ? "npm-fixed" : kind === "framework" ? "next-build" : "node-direct",
    expectedExitCode,
    observedExitCode: result.exitCode,
    signal: result.signal,
    launchError: result.launchError,
    stdoutSha256: streamHash(root, result.stdout, kind),
    stderrSha256: streamHash(root, result.stderr, kind),
  };
}

const RAW_CASE_MAX_FILES = 64;
const RAW_CASE_MAX_FILE_BYTES = 65_536;
const RAW_CASE_MAX_TOTAL_BYTES = 524_288;
const RAW_CASE_MAX_STREAM_BYTES = 65_536;
const ABSOLUTE_HOST_PATH = /(?:^|[\s"'`=(:,;\[!])(?:\/(?!\/)[^\s"'`<>{}\[\],)]*|[A-Za-z]:[\\/][^\s"'`<>{}\[\],)]*|\\\\[^\\\s"'`<>{}\[\],)]+\\[^\s"'`<>{}\[\],)]*)/m;

function safeTokenizedPath(value) {
  if (typeof value !== "string") return false;
  const parts = value.split("/");
  return parts[0] === "$TEMP" && parts.length > 1
    && parts.slice(1).every((part) => /^[A-Za-z0-9@._-]+$/.test(part) && part !== "." && part !== "..");
}

function assertPublicSafeRaw(value) {
  if (typeof value !== "string" || value.includes("\0") || ABSOLUTE_HOST_PATH.test(value)) throw new Error("raw case evidence contains an untokenized absolute host path");
  for (const match of value.matchAll(/\$TEMP(?:\/[^\s"'`<>{}\[\],)]*)?/g)) if (!safeTokenizedPath(match[0])) throw new Error("raw case evidence contains an unsafe temporary path token");
  const unknownTokens = value.replaceAll("$NODE", "").replaceAll("$ENV", "").replace(/\$TEMP(?:\/[A-Za-z0-9@._-]+)+/g, "");
  if (/\$[A-Z][A-Z_]*/.test(unknownTokens)) throw new Error("raw case evidence contains an unknown path token");
}

function tokenizedRaw(root, value) {
  const output = String(value).split(root).join("$TEMP").split(process.execPath).join("$NODE").replaceAll("/usr/bin/env", "$ENV");
  if (output.includes(root) || output.includes(process.execPath)) throw new Error("raw case evidence contains an untokenized runtime path");
  assertPublicSafeRaw(output);
  return output;
}

async function materializedFiles(root, target, output = []) {
  const state = await lstat(target);
  if (state.isSymbolicLink()) throw new Error("raw case evidence refuses symbolic-link inputs");
  if (state.isDirectory()) {
    for (const entry of (await readdir(target)).sort()) await materializedFiles(root, join(target, entry), output);
    return output;
  }
  if (!state.isFile()) throw new Error("raw case evidence accepts only regular-file inputs");
  const bytes = await readFile(target);
  if (bytes.length < 1 || bytes.length > RAW_CASE_MAX_FILE_BYTES) throw new Error("raw case evidence input is outside the bounded file size");
  const decoded = bytes.toString("utf8");
  if (!Buffer.from(decoded, "utf8").equals(bytes) || decoded.includes("\0")) throw new Error("raw case evidence inputs must be bounded UTF-8 text");
  const retainedBytes = tokenizedRaw(root, decoded);
  output.push({ path: tokenizedRaw(root, target), sha256: hash("sha256", retainedBytes), bytes: retainedBytes });
  return output;
}

async function materializedConsumerOverlay(root, fixtureRoot, overlay) {
  const sourcePath = resolve(fixtureRoot, overlay.fixture);
  const targetPath = resolve(root, overlay.target);
  if (!sourcePath.startsWith(`${resolve(fixtureRoot)}${sep}`) || !targetPath.startsWith(`${root}${sep}`)) throw new Error("raw case evidence consumer overlay escapes the disposable root");
  const [sourceState, targetState] = await Promise.all([lstat(sourcePath), lstat(targetPath)]);
  if (sourceState.isSymbolicLink() || targetState.isSymbolicLink() || !sourceState.isFile() || !targetState.isFile()) throw new Error("raw case evidence consumer overlay must map regular files");
  const [sourceBytes, targetBytes] = await Promise.all([readFile(sourcePath), readFile(targetPath)]);
  if (!sourceBytes.equals(targetBytes)) throw new Error("raw case evidence consumer overlay target differs from its materialized source");
  if (targetBytes.length < 1 || targetBytes.length > RAW_CASE_MAX_FILE_BYTES) throw new Error("raw case evidence consumer overlay is outside the bounded file size");
  const decoded = targetBytes.toString("utf8");
  if (!Buffer.from(decoded, "utf8").equals(targetBytes) || decoded.includes("\0")) throw new Error("raw case evidence consumer overlay must be bounded UTF-8 text");
  const retainedBytes = tokenizedRaw(root, decoded);
  return {
    sourcePath: tokenizedRaw(root, sourcePath),
    targetPath: tokenizedRaw(root, targetPath),
    sha256: hash("sha256", retainedBytes),
    bytes: retainedBytes,
  };
}

async function rawCaseInputSnapshot(root, fixtureRoot, descriptors, consumerOverlay) {
  const inputs = [];
  for (const descriptor of descriptors) {
    if (typeof descriptor === "string") await materializedFiles(root, join(fixtureRoot, descriptor), inputs);
    else if (typeof descriptor?.fixture === "string") await materializedFiles(root, join(fixtureRoot, descriptor.fixture), inputs);
    else if (typeof descriptor?.fixtureDirectory === "string") await materializedFiles(root, join(fixtureRoot, descriptor.fixtureDirectory), inputs);
  }
  inputs.sort((left, right) => left.path.localeCompare(right.path));
  const overlay = [];
  for (const item of consumerOverlay ?? []) overlay.push(await materializedConsumerOverlay(root, fixtureRoot, item));
  overlay.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
  const retainedFiles = [...inputs, ...overlay];
  if (inputs.length < 1 || retainedFiles.length > RAW_CASE_MAX_FILES || new Set(inputs.map((item) => item.path)).size !== inputs.length || new Set(overlay.map((item) => item.sourcePath)).size !== overlay.length || new Set(overlay.map((item) => item.targetPath)).size !== overlay.length || retainedFiles.reduce((total, item) => total + Buffer.byteLength(item.bytes), 0) > RAW_CASE_MAX_TOTAL_BYTES) throw new Error("raw case evidence inputs exceed the closed bounds");
  return { materializedInputs: inputs, consumerOverlay: overlay };
}

function rawCaseEvidence(root, target, args, snapshot, result) {
  const stdout = tokenizedRaw(root, result.stdout);
  const stderr = tokenizedRaw(root, result.stderr);
  if (Buffer.byteLength(stdout) > RAW_CASE_MAX_STREAM_BYTES || Buffer.byteLength(stderr) > RAW_CASE_MAX_STREAM_BYTES || stdout.includes("\0") || stderr.includes("\0")) throw new Error("raw case evidence output exceeds the closed bounds");
  return {
    argv: ["$NODE", tokenizedRaw(root, target), ...args.map((argument) => tokenizedRaw(root, argument))],
    ...snapshot,
    exitCode: result.exitCode,
    stdout,
    stderr,
  };
}

async function assertRawCaseInputsUnchanged(root, fixtureRoot, preparedCases, consumerOverlay, observedExitCode) {
  try {
    for (const prepared of preparedCases) {
      const current = await rawCaseInputSnapshot(root, fixtureRoot, prepared.descriptors, consumerOverlay);
      if (JSON.stringify(current) !== JSON.stringify(prepared.snapshot)) throw new Error("changed bytes");
    }
  } catch {
    throw new Error(`candidate mutated raw case evidence inputs during execution after observed exit ${observedExitCode}`);
  }
}

export async function containedRegularFile(root, target) {
  const resolved = resolve(root, target);
  if (!resolved.startsWith(`${root}${sep}`)) return null;
  try {
    const state = await lstat(resolved);
    if (!state.isFile() || state.isSymbolicLink()) return null;
    const [canonicalRoot, canonicalTarget] = await Promise.all([realpath(root), realpath(resolved)]);
    return canonicalTarget.startsWith(`${canonicalRoot}${sep}`) ? canonicalTarget : null;
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
const KNOWN_CONDITIONS = new Set(["types", "import", "default", "react-server"]);
const RUNTIME_CONDITIONS = new Set(["string", "import", "default", "react-server"]);
const FRAMEWORK_SUBPATH = /^[A-Za-z0-9@._~+-]+(?:\/[A-Za-z0-9@._~+-]+)*$/;

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
    runtime: condition === "import" || condition === "react-server" || (condition === "default" && !hasOwn(entry.value, "import")),
  }));
}

/** Build the one fixed Node invocation that resolves and imports a declared runtime target. */
export function runtimeImportArguments(condition, specifier, expectedTarget, packageRoot) {
  if (!RUNTIME_CONDITIONS.has(condition) || typeof specifier !== "string" || specifier.length === 0 || typeof expectedTarget !== "string" || expectedTarget.length === 0 || typeof packageRoot !== "string" || packageRoot.length === 0) throw new Error("unsupported runtime export condition");
  const probe = [
    'import { realpath } from "node:fs/promises";',
    'import { fileURLToPath } from "node:url";',
    `const specifier = ${JSON.stringify(specifier)};`,
    `const expectedTarget = ${JSON.stringify(expectedTarget)};`,
    `const packageRoot = ${JSON.stringify(packageRoot)};`,
    'const resolved = import.meta.resolve(specifier);',
    'if (!resolved.startsWith("file:")) throw new Error("runtime export did not resolve to a file");',
    'const [resolvedReal, expectedReal, rootReal] = await Promise.all([realpath(fileURLToPath(resolved)), realpath(expectedTarget), realpath(packageRoot)]);',
    'if (resolvedReal !== expectedReal || !(resolvedReal.startsWith(`${rootReal}/`))) throw new Error("runtime export resolved outside its declared packed target");',
    'await import(specifier);',
  ].join("\n");
  return [
    ...(condition === "react-server" ? ["--conditions=react-server"] : []),
    "--input-type=module",
    "--eval",
    probe,
  ];
}

export function wildcardCapture(target, candidate) {
  const wildcard = target.indexOf("*");
  if (wildcard < 0 || wildcard !== target.lastIndexOf("*")) throw new Error("wildcard capture requires exactly one wildcard");
  const before = target.slice(0, wildcard);
  const after = target.slice(wildcard + 1);
  if (!candidate.startsWith(before) || !candidate.endsWith(after)) return null;
  const captureEnd = candidate.length - after.length;
  if (captureEnd < before.length) return null;
  return candidate.slice(before.length, captureEnd);
}

function frameworkSpecifier(packageName, subpath) {
  if (subpath === ".") return packageName;
  if (typeof subpath !== "string" || !subpath.startsWith("./") || !FRAMEWORK_SUBPATH.test(subpath.slice(2))) {
    throw new Error(`${packageName} Next context must name an exact package-relative subpath`);
  }
  return `${packageName}/${subpath.slice(2)}`;
}

/**
 * Interpret framework execution contexts from the packed manifest itself.
 * This is intentionally closed in both directions: every row must be known,
 * nonempty when present, unique across roles, and name a runtime export that
 * the same packed manifest actually declares.
 */
export function packedFrameworkContexts(manifest, runtimeSpecifiers) {
  const verification = manifest.foundryReleaseVerification;
  if (verification === undefined) return { client: [], server: [], proxy: [], all: [] };
  if (!verification || typeof verification !== "object" || Array.isArray(verification)) throw new Error(`${manifest.name} foundryReleaseVerification must be an object`);
  if (JSON.stringify(Object.keys(verification).sort()) !== JSON.stringify(["next"])) throw new Error(`${manifest.name} foundryReleaseVerification has an unsupported or missing context row`);
  const next = verification.next;
  if (!next || typeof next !== "object" || Array.isArray(next)) throw new Error(`${manifest.name} foundryReleaseVerification.next must be an object`);
  const fields = [["client", "clientSubpaths"], ["server", "serverSubpaths"], ["proxy", "proxySubpaths"]];
  const allowed = new Set(fields.map(([, field]) => field));
  if (Object.keys(next).some((key) => !allowed.has(key))) throw new Error(`${manifest.name} foundryReleaseVerification.next has an unsupported context row`);
  const runtime = new Set(runtimeSpecifiers);
  const contexts = {};
  const seen = new Set();
  for (const [role, field] of fields) {
    const present = hasOwn(next, field);
    const subpaths = present ? next[field] : [];
    if (!Array.isArray(subpaths) || (present && subpaths.length === 0) || subpaths.some((subpath) => typeof subpath !== "string" || subpath.length === 0)) {
      throw new Error(`${manifest.name} ${field} must be a nonempty array of declared runtime subpaths when present`);
    }
    contexts[role] = subpaths.map((subpath) => {
      const specifier = frameworkSpecifier(manifest.name, subpath);
      if (seen.has(specifier)) throw new Error(`${manifest.name} Next context duplicates ${subpath}`);
      if (!runtime.has(specifier)) throw new Error(`${manifest.name} Next context names undeclared runtime export ${subpath}`);
      seen.add(specifier);
      return specifier;
    });
  }
  if (seen.size === 0) throw new Error(`${manifest.name} foundryReleaseVerification.next declares no framework exports`);
  return { ...contexts, all: [...seen].sort() };
}

function namespaceImports(specifiers) {
  return specifiers.map((specifier, index) => `import * as probe${index} from ${JSON.stringify(specifier)};\nvoid probe${index};`).join("\n");
}

export async function writeNextFixture(root, contexts) {
  const app = join(root, "app");
  await mkdir(app, { recursive: true });
  await Promise.all([
    writeFile(join(app, "layout.tsx"), 'import type { ReactNode } from "react";\n\nexport default function RootLayout({ children }: { children: ReactNode }) {\n  return <html><body>{children}</body></html>;\n}\n'),
    writeFile(join(app, "client-probe.tsx"), `"use client";\n\n${namespaceImports(contexts.client)}\n\nexport function ClientProbe() {\n  return null;\n}\n`),
    writeFile(join(app, "server-probe.ts"), `${namespaceImports(contexts.server)}\n\nexport const serverProbe = true;\n`),
    writeFile(join(app, "page.tsx"), 'import { ClientProbe } from "./client-probe";\nimport { serverProbe } from "./server-probe";\n\nexport const dynamic = "force-dynamic";\n\nexport default function Page() {\n  void serverProbe;\n  return <ClientProbe />;\n}\n'),
    writeFile(join(root, "proxy.ts"), `${namespaceImports(contexts.proxy)}\n\nexport function proxy() {\n  return new Response(null);\n}\n`),
  ]);
}

async function exportCoverage(manifest, installed, root) {
  const files = await packageFiles(installed);
  const declared = entriesFromExports(manifest.exports);
  const concreteTargets = [];
  for (const entry of declared) for (const descriptor of targetsFromEntry(entry)) {
    const stars = targetShape(descriptor.target);
    const keyStars = [...entry.key].filter((character) => character === "*").length;
    if (stars !== keyStars || stars > 1) throw new Error("export wildcard shape is invalid");
    const concrete = stars === 0 ? [{ target: descriptor.target, capture: "" }] : files.map((file) => {
      const capture = wildcardCapture(descriptor.target, file);
      return capture === null ? null : { target: file, capture };
    }).filter(Boolean);
    if (concrete.length === 0) throw new Error("export wildcard has no packaged files");
    for (const item of concrete) {
      const suffix = entry.key === "." ? "" : `/${entry.key.slice(2).replaceAll("*", item.capture)}`;
      concreteTargets.push({ condition: descriptor.condition, target: item.target, runtime: descriptor.runtime, specifier: `${manifest.name}${suffix}` });
    }
  }
  const runtimeSpecifiers = [...new Set(concreteTargets.filter((item) => item.runtime && item.condition !== "react-server").map((item) => item.specifier))];
  const framework = packedFrameworkContexts(manifest, runtimeSpecifiers);
  const frameworkRoles = new Map();
  for (const role of ["client", "server", "proxy"]) for (const specifier of framework[role]) frameworkRoles.set(specifier, role);
  const coverage = {
    declaredExportKeys: declared.length,
    concreteTargets: concreteTargets.length,
    runtimeImports: 0,
    reactServerImports: 0,
    staticTargets: 0,
    frameworkExports: 0,
    frameworkBuilds: framework.all.length > 0 ? 1 : 0,
    failed: 0,
    installedManifestSha256: hash("sha256", await readFile(join(installed, "package.json"))),
  };
  const operations = [];
  for (const item of concreteTargets) {
    const target = await containedRegularFile(installed, item.target);
    if (!item.runtime) coverage.staticTargets += 1;
    else if (item.condition !== "react-server" && frameworkRoles.has(item.specifier)) coverage.frameworkExports += 1;
    else {
      coverage.runtimeImports += 1;
      if (item.condition === "react-server") coverage.reactServerImports += 1;
    }
    if (!target) { coverage.failed += 1; continue; }
    if (item.runtime && (item.condition === "react-server" || !frameworkRoles.has(item.specifier))) {
      const result = await runProcess(process.execPath, runtimeImportArguments(item.condition, item.specifier, target, installed), { cwd: root, env: sanitizedEnv(root), timeout: QUALIFICATION_PHASE_TIMEOUTS.probe });
      operations.push({ id: `import:${item.condition}:${item.specifier}`, kind: "import", result });
      if (result.exitCode !== 0 || result.signal || result.launchError) coverage.failed += 1;
    }
  }
  if (framework.all.length > 0) {
    await writeNextFixture(root, framework);
    const result = await runProcess(join(root, "node_modules", ".bin", "next"), ["build"], {
      cwd: root,
      env: { ...sanitizedEnv(root), CI: "1", NEXT_TELEMETRY_DISABLED: "1" },
      timeout: QUALIFICATION_PHASE_TIMEOUTS.framework,
    });
    for (const role of ["client", "server", "proxy"]) for (const specifier of framework[role]) {
      operations.push({ id: `framework:next:${role}:${specifier}`, kind: "framework", result });
    }
    if (result.exitCode !== 0 || result.signal || result.launchError) coverage.failed += framework.all.length;
  }
  return { coverage, operations };
}

/** Execute the fixed, data-only contract against exactly one local tarball. */
export async function runCandidateQualification({ tarball, policy, adapter, fixtures, manifestBins, registry, consumerRoot = null, skipRollback = false, restoreConsumerOverlay = false }) {
  assertCredentialFree();
  const bytes = await readFile(tarball);
  const tarballDigests = { sha1: hash("sha1", bytes), sha256: hash("sha256", bytes), sha512: hash("sha512", bytes) };
  const ownsRoot = consumerRoot === null;
  const root = ownsRoot ? await realpath(await mkdtemp(join(tmpdir(), "foundry-candidate-"))) : await realpath(consumerRoot);
  // Aggregate execution reuses one consumer root.  Each supplied tarball gets
  // a content-addressed private path so a later candidate cannot overwrite a
  // prior adapter's packed bytes or fail on an existing artifact directory.
  const artifact = join(root, "artifact", `${tarballDigests.sha256}.tgz`);
  const artifactSpec = `file:./artifact/${tarballDigests.sha256}.tgz`;
  await mkdir(join(root, "artifact"), { recursive: true }); await writeFile(artifact, bytes, { flag: "wx" });
  const manifest = await packedManifest(artifact);
  if (adapter.package !== manifest.name) throw new Error("adapter package must equal packed manifest name");
  if (registry?.scope !== packageScope(manifest.name)) throw new Error("registry scope must match candidate package scope");
  const packedBins = normalizedBins(manifest);
  const contract = validateReleaseQualificationContract({ policy, adapter, fixtures, manifestBins: packedBins, peerDependencies: manifest.peerDependencies ?? {}, peerDependenciesMeta: manifest.peerDependenciesMeta ?? {} });
  if (contract.length) throw new Error(`invalid qualification contract: ${contract.map((item) => item.rule).join(",")}`);
  if (!sameBinMap(packedBins, manifestBins) || !sameBinKeys(packedBins, adapter.bins)) throw new Error("adapter must probe exactly the packed manifest bin map");

  const packagePolicy = policy.packages[adapter.package];
  const fixtureMaterializedAt = adapter.retainRawCaseEvidence === true ? new Date().toISOString() : null;
  const transcript = {
    // Aggregate execution has one shared install/rollback. It must not claim
    // the standalone v3's per-package rollback observations.
    schema: skipRollback ? "foundry-aggregate-child-execution-v1" : "foundry-candidate-qualification-transcript-v3",
    version: skipRollback ? 1 : 3,
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
      if (dimension === "rollback") return { dimension, status: "supported", evidence: skipRollback ? ["aggregate-rollback-delegated"] : ["uninstall", "reinstall"] };
      const group = adapter.dimensionEvidence.duplicate;
      return { dimension, status: "supported", evidence: adapter.cases.filter((item) => item.group === group && [0, 1].includes(item.exitCode)).map((item) => "case:" + item.id) };
    }),
    restoration: null,
    mismatches: [],
    ok: false,
  };
  if (fixtureMaterializedAt) transcript.fixtureMaterializedAt = fixtureMaterializedAt;
  const aggregateFixtureBackup = new Map();
  try {
    const fixtureRoot = ownsRoot || adapter.package === "@clossys/starter" ? join(root, "fixtures") : join(root, "fixtures", adapter.package.slice(adapter.package.indexOf("/") + 1));
    await mkdir(fixtureRoot, { recursive: true });
    const variables = { CANDIDATE_NAME: manifest.name, CANDIDATE_VERSION: manifest.version, CANDIDATE_INTEGRITY: npmIntegrity(tarballDigests.sha512), NOW: fixtureMaterializedAt ?? new Date().toISOString() };
    for (const fixture of adapter.fixtures) {
      const target = join(fixtureRoot, fixture);
      await mkdir(dirname(target), { recursive: true });
      if (!ownsRoot) {
        try { aggregateFixtureBackup.set(target, await readFile(target)); }
        catch (error) { if (error?.code !== "ENOENT") throw error; aggregateFixtureBackup.set(target, null); }
      }
      await writeFile(target, renderFixture(await readFile(fixtures[fixture].path, "utf8"), variables));
    }
    const userNpmrc = join(root, "user-npmrc");
    const globalNpmrc = join(root, "global-npmrc");
    await Promise.all([writeFile(userNpmrc, installNpmrc(registry)), writeFile(globalNpmrc, "")]);
    const frameworkFixtureDevDependencies = manifest.foundryReleaseVerification === undefined ? undefined : {
      "@types/node": "22.20.1",
      "@types/react": "19.2.18",
      typescript: "6.0.3",
    };
    if (ownsRoot) await writeFile(join(root, "package.json"), `${JSON.stringify({
      name: "foundry-candidate-consumer",
      private: true,
      type: "module",
      ...(frameworkFixtureDevDependencies ? { devDependencies: frameworkFixtureDevDependencies } : {}),
    }, null, 2)}\n`);

    const peerArgs = Object.entries(adapter.peerInstall ?? {}).sort(([left], [right]) => left.localeCompare(right)).map(([name, version]) => `${name}@${version}`);
    const install = ownsRoot ? await runProcess("npm", ["install", "--ignore-scripts", "--save-exact", artifactSpec, ...peerArgs], {
      cwd: root, env: sanitizedEnv(root), timeout: QUALIFICATION_PHASE_TIMEOUTS.npm,
    }) : { exitCode: 0, signal: null, launchError: false, stdout: "aggregate preinstall", stderr: "" };
    transcript.observations.push(observation(root, "install", "install", 0, install));
    if (install.exitCode !== 0 || install.signal || install.launchError) transcript.mismatches.push("install");
    // This file may temporarily contain an install credential. Candidate code sees
    // neither it nor the credential-bearing environment, even after an install error.
    await writeFile(userNpmrc, "");

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
    const exported = await exportCoverage(manifest, installed, root);
    for (const operation of exported.operations) {
      transcript.observations.push(observation(root, operation.id, operation.kind, 0, operation.result));
      if (operation.result.exitCode !== 0 || operation.result.signal || operation.result.launchError) transcript.mismatches.push(operation.id);
    }
    if (exported.coverage.failed !== 0) transcript.mismatches.push("export-coverage");
    for (const bin of Object.keys(adapter.bins).sort()) {
      const result = targets[bin]
        ? await runProcess(process.execPath, [targets[bin], "--help"], { cwd: root, env: sanitizedEnv(root), timeout: QUALIFICATION_PHASE_TIMEOUTS.probe })
        : { exitCode: null, signal: null, launchError: true, stdout: "", stderr: "missing contained bin target" };
      transcript.observations.push(observation(root, `help:${bin}`, "help", adapter.bins[bin], result));
      if (result.exitCode !== adapter.bins[bin] || result.signal || result.launchError) transcript.mismatches.push(`help:${bin}`);
    }
    const caseBase = { manifest: await readRegularFile(join(root, "package.json"), "consumer package.json"), lock: await readRegularFile(join(root, "package-lock.json"), "consumer package-lock.json") };
    const overlayRoots = new Set();
    for (const item of adapter.consumerOverlay ?? []) {
      const target = resolve(root, item.target);
      if (!target.startsWith(`${root}${sep}`)) throw new Error("consumer overlay escapes disposable root");
      const packageRoot = overlayPackageRoot(root, item.target);
      if (packageRoot) overlayRoots.add(packageRoot);
    }
    if (!restoreConsumerOverlay) await assertConsumerOverlayRootsAbsent(overlayRoots, "refuses to overwrite");
    const overlayBackup = new Map();
    for (const item of adapter.consumerOverlay ?? []) {
      const target = resolve(root, item.target);
      await mkdir(dirname(target), { recursive: true });
      if (restoreConsumerOverlay) {
        try { overlayBackup.set(target, await readRegularFile(target, `consumer overlay ${item.target}`)); }
        catch (error) { if (error?.code !== "ENOENT") throw error; overlayBackup.set(target, null); }
      }
      await copyFile(join(fixtureRoot, item.fixture), target);
    }
    const preparedCases = [];
    for (const item of adapter.cases) {
      const args = item.fixtureArgs
        ? item.fixtureArgs.map((fixture) => join(fixtureRoot, fixture))
        : await Promise.all(item.args.map((descriptor) => caseArgument(root, fixtureRoot, descriptor)));
      const descriptors = item.fixtureArgs ?? item.args;
      const snapshot = adapter.retainRawCaseEvidence === true ? await rawCaseInputSnapshot(root, fixtureRoot, descriptors, adapter.consumerOverlay) : null;
      preparedCases.push({ item, args, descriptors, snapshot });
    }
    for (const prepared of preparedCases) {
      const { item, args, snapshot } = prepared;
      const result = targets[item.bin]
        ? await runProcess(process.execPath, [targets[item.bin], ...args], { cwd: root, env: sanitizedEnv(root), timeout: QUALIFICATION_PHASE_TIMEOUTS.probe })
        : { exitCode: null, signal: null, launchError: true, stdout: "", stderr: "missing contained bin target" };
      if (adapter.retainRawCaseEvidence === true && targets[item.bin]) await assertRawCaseInputsUnchanged(root, fixtureRoot, preparedCases, adapter.consumerOverlay, result.exitCode);
      const observed = observation(root, `case:${item.id}`, "case", item.exitCode, result);
      if (adapter.retainRawCaseEvidence === true && targets[item.bin]) observed.rawCaseEvidence = rawCaseEvidence(root, targets[item.bin], args, snapshot, result);
      transcript.observations.push(observed);
      if (result.exitCode !== item.exitCode || result.signal || result.launchError) transcript.mismatches.push(`case:${item.id}`);
    }

    await restoreRegularFile(join(root, "package.json"), caseBase.manifest, "consumer package.json");
    await restoreRegularFile(join(root, "package-lock.json"), caseBase.lock, "consumer package-lock.json");
    if (restoreConsumerOverlay) {
      for (const [target, bytes] of overlayBackup) {
        await restoreRegularFile(target, bytes, "consumer overlay");
      }
    } else {
      for (const packageRoot of overlayRoots) await rm(packageRoot, { recursive: true, force: true });
      await assertConsumerOverlayRootsAbsent(overlayRoots, "post-case restoration failed");
    }

    const before = { manifest: await readFile(join(root, "package.json"), "utf8"), lock: await readFile(join(root, "package-lock.json"), "utf8") };
    let packageAbsentAfterUninstall = false;
    let restored = false;
    if (skipRollback) {
      // A preinstalled aggregate has one real all-package rollback.  Do not
      // manufacture individual npm observations: the aggregate transcript
      // owns absence and reinstall proof, while this child records delegation.
      restored = true;
    } else {
      const uninstall = await runProcess("npm", ["uninstall", manifest.name, "--ignore-scripts"], { cwd: root, env: sanitizedEnv(root), timeout: QUALIFICATION_PHASE_TIMEOUTS.npm });
      transcript.observations.push(observation(root, "uninstall", "uninstall", 0, uninstall));
      try { await lstat(installed); } catch { packageAbsentAfterUninstall = true; }
      const reinstall = await runProcess("npm", ["install", "--ignore-scripts", "--save-exact", artifactSpec], { cwd: root, env: sanitizedEnv(root), timeout: QUALIFICATION_PHASE_TIMEOUTS.npm });
      transcript.observations.push(observation(root, "reinstall", "reinstall", 0, reinstall));
      const after = { manifest: await readFile(join(root, "package.json"), "utf8"), lock: await readFile(join(root, "package-lock.json"), "utf8") };
      restored = before.manifest === after.manifest && before.lock === after.lock;
      if (uninstall.exitCode !== 0 || reinstall.exitCode !== 0 || !packageAbsentAfterUninstall || !restored) transcript.mismatches.push("restoration");
    }

    transcript.consumer = { manifestSha256: consumerDigest(root, before.manifest), lockfileSha256: consumerDigest(root, before.lock) };
    transcript.coverage = { ...exported.coverage, bins: Object.keys(packedBins).length, lifecycleScriptsDisabled };
    transcript.restoration = skipRollback ? { delegatedToAggregate: true } : { manifestRestored: restored, lockfileRestored: restored, packageAbsentAfterUninstall };
    transcript.mismatches.sort();
    transcript.ok = transcript.mismatches.length === 0;
    transcript.canonicalSha256 = hash("sha256", JSON.stringify(transcript));
    return transcript;
  } finally {
    // In aggregate mode Starter intentionally uses root/fixtures so its v3
    // raw evidence remains compatible.  Every preexisting fixture byte is
    // restored here, including failures during a case or framework build.
    for (const [target, bytes] of aggregateFixtureBackup) {
      if (bytes === null) await rm(target, { force: true });
      else await writeFile(target, bytes);
    }
    if (ownsRoot) await rm(root, { recursive: true, force: true });
  }
}
