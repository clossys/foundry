export const VERBS = ["direct", "design", "write", "publish", "produce"] as const;
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
}

export class CliUsageError extends Error {
  readonly exitCode = 2;
}

export const USAGE = "Usage: clossys <direct|design|write|publish|produce> [--check] [--root <dir>] [--json]\n"
  + "Options: --help; produce --once --port <0-65535> --no-open; publish --target <id>";

export function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { help: false, check: false, json: false, once: false, noOpen: false };
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
  if ((args.once || args.port !== undefined || args.noOpen) && args.verb !== "produce") {
    throw new CliUsageError("--once, --port and --no-open require produce");
  }
  if (args.target !== undefined && args.verb !== "publish") throw new CliUsageError("--target requires publish");
  if (!args.verb && !args.help) throw new CliUsageError("A verb is required");
  return args;
}
