#!/usr/bin/env node
// check-merge-policy — fail when the forge permits a merge method this
// repository has declared it does not use.
//
//   node scripts/check-merge-policy.mjs [--policy <file>] [--json]
//
// Exit 0 = the forge's live configuration matches governance/merge-policy.json.
// Exit 1 = at least one drift finding. Exit 2 = the check could not be
// completed — no token, an API error, a response this gate could not parse,
// or a credential that cannot see the settings it exists to read. Same
// three-state contract every gate in this repo uses (see CONTRIBUTING.md's
// "Gate CLIs exit 0/1/2" entry): a check that cannot run must fail, never
// silently pass.
//
// WHY THIS GATE EXISTS
// --------------------
// Eight commits reachable from this repository's trunk carry private identity
// in their MESSAGE text. Every one is a squash-merged dependency-bot pull
// request, and no author wrote the offending line. The forge composes a squash
// commit's message server-side and appends a `Co-authored-by:` trailer per
// contributor to the squashed branch, built from each account's PUBLIC PROFILE
// email rather than from the address configured on the commits being squashed.
// Every local and global git identity in this repository was already the
// privacy-preserving forge noreply form throughout. The address was published
// anyway, on every squash, after every check had already passed.
//
// scripts/check-commit-messages.mjs is the gate for commit message text, and
// it cannot prevent this: the trailer is written at merge time, so there is no
// commit for it to scan until the disclosure has already happened. Its own
// header already exempts the forge's NOREPLY trailer form as machine-generated
// and unavoidable; what it did not anticipate is that the same server-side step
// also emits a plain profile address when an account has not enabled
// address privacy. So the exposure is created by the choice of merge method,
// one click earlier than any gate in this repository can see.
//
// WHAT THIS GATE CANNOT DO -- READ THIS BEFORE TRUSTING IT
// --------------------------------------------------------
// It cannot prevent a squash merge, and it does not try to. The merge methods
// a repository offers live in the forge's own settings store, not in the git
// tree; changing them needs an Administration-level credential, which is
// categorically more privilege than the read-only token this runs with and
// more than any workflow here should hold. This gate OBSERVES that
// configuration and fails when it drifts from the declaration. The first
// application of the declaration is a human action in repository settings,
// outside this repository. What the gate buys is that the setting cannot then
// be reverted silently.
//
// It is also blind to the sharpest half of the same hazard. The account-level
// "Keep my email addresses private" setting is the only control that also
// covers a squash commit's AUTHOR header, which carries the same address in
// commit metadata rather than message text, and which no gate in this
// repository reads at all. That setting cannot be observed from here without
// naming a personal account, and naming one is exactly what the identity
// denylist refuses. governance/merge-policy.json records it as unassertable
// rather than pretending otherwise.
//
// NEVER WIRED INTO LOCAL `npm run check`
// --------------------------------------
// Every gate in that aggregate scans this checkout: offline, hermetic, exactly
// reproducible on a fork's CI run with no credentials. This one reads the live
// forge API and needs a token. Wiring it into `check` would fail the whole
// chain for every contributor who is not the repository owner, or teach them to
// ignore it. It runs on its own schedule in .github/workflows/merge-policy.yml,
// where the precondition is actually met -- the same reasoning that keeps
// check:conversation and check:package-visibility out of `check`.
//
// NO HARDCODED REPOSITORY IDENTITY
// --------------------------------
// The account and repository are derived from the published manifests' own
// `repository.url`, the same second, independent source check-foreign-
// references.mjs derives them from. A gate that hardcodes the identity it
// checks keeps passing after a transfer, against a repository nobody here
// owns any more.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");

// GitHub's three merge methods, named as the ruleset API's
// `allowed_merge_methods` parameter names them, each paired with the
// repository-settings boolean that offers it.
export const MERGE_METHODS = Object.freeze({
  merge: "allow_merge_commit",
  squash: "allow_squash_merge",
  rebase: "allow_rebase_merge",
});

// ------------------------------------------------------------------ evaluation
//
// Pure, and deliberately separated from every byte of IO so the behaviour that
// matters can be tested without a network, a token, or a fixture server. The
// caller hands in what it read; this decides what it means.

/**
 * Which merge methods can actually land a commit on the declared default
 * branch, given the repository settings and the branch's effective rules?
 *
 * A ruleset `pull_request` rule carrying `allowed_merge_methods` NARROWS the
 * repository-level allowance; it never widens it. Intersecting rather than
 * replacing is the load-bearing part: a ruleset naming a method the repository
 * itself does not offer does not make that method available, and reading the
 * ruleset alone would report one that cannot be used.
 *
 * More than one `pull_request` rule can apply to the same branch at once —
 * GitHub enforces every ruleset that targets it simultaneously, each
 * contributing its own restriction, so the true effective set is the
 * intersection of ALL of them, not just the first one this API response
 * happens to list. Taking only the first (an earlier version of this
 * function did) is always a superset of the truth: it can never let an
 * undeclared method through undetected, but it CAN report a declared method
 * as available when a second ruleset this gate ignored actually forbids it —
 * silently defeating the half of `evaluate` that exists to catch a stale
 * declaration.
 */
