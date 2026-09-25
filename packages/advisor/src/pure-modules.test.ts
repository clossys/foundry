import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// A build-time tool from this repository, not shipped code; an untyped .mjs
// file that vitest transpiles without typechecking.
import { checkImportPurity } from "../../../scripts/lib/import-purity.mjs";

/*
 * Issue #1178: this package's library -- everything index.ts exports, the
 * registry snapshot reader and the package resolution included -- makes no
 * network call, reads no file, and has no clock, randomness or ambient
 * global. The check walks the real import graph from the entry files with
 * the TypeScript compiler API. The only builtin allowed is node:crypto, for
 * hashing. The bins (the *-cli.ts files) read the files they are given, so
 * they are outside this check, and the check is shown to catch them.
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

  it("import no builtin but node:crypto, and use no network, process, clock or randomness", () => {
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
