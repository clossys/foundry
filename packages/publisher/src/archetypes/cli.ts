#!/usr/bin/env node
/**
 * `node <publisher>/dist/archetypes/cli.js --pages <file.json> [--report <out.json>] [--strict]`
 *
 * Reads either `{ records, routes?, directorCells?, copyFit? }` or a
 * publication join `{ contentMap, routePack?, sectionBindings?, pageCopy?, pages?, routes?, directorCells?, copyFit? }`
 * and prints the JSON conformance report. Report only: exit 0 unless
 * `--strict` and the report has an error finding (1); unreadable input is 2.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { checkPageRecords } from "./conformance.js";
import type { PageConformanceReport } from "./conformance.js";
import { pageRecordsFromPublication } from "./record.js";
import type { PageRecord, PageRecordSet } from "./record.js";
import type { CopyFitMeasurement } from "./copy-fit.js";

export const usage = "node <publisher>/dist/archetypes/cli.js --pages <file.json> [--report <out.json>] [--strict]";

export interface PageCheckCliResult {
  readonly exitCode: 0 | 1 | 2;
  readonly report?: PageConformanceReport;
  readonly error?: string;
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** Normalize one input document into a record set. */
export function pageRecordSetFrom(input: unknown): { set: PageRecordSet; copyFit?: CopyFitMeasurement[] } {
  if (!object(input)) throw new TypeError("Page check input must be a JSON object");
  const records = Array.isArray(input.records) ? input.records as PageRecord[]
    : object(input.contentMap) ? pageRecordsFromPublication(input as never) : undefined;
  if (!records) throw new TypeError("Page check input needs records[] or contentMap");
  const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;
  const routes = strings(input.routes), directorCells = strings(input.directorCells);
  return {
    set: { records, ...(routes ? { routes } : {}), ...(directorCells ? { directorCells } : {}) },
    ...(Array.isArray(input.copyFit) ? { copyFit: input.copyFit as CopyFitMeasurement[] } : {}),
  };
}

export function runPageCheckCli(argv: readonly string[], cwd = process.cwd()): PageCheckCliResult {
  let pages: string | undefined, report: string | undefined, strict = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--strict") { strict = true; continue; }
    const value = argv[index + 1];
    if ((arg === "--pages" || arg === "--report") && value && !value.startsWith("--")) {
      if (arg === "--pages") pages = value; else report = value;
      index += 1; continue;
    }
    return { exitCode: 2, error: `Unexpected argument ${arg}. Usage: ${usage}` };
  }
  if (!pages) return { exitCode: 2, error: `--pages is required. Usage: ${usage}` };
  try {
    const { set, copyFit } = pageRecordSetFrom(JSON.parse(readFileSync(resolve(cwd, pages), "utf8")));
    const result = checkPageRecords(set, { strict, ...(copyFit ? { copyFit } : {}) });
    if (report) writeFileSync(resolve(cwd, report), `${JSON.stringify(result, null, 2)}\n`);
    return { exitCode: result.exitCode, report: result };
  } catch (error) {
    return { exitCode: 2, error: error instanceof Error ? error.message : String(error) };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = runPageCheckCli(process.argv.slice(2));
  if (result.report) process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
  if (result.error) process.stderr.write(`${result.error}\n`);
  process.exitCode = result.exitCode;
}
