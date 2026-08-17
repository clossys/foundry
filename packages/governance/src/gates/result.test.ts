import { describe, expect, it } from "vitest";
import {
  COMMON_INDETERMINATE_REASONS,
  assertNeverVacuouslySatisfied,
  createGateReasons,
  foldGateResults,
  gateIndeterminate,
  gateResultFromRatchet,
  gateResultToExitCode,
  gateSatisfied,
  gateViolated,
  isIndeterminate,
  isSatisfied,
  isViolated,
} from "./result.js";
import type { GateResult } from "./result.js";
import { evaluateRatchet } from "./ratchet.js";

describe("gateSatisfied — the meta-check: a pass must carry evidence it evaluated something", () => {
  it("constructs a satisfied result when at least one thing was evaluated", () => {
    const result = gateSatisfied(3);
    expect(result).toEqual({ verdict: "satisfied", evaluated: 3 });
  });

  it("refuses to construct satisfied with zero evaluated — this is the defect #256 exists to catch", () => {
    expect(() => gateSatisfied(0)).toThrow(/evaluated/i);
  });

  it("refuses a negative evaluated count", () => {
    expect(() => gateSatisfied(-1)).toThrow(/positive integer/i);
  });

  it("refuses a non-integer evaluated count", () => {
    expect(() => gateSatisfied(1.5)).toThrow(/positive integer/i);
  });
});

describe("gateViolated", () => {
  it("constructs a violated result carrying its findings", () => {
    const result = gateViolated(["bad-thing"]);
    expect(result).toEqual({ verdict: "violated", findings: ["bad-thing"] });
  });

  it("refuses to construct violated with no findings — a violation with nothing wrong is not a violation", () => {
    expect(() => gateViolated([])).toThrow(/non-empty/i);
  });
});

describe("gateIndeterminate", () => {
  it("requires a non-empty reason", () => {
    expect(() => gateIndeterminate("" as never)).toThrow(/reason/i);
  });

  it("carries an optional detail alongside the reason", () => {
    const result = gateIndeterminate("missing-credential", "no token in env");
    expect(result).toEqual({ verdict: "indeterminate", reason: "missing-credential", detail: "no token in env" });
  });

  it("omits detail entirely when not supplied, rather than carrying it as undefined", () => {
    const result = gateIndeterminate("missing-credential");
    expect(result).toEqual({ verdict: "indeterminate", reason: "missing-credential" });
    expect("detail" in result).toBe(false);
  });
});

describe("createGateReasons — a gate's own declared, finite reason vocabulary", () => {
  it("accepts a declared reason", () => {
    const reasons = createGateReasons(["missing-credential", "no-applicable-inputs"] as const);
    const result = reasons.indeterminate("missing-credential");
    expect(result).toEqual({ verdict: "indeterminate", reason: "missing-credential" });
  });

  it("refuses a reason the gate never declared — naming, never omission", () => {
    const reasons = createGateReasons(["missing-credential"] as const);
    expect(() => reasons.indeterminate("tool-unavailable" as never)).toThrow(/not a declared reason/i);
  });

  it("refuses a duplicate declared reason", () => {
    expect(() => createGateReasons(["missing-credential", "missing-credential"] as const)).toThrow(/duplicate/i);
  });

  it("isDeclaredReason narrows without throwing", () => {
    const reasons = createGateReasons(["missing-credential", "tool-unavailable"] as const);
    expect(reasons.isDeclaredReason("missing-credential")).toBe(true);
    expect(reasons.isDeclaredReason("something-else")).toBe(false);
  });

  it("COMMON_INDETERMINATE_REASONS is a real, non-empty starter vocabulary a gate can extend", () => {
    expect(COMMON_INDETERMINATE_REASONS.length).toBeGreaterThan(0);
    expect(COMMON_INDETERMINATE_REASONS).toContain("missing-credential");
    expect(COMMON_INDETERMINATE_REASONS).toContain("no-applicable-inputs");
    expect(COMMON_INDETERMINATE_REASONS).toContain("tool-unavailable");
  });
});

describe("isSatisfied / isViolated / isIndeterminate", () => {
  it("narrow a GateResult union correctly", () => {
    const satisfied: GateResult<string> = gateSatisfied(1);
    const violated: GateResult<string> = gateViolated(["x"]);
    const indeterminate: GateResult<string> = gateIndeterminate("missing-credential");

    expect(isSatisfied(satisfied)).toBe(true);
    expect(isSatisfied(violated)).toBe(false);
    expect(isSatisfied(indeterminate)).toBe(false);

    expect(isViolated(violated)).toBe(true);
    expect(isViolated(satisfied)).toBe(false);

    expect(isIndeterminate(indeterminate)).toBe(true);
    expect(isIndeterminate(satisfied)).toBe(false);
  });
});

