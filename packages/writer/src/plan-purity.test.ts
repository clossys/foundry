import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// A build-time tool from this repository, not shipped code; an untyped .mjs
// file that vitest transpiles without typechecking.
import { checkImportPurity } from "../../../scripts/lib/import-purity.mjs";

/*
 * Issue #1586: planDelegateCopyAuthority() decides whether bytes authorize
 * production copy, so it must be a pure function of them. Two checks on its
 * import graph, walked with the TypeScript compiler API: (a) every module it
 * reaches imports no builtin but node:crypto (for hashing) and no package,
 * and none uses a dynamic import(); (b) none writes one of the listed
 * globals (fetch, process, globalThis, the timers, Date.now, Math.random and
 * the others scripts/lib/import-purity.mjs lists) directly. (b) is not a
 * proof: JavaScript can reach a global indirectly, in forms the check does
 * not see, so that the function makes no network call and uses no clock or
 * randomness rests on (a) plus review of its code.
 */
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const at = (file: string) => `packages/writer/src/${file}`;

interface Result {
  findings: { file: string; line: number; rule: string; message: string }[];
  visited: string[];
}
const check = (entries: string[]): Result => checkImportPurity({ entries, allowedBuiltins: ["node:crypto"], root: repoRoot }) as Result;

describe("the plan authority's pure modules", () => {
  const result = check([at("plan-authority.ts")]);

  it("import no builtin but node:crypto and no package, and write none of the listed globals directly", () => {
    expect(result.findings).toEqual([]);
  });

  it("include the plan reading, rules and digest modules and both packed modules", () => {
    for (const file of ["plan-contract.ts", "plan-rules.ts", "plan-digest.ts", "generated/advisor-plan-contract.generated.ts", "generated/contract-schema.generated.ts"]) {
      expect(result.visited, file).toContain(at(file));
    }
  });

  it("reach no module that reads files or the clock", () => {
    expect(result.visited).not.toContain(at("registry.ts"));
    expect(result.visited).not.toContain(at("cli.ts"));
  });

  it("would catch a module that reads files", () => {
    const registry = check([at("registry.ts")]);
    expect(registry.findings.map((finding) => finding.rule)).toContain("builtin-not-allowed");
  });
});
