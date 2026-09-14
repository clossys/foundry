// check-merge-policy.test.mjs — the behaviour that decides whether this gate
// reports a leak-permitting configuration, tested without a network, a token,
// or a live repository.
//
// Imports only node builtins and this repository's own scripts, because
// `check:gates` runs in ci.yml's dependency-free `safety` job — see
// scripts/check-workflow-references.test.mjs's own suite for the incident that
// made that a written rule rather than a habit.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import {
  MERGE_METHODS,
  assertObservable,
  deriveRepository,
  effectiveMergeMethods,
  evaluate,
  parsePolicy,
  reportError,
} from "./check-merge-policy.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const allMethodsOn = { allow_merge_commit: true, allow_squash_merge: true, allow_rebase_merge: true };
const policy = { defaultBranch: "main", permittedMergeMethods: ["merge", "rebase"] };

// ------------------------------------------------------- effectiveMergeMethods

test("repository settings alone decide the permitted methods when no ruleset restricts them", () => {
  assert.deepEqual(effectiveMergeMethods(allMethodsOn, []), ["merge", "squash", "rebase"]);
  assert.deepEqual(effectiveMergeMethods({ ...allMethodsOn, allow_squash_merge: false }, []), ["merge", "rebase"]);
});

test("a pull_request rule's allowed_merge_methods narrows the repository allowance", () => {
  const rules = [{ type: "pull_request", parameters: { allowed_merge_methods: ["merge"] } }];
  assert.deepEqual(effectiveMergeMethods(allMethodsOn, rules), ["merge"]);
});

test("a ruleset never WIDENS the repository allowance", () => {
  // The direction that would produce a false finding: a ruleset naming a
  // method the repository itself does not offer does not make it usable.
  // Reading the ruleset alone would report "squash" as available here.
  const rules = [{ type: "pull_request", parameters: { allowed_merge_methods: ["merge", "squash"] } }];
  assert.deepEqual(effectiveMergeMethods({ ...allMethodsOn, allow_squash_merge: false }, rules), ["merge"]);
});

test("rules that are not pull_request rules are ignored", () => {
  const rules = [{ type: "deletion" }, { type: "non_fast_forward" }, { type: "required_status_checks", parameters: {} }];
  assert.deepEqual(effectiveMergeMethods(allMethodsOn, rules), ["merge", "squash", "rebase"]);
});

test("TWO pull_request rules intersect, they do not let the first one found win", () => {
  // GitHub enforces every ruleset that targets a branch simultaneously, so
  // more than one `pull_request` rule can be in force at once — reading only
  // the first one this API response happens to list (an earlier version of
  // this function did exactly that) is always a superset of the truth. It
  // can never let an undeclared method through undetected, since the true
  // set can only be smaller — but it CAN wrongly report a declared method as
  // still available when a second, ignored ruleset actually forbids it,
  // which silently defeats evaluate()'s "declared-unavailable" half.
  const rules = [
    { type: "pull_request", parameters: { allowed_merge_methods: ["merge", "squash", "rebase"] } },
    { type: "pull_request", parameters: { allowed_merge_methods: ["squash"] } },
  ];
  assert.deepEqual(effectiveMergeMethods(allMethodsOn, rules), ["squash"]);
});

test("three pull_request rules intersect down to whatever every one of them allows", () => {
  const rules = [
    { type: "pull_request", parameters: { allowed_merge_methods: ["merge", "squash", "rebase"] } },
    { type: "pull_request", parameters: { allowed_merge_methods: ["merge", "rebase"] } },
    { type: "pull_request", parameters: { allowed_merge_methods: ["merge", "squash"] } },
  ];
  assert.deepEqual(effectiveMergeMethods(allMethodsOn, rules), ["merge"]);
});

test("a second pull_request rule that allows nothing this repository offers narrows to empty, not to the first rule's set", () => {
  const rules = [
    { type: "pull_request", parameters: { allowed_merge_methods: ["merge", "rebase"] } },
    { type: "pull_request", parameters: { allowed_merge_methods: ["squash"] } },
  ];
  assert.deepEqual(effectiveMergeMethods(allMethodsOn, rules), []);
});

// -------------------------------------------------------------------- evaluate

test("a forge that permits an undeclared method is a high finding", () => {
  const { findings } = evaluate({ policy, repository: allMethodsOn, branchRules: [] });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, "permits-undeclared");
  assert.equal(findings[0].method, "squash");
  assert.equal(findings[0].severity, "high");
});

test("a declaration the forge cannot satisfy is reported too, and separately", () => {
  const repository = { allow_merge_commit: false, allow_squash_merge: false, allow_rebase_merge: true };
  const { findings } = evaluate({ policy, repository, branchRules: [] });
  assert.deepEqual(
    findings.map((f) => [f.kind, f.method]),
    [["declared-unavailable", "merge"]],
  );
});

test("agreement in both directions is a clean pass", () => {
  const repository = { ...allMethodsOn, allow_squash_merge: false };
  const { findings, effective } = evaluate({ policy, repository, branchRules: [] });
  assert.deepEqual(findings, []);
  assert.deepEqual(effective, ["merge", "rebase"]);
});

