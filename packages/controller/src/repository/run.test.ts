import { describe, expect, it } from "vitest";
import {
  REPOSITORY_PROFILE_RUN_DECLARATION_SOURCE,
  runRepositoryProfileCheck,
  type RepositoryProfileRunCustomAxis,
  type RepositoryProfileRunInput,
} from "./run.js";
import type { RepositoryRequirementObservation } from "./types.js";

const validV3Profile = {
  schemaVersion: 3,
  defaultBranch: "main",
  commands: [{ name: "check", run: "npm run check" }],
  protectedPaths: [".github/workflows/**"],
  requirements: [
    { id: "runtime.node", scope: "machine", constraint: { kind: "present" } },
    { id: "tool.package-manager", scope: "repository", constraint: { kind: "one-of", values: ["npm"] } },
  ],
  rootEntries: [
    { name: "README.md", classification: "canonical", disposition: "required" },
    { name: "secrets", classification: "legacy-artifact", disposition: "prohibited" },
  ],
};

const validV1Profile = {
  schemaVersion: 1,
  defaultBranch: "main",
  commands: [{ name: "check", run: "npm run check" }],
  protectedPaths: [],
};

const satisfyingObservations: readonly RepositoryRequirementObservation[] = [
  { id: "runtime.node", scope: "machine", state: "observed", value: "20" },
  {
    id: "tool.package-manager",
    scope: "repository",
    source: REPOSITORY_PROFILE_RUN_DECLARATION_SOURCE,
    state: "observed",
    value: "npm",
  },
];

function parsedInput(
  value: unknown,
  overrides: Partial<Omit<RepositoryProfileRunInput, "declaration">> & { canonical?: boolean; path?: string } = {},
): RepositoryProfileRunInput {
  return {
    declaration: {
      kind: "parsed",
      path: overrides.path ?? "governance/repository-profile.json",
      canonical: overrides.canonical ?? true,
      value,
    },
    requirementObservations: overrides.requirementObservations ?? [],
    rootObservedEntries: overrides.rootObservedEntries,
    customAxes: overrides.customAxes,
  };
}

describe("runRepositoryProfileCheck: satisfied", () => {
  it("reports satisfied for a fully-evidenced v3 profile", () => {
    const result = runRepositoryProfileCheck(
      parsedInput(validV3Profile, {
        requirementObservations: satisfyingObservations,
        rootObservedEntries: ["README.md"],
      }),
    );
    expect(result.verdict).toBe("satisfied");
    if (result.verdict === "satisfied") expect(result.evaluated).toBeGreaterThan(0);
  });

  it("reports satisfied for a valid v1 profile with nothing to evaluate", () => {
    const result = runRepositoryProfileCheck(parsedInput(validV1Profile));
    expect(result).toEqual({ verdict: "satisfied", evaluated: 1 });
  });

  it("reports satisfied for a v3 profile with empty requirements/rootEntries arrays", () => {
    const result = runRepositoryProfileCheck(
      parsedInput({ ...validV3Profile, requirements: [], rootEntries: [] }),
    );
    expect(result).toEqual({ verdict: "satisfied", evaluated: 1 });
  });
});

describe("runRepositoryProfileCheck: violated", () => {
  it("reports violated when no declaration exists anywhere", () => {
    const result = runRepositoryProfileCheck({
      declaration: { kind: "not-found" },
      requirementObservations: [],
      rootObservedEntries: undefined,
    });
    expect(result.verdict).toBe("violated");
    if (result.verdict === "violated") {
      expect(result.findings).toEqual([expect.objectContaining({ rule: "declaration-not-found" })]);
    }
  });

  it("reports violated for a valid declaration at a non-canonical location", () => {
    const result = runRepositoryProfileCheck(parsedInput(validV1Profile, { canonical: false, path: "repository-profile.json" }));
    expect(result.verdict).toBe("violated");
    if (result.verdict === "violated") {
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]).toMatchObject({ rule: "declaration-non-canonical-location" });
    }
  });

  it("reports violated when an observed requirement value is unaccepted", () => {
    const observations: readonly RepositoryRequirementObservation[] = [
      { id: "runtime.node", scope: "machine", state: "observed", value: "20" },
      {
        id: "tool.package-manager",
        scope: "repository",
        source: REPOSITORY_PROFILE_RUN_DECLARATION_SOURCE,
        state: "observed",
        value: "yarn",
      },
    ];
    const result = runRepositoryProfileCheck(
      parsedInput(validV3Profile, { requirementObservations: observations, rootObservedEntries: ["README.md"] }),
    );
    expect(result.verdict).toBe("violated");
    if (result.verdict === "violated") {
      expect(result.findings.some((finding) => finding.rule === "requirement-unsatisfied")).toBe(true);
    }
  });

  it("reports violated when a required root entry is missing", () => {
    const result = runRepositoryProfileCheck(
      parsedInput(validV3Profile, { requirementObservations: satisfyingObservations, rootObservedEntries: [] }),
    );
    expect(result.verdict).toBe("violated");
    if (result.verdict === "violated") {
      expect(result.findings.some((finding) => finding.rule === "root-entry-missing")).toBe(true);
    }
  });

  it("reports violated when a prohibited root entry is observed", () => {
    const result = runRepositoryProfileCheck(
      parsedInput(validV3Profile, {
        requirementObservations: satisfyingObservations,
        rootObservedEntries: ["README.md", "secrets"],
      }),
    );
    expect(result.verdict).toBe("violated");
    if (result.verdict === "violated") {
      expect(result.findings.some((finding) => finding.rule === "root-entry-prohibited")).toBe(true);
    }
  });
});

