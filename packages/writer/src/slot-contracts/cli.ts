/**
 * `writer slots <cells...> [--director <dir>] [--strict]`: run the Writer slot
 * check suite over Writer cell files and print one JSON report. Exits 0 even
 * with findings unless --strict; usage errors exit 2.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { directorVoiceFromFiles, runWriterSuite, type WriterSuiteInput } from "./checks.js";
import { loadWriterContracts } from "./format.js";

const USAGE = "usage: writer slots <cell file or directory>... [--director <director cells dir>] [--strict]";

function collect(path: string, out: WriterSuiteInput[]): void {
  const stat = statSync(path);
  if (stat.isDirectory()) { for (const name of readdirSync(path).sort()) if (!name.startsWith(".")) collect(join(path, name), out); return; }
  if (path.endsWith(".md")) out.push({ path, text: readFileSync(path, "utf8") });
}

export function mainWriterSlotCheck(argv: string[], write: (text: string) => void = t => process.stdout.write(t)): number {
  let strict = false; let director: string | undefined; const targets: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--help" || arg === "-h") { write(`${USAGE}\n`); return 0; }
    if (arg === "--strict") strict = true;
    else if (arg === "--json") continue;
    else if (arg === "--director") { director = argv[++i]; if (!director) { write(`${JSON.stringify({ command: "slots", error: USAGE })}\n`); return 2; } }
    else if (arg.startsWith("--")) { write(`${JSON.stringify({ command: "slots", error: `unknown option ${arg}`, usage: USAGE })}\n`); return 2; }
    else targets.push(arg);
  }
  if (targets.length === 0) { write(`${JSON.stringify({ command: "slots", error: USAGE })}\n`); return 2; }
  const cells: WriterSuiteInput[] = []; const directorFiles: WriterSuiteInput[] = [];
  try {
    for (const t of targets) collect(t, cells);
    if (director) collect(director, directorFiles);
  } catch (error) {
    write(`${JSON.stringify({ command: "slots", error: error instanceof Error ? error.message : String(error) })}\n`); return 2;
  }
  const contracts = loadWriterContracts();
  const voice = director ? directorVoiceFromFiles(directorFiles) : undefined;
  const result = runWriterSuite({ cells, ...(voice ? { director: voice.voice } : {}) }, contracts);
  const byCheck: Record<string, number> = {};
  for (const f of result.findings) byCheck[f.check] = (byCheck[f.check] ?? 0) + 1;
  const errors = result.findings.filter(f => f.severity === "error").length;
  write(`${JSON.stringify({
    command: "slots", strict, suite: result.suite, checks: result.checks, files: result.files,
    director: voice ? { files: directorFiles.length, banned: voice.voice.banned.length, brands: voice.voice.brands.length, issues: voice.issues } : null,
    findings: result.findings,
    counts: { slots: contracts.slots.length, records: result.records, findings: result.findings.length, errors, warnings: result.findings.length - errors, byCheck },
  }, null, 2)}\n`);
  return strict && result.findings.length > 0 ? 1 : 0;
}
