import { describe, expect, it } from "vitest";
import { checkBrandFileCoverage, TOKENS } from "@vespeneventures/designer/tokens";

import { RenderError } from "./errors.js";
import { flattenTokens } from "./tokens.js";

/**
 * `@vespeneventures/designer/tokens`' `checkBrandFileCoverage` and this package's own
 * `flattenTokens` are two independent implementations of the SAME rule —
 * a brand override may only ever target a `brandable: true` slot that
 * really exists in `TOKENS` — enforced two different ways: `flattenTokens`
 * THROWS a `RenderError` (it is a resolver, not a checker: it must refuse
 * to produce output rather than silently accept a bad override), while
 * `checkBrandFileCoverage` REPORTS a finding (it is a checker, meant to run
 * over an entire brand file and surface every problem at once, not stop at
 * the first one). Two checks in one repository disagreeing about which
 * slots a brand is allowed to touch would be worse than either one alone —
 * a brand override this package's own render pipeline accepts (or rejects)
 * differently from what `tokens-brand-check` told a consumer in CI is
 * exactly the kind of drift that surfaces in production, not in a gate.
 *
 * This lives HERE, in `@vespeneventures/publisher` (which already depends on
 * `@vespeneventures/designer/tokens` — see `package.json`), rather than inside
 * `@vespeneventures/designer/tokens` itself, because the reverse dependency would be
 * circular: `@vespeneventures/designer/tokens` cannot import
 * `@vespeneventures/publisher` to test against `flattenTokens` without
 * `render` already depending on `tokens` right back (see `internal/
 * tokens.ts`'s own header comment for exactly what it imports).
 *
 * Every case below runs the EXACT SAME override object through both
 * functions and asserts the two outcomes AGREE, rather than asserting
 * either implementation's behavior in isolation (that is what each
 * package's own test suite is for) — the point here is strictly the
 * cross-package agreement.
 */
describe("checkBrandFileCoverage (@vespeneventures/designer/tokens) agrees with flattenTokens (this package) on the non-brandable-override rule", () => {
  const nonBrandableSlots = Object.values(TOKENS)
    .filter((def) => !def.brandable)
    .map((def) => def.property);

  it("this repository actually HAS non-brandable slots to check agreement against (a guard against this test silently checking nothing)", () => {
    expect(nonBrandableSlots.length).toBeGreaterThan(0);
  });

  it.each(nonBrandableSlots)("every non-brandable slot %s: flattenTokens throws, checkBrandFileCoverage finds", (slot) => {
    const overrides = { [slot]: "red" };

    let thrown: unknown;
    try {
      flattenTokens(overrides);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RenderError);
    expect((thrown as RenderError).reason).toBe("non-brandable-override");

    const report = checkBrandFileCoverage(overrides);
    const finding = report.findings.find((f) => f.slot === slot);
    expect(finding?.rule).toBe("non-brandable-override");
  });

  it("a typo'd/unknown slot: flattenTokens throws unknown-token-override, checkBrandFileCoverage reports unknown-slot", () => {
    const overrides = { "--color-surfac-base": "red" }; // deliberate typo, matches no real token

    let thrown: unknown;
    try {
      flattenTokens(overrides);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RenderError);
    expect((thrown as RenderError).reason).toBe("unknown-token-override");

    const report = checkBrandFileCoverage(overrides);
    const finding = report.findings.find((f) => f.slot === "--color-surfac-base");
    expect(finding?.rule).toBe("unknown-slot");
  });

  it("a real brandable slot: flattenTokens accepts it, checkBrandFileCoverage never flags it as non-brandable/unknown", () => {
    const overrides = { "--color-surface-base": "oklch(0.5 0 0)" };

    expect(() => flattenTokens(overrides)).not.toThrow();

    const report = checkBrandFileCoverage(overrides);
    const badFinding = report.findings.find(
      (f) => f.slot === "--color-surface-base" && (f.rule === "non-brandable-override" || f.rule === "unknown-slot"),
    );
    expect(badFinding).toBeUndefined();
  });
});
