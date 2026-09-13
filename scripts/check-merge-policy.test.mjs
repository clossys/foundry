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

import {
  MERGE_METHODS,
  assertObservable,
  deriveRepository,
  effectiveMergeMethods,
  evaluate,
  parsePolicy,
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

function fakeFs(files) {
  return {
    existsSync: (p) => Object.hasOwn(files, p) || p.endsWith("packages"),
    readFileSync: (p) => files[p],
    readdirSync: () => ["alpha", "beta"],
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