describe("runRepositoryProfileCheck: indeterminate", () => {
  it("reports indeterminate when the declaration file could not be read", () => {
    const result = runRepositoryProfileCheck({
      declaration: { kind: "unreadable", detail: "EACCES" },
      requirementObservations: [],
      rootObservedEntries: undefined,
    });
    expect(result).toMatchObject({ verdict: "indeterminate", reason: "declaration-unreadable" });
  });

  it("reports indeterminate when the declaration is not valid JSON", () => {
    const result = runRepositoryProfileCheck({
      declaration: { kind: "invalid-json", detail: "Unexpected token" },
      requirementObservations: [],
      rootObservedEntries: undefined,
    });
    expect(result).toMatchObject({ verdict: "indeterminate", reason: "declaration-invalid-json" });
  });

  /**
   * THE BUG THIS RUNNER EXISTS TO MAKE STRUCTURALLY IMPOSSIBLE (issue #321).
   * A declaration that parses as JSON but is not shaped like a profile —
   * here, `commands` is a string instead of an array, exactly the shape
   * that let one hand-written runner iterate it character by character and
   * report a clean cross-reference against a declaration it had never
   * understood. This must be `indeterminate`, never `satisfied`, and the
   * requirements/root evaluators must never be reached at all: there are no
   * `requirement-*` or `root-entry-*` findings in the result below, only
   * the schema finding, proving evaluation was never attempted.
   */
  it("reports indeterminate — never satisfied — for a JSON-valid, schema-invalid declaration", () => {
    const malformed = {
      schemaVersion: 3,
      defaultBranch: "main",
      commands: "npm run check", // a string, not an array — the exact shipped defect
      protectedPaths: [],
      requirements: [{ id: "runtime.node", scope: "machine", constraint: { kind: "present" } }],
      rootEntries: [],
    };
    const result = runRepositoryProfileCheck(
      parsedInput(malformed, {
        // Even fully-satisfying discovery must not rescue a schema-invalid declaration.
        requirementObservations: [{ id: "runtime.node", scope: "machine", state: "observed", value: "20" }],
      }),
    );
    expect(result.verdict).toBe("indeterminate");
    expect(result).toMatchObject({ verdict: "indeterminate", reason: "declaration-schema-invalid" });
    if (result.verdict === "indeterminate") {
      expect(result.detail).toContain("commands-shape");
    }
  });

  it("reports indeterminate when a declared requirement has no observation", () => {
    const result = runRepositoryProfileCheck(
      parsedInput(validV3Profile, { requirementObservations: [], rootObservedEntries: ["README.md"] }),
    );
    expect(result).toMatchObject({ verdict: "indeterminate", reason: "requirements-unknown" });
  });

  it("reports indeterminate when the profile declares root entries but root discovery never ran", () => {
    const result = runRepositoryProfileCheck(
      parsedInput(validV3Profile, { requirementObservations: satisfyingObservations, rootObservedEntries: undefined }),
    );
    expect(result).toMatchObject({ verdict: "indeterminate", reason: "root-observations-missing" });
  });

  it("distinguishes an empty observed root ([]) from no root discovery (undefined)", () => {
    // [] is a real, evaluable observation ("the root has zero children") and
    // therefore VIOLATED (a required entry is missing) — not indeterminate.
    const empty = runRepositoryProfileCheck(
      parsedInput(validV3Profile, { requirementObservations: satisfyingObservations, rootObservedEntries: [] }),
    );
    expect(empty.verdict).toBe("violated");

    // undefined means discovery never ran at all — indeterminate.
    const undiscovered = runRepositoryProfileCheck(
      parsedInput(validV3Profile, { requirementObservations: satisfyingObservations, rootObservedEntries: undefined }),
    );
    expect(undiscovered.verdict).toBe("indeterminate");
  });

  it("reports indeterminate when injected requirement observations are themselves malformed", () => {
    const malformedObservations = [
      { id: "runtime.node", scope: "machine", state: "observed", value: "20" },
      { id: "runtime.node", scope: "machine", state: "observed", value: "22" }, // duplicate observation identity
    ] as unknown as readonly RepositoryRequirementObservation[];
    const result = runRepositoryProfileCheck(
      parsedInput(validV3Profile, { requirementObservations: malformedObservations, rootObservedEntries: ["README.md"] }),
    );
    expect(result).toMatchObject({ verdict: "indeterminate", reason: "requirements-input-invalid" });
  });

  it("never advances to evaluation for a non-canonical declaration that also fails schema validation", () => {
    const result = runRepositoryProfileCheck(
      parsedInput({ schemaVersion: 3, defaultBranch: "main", commands: [], protectedPaths: [] }, { canonical: false }),
    );
    // Missing `requirements`/`rootEntries` for schemaVersion 3 is itself a
    // schema violation — indeterminate, and the location finding never
    // separately surfaces as its own violated result.
    expect(result).toMatchObject({ verdict: "indeterminate", reason: "declaration-schema-invalid" });
  });

  it("folds to indeterminate ahead of a violated finding when one axis is indeterminate and another is violated", () => {
    const observations: readonly RepositoryRequirementObservation[] = [
      { id: "runtime.node", scope: "machine", state: "observed", value: "20" },
      {
        id: "tool.package-manager",
        scope: "repository",
        source: REPOSITORY_PROFILE_RUN_DECLARATION_SOURCE,
        state: "observed",
        value: "yarn", // unsatisfied
      },
    ];
    const result = runRepositoryProfileCheck(
      parsedInput(validV3Profile, { requirementObservations: observations, rootObservedEntries: undefined }),
    );
    expect(result.verdict).toBe("indeterminate");
  });
});

