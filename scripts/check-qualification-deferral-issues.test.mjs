import assert from "node:assert/strict";
import test from "node:test";

import { evaluateDeferralIssues } from "./check-qualification-deferral-issues.mjs";

// Every case here needs no network and no `gh`: `fetchIssue` is injected, the
// same "policy is pure, network is injectable" discipline
// scripts/land-stack.mjs's canMerge() and scripts/check-merge-policy.mjs's
// evaluate() already use. This is what lets this suite run in the
// dependency-free check:gates lane even though the real CLI it tests makes a
// live GitHub API call.

function entry(overrides = {}) {
  return { package: "controller", version: "0.9.9", reason: "some deferral reason long enough to pass validation", issue: 833, ...overrides };
}

test("an entry citing an OPEN issue passes", () => {
  const results = evaluateDeferralIssues([entry()], () => ({ state: "open" }));
  assert.deepEqual(results, [
    { package: "controller", version: "0.9.9", issue: 833, status: "pass", detail: "controller@0.9.9: issue #833 is open" },
  ]);
});

test("an entry citing a CLOSED issue fails — the countdown has expired", () => {
  const results = evaluateDeferralIssues([entry()], () => ({ state: "closed" }));
  assert.equal(results[0].status, "fail");
  assert.match(results[0].detail, /CLOSED/);
  assert.match(results[0].detail, /#833/);
});

test("issue state is matched case-insensitively", () => {
  assert.equal(evaluateDeferralIssues([entry()], () => ({ state: "CLOSED" }))[0].status, "fail");
  assert.equal(evaluateDeferralIssues([entry()], () => ({ state: "Open" }))[0].status, "pass");
});

test("a fetch failure (API unreachable, no token, rate limit) is not-applicable, never a silent pass", () => {
  const results = evaluateDeferralIssues([entry()], () => {
    throw new Error("gh: HTTP 401: Bad credentials");
  });
  assert.equal(results[0].status, "not-applicable");
  assert.match(results[0].detail, /could not resolve issue #833/);
  assert.match(results[0].detail, /Bad credentials/);
});

test("a response with no readable state is not-applicable, never folded into pass", () => {
  assert.equal(evaluateDeferralIssues([entry()], () => ({}))[0].status, "not-applicable");
  assert.equal(evaluateDeferralIssues([entry()], () => null)[0].status, "not-applicable");
  assert.equal(evaluateDeferralIssues([entry()], () => ({ state: "merged" }))[0].status, "not-applicable");
});

test("every entry is evaluated independently, derived from whatever the caller supplies — never a hard-coded list", () => {
  const entries = [
    entry({ package: "controller", version: "0.9.9", issue: 833 }),
    entry({ package: "customer", version: "0.1.0", issue: 833 }),
    entry({ package: "writer", version: "0.3.14", issue: 1063 }),
    entry({ package: "inspector", version: "0.2.4", issue: 948 }),
  ];
  const closedIssues = new Set([833, 1063]);
  const results = evaluateDeferralIssues(entries, (n) => ({ state: closedIssues.has(n) ? "closed" : "open" }));
  assert.deepEqual(
    results.map((r) => [r.package, r.status]),
    [
      ["controller", "fail"],
      ["customer", "fail"],
      ["writer", "fail"],
      ["inspector", "pass"],
    ],
  );
});

test("an empty entry list evaluates to an empty result, not an error", () => {
  assert.deepEqual(evaluateDeferralIssues([], () => ({ state: "open" })), []);
});