describe("foldGateResults — combining many per-input results into one verdict", () => {
  it("is satisfied only when every result is satisfied and at least one was evaluated", () => {
    const folded = foldGateResults([gateSatisfied(2), gateSatisfied(3)], { emptyReason: "no-applicable-inputs" });
    expect(folded).toEqual({ verdict: "satisfied", evaluated: 5 });
  });

  it("is indeterminate on an EMPTY results array — zero inputs is never a clean pass", () => {
    const folded = foldGateResults<string>([], { emptyReason: "no-applicable-inputs" });
    expect(folded.verdict).toBe("indeterminate");
    if (folded.verdict !== "indeterminate") throw new Error("unreachable");
    expect(folded.reason).toBe("no-applicable-inputs");
  });

  it("any indeterminate wins over any violated or satisfied — fails closed", () => {
    const folded = foldGateResults(
      [gateSatisfied(1), gateViolated(["bad"]), gateIndeterminate("tool-unavailable", "gitleaks missing")],
      { emptyReason: "no-applicable-inputs" },
    );
    expect(folded).toEqual({ verdict: "indeterminate", reason: "tool-unavailable", detail: "gitleaks missing" });
  });

  it("violated wins over satisfied when nothing is indeterminate", () => {
    const folded = foldGateResults([gateSatisfied(1), gateViolated(["bad-a"]), gateViolated(["bad-b"])], {
      emptyReason: "no-applicable-inputs",
    });
    expect(folded).toEqual({ verdict: "violated", findings: ["bad-a", "bad-b"] });
  });

  it("collects every indeterminate reason into the detail when more than one is present", () => {
    const folded = foldGateResults(
      [gateIndeterminate("missing-credential"), gateIndeterminate("tool-unavailable")],
      { emptyReason: "no-applicable-inputs" },
    );
    expect(folded.verdict).toBe("indeterminate");
    if (folded.verdict !== "indeterminate") throw new Error("unreachable");
    expect(folded.reason).toBe("missing-credential");
    expect(folded.detail).toContain("missing-credential");
    expect(folded.detail).toContain("tool-unavailable");
  });
});

describe("gateResultToExitCode — the existing foundry-check 0/1/2 contract, lifted into the type layer", () => {
  it("maps satisfied to 0", () => {
    expect(gateResultToExitCode(gateSatisfied(1))).toBe(0);
  });

  it("maps violated to 1", () => {
    expect(gateResultToExitCode(gateViolated(["bad"]))).toBe(1);
  });

  it("maps indeterminate to 2 unconditionally — AGENTS.md: '2 is not a variant of failure'", () => {
    expect(gateResultToExitCode(gateIndeterminate("missing-credential"))).toBe(2);
  });

  it("offers no override parameter that could turn indeterminate into 0 (compile-time shape check)", () => {
    // gateResultToExitCode takes exactly one argument; this is asserted at
    // the type level by the function's own signature, and pinned here so a
    // future edit adding a silent bypass parameter fails this test's
    // arity assumption too.
    expect(gateResultToExitCode.length).toBe(1);
  });
});

describe("assertNeverVacuouslySatisfied — the meta-check as a reusable regression-test helper", () => {
  it("passes silently when the gate correctly reports indeterminate for an empty/unevaluated input", () => {
    const evaluate = (input: readonly string[]): GateResult<string> =>
      input.length === 0 ? gateIndeterminate("no-applicable-inputs") : gateSatisfied(input.length);
    expect(() => assertNeverVacuouslySatisfied(evaluate, [])).not.toThrow();
  });

  it("throws when the gate under test reports satisfied without evaluating anything -- the exact defect #256 names", () => {
    // Reproduces instance 1 from the issue: an "unconfigured consumer ->
    // skip" path that resolves to a clean pass without ever having
    // evaluated its real input.
    const vacuouslyPassingGate = (_input: readonly string[]): GateResult<string> => gateSatisfied(1);
    expect(() => assertNeverVacuouslySatisfied(vacuouslyPassingGate, [])).toThrow(/satisfied.*evaluat/is);
  });
});

