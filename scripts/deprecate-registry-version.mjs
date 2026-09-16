#!/usr/bin/env node
// Deprecate one exact version — or one resolved range — of a package that is
// still alive on the public npm registry.
//
//   node scripts/deprecate-registry-version.mjs \
//     --package <@scope/name> --versions <spec> --message <text> --mode dry-run|apply
//
// Exit 0 = the intended notice is present on every exact version, confirmed by
// an anonymous read. Exit 1 = a concrete mismatch: the packument was read and
// it disagrees with what was asked for. Exit 2 = an input or a registry answer
// this script could not establish; uncertainty never passes.
//
// Those last two are kept apart on purpose — see verifyDeprecationState. An
// exit code the code cannot actually reach is a stated contract with nothing
// behind it, which is the defect class this repository keeps finding (#914),
// so "a mismatch fails" has to be a path, not a sentence in a header.
//
// A version carrying a dist-tag needs `--allow-dist-tagged true`. That guard
// exists because `--versions '*'` resolves to EVERY published version,
// `latest` included, without the operator ever naming it; see
// assertDistTagOptIn for why the gate keys on blast radius rather than count.
//
// WHY THIS IS NOT scripts/deprecate-legacy-packages.mjs
// -----------------------------------------------------
// That script deprecates a retired NAME, and derives its whole plan from
// docs/contracts/package-lifecycle.json, where every entry must carry a
// `replacement.name`. It has no model for the case here: a package that is
// still current, still the thing to install, with one BROKEN VERSION among
// good ones. There is no replacement NAME to point at — the replacement is a
// different version of the same package — so the lifecycle contract cannot
// express it and the derived plan will never contain it.
//
// DEPRECATION IS REVERSIBLE, AND THAT CHANGES THE RISK CALCULUS
// -------------------------------------------------------------
// Publishing is not reversible: bytes, once uploaded, are permanent, and npm's
// unpublish window is narrow and conditional. A deprecation is different in
// kind. `npm deprecate <pkg>@<ver> ""` clears the notice, and this script
// applies a cleared message by the same path it applies a set one — pass
// `--message ""` and the verification below inverts to assert the field is
// ABSENT. So a wrong message here is a correctable mistake, not a permanent
// one, and this tool is genuinely exercisable end to end in a way that
// publish-shaped tooling never is.
//
// That is a reason to TEST it, not a reason to be casual with it. The notice
// is public the moment it lands, it is what every installer prints, and
// "we cleared it an hour later" does not un-print it for anyone who installed
// in between.
//
// WHY A PREFLIGHT EXISTS AT ALL — THE MEASURED HAZARD
// ---------------------------------------------------
// `npm deprecate` exits 0 when its version spec matches NOTHING. Measured
// against this repository's own registry target with npm 11.12.1:
//
//   npm deprecate '<pkg>@<absent>'  msg --dry-run  ->  "npm warn deprecate
//                                                       No version found"
//                                                  ->  exit 0
//   npm deprecate '<pkg>@<present>' msg --dry-run  ->  "npm notice
//                                                       deprecating ..."
//                                                  ->  exit 0
//
// Identical exit codes. A typo in the version therefore produces a silent
// no-op that an operator reads as a successful deprecation, while the broken
// version stays installable with no warning — the exact state this tool was
// written to end. The exit code cannot be the signal, so this script parses
// npm's own resolution and refuses an empty match before any mutation.
//
// WHY npm RESOLVES THE RANGE AND THIS SCRIPT DOES NOT
// ---------------------------------------------------
// This repository ships no runtime dependencies; every script here imports
// `node:` builtins only. Reimplementing semver range matching to preview a
// range would mean a second, subtly different resolver deciding which versions
// get a permanent public notice — a divergence between the preview and the
// mutation is precisely the failure this preflight exists to stop. So the
// authority for "which versions does this spec select" is npm itself, read
// from `npm deprecate --dry-run`: the same code path that performs the write.
//
// That preview costs nothing in trust. `npm deprecate --dry-run` needs no
// credential: its packument read (`GET /<pkg>?write=true`) returns 200
// anonymously for a public package, so the entire dry-run mode of this script
// — and of the workflow that calls it — authenticates to nothing and is fully
// exercisable without a token.
//
// AUTHENTICATION — WHY A STORED TOKEN, NOT OIDC
// ----------------------------------------------
// This repository publishes with npm trusted publishing over OIDC and stores
// no npm token, deliberately. That path CANNOT authorize this operation. npm
// documents OIDC as supporting `npm publish` and `npm stage publish` only, and
// in the npm CLI the OIDC token exchange (`lib/utils/oidc.js`) is required
// from exactly one file, `lib/commands/publish.js`. `npm deprecate` never
// reaches it: it authenticates through `otplease` against an existing token
// and PUTs the mutated packument.
//
// So an apply here requires a stored npm granular token with write access to
// the scope. This script does not create, request, or read one — it requires
// the environment to carry it and REFUSES LOUDLY when it does not, because a
// deprecation run that silently does nothing is the failure mode above
// wearing a green check.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  POST_PUBLISH_VISIBILITY_RETRY_DELAYS_MS,
  PUBLIC_NPM_REGISTRY,
  fetchPublicNpmPackument,
} from "./lib/public-npm-registry.mjs";

