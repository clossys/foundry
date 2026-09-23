import { describe, expect, it } from "vitest";
import { bindPlan, decidePlanExecution } from "./plan-binding.js";
import { fingerprintInputs } from "./staleness.js";
import { planCreateOrUpdate } from "./artifacts.js";

describe("stale-plan refusal", () => {
  it("executes a plan whose bound inputs still match the current fingerprint", () => {
    const inputs = fingerprintInputs([{ path: "clossys/advisor/intake.json", content: "same" }]);
    const plan = planCreateOrUpdate({ role: "@clossys/advisor", path: "clossys/advisor/brief.json", existing: null });
    const binding = bindPlan(plan, inputs);
    const decision = decidePlanExecution(binding, inputs);
    expect(decision.outcome).toBe("execute");
    expect(decision.plan).toBe(plan);
  });

  it("refuses a plan whose bound inputs no longer match the current fingerprint", () => {
    const boundInputs = fingerprintInputs([{ path: "clossys/advisor/intake.json", content: "original" }]);
    const currentInputs = fingerprintInputs([{ path: "clossys/advisor/intake.json", content: "changed since the plan was made" }]);
    const plan = planCreateOrUpdate({ role: "@clossys/advisor", path: "clossys/advisor/brief.json", existing: null });
    const binding = bindPlan(plan, boundInputs);
    const decision = decidePlanExecution(binding, currentInputs);
    expect(decision.outcome).toBe("stale-refuse");
    expect(decision.plan).toBeNull();
  });

  it("never carries the plan through on a stale-refuse, even though the caller has it in scope", () => {
    const boundInputs = fingerprintInputs([{ path: "a.json", content: "v1" }]);
    const currentInputs = fingerprintInputs([{ path: "a.json", content: "v2" }]);
    const decision = decidePlanExecution(bindPlan({ secret: "do-not-leak" }, boundInputs), currentInputs);
    expect(decision.plan).toBeNull();
    expect(JSON.stringify(decision)).not.toContain("do-not-leak");
  });

  it("is stale when an input the plan depended on disappears entirely", () => {
    const boundInputs = fingerprintInputs([{ path: "a.json", content: "v1" }, { path: "b.json", content: "v1" }]);
    const currentInputs = fingerprintInputs([{ path: "a.json", content: "v1" }]);
    const decision = decidePlanExecution(bindPlan("plan", boundInputs), currentInputs);
    expect(decision.outcome).toBe("stale-refuse");
  });

  it("is not stale when nothing changed at all, including an empty fingerprint set", () => {
    const decision = decidePlanExecution(bindPlan("plan", {}), {});
    expect(decision.outcome).toBe("execute");
  });
});