describe("gateResultFromRatchet — proves the ternary already existed at evaluateRatchet's boundary", () => {
  it("maps a clean ratchet result to satisfied", () => {
    const ratchet = evaluateRatchet(3, 5);
    const folded = gateResultFromRatchet(ratchet);
    expect(folded.verdict).toBe("satisfied");
  });

  it("maps a regressed ratchet result to violated, carrying its findings", () => {
    const ratchet = evaluateRatchet(6, 5);
    const folded = gateResultFromRatchet(ratchet);
    expect(folded.verdict).toBe("violated");
    if (folded.verdict !== "violated") throw new Error("unreachable");
    expect(folded.findings).toEqual(ratchet.findings);
  });

  it("maps an invalid ratchet result to indeterminate, never satisfied", () => {
    const ratchet = evaluateRatchet(-1, 5);
    const folded = gateResultFromRatchet(ratchet);
    expect(folded.verdict).toBe("indeterminate");
    if (folded.verdict !== "indeterminate") throw new Error("unreachable");
    expect(folded.reason).toBe("ratchet-invalid-input");
  });

  it("a clean ratchet result folds to exit 0, a regression to 1, invalid to 2 -- proving the lift is faithful", () => {
    expect(gateResultToExitCode(gateResultFromRatchet(evaluateRatchet(5, 5)))).toBe(0);
    expect(gateResultToExitCode(gateResultFromRatchet(evaluateRatchet(6, 5)))).toBe(1);
    expect(gateResultToExitCode(gateResultFromRatchet(evaluateRatchet(-1, 5)))).toBe(2);
  });
});

describe("design tests from the issue: the two live instances this contract must make expressible", () => {
  // Instance 1 (generic reconstruction): a gate has both an "unconfigured
  // consumer -> nothing to check" branch AND a "could not read the base
  // ref" branch. The defect was collapsing both into the same early return.
  // With named reasons, they cannot share a branch without a caller
  // explicitly choosing to.
  const evaluateLedgerGate = (input: {
    readonly baseRefReadable: boolean;
    readonly consumerConfigured: boolean;
  }): GateResult<string> => {
    if (!input.baseRefReadable) {
      // Must be checked FIRST and must be its own, distinct reason -- an
      // unreadable ref is never the same fact as "not configured".
      return gateIndeterminate("unreadable-base-ref", "could not resolve the base ref");
    }
    if (!input.consumerConfigured) {
      return gateIndeterminate("no-applicable-inputs", "consumer has not adopted this contract");
    }
    return gateSatisfied(1);
  };

  it("an unreadable base ref is indeterminate with its OWN reason, never conflated with 'not configured'", () => {
    const result = evaluateLedgerGate({ baseRefReadable: false, consumerConfigured: false });
    expect(result).toEqual({
      verdict: "indeterminate",
      reason: "unreadable-base-ref",
      detail: "could not resolve the base ref",
    });
  });

  it("an unconfigured consumer with a READABLE base ref is a distinctly-named indeterminate too, never 'satisfied'", () => {
    const result = evaluateLedgerGate({ baseRefReadable: true, consumerConfigured: false });
    expect(result.verdict).toBe("indeterminate");
    if (result.verdict !== "indeterminate") throw new Error("unreachable");
    expect(result.reason).toBe("no-applicable-inputs");
  });

  it("both non-adoption shapes fail closed under the default exit-code mapping (never exit 0)", () => {
    expect(gateResultToExitCode(evaluateLedgerGate({ baseRefReadable: false, consumerConfigured: false }))).toBe(2);
    expect(gateResultToExitCode(evaluateLedgerGate({ baseRefReadable: true, consumerConfigured: false }))).toBe(2);
  });

  // Instance 2 (generic reconstruction): a secret-scan gate starts failing
  // for one actor context because of a licensing/tooling change. The
  // tempting fix is to skip it silently for that actor. Modeled here as a
  // reason a gate's OWN declared vocabulary must name explicitly -- it is
  // still indeterminate, still fails closed, and is never silently 0.
  const secretScanReasons = createGateReasons(["tool-unavailable"] as const);
  const evaluateSecretScanGate = (input: { readonly toolAvailable: boolean }): GateResult<string> =>
    input.toolAvailable ? gateSatisfied(1) : secretScanReasons.indeterminate("tool-unavailable", "scanner licensing blocked this actor");

  it("a tool-unavailable actor context is indeterminate, not a silently-skipped pass", () => {
    const result = evaluateSecretScanGate({ toolAvailable: false });
    expect(result.verdict).toBe("indeterminate");
    expect(gateResultToExitCode(result)).toBe(2);
  });
});
