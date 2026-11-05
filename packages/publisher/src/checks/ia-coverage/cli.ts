import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import type { PublisherCommandResult } from "../../content/cli/types.js";
import { checkPublisherIACoverage } from "./check.js";
import { loadPublisherIAInput, publisherPackageRoot } from "./load.js";
import type { LoadOptions } from "./load.js";

export const usage = "node <publisher>/dist/content/node.js ia-coverage --out ia-coverage.json [--registry ContentRegistry.json] [--libraries ReviewLibrarySnapshot[].json] [--evidence CandidateStageEvidence[].json] [--designer-catalog path] [--writer-catalog path]";
const within = (path: string, root: string): boolean => { const difference = relative(root, path); return difference === "" || (!difference.startsWith(`..${sep}`) && difference !== ".." && !difference.startsWith(sep)); };
/** Resolve existing ancestors so a symlink cannot turn a report write into a source write. */
function physical(path: string): string {
  if (existsSync(path)) return realpathSync(path);
  const parent = dirname(path); if (parent === path) return path;
  return resolve(physical(parent), relative(parent, path));
}

/** Emits findings, not a cleanup: the only write is the explicitly selected report. */
export async function mainIACoverage(argv: readonly string[]): Promise<PublisherCommandResult> {
  if (argv.length === 1 && ["--help", "-h"].includes(argv[0]!)) return { exitCode: 0, findings: [], data: { usage } };
  try {
    const flags = new Map<string, string>();
    for (let index = 0; index < argv.length; index += 2) {
      const key = argv[index]!, value = argv[index + 1];
      if (!["--out", "--registry", "--libraries", "--evidence", "--designer-catalog", "--writer-catalog"].includes(key) || flags.has(key) || !value || value.startsWith("--")) throw new TypeError("Expected unique check options with a file/directory value");
      flags.set(key, value);
    }
    if (!flags.has("--out")) throw new TypeError("--out is required; catalogs are never report destinations");
    const options: LoadOptions = { registry: flags.get("--registry"), libraries: flags.get("--libraries"), evidence: flags.get("--evidence"), designerCatalog: flags.get("--designer-catalog"), writerCatalog: flags.get("--writer-catalog") };
    const out = physical(resolve(flags.get("--out")!));
    const sourceRoots = ["src", "dist", "../designer/src", "../designer/dist", "../writer/src", "../writer/dist"].map(path => resolve(publisherPackageRoot, path))
      .concat([options.designerCatalog, options.writerCatalog].filter((path): path is string => !!path)).map(path => physical(resolve(path)));
    if (sourceRoots.some(root => within(out, root)) || [options.registry, options.evidence, options.libraries].some(path => path && physical(resolve(path)) === out)) throw new TypeError("Report output must not replace source/catalog/check inputs");
    if (existsSync(out)) {
      const prior: unknown = JSON.parse(readFileSync(out, "utf8"));
      if (!prior || typeof prior !== "object" || !("kind" in prior) || prior.kind !== "publisher-ia-coverage") throw new TypeError("Only a previous IA report may be replaced");
    }
    const report = checkPublisherIACoverage(loadPublisherIAInput(options));
    writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
    const summaryTable = ["Layer | L0 | L1 | L2 | L3 | Registered | Absent | Draft | Checked | Approved", ...Object.entries(report.summary.layers).map(([layer, row]) =>
      `${layer} | ${row.L0} | ${row.L1} | ${row.L2} | ${row.L3} | ${row.registered} | ${row.states.absent} | ${row.states.draft} | ${row.states.checked} | ${row.states.approved}`)].join("\n");
    return { exitCode: report.findings.length ? 1 : 0, findings: report.findings.map(row => ({ path: row.subject, rule: row.code, message: row.message })), data: { summary: report.summary, summaryTable, needs: report.basis.needs } };
  } catch (error) {
    return { exitCode: 2, findings: [{ path: "ia-coverage", rule: "ia-coverage-input", message: error instanceof Error ? error.message : "Invalid IA coverage input" }] };
  }
}