export function effectiveMergeMethods(repository, branchRules) {
  const repositoryLevel = [];
  for (const [method, field] of Object.entries(MERGE_METHODS)) {
    if (repository[field] === true) repositoryLevel.push(method);
  }
  const restrictions = branchRules
    .filter((rule) => rule?.type === "pull_request")
    .map((rule) => rule?.parameters?.allowed_merge_methods)
    .filter((value) => Array.isArray(value));
  return restrictions.reduce(
    (allowed, restriction) => allowed.filter((method) => restriction.includes(method)),
    repositoryLevel,
  );
}

/**
 * Compare the declaration against what the forge actually permits.
 *
 * Both directions are reported, and they are not the same defect:
 *
 *   permits-undeclared -- the forge offers a method this repository says it
 *     does not use. This is the direction that publishes identity. It is the
 *     finding this gate exists for.
 *   declared-unavailable -- this repository declares a method the forge does
 *     not offer. Nothing leaks, but the declaration is describing a repository
 *     that does not exist, and a stale declaration is how a drift alarm stops
 *     meaning anything.
 */
export function evaluate({ policy, repository, branchRules }) {
  const declared = policy.permittedMergeMethods;
  const effective = effectiveMergeMethods(repository, branchRules);
  const findings = [];
  for (const method of effective) {
    if (!declared.includes(method)) {
      findings.push({
        kind: "permits-undeclared",
        method,
        severity: "high",
        detail:
          `the forge permits a "${method}" merge into ${policy.defaultBranch}, which ` +
          `governance/merge-policy.json does not list as permitted`,
      });
    }
  }
  for (const method of declared) {
    if (!effective.includes(method)) {
      findings.push({
        kind: "declared-unavailable",
        method,
        severity: "medium",
        detail:
          `governance/merge-policy.json permits a "${method}" merge into ${policy.defaultBranch}, ` +
          `but the forge does not offer one`,
      });
    }
  }
  return { declared, effective, findings };
}

// --------------------------------------------------------------- declaration
//
// A malformed declaration is exit 2, never exit 0. This gate's entire output is
// a comparison against this file; if it cannot be trusted, the gate never
// formed an opinion and must say so rather than report agreement with a shape
// it guessed at.

export function parsePolicy(raw, label) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${label} does not parse: ${error.message}`);
  }
  if (typeof parsed.defaultBranch !== "string" || parsed.defaultBranch === "") {
    throw new Error(`${label} declares no defaultBranch`);
  }
  if (!Array.isArray(parsed.permittedMergeMethods) || parsed.permittedMergeMethods.length === 0) {
    throw new Error(`${label} declares no permittedMergeMethods`);
  }
  const unknown = parsed.permittedMergeMethods.filter((m) => !Object.hasOwn(MERGE_METHODS, m));
  if (unknown.length > 0) {
    throw new Error(
      `${label} names merge method(s) this gate does not know: ${unknown.join(", ")} ` +
        `(expected any of ${Object.keys(MERGE_METHODS).join(", ")})`,
    );
  }
  return parsed;
}

// -------------------------------------------------------- repository identity

const REPOSITORY_URL_RE =
  /github\.com[/:]([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)\/([A-Za-z0-9][A-Za-z0-9._-]*?)(?:\.git)?$/;

export function deriveRepository(root, { existsSync: exists = existsSync, readFileSync: read = readFileSync, readdirSync: readdir = readdirSync } = {}) {
  const candidates = [join(root, "package.json")];
  const packagesDir = join(root, "packages");
  if (exists(packagesDir)) {
    for (const entry of readdir(packagesDir).sort()) candidates.push(join(packagesDir, entry, "package.json"));
  }
  const found = new Set();
  for (const manifestPath of candidates) {
    if (!exists(manifestPath)) continue;
    let manifest;
    try {
      manifest = JSON.parse(read(manifestPath, "utf8"));
    } catch (error) {
      throw new Error(`${manifestPath} does not parse: ${error.message}`);
    }
    const url = typeof manifest.repository === "string" ? manifest.repository : manifest.repository?.url;
    if (typeof url !== "string") continue;
    const match = url.match(REPOSITORY_URL_RE);
    if (!match) {
      throw new Error(
        `${manifestPath} declares repository.url "${url}", which this gate cannot read as an ` +
          `<account>/<repository> pair — refusing to query an identity it could not parse`,
      );
    }
    found.add(`${match[1]}/${match[2]}`);
  }
  if (found.size === 0) {
    throw new Error(
      "no package.json declares a repository.url — this gate derives the forge account and repository " +
        "from that field and will not fall back to a hardcoded identity",
    );
  }
  if (found.size > 1) {
    throw new Error(
      `the manifests disagree about which repository this is (${[...found].sort().join(", ")}) — ` +
        `"own" is ambiguous and this gate refuses to pick one`,
    );
  }
  return [...found][0];
}

// ------------------------------------------------------------------------ IO

async function readForge(slug, branch, token, fetchImpl) {
  const request = async (path) => {
    const response = await fetchImpl(`https://api.github.com/repos/${slug}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "check-merge-policy",
      },
    });
    if (!response.ok) {
      throw new Error(`GET /repos/<repository>${path} returned HTTP ${response.status}`);
    }
    try {
      return await response.json();
    } catch (error) {
      throw new Error(`GET /repos/<repository>${path} returned a body this gate could not parse: ${error.message}`);
    }
  };
  return {
    repository: await request(""),
    branchRules: await request(`/rules/branches/${encodeURIComponent(branch)}`),
  };
}