const MODES = new Set(["dry-run", "apply"]);
const SCOPED_NAME = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;
const CANONICAL_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;
const MAX_MESSAGE_BYTES = 512;
const DEL_CODE_POINT = 127;
const FIRST_PRINTABLE_CODE_POINT = 32;

const usage =
  "Usage: --package <@scope/name> --versions <spec> --message <text> --mode dry-run|apply [--allow-dist-tagged true]";

/** Exit 2 — an input or registry answer this script refuses to guess at. */
export class IndeterminateError extends Error {}

export function argsFrom(argv) {
  const allowed = { package: true, versions: true, message: true, mode: true, "allow-dist-tagged": true };
  const result = {};
  for (let index = 2; index < argv.length; index += 2) {
    const key = argv[index]?.slice(2);
    const value = argv[index + 1];
    // `--message ""` is the documented clear/undeprecate form, so an empty
    // string is a real value here where it is a usage error everywhere else.
    const empty = value === "";
    if (!Object.hasOwn(allowed, key) || value === undefined || (empty && key !== "message") || result[key] !== undefined) {
      throw new IndeterminateError(usage);
    }
    result[key] = value;
  }
  for (const required of ["package", "versions", "message", "mode"]) {
    if (result[required] === undefined) throw new IndeterminateError(usage);
  }
  if (!MODES.has(result.mode)) throw new IndeterminateError(`--mode must be one of: ${[...MODES].join(", ")}`);
  if (result["allow-dist-tagged"] !== undefined && !["true", "false"].includes(result["allow-dist-tagged"])) {
    throw new IndeterminateError("--allow-dist-tagged must be true or false");
  }
  return result;
}

/**
 * A version spec must look like a version spec and nothing else.
 *
 * The spec reaches npm through an argument vector, so there is no shell to
 * inject into; this refuses the subtler thing — a spec that is not a version
 * spec at all (a flag, a path, a second package name) smuggled into the
 * argument that decides what receives a permanent public notice.
 */
export function assertVersionSpec(spec) {
  if (typeof spec !== "string" || spec.trim() !== spec || spec.length === 0 || spec.length > 128) {
    throw new IndeterminateError("--versions must be a trimmed, non-empty version spec under 128 characters");
  }
  // A leading "-" or "+" is the one spec shape that could be read as an
  // option rather than a version, so it is refused by shape here rather than
  // left to npm resolving it to nothing further downstream.
  if (/^[-+]/.test(spec)) {
    throw new IndeterminateError(`--versions must not begin with "-" or "+": ${JSON.stringify(spec)}`);
  }
  if (!/^[0-9A-Za-z.\-+~^*<>=|\s]+$/.test(spec)) {
    throw new IndeterminateError(`--versions contains characters that are not part of a version spec: ${JSON.stringify(spec)}`);
  }
}

/** A control character in a notice every installer prints verbatim. */
export function hasControlCharacter(value) {
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code < FIRST_PRINTABLE_CODE_POINT || code === DEL_CODE_POINT) return true;
  }
  return false;
}

export function assertMessage(message) {
  if (typeof message !== "string") throw new IndeterminateError("--message must be a string");
  if (Buffer.byteLength(message, "utf8") > MAX_MESSAGE_BYTES) {
    throw new IndeterminateError(`--message must be at most ${MAX_MESSAGE_BYTES} bytes`);
  }
  // The notice is printed verbatim by every installer; a control character
  // there is at best unreadable and at worst terminal-escape shaped.
  if (hasControlCharacter(message)) {
    throw new IndeterminateError("--message must not contain control characters");
  }
}

/**
 * Refuse any package outside this repository's own declared scope.
 *
 * A token with scope write access can deprecate anything in that scope, and
 * the argument naming the target is free text typed into a dispatch form. This
 * is the guard that stops a mistyped name writing a public notice onto a
 * package this repository does not publish.
 */