test("a ruleset restricting the branch clears the finding the repository setting alone would raise", () => {
  // The second of the two ways an administrator can satisfy this declaration.
  // Asserting it here is what stops the gate from quietly demanding one
  // particular mechanism while its own message offers two.
  const rules = [{ type: "pull_request", parameters: { allowed_merge_methods: ["merge", "rebase"] } }];
  assert.deepEqual(evaluate({ policy, repository: allMethodsOn, branchRules: rules }).findings, []);
});

// ----------------------------------------------------------------- parsePolicy

test("a declaration this gate cannot trust is an error, never an empty pass", () => {
  assert.throws(() => parsePolicy("{", "policy"), /does not parse/);
  assert.throws(() => parsePolicy(JSON.stringify({ permittedMergeMethods: ["merge"] }), "policy"), /no defaultBranch/);
  assert.throws(() => parsePolicy(JSON.stringify({ defaultBranch: "main" }), "policy"), /no permittedMergeMethods/);
  assert.throws(
    () => parsePolicy(JSON.stringify({ defaultBranch: "main", permittedMergeMethods: [] }), "policy"),
    /no permittedMergeMethods/,
  );
  assert.throws(
    () => parsePolicy(JSON.stringify({ defaultBranch: "main", permittedMergeMethods: ["fast-forward"] }), "policy"),
    /does not know: fast-forward/,
  );
});

// ------------------------------------------------------------- assertObservable

test("a credential that cannot see the merge settings is 'could not check', not a pass", () => {
  // Absent fields read identically to "no merge method is offered", which
  // would be the cleanest possible pass and entirely unearned.
  assert.throws(() => assertObservable({}, []), /cannot see the merge/);
  assert.throws(() => assertObservable({ ...allMethodsOn, allow_squash_merge: undefined }, []), /allow_squash_merge/);
  assert.throws(() => assertObservable(allMethodsOn, undefined), /not a list/);
  assert.doesNotThrow(() => assertObservable(allMethodsOn, []));
});

// ------------------------------------------------------------ deriveRepository

function fakeFs(files, { packagesDirExists = true, packagesEntries = ["alpha", "beta"] } = {}) {
  // `packagesDirExists` and `packagesEntries` are explicit fixture inputs
  // now (#827) rather than a hardcoded `true` / `["alpha", "beta"]` no test
  // could override: the old stub reported a packages/ directory as present
  // for ANY fixture, regardless of what that fixture declared, so the "no
  // packages/ directory at all" branch in `deriveRepository` was
  // structurally unreachable from this file, and the packages listing was
  // never actually driven by per-test data.
  return {
    existsSync: (p) => Object.hasOwn(files, p) || (p.endsWith("packages") && packagesDirExists),
    readFileSync: (p) => files[p],
    readdirSync: () => packagesEntries,
  };
}

test("the repository identity is derived from the manifests, never hardcoded", () => {
  const files = {
    [join("/r", "package.json")]: JSON.stringify({ repository: { url: "git+https://github.com/example/example.git" } }),
    [join("/r", "packages", "alpha", "package.json")]: JSON.stringify({ repository: "https://github.com/example/example" }),
  };
  assert.equal(deriveRepository("/r", fakeFs(files)), "example/example");
});

test("manifests that disagree about which repository this is are refused, not guessed", () => {
  const files = {
    [join("/r", "package.json")]: JSON.stringify({ repository: { url: "https://github.com/example/example.git" } }),
    [join("/r", "packages", "alpha", "package.json")]: JSON.stringify({ repository: "https://github.com/example/example-scope" }),
  };
  assert.throws(() => deriveRepository("/r", fakeFs(files)), /ambiguous/);
});

test("no declared repository.url is an error rather than a hardcoded fallback", () => {
  const files = { [join("/r", "package.json")]: JSON.stringify({ name: "x" }) };
  assert.throws(() => deriveRepository("/r", fakeFs(files)), /will not fall back to a hardcoded identity/);
});

test("a repository.url this gate cannot parse is refused rather than queried", () => {
  const files = { [join("/r", "package.json")]: JSON.stringify({ repository: { url: "git@example.invalid:thing" } }) };
  assert.throws(() => deriveRepository("/r", fakeFs(files)), /cannot read as an/);
});

test("no packages/ directory at all is a branch this stub can now actually simulate", () => {
  // Regression guard for the fakeFs helper itself (#827): a files fixture
  // that places a manifest at a packages/<x>/package.json path must NOT be
  // read when the fixture declares no packages/ directory exists, the same
  // way a real `existsSync(packagesDir)` would gate a real `readdirSync`.
  // Under the old, unconditional-true stub this manifest was read anyway
  // and the call below returned successfully instead of throwing.
  const files = {
    [join("/r", "package.json")]: JSON.stringify({ name: "root-only" }),
    [join("/r", "packages", "alpha", "package.json")]: JSON.stringify({
      repository: { url: "https://github.com/example/example" },
    }),
  };
  assert.throws(
    () => deriveRepository("/r", fakeFs(files, { packagesDirExists: false })),
    /no package\.json declares a repository\.url/,
  );
});

