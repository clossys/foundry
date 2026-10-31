/**
 * `clossys specimen serve|snapshot`: the one preview URL for element records, and headless
 * thumbnails of it. Publisher renders; this verb only wires record roots to it.
 */
import { resolve } from "node:path";
import { directoryRecordSource, specimenUrl, startSpecimenServer } from "@clossys/publisher/specimen";
import { snapshotSpecimen, type SnapshotResult } from "../specimen/thumbnails.js";
import { CliUsageError } from "./args.js";

export const SPECIMEN_USAGE = "Usage: clossys specimen serve --records <dir> [--theme <id>] [--port <n>] [--workspace <dir>]\n"
  + "       clossys specimen snapshot --records <dir> --element <id> [--v <n>] [--theme <t>] [--width <px,px>] [--cache <dir>] [--workspace <dir>] [--json]";

export interface SpecimenCliResult {
  exitCode: 0 | 1 | 2;
  message: string;
  url?: string;
  snapshot?: SnapshotResult;
}

interface SpecimenArgs {
  command?: "serve" | "snapshot";
  records: string[];
  element?: string;
  version?: number;
  theme?: string;
  defaultTheme?: string;
  widths: number[];
  cache?: string;
  workspace?: string;
  port?: number;
  help: boolean;
}

export function parseSpecimenArgs(argv: readonly string[]): SpecimenArgs {
  const args: SpecimenArgs = { records: [], widths: [], help: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    const value = (): string => {
      const next = argv[++index];
      if (!next || next.startsWith("--")) throw new CliUsageError(`${arg} requires a value`);
      return next;
    };
    const int = (min: number, max: number): number => {
      const raw = value();
      if (!/^\d+$/.test(raw) || Number(raw) < min || Number(raw) > max) throw new CliUsageError(`${arg} must be ${min}-${max}`);
      return Number(raw);
    };
    switch (arg) {
      case "serve": case "snapshot":
        if (args.command) throw new CliUsageError(`unexpected ${arg}`);
        args.command = arg; break;
      case "--help": args.help = true; break;
      case "--json": break;
      case "--records": args.records.push(value()); break;
      case "--element": args.element = value(); break;
      case "--v": args.version = int(1, 999_999); break;
      case "--theme": args.theme = value(); break;
      case "--default-theme": args.defaultTheme = value(); break;
      case "--cache": args.cache = value(); break;
      case "--workspace": args.workspace = value(); break;
      case "--port": args.port = int(0, 65_535); break;
      case "--width":
        for (const part of value().split(",")) {
          if (!/^\d{3,4}$/.test(part) || Number(part) < 200 || Number(part) > 3840) throw new CliUsageError("--width must be 200-3840 (comma-separated)");
          args.widths.push(Number(part));
        }
        break;
      default: throw new CliUsageError(`unknown argument ${arg}`);
    }
  }
  return args;
}

export async function runSpecimenCli(argv: readonly string[], cwd = process.cwd()): Promise<SpecimenCliResult> {
  try {
    const args = parseSpecimenArgs(argv);
    if (args.help || !args.command) return { exitCode: args.help ? 0 : 2, message: SPECIMEN_USAGE };
    if (!args.records.length) throw new CliUsageError("--records is required");
    if (args.command === "serve") {
      const source = directoryRecordSource({ roots: args.records.map(root => resolve(cwd, root)), ...(args.defaultTheme ?? args.theme ? { defaultTheme: (args.defaultTheme ?? args.theme)! } : {}) });
      const { url } = await startSpecimenServer({ source, workspace: resolve(cwd, args.workspace ?? "."), ...(args.port !== undefined ? { port: args.port } : {}) });
      return { exitCode: 0, message: `specimens at ${specimenUrl(url, { element: "<id>" }).replace("%3Cid%3E", "<id>")}`, url };
    }
    if (!args.element) throw new CliUsageError("snapshot needs --element");
    const snapshot = await snapshotSpecimen({
      records: args.records, element: args.element, cwd,
      ...(args.version ? { version: args.version } : {}), ...(args.theme ? { theme: args.theme } : {}),
      ...(args.defaultTheme ? { defaultTheme: args.defaultTheme } : {}), ...(args.widths.length ? { widths: args.widths } : {}),
      ...(args.cache ? { cache: args.cache } : {}), ...(args.workspace ? { workspace: args.workspace } : {}),
    });
    const lines = snapshot.thumbnails.map(thumb => `${thumb.cached ? "cached" : "rendered"} ${thumb.width}px ${thumb.path} errors=${thumb.health?.errors.count ?? "?"}`);
    return { exitCode: 0, message: [`${snapshot.element}@v${snapshot.version} ${snapshot.theme}`, ...lines].join("\n"), snapshot };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { exitCode: error instanceof CliUsageError ? 2 : 1, message: error instanceof CliUsageError ? `${message}\n${SPECIMEN_USAGE}` : message };
  }
}