// Custom axes (issue #324): caller-supplied, ALREADY-EVALUATED derived
// cross-reference checks the shared runner has no concept of — e.g. a
// consumer cross-referencing `commands[].run` against its own manifest's
// `scripts` map, or `protectedPaths` against its own merge-governance
// workflow's live path-matching predicate. This suite proves the four
// properties issue #324 asks for: the fold uses the same precedence as
// every built-in axis, a malformed axis is indeterminate rather than
// dropped or satisfied, and — the backward-compatibility half — every test
// above this point still passes with `customAxes` never supplied.
describe("runRepositoryProfileCheck: custom axes (#324)", () => {
  it("folds a satisfied custom axis into an otherwise-satisfied result", () => {
    const customAxes: readonly RepositoryProfileRunCustomAxis[] = [
      { name: "commands-vs-manifest-scripts", result: { verdict: "satisfied", evaluated: 1 } },
    ];
    const result = runRepositoryProfileCheck(parsedInput(validV1Profile, { customAxes }));
    expect(result.verdict).toBe("satisfied");
  });

  it("folds a violated custom axis to an overall violated result, findings intact", () => {
    const customAxes: readonly RepositoryProfileRunCustomAxis[] = [
      {
        name: "commands-vs-manifest-scripts",
        result: {
          verdict: "violated",
          findings: [
            {
              rule: "command-script-missing",
              severity: "error",
              path: "$.commands[0].run",
              message: 'npm run check names a script that does not exist in the manifest\'s "scripts" map.',
            },
          ],
        },
      },
    ];
    const result = runRepositoryProfileCheck(parsedInput(validV1Profile, { customAxes }));
    expect(result.verdict).toBe("violated");
    if (result.verdict === "violated") {
      expect(result.findings).toEqual([
        {
          rule: "command-script-missing",
          severity: "error",
          path: "$.commands[0].run",
          message: 'npm run check names a script that does not exist in the manifest\'s "scripts" map.',
        },
      ]);
    }
  });

  it("folds an indeterminate custom axis to indeterminate, legibly naming which axis", () => {
    const customAxes: readonly RepositoryProfileRunCustomAxis[] = [
      {
        name: "protected-paths-vs-workflow-predicate",
        result: { verdict: "indeterminate", reason: "workflow-file-unreadable", detail: "could not read the merge-governance workflow" },
      },
    ];
    const result = runRepositoryProfileCheck(parsedInput(validV1Profile, { customAxes }));
    expect(result.verdict).toBe("indeterminate");
    if (result.verdict === "indeterminate") {
      expect(result.reason).toBe("custom-axis-indeterminate");
      expect(result.detail).toContain("protected-paths-vs-workflow-predicate");
      expect(result.detail).toContain("workflow-file-unreadable");
      expect(result.detail).toContain("could not read the merge-governance workflow");
    }
  });

  it("an indeterminate custom axis beats every satisfied built-in axis (fold precedence)", () => {
    const customAxes: readonly RepositoryProfileRunCustomAxis[] = [
      { name: "protected-paths-vs-workflow-predicate", result: { verdict: "indeterminate", reason: "workflow-file-unreadable" } },
    ];
    const result = runRepositoryProfileCheck(
      parsedInput(validV3Profile, {
        requirementObservations: satisfyingObservations,
        rootObservedEntries: ["README.md"],
        customAxes,
      }),
    );
    // Every built-in axis here is fully satisfied on its own (see the
    // "satisfied" describe block above using the identical inputs) — the
    // only thing that can make this indeterminate is the custom axis.
    expect(result.verdict).toBe("indeterminate");
    if (result.verdict === "indeterminate") expect(result.reason).toBe("custom-axis-indeterminate");
  });

  it("a violated custom axis is never silently dropped even when the declaration has nothing built-in to evaluate", () => {
    // validV1Profile has no requirements/rootEntries at all — without
    // custom-axis support this would take the "nothing to evaluate ->
    // satisfied" path. A violated custom axis must still win.
    const customAxes: readonly RepositoryProfileRunCustomAxis[] = [
      {
        name: "commands-vs-manifest-scripts",
        result: { verdict: "violated", findings: [{ rule: "command-script-missing", severity: "error", path: "$", message: "missing" }] },
      },
    ];
    const result = runRepositoryProfileCheck(parsedInput(validV1Profile, { customAxes }));
    expect(result.verdict).toBe("violated");
  });

  it("a malformed custom axis result (not a valid GateResult) is indeterminate, never ignored and never satisfied", () => {
    const malformedResults: readonly unknown[] = [
      undefined,
      null,
      {},
      { verdict: "satisfied" }, // missing "evaluated"
      { verdict: "satisfied", evaluated: 0 }, // not a positive integer
      { verdict: "violated", findings: [] }, // empty findings
      { verdict: "violated", findings: [{ rule: "x" }] }, // finding missing required fields
      { verdict: "indeterminate", reason: "" }, // empty reason
      { verdict: "indeterminate" }, // missing reason
      { verdict: "not-a-real-verdict" },
    ];

    for (const malformed of malformedResults) {
      const customAxes = [{ name: "commands-vs-manifest-scripts", result: malformed }] as unknown as readonly RepositoryProfileRunCustomAxis[];
      const result = runRepositoryProfileCheck(parsedInput(validV1Profile, { customAxes }));
      expect(result.verdict, `expected indeterminate for ${JSON.stringify(malformed)}`).toBe("indeterminate");
      if (result.verdict === "indeterminate") expect(result.reason).toBe("custom-axis-invalid");
    }
  });

  it("a custom axis missing a valid name is indeterminate under custom-axis-invalid", () => {
    const customAxes = [{ name: "", result: { verdict: "satisfied", evaluated: 1 } }] as unknown as readonly RepositoryProfileRunCustomAxis[];
    const result = runRepositoryProfileCheck(parsedInput(validV1Profile, { customAxes }));
    expect(result).toMatchObject({ verdict: "indeterminate", reason: "custom-axis-invalid" });
  });

  it("never reaches — never even READS — a custom axis when the declaration is schema-invalid", () => {
    // A custom axis whose `result` getter throws if it is ever accessed.
    // Schema validation must short-circuit before this module reads
    // `customAxes` at all; if it were reached, this test would throw
    // instead of asserting a clean "declaration-schema-invalid" result.
    const poisonedAxis: RepositoryProfileRunCustomAxis = {
      name: "commands-vs-manifest-scripts",
      get result(): never {
        throw new Error("customAxisResult must never be reached for a schema-invalid declaration");
      },
    };
    const result = runRepositoryProfileCheck(
      parsedInput(
        { schemaVersion: 3, defaultBranch: "main", commands: [], protectedPaths: [] }, // missing requirements/rootEntries -> schema-invalid
        { customAxes: [poisonedAxis] },
      ),
    );
    expect(result).toMatchObject({ verdict: "indeterminate", reason: "declaration-schema-invalid" });
  });

  it("omitting customAxes entirely behaves identically to the pre-#324 API (backward compatibility)", () => {
    const withoutField = runRepositoryProfileCheck(
      parsedInput(validV3Profile, { requirementObservations: satisfyingObservations, rootObservedEntries: ["README.md"] }),
    );
    const withUndefined = runRepositoryProfileCheck(
      parsedInput(validV3Profile, { requirementObservations: satisfyingObservations, rootObservedEntries: ["README.md"], customAxes: undefined }),
    );
    const withEmptyArray = runRepositoryProfileCheck(
      parsedInput(validV3Profile, { requirementObservations: satisfyingObservations, rootObservedEntries: ["README.md"], customAxes: [] }),
    );
    expect(withoutField).toEqual(withUndefined);
    expect(withoutField).toEqual(withEmptyArray);
    expect(withoutField.verdict).toBe("satisfied");
  });
});
