export const VERBS = ["direct", "design", "write", "publish", "produce", "check"] as const;
export type Verb = typeof VERBS[number];

export interface CliArgs {
  verb?: Verb;
  help: boolean;
  check: boolean;
  root?: string;
  json: boolean;
  once: boolean;
  port?: number;
  noOpen: boolean;
  target?: string;
  pages?: string;
  report?: string;
  out?: string;
  /** check: run the record suites (archetypes, Writer/Director slots, slot contracts). */
  suites: boolean;
  /** check: record-suite findings fail the command (exit 1). */
  strict: boolean;
  /** publish: library roots served at `/__specimen`. */
  records: string[];
}

export class CliUsageError extends Error {
  readonly exitCode = 2;
}

export const USAGE = "Usage: clossys <direct|design|write|publish|produce|check> [--check] [--root <dir>] [--json]\n"
  + "Options: --help; produce --once --port <0-65535> --no-open; publish --target preview [--port <0-65535>] [--out <dir>]\n"
  + "Page check: clossys check --pages <generated-manifest.json> --report <report.json> [--json]\n"
  + "Record suites: clossys check --suites [--strict] [--root <dir>] (also run with --pages/--report when --root is a consumer root)\n"
  + "Specimens: clossys publish --target preview [--records <library dir>]... (default <root>/clossys/library)";

export function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { help: false, check: false, json: false, once: false, noOpen: false, suites: false, strict: false, records: [] };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    const value = (): string => {
      const next = argv[++index];
      if (!next || next.startsWith("--")) throw new CliUsageError(`${arg} requires a value`);
      return next;
    };
    switch (arg) {
      case "--help": args.help = true; break;
      case "--check": args.check = true; break;
      case "--json": args.json = true; break;
      case "--root": args.root = value(); break;
      case "--once": args.once = true; break;
      case "--no-open": args.noOpen = true; break;
      case "--target": args.target = value(); break;
      case "--pages": args.pages = value(); break;
      case "--report": args.report = value(); break;
      case "--out": args.out = value(); break;
      case "--suites": args.suites = true; break;
      case "--strict": args.strict = true; break;
      case "--records": args.records.push(value()); break;
      case "--port": {
        const port = value();
        if (!/^\d+$/.test(port) || Number(port) > 65535) throw new CliUsageError("--port must be an integer from 0 to 65535");
        args.port = Number(port);
        break;
      }
      default:
        if (args.verb || !VERBS.includes(arg as Verb)) throw new CliUsageError(`Unknown argument: ${arg}`);
        args.verb = arg as Verb;
    }
  }
  if ((args.once || args.noOpen) && args.verb !== "produce") throw new CliUsageError("--once and --no-open require produce");
  if (args.port !== undefined && args.verb !== "produce" && args.verb !== "publish") throw new CliUsageError("--port requires produce or publish");
  if (args.target !== undefined && args.verb !== "publish") throw new CliUsageError("--target requires publish");
  if (args.out !== undefined && args.verb !== "publish") throw new CliUsageError("--out requires publish");
  if ((args.pages !== undefined || args.report !== undefined) && args.verb !== "check") {
    throw new CliUsageError("--pages and --report require check");
  }
  if ((args.suites || args.strict) && args.verb !== "check") throw new CliUsageError("--suites and --strict require check");
  if (args.records.length && args.verb !== "publish") throw new CliUsageError("--records requires publish");
  if (!args.verb && !args.help) throw new CliUsageError("A verb is required");
  if (args.verb === "check" && !args.help) {
    const page = args.pages !== undefined || args.report !== undefined;
    if (page && (args.pages === undefined || args.report === undefined)) throw new CliUsageError("check requires --pages and --report");
    if (!page && !args.suites) throw new CliUsageError("check requires --pages and --report, or --suites");
  }
  return args;
}