test("the packages/ listing is driven by the fixture's own entries, not a hardcoded pair", () => {
  // Regression guard for the fakeFs helper itself (#827): the old stub's
  // `readdirSync` always returned `["alpha", "beta"]` no matter what a test
  // fixture put under packages/, so a manifest at any other entry name was
  // silently invisible to deriveRepository regardless of what the gate's
  // own logic did with it.
  const files = {
    [join("/r", "package.json")]: JSON.stringify({ name: "root-only" }),
    [join("/r", "packages", "gamma", "package.json")]: JSON.stringify({
      repository: { url: "https://github.com/example/example" },
    }),
  };
  assert.equal(deriveRepository("/r", fakeFs(files, { packagesEntries: ["gamma"] })), "example/example");
});

// --------------------------------------------- this repository's own declaration

test("the declaration this repository actually ships parses and excludes squash", () => {
  // Not a tautology: the whole point of the file is that "squash" is absent
  // from it, and a future edit that quietly re-adds it should fail here rather
  // than turn the gate green by agreeing with the configuration that leaks.
  const shipped = parsePolicy(readFileSync(join(repoRoot, "governance", "merge-policy.json"), "utf8"), "shipped");
  assert.equal(shipped.defaultBranch, "main");
  assert.ok(!shipped.permittedMergeMethods.includes("squash"));
  for (const method of shipped.permittedMergeMethods) assert.ok(Object.hasOwn(MERGE_METHODS, method));
});

test("the shipped declaration finds the configuration that published identity", () => {
  // Mutation proof: fed the exact forge shape that produced the eight commits
  // (squash offered, no ruleset restricting it), the shipped declaration must
  // report it. A gate never observed failing is indistinguishable from a gate
  // that cannot fail.
  const shipped = parsePolicy(readFileSync(join(repoRoot, "governance", "merge-policy.json"), "utf8"), "shipped");
  const { findings } = evaluate({ policy: shipped, repository: allMethodsOn, branchRules: [] });
  assert.ok(findings.some((f) => f.kind === "permits-undeclared" && f.method === "squash"));
});

// ------------------------------------------------------- reportError (#827)
//
// `main()`'s success path already branched on `--json` once for its human
// summary and once for its JSON payload; every exit-2 catch site called
// `console.error` with plain text unconditionally, ignoring `--json`
// entirely. reportError() is the one place that decision is made now.

test("reportError formats plain text the same way every exit-2 path used to", () => {
  assert.equal(reportError("boom", false), "check-merge-policy: boom");
});

test("reportError honours --json on an error path, not just on findings", () => {
  const parsed = JSON.parse(reportError("boom", true));
  assert.deepEqual(parsed, { error: "boom" });
});

test("reportError collapses a human-formatted, multi-line message into one JSON string", () => {
  // The no-token message wraps itself across lines with hanging indentation
  // for terminal readability. A --json caller has no use for that wrapping
  // and every use for a message it can log as one string.
  const message = "no token\n  continuation one\n  continuation two";
  const parsed = JSON.parse(reportError(message, true));
  assert.equal(parsed.error, "no token continuation one continuation two");
});

// ---------------------------------------------- the CLI's exit-2 paths (#827)
//
// Integration-level, not just a unit test of reportError in isolation: this
// proves main() actually threads `asJson` into the catch sites that call it,
// which a test of reportError alone cannot show. Both cases below are
// reachable with no network and no token, so they stay inside this file's
// own "no network, no token, no fixture server" contract.

const cliPath = join(dirname(fileURLToPath(import.meta.url)), "check-merge-policy.mjs");

function runCli(args, env) {
  try {
    const stdout = execFileSync("node", [cliPath, ...args], { encoding: "utf8", env });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    return { status: error.status, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

test("the CLI's policy-parse exit-2 path honours --json", () => {
  const missingPolicyPath = join(repoRoot, "governance", "merge-policy.json") + ".does-not-exist";

  const prose = runCli(["--policy", missingPolicyPath], process.env);
  assert.equal(prose.status, 2);
  assert.match(prose.stderr, /^check-merge-policy: /);

  const json = runCli(["--policy", missingPolicyPath, "--json"], process.env);
  assert.equal(json.status, 2);
  const parsed = JSON.parse(json.stderr);
  assert.ok(typeof parsed.error === "string" && parsed.error.length > 0);
});

test("the CLI's missing-token exit-2 path honours --json", () => {
  const envWithoutToken = { ...process.env };
  delete envWithoutToken.GH_TOKEN;
  delete envWithoutToken.GITHUB_TOKEN;

  const prose = runCli([], envWithoutToken);
  assert.equal(prose.status, 2);
  assert.match(prose.stderr, /^check-merge-policy: no \$GH_TOKEN or \$GITHUB_TOKEN/);

  const json = runCli(["--json"], envWithoutToken);
  assert.equal(json.status, 2);
  const parsed = JSON.parse(json.stderr);
  assert.match(parsed.error, /no \$GH_TOKEN or \$GITHUB_TOKEN/);
  assert.ok(!parsed.error.includes("\n"), "the JSON form collapses the human message's line breaks");
});
