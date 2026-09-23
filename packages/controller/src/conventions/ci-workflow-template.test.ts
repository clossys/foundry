import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluateCiConventions } from "./ci-conventions.js";
import { templatePath } from "./documents.js";

// The one thing conventions/templates/ci-workflow.yml must actually do:
// pass its own checker. This is what "a conforming CI template" (#1259)
// means in a testable sense -- not a claim in this repository's prose, a
// fact about the shipped bytes, same discipline documents.test.ts already
// holds for the documents/adapters this package ships.
describe("conventions/templates/ci-workflow.yml", () => {
  it("satisfies ci-conventions-check with its own fan-in declared as the required context", () => {
    const content = readFileSync(templatePath("ci-workflow.yml"), "utf8");
    const result = evaluateCiConventions({
      workflowFiles: [{ path: ".github/workflows/ci.yml", content }],
      ruleset: { requiredContexts: ["verify-build-and-test"], maxRetentionDays: 14 },
      declaration: {
        visibility: "public",
        requiredContextWorkflows: { "verify-build-and-test": ".github/workflows/ci.yml" },
      },
      packageVersion: "0.0.0-test",
    });

    expect(result.verdict).toBe("satisfied");
    expect(result.findings.filter((f) => f.severity === "error")).toEqual([]);
  });
});