export function assertPackageInScope(name, scope) {
  if (typeof name !== "string" || !SCOPED_NAME.test(name)) {
    throw new IndeterminateError("--package must be a canonical scoped package name");
  }
  if (!name.startsWith(`${scope}/`)) {
    throw new IndeterminateError(
      `--package ${name} is not in this repository's scope ${scope} — refusing to mutate a package this repository does not publish`,
    );
  }
}

export function assertPublicRegistry(registry) {
  if (registry !== PUBLIC_NPM_REGISTRY) {
    throw new IndeterminateError(`registry deprecation supports only ${PUBLIC_NPM_REGISTRY}, not ${registry}`);
  }
}

/**
 * Read the exact versions npm itself resolved, from its own dry-run notices.
 *
 * npm prints one `deprecating <name>@<version> with message "..."` notice per
 * selected version, and `No version found for <spec>` when the spec selects
 * nothing — both on stderr, both under exit 0. Parsing is therefore the only
 * way to tell those two apart. The name is matched exactly, so a notice about
 * some other package can never be counted as a resolution of this one.
 */
export function resolvedVersionsFrom(output, packageName) {
  if (typeof output !== "string") throw new IndeterminateError("npm dry-run produced no readable output");
  const versions = [];
  for (const raw of output.split("\n")) {
    const line = raw.trim();
    const match = /^npm\s+(?:notice|warn|info)?\s*(?:deprecate\s+)?(?:deprecating|undeprecating)\s+(\S+)@(\S+?)(?:\s+with\s+message\b.*)?$/.exec(line);
    if (!match) continue;
    if (match[1] !== packageName) continue;
    if (!CANONICAL_VERSION.test(match[2])) {
      throw new IndeterminateError(`npm resolved an unreadable version for ${packageName}: ${JSON.stringify(match[2])}`);
    }
    if (!versions.includes(match[2])) versions.push(match[2]);
  }
  return versions;
}

export function assertResolvedVersions({ versions, packageName, spec }) {
  if (versions.length === 0) {
    throw new IndeterminateError(
      `no version of ${packageName} matches ${JSON.stringify(spec)} on the registry — refusing to write a deprecation notice against nothing. ` +
        "npm exits 0 for a spec that matches no version, so this refusal is the only signal that a typo did not silently no-op.",
    );
  }
}

/**
 * Cross-check npm's resolution against an independent anonymous read.
 *
 * npm resolved the spec through its own (authenticated-capable) path; this
 * confirms those same versions are what the public anonymous edge actually
 * serves, so a notice is never written against a version no consumer sees.
 */
export function assertVersionsPresentInPackument({ document, versions, packageName }) {
  const present = new Set(Object.keys(document?.versions ?? {}));
  const missing = versions.filter((version) => !present.has(version));
  if (missing.length > 0) {
    throw new IndeterminateError(
      `the anonymous packument for ${packageName} does not contain ${missing.join(", ")} — refusing a notice against a version the public registry does not serve`,
    );
  }
}

/** Which of the targeted versions currently carry a dist-tag, `latest` included. */
export function distTagsOver({ document, versions }) {
  const tags = [];
  for (const [tag, version] of Object.entries(document?.["dist-tags"] ?? {})) {
    if (versions.includes(version)) tags.push({ tag, version });
  }
  return tags.sort((left, right) => left.tag.localeCompare(right.tag, "en"));
}

/**
 * Refuse to notice a dist-tagged version unless that was asked for explicitly.
 *
 * The advisory warning this replaces was the wrong shape. A notice on the
 * version behind `latest` is what EVERY default `npm install` prints, which is
 * a categorically larger blast radius than deprecating a superseded version —
 * and `--versions '*'` reaches it without the operator ever naming it, because
 * `*` resolves to every published version including whichever holds the tag.
 *
 * This is not a count limit. Deprecating fifty superseded versions is a normal,
 * low-risk bulk operation and stays unguarded; deprecating the one version new
 * consumers actually get is the decision worth making deliberately. So the gate
 * keys on the blast radius, not the size, and the opt-in must name itself.
 */
export function assertDistTagOptIn({ tagged, allowDistTagged, packageName }) {
  if (tagged.length === 0 || allowDistTagged) return;
  const described = tagged.map(({ tag, version }) => `${packageName}@${version} holds "${tag}"`).join("; ");
  throw new IndeterminateError(
    `refusing to write a notice onto a dist-tagged version without an explicit opt-in: ${described}. ` +
      "A notice there is what every default install prints. Re-dispatch with allow_dist_tagged enabled if that is genuinely intended.",
  );
}

