import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { assembleWriterBrief, checkWriterDerivation, compileWriterCells } from "@clossys/writer";
import { resolveAgent } from "../agents.js";
import type { CliArgs } from "./args.js";
import type { CliResult } from "./main.js";

type WriterApi = {
  assembleWriterBrief: typeof assembleWriterBrief;
  checkWriterDerivation: typeof checkWriterDerivation;
  compileWriterCells: typeof compileWriterCells;
};

/** Load the mapped Writer's public import entry, including import-only packages. */
async function writerApi(): Promise<WriterApi> {
  const { packageRoot } = resolveAgent("writer");
  const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  const entry = manifest.exports?.["."]?.import;
  if (typeof entry !== "string" || !entry.startsWith("./")) throw new Error("Writer public import entry is unavailable");
  const target = resolve(packageRoot, entry);
  const local = relative(packageRoot, target);
  if (!local || local === ".." || local.startsWith("../") || isAbsolute(local)) throw new Error("Writer public import entry is outside its package");
  const api = await import(pathToFileURL(target).href);
  return api as WriterApi;
}

export async function runWrite(args: CliArgs, root: string): Promise<CliResult> {
  const base = { verb: "write" as const, root, check: args.check };
  try {
    const api = await writerApi();
    const directorRoot = join(root, "clossys", "agents", "director");
    const writerRoot = join(root, "clossys", "agents", "writer");
    if (args.brief) {
      resolveAgent("director");
      if (typeof api.assembleWriterBrief !== "function") throw new Error("Writer brief API is unavailable; install the matching Writer build");
      const brief = await api.assembleWriterBrief(directorRoot);
      return { ...base, exitCode: 0, message: JSON.stringify(brief, null, 2), brief };
    }
    if (args.check) {
      resolveAgent("director");
      if (typeof api.checkWriterDerivation !== "function") throw new Error("Writer traceability API is unavailable; install the matching Writer build");
      const result = await api.checkWriterDerivation(directorRoot, writerRoot);
      const details = result.findings.map(finding => `${finding.rule}${finding.cell ? ` (${finding.cell})` : ""}: ${finding.message}`);
      return { ...base, exitCode: result.exitCode, message: [result.message, ...details].join("\n"), checks: result };
    }
    if (typeof api.compileWriterCells !== "function") throw new Error("Writer compiler API is unavailable; install the matching Writer build");
    const result = await api.compileWriterCells(writerRoot, join(writerRoot, "compiled"));
    return { ...base, exitCode: 0, message: `Writer: compiled ${result.cellCount} active cells (${result.recordCount} records)`, compilation: { cellCount: result.cellCount, recordCount: result.recordCount, output: "clossys/agents/writer/compiled" } };
  } catch (error) {
    return { ...base, exitCode: 2, message: error instanceof Error ? error.message : String(error) };
  }
}
