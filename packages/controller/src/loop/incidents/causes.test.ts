import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { causeFindings, readCauses, readRegistryRules } from "./causes.js";
import { DEFAULT_CAUSES, PACKAGE_ROOT, healMain } from "./cli.js";
import { REMEDIES } from "./remedies.js";
import type { KnownCause } from "./types.js";

const REPO = resolve(PACKAGE_ROOT, "../..");
const registry = readRegistryRules(resolve(REPO, "scripts/rules/registry.json"));
const doc = readCauses(DEFAULT_CAUSES);
const remedies = Object.keys(REMEDIES);
const withCause = (cause: Partial<KnownCause>) => ({ ...doc, causes: [{ ...doc.causes[0]!, ...cause }] });

describe("known causes against the rule registry", () => {
  it("every shipped cause is guarded by an enforced rule and remedied in code or none", () => {
    expect(causeFindings(doc, registry, remedies)).toEqual([]);
    expect(doc.causes.map(cause => cause.id)).toEqual(["orphan-test-child", "fixed-exit-root-check", "load-noise-timeout", "stale-branch-ref", "contradictory-packet"]);
  });

  it("a cause without a guard is refused by the registry check", async () => {
    const { guard: _guard, ...unguarded } = doc.causes[0]!;
    expect(causeFindings({ ...doc, causes: [unguarded] }, registry, remedies)).toEqual([
      "cause orphan-test-child has no guard: no cause is closed without a guard (a rule in scripts/rules/registry.json whose check fails on its violation fixture)",
    ]);
    expect(causeFindings(withCause({ guard: "" }), registry, remedies)).toHaveLength(1);
    // A guard must be a rule, and an enforced one.
    expect(causeFindings(withCause({ guard: "R-NO-SUCH-RULE" }), registry, remedies)).toEqual(["cause orphan-test-child: guard R-NO-SUCH-RULE is not a rule in scripts/rules/registry.json"]);
    expect(causeFindings(withCause({ guard: "R-X" }), [{ id: "R-X", status: "unenforced" }], remedies)).toEqual(["cause orphan-test-child: guard R-X is not enforced by a check with a violation fixture"]);

    // The check the root runs refuses the registry's violation fixture.
    const fixture = await healMain(["check", "--causes", resolve(REPO, "scripts/rules/fixtures/R-HEAL-CAUSE-GUARDED/causes.json"), "--root", REPO], process.cwd());
    expect(fixture.exit).toBe(1);
    expect(fixture.out).toMatch(/^\s+cause unguarded-cause has no guard: no cause is closed without a guard/m);
  });

  it("refuses a remedy that is not a function in code, and a matcher that is not a regular expression", () => {
    expect(causeFindings(withCause({ remedy: "ask-a-model" }), registry, remedies)).toEqual(["cause orphan-test-child: remedy ask-a-model is not a function in code (remedies.ts) or none"]);
    expect(causeFindings(withCause({ match: "(" }), registry, remedies)).toEqual(["cause orphan-test-child: match is not a regular expression"]);
    expect(causeFindings(withCause({ guard_landed: "soon" }), registry, remedies)).toEqual(["cause orphan-test-child: guard_landed must be an ISO 8601 time"]);
  });
});