/**
 * Compare observed deprecation state against what was asked for.
 *
 * `--message ""` clears a notice, so the assertion inverts: an empty message
 * must leave the field ABSENT, and a non-empty one must leave it exactly
 * equal. "Deprecated at all" is not good enough — a stale notice from an
 * earlier run would satisfy that and hide a write that never landed.
 */
export function deprecationMismatches({ document, versions, message }) {
  const mismatches = [];
  for (const version of versions) {
    const observed = document?.versions?.[version]?.deprecated;
    if (message === "") {
      if (observed !== undefined) mismatches.push({ version, expected: "(no notice)", observed });
    } else if (observed !== message) {
      mismatches.push({ version, expected: message, observed: observed === undefined ? "(no notice)" : observed });
    }
  }
  return mismatches;
}

function sleep(ms) {
  return new Promise((done) => { setTimeout(done, ms); });
}

/**
 * Re-read the packument anonymously until it shows the intended state.
 *
 * Anonymous, because "the maintainer who just wrote it can see it" is not the
 * claim worth proving — the claim is that an ordinary installer sees it. The
 * registry can acknowledge the PUT before its public edge serves the change,
 * so this reuses the same bounded visibility window post-publish verification
 * uses.
 *
 * WHAT THE CLOSED WINDOW MEANS DEPENDS ON THE LAST OBSERVATION, and the two
 * outcomes are deliberately not folded together (the same distinction
 * verify-post-publish-public-npm-artifact.mjs draws for published bytes):
 *
 *   unreadable -> INDETERMINATE. We never got a packument to judge. The write
 *                 already happened and is not disputed by not yet being
 *                 readable.
 *   mismatch   -> a CONCRETE FINDING. We read the packument, repeatedly, and
 *                 it disagrees with what was asked for. That is a fact about
 *                 a document we DID observe, not an absence of evidence.
 *
 * Retrying THROUGH a mismatch is still right: a stale edge legitimately serves
 * the old notice for a while. Only the final observation decides the verdict.
 */
export async function verifyDeprecationState({
  registry,
  name,
  versions,
  message,
  fetchImpl = fetch,
  delays = POST_PUBLISH_VISIBILITY_RETRY_DELAYS_MS,
  wait = sleep,
}) {
  let last = null;
  for (const delay of delays) {
    if (delay > 0) await wait(delay);
    const result = await fetchPublicNpmPackument({ registry, name, fetchImpl });
    if (result.kind !== "found") {
      last = { kind: "unreadable", detail: result.detail ?? result.kind };
      continue;
    }
    const mismatches = deprecationMismatches({ document: result.document, versions, message });
    if (mismatches.length === 0) return { kind: "verified", versions };
    last = { kind: "mismatch", mismatches };
  }
  if (last?.kind === "mismatch") return { kind: "mismatch", mismatches: last.mismatches };
  return { kind: "indeterminate", detail: last };
}

/**
 * The stored-credential requirement, enforced rather than assumed.
 *
 * OIDC cannot reach `npm deprecate` (see this file's header), so an apply run
 * without a token does not fail cleanly — it fails as a 401 somewhere
 * downstream, or worse, as a run that looks like it did something. Refusing up
 * front, before any registry call, keeps a missing credential a visible, named
 * blocker instead of a green run that mutated nothing.
 */
export function assertApplyCredentialPresent(env) {
  const token = env.NODE_AUTH_TOKEN;
  if (typeof token !== "string" || token.trim().length === 0) {
    throw new IndeterminateError(
      "apply mode requires a stored npm token in NODE_AUTH_TOKEN with write access to this scope. " +
        "npm's OIDC trusted-publishing exchange authorizes `npm publish` and `npm stage publish` only and cannot authorize `npm deprecate`, " +
        "so this operation has no credential-free path. Refusing before any registry call rather than reporting a run that mutated nothing.",
    );
  }
}

/**
 * Run npm and return stdout and stderr together.
 *
 * spawnSync, not execFileSync: npm writes the `deprecating <pkg>@<ver>`
 * resolution notices this script parses to STDERR, and execFileSync returns
 * stdout only on a successful run — the resolution would be unreadable exactly
 * when the command worked.
 */