/**
 * A credential that cannot SEE the merge settings reports them as absent, and
 * absent reads identically to "every method is disabled" — which would be a
 * clean pass this gate never earned. Missing fields are therefore exit 2, not
 * a finding and certainly not agreement.
 */
export function assertObservable(repository, branchRules) {
  const blind = Object.values(MERGE_METHODS).filter((field) => typeof repository?.[field] !== "boolean");
  if (blind.length > 0) {
    throw new Error(
      `the repository response carried no ${blind.join(", ")} — a credential that cannot see the merge ` +
        `settings reads exactly like a repository that offers no merge method at all, so this is reported ` +
        `as "could not check", never as a pass`,
    );
  }
  if (!Array.isArray(branchRules)) {
    throw new Error(
      "the branch rules response was not a list — this gate cannot tell a branch with no rules from a " +
        "response it failed to understand, and will not guess",
    );
  }
}

// ---------------------------------------------------------------------- main

async function main(argv) {
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i !== -1 ? argv[i + 1] : undefined;
  };
  const asJson = argv.includes("--json");
  const policyPath = flag("--policy") ?? join(repoRoot, "governance", "merge-policy.json");

  let policy;
  let slug;
  try {
    policy = parsePolicy(readFileSync(policyPath, "utf8"), "governance/merge-policy.json");
    slug = deriveRepository(repoRoot);
  } catch (error) {
    console.error(`check-merge-policy: ${error.message}`);
    return 2;
  }

  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? null;
  if (!token) {
    console.error(
      "check-merge-policy: no $GH_TOKEN or $GITHUB_TOKEN — this gate reads the forge's live merge\n" +
        "  settings and cannot form an opinion without one. Reporting \"could not check\" (exit 2)\n" +
        "  rather than a pass it never earned.",
    );
    return 2;
  }

  let forge;
  try {
    forge = await readForge(slug, policy.defaultBranch, token, globalThis.fetch);
    assertObservable(forge.repository, forge.branchRules);
  } catch (error) {
    console.error(`check-merge-policy: ${error.message}`);
    return 2;
  }

  const result = evaluate({ policy, repository: forge.repository, branchRules: forge.branchRules });

  if (asJson) {
    console.log(JSON.stringify({ declared: result.declared, effective: result.effective, findings: result.findings }, null, 2));
  } else {
    console.log(`check-merge-policy: branch "${policy.defaultBranch}"`);
    console.log(`  declared permitted: ${result.declared.join(", ")}`);
    console.log(`  forge permits:      ${result.effective.join(", ") || "(none)"}`);
  }

  if (result.findings.length === 0) {
    if (!asJson) console.log("\nPASS — the forge's merge configuration matches the declaration.");
    return 0;
  }

  if (!asJson) {
    console.error(`\nFAIL — ${result.findings.length} merge-policy drift finding(s):\n`);
    for (const finding of result.findings) console.error(`  [${finding.severity}] ${finding.detail}`);
    console.error(
      "\nThis gate cannot apply the declaration — merge methods live in the forge's settings store,\n" +
        "not in this tree, and writing them needs Administration-level access. A repository\n" +
        "administrator changes it under Settings, or adds a branch ruleset that restricts merge\n" +
        "methods. See SECURITY.md's \"The commit-message gate\" section for why the declaration\n" +
        "reads the way it does.\n",
    );
  }
  return 1;
}

// Only self-invoke as a program. Imported by its own test suite, which needs
// the evaluator and nothing else to happen.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(`check-merge-policy: unexpected failure: ${error?.stack ?? error}`);
      process.exit(2);
    },
  );
}
