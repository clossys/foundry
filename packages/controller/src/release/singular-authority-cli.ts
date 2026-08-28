/** CLI boundary for a caller-owned frozen lock and singular-authority declaration. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkSingularAuthority, type SingularAuthorityCheckInput } from "./singular-authority.js";

const USAGE = `Usage: singular-authority-check <package-lock.json|pnpm-lock.yaml> <declarations.json>

declarations.json is a caller-owned SingularAuthorityCheckInput object without lockfile.
For pnpm target qualification, dependencyConstraints bind caller-retained
declared ranges to exact parsed snapshot edges where pnpm does not retain them.
Exit codes: 0 = converged or explicitly disposed helper; 1 = conflict/update required; 2 = indeterminate or unsupported lock shape.`;

export function main(argv: readonly string[] = process.argv.slice(2), write: (line: string) => void = console.log): 0 | 1 | 2 {
  try {
    if (argv.length === 1 && argv[0] === "--help") { write(USAGE); return 0; }
    if (argv.length !== 2) { write(USAGE); return 2; }
    const lockPath = resolve(argv[0]!);
    const declarations = JSON.parse(readFileSync(resolve(argv[1]!), "utf8")) as Omit<SingularAuthorityCheckInput, "lockfile">;
    const format = lockPath.endsWith("pnpm-lock.yaml") ? "pnpm" : lockPath.endsWith("package-lock.json") ? "npm" : undefined;
    if (!format) { write("lockfile must be named package-lock.json or pnpm-lock.yaml"); return 2; }
    const report = checkSingularAuthority({ ...declarations, lockfile: { format, content: readFileSync(lockPath, "utf8") } });
    for (const finding of report.findings) write(`${finding.code}: ${finding.message}`);
    for (const result of report.results) {
      write(`${result.authority}: ${result.status}`);
      for (const resolved of result.resolved) {
        const edges = resolved.introducedBy.length === 0 ? "no introducing edge recorded" : resolved.introducedBy.map((edge) => `${edge.from} --${edge.dependency}${edge.range ? `@${edge.range}` : ""}--> ${edge.to}`).join("; ");
        write(`  ${resolved.packageName}@${resolved.version} at ${resolved.node}; ${edges}`);
      }
      for (const finding of result.findings) write(`  ${finding.code}: ${finding.message}`);
    }
    if (report.ok) return 0;
    return report.results.some((result) => result.status === "unresolved-conflict" || result.status === "compatibility-update-required") ? 1 : 2;
  } catch (error) { write(error instanceof Error ? error.message : String(error)); return 2; }
}

export function run(): void { process.exitCode = main(); }