export function runNpmDeprecate({ name, spec, message, registry, dryRun, env, spawn = spawnSync }) {
  const args = ["deprecate", `${name}@${spec}`, message, `--registry=${registry}`];
  if (dryRun) args.push("--dry-run");
  const result = spawn("npm", args, { encoding: "utf8", env });
  if (result.error) throw new IndeterminateError(`could not run npm: ${result.error.message}`);
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status !== 0) {
    throw new IndeterminateError(`npm deprecate exited ${result.status}: ${output.trim()}`);
  }
  return output;
}

export async function deprecateRegistryVersion({
  root = process.cwd(),
  packageName,
  spec,
  message,
  mode,
  env = process.env,
  fetchImpl = fetch,
  log = console.log,
  identity = undefined,
  allowDistTagged = false,
  npmRun = runNpmDeprecate,
  delays = undefined,
} = {}) {
  const resolved = identity ?? JSON.parse(readFileSync(resolve(root, "package-scope.json"), "utf8"));
  const registry = resolved.registry;
  const scope = resolved.scope;

  assertPublicRegistry(registry);
  assertPackageInScope(packageName, scope);
  assertVersionSpec(spec);
  assertMessage(message);

  const intent = message === "" ? "clear the deprecation notice on" : "deprecate";
  log(`plan: ${intent} ${packageName}@${spec} at ${registry} (mode: ${mode})`);

  // ---- Preflight. Anonymous; no credential is used or required. ----
  const preview = npmRun({ name: packageName, spec, message, registry, dryRun: true, env });
  const versions = resolvedVersionsFrom(preview, packageName);
  assertResolvedVersions({ versions, packageName, spec });

  const before = await fetchPublicNpmPackument({ registry, name: packageName, fetchImpl });
  if (before.kind !== "found") {
    throw new IndeterminateError(`could not read the anonymous packument for ${packageName}: ${before.detail ?? before.kind}`);
  }
  assertVersionsPresentInPackument({ document: before.document, versions, packageName });

  log(`preflight: ${versions.length} exact version(s) resolved by npm and present on the anonymous registry edge:`);
  for (const version of versions) {
    const current = before.document.versions[version]?.deprecated;
    log(`  - ${packageName}@${version}${current === undefined ? "" : ` (already deprecated: ${JSON.stringify(current)})`}`);
  }
  const tagged = distTagsOver({ document: before.document, versions });
  for (const { tag, version } of tagged) {
    log(`  ! ${packageName}@${version} is currently the "${tag}" dist-tag — a notice here is what every default install prints`);
  }
  assertDistTagOptIn({ tagged, allowDistTagged, packageName });

  if (mode === "dry-run") {
    log("dry-run: no registry mutation attempted, and no credential was used. Re-dispatch with dry_run disabled to apply.");
    return { kind: "planned", versions };
  }

  // ---- Apply. The only step that needs a credential. ----
  assertApplyCredentialPresent(env);
  npmRun({ name: packageName, spec, message, registry, dryRun: false, env });
  log(`applied: npm deprecate accepted the packument write for ${versions.length} version(s)`);

  // ---- Verify. Anonymous again: prove an ordinary installer sees it. ----
  const verified = await verifyDeprecationState({
    registry,
    name: packageName,
    versions,
    message,
    fetchImpl,
    ...(delays ? { delays } : {}),
  });
  if (verified.kind === "verified") {
    log(`verified: the anonymous packument shows the intended state on every targeted version of ${packageName}`);
    return { kind: "verified", versions };
  }
  // A stable mismatch is a real finding about a document we read, so it fails
  // (exit 1) rather than folding into "could not establish" (exit 2).
  if (verified.kind === "mismatch") {
    throw new Error(
      `the registry write was accepted but the anonymous packument still disagrees with the intended state: ${JSON.stringify(verified.mismatches)}`,
    );
  }
  throw new IndeterminateError(
    `the registry write was accepted but anonymous verification did not settle within the observation window: ${JSON.stringify(verified.detail)}. ` +
      "This is indeterminate, not a failed write — re-read the packument before re-dispatching.",
  );
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  let args;
  try {
    args = argsFrom(process.argv);
  } catch (error) {
    console.error(`deprecate-registry-version: ${error.message}`);
    process.exit(2);
  }
  deprecateRegistryVersion({
    packageName: args.package,
    spec: args.versions,
    message: args.message,
    mode: args.mode,
    allowDistTagged: args["allow-dist-tagged"] === "true",
  }).catch((error) => {
    console.error(`deprecate-registry-version: ${error.message}`);
    process.exit(error instanceof IndeterminateError ? 2 : 1);
  });
}
