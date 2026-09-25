import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// A build-time tool from this repository, not shipped code; an untyped .mjs
// file that vitest transpiles without typechecking.
import { checkImportPurity } from "../../../scripts/lib/import-purity.mjs";

/*
 * Issue #1178: two checks on this package's library, everything index.ts
 * exports, the registry snapshot reader and the package resolution included.
 * (a) Its import graph, walked with the TypeScript compiler API: every module
 * it reaches imports no builtin but node:crypto (for hashing) and no package,
 * and none uses a dynamic import(). (b) A syntactic check that none writes one
 * of a listed set of globals directly (fetch, process, globalThis, the timers,
 * Date.now, Math.random and the others scripts/lib/import-purity.mjs lists).
 * (b) is not a proof: JavaScript can reach a global indirectly, in forms the
 * check does not see. That the library makes no network call and uses no
 * clock or randomness rests on (a) plus review of its code. The bins (the
 * *-cli.ts files) read the files they are given, so they are outside this
 * check, and the check is shown to catch them.
 */
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const at = (file: string) => `packages/advisor/src/${file}`;
const PURE_ENTRIES = [at("index.ts"), at("package-resolution.ts"), at("registry-snapshot.ts")];

interface Result {
  findings: { file: string; line: number; rule: string; message: string }[];
  visited: string[];
}
const check = (entries: string[]): Result => checkImportPurity({ entries, allowedBuiltins: ["node:crypto"], root: repoRoot }) as Result;

describe("the library's pure modules", () => {
  const result = check(PURE_ENTRIES);

  it("import no builtin but node:crypto and no package, and write none of the listed globals directly", () => {
    expect(result.findings).toEqual([]);
  });

  it("include the resolution modules and everything they reach, and no bin", () => {
    for (const file of ["package-resolution.ts", "registry-snapshot.ts", "plan-rules.ts", "plan-contract.ts", "plan-digest.ts", "contract-schema.ts", "capability-catalogue.ts", "generated/package-scope.generated.ts", "generated/plan-contracts.generated.ts"]) {
      expect(result.visited, file).toContain(at(file));
    }
    expect(result.visited.filter((file) => file.endsWith("-cli.ts") || file.endsWith("/cli.ts"))).toEqual([]);
  });

  it("would catch a bin, which reads files", () => {
    const bins = check([at("package-request-cli.ts"), at("resolve-packages-cli.ts")]);
    expect(bins.findings.map((finding) => finding.rule)).toContain("builtin-not-allowed");
  });
});
