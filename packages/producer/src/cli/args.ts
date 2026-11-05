export const VERBS = ["direct", "design", "write", "publish", "produce", "check"] as const;
export type Verb = typeof VERBS[number];

export interface CliArgs {
  verb?: Verb;
  help: boolean;
  check: boolean;
  brief: boolean;
  root?: string;
  json: boolean;
  once: boolean;
  port?: number;
  noOpen: boolean;
  pages?: string;
  report?: string;
  /** publish: the install out dir; produce: the folder of install out dirs Studio previews; direct|design|write: the projection file. */
  out?: string;
  /** check: run the record suites (archetypes, Writer/Director slots, slot contracts). */
  suites: boolean;
  /** check: record-suite findings fail the command (slot findings always fail). */
  strict: boolean;
  /** publish: library roots served at `/__specimen`. */
  records: string[];
  /** publish: install the page's pinned registry items, bind its copy, and render it. */
  install: boolean;
  /** publish --install: the page record file. */
  page?: string;
  /** publish --install: the route pack / content map id to install as one routed site. */
  site?: string;
  /** publish --install --site: the deployment origin (target config). */
  origin?: string;
  /** publish --install --site: run the substrate's Vite build. */
  build: boolean;
  /** publish --install --site: install the publication's routes into this Next app directory. */
  next?: string;
  /** publish --install --next: the consumer's assembly module, relative to the app directory. */
  assembly?: string;
  /** publish --install --next: the consumer's states module (client), relative to the app directory; installs the publication's layout and state files. */
  states?: string;
  /** publish --install --next: resolve leaves at request time through the assembly. */
  live: boolean;
  /** publish --install: the consumer's component selection module, `<module>[#export]`. */
  selection?: string;
  /** check: validate the slot model and report coverage (slots / with candidate / pinned). */
  slots: boolean;
  /** check --slots: also report blocked-by per agent. */
  readiness: boolean;
}

export class CliUsageError extends Error {
  readonly exitCode = 2;
}

export const USAGE = "Usage: clossys <direct|design|write|publish|produce|check> [--check] [--root <dir>] [--json]\n"
  + "Options: --help; produce --once --port <0-65535> --no-open [--out <install out folder>]; publish --install --page <id> | --site <pack id> [--origin <url>] [--build] [--out <dir>]\n"
  + "Agents (pinned slot model, read-only): direct|design|write [--brief | --check] [--out <projection.json>]; publish (dry run: every pinned page compiled and checked, nothing installed)\n"
  + "Migrate: clossys migrate copy-keys [--check] [--root <dir>] (camelCase copy ids to the catalog's kebab-case ids; record text unchanged)\n"
  + "Migrate: clossys migrate inputs [--check] [--root <dir>] (declare Designer and Writer slot inputs from the read graph; only adds)\n"
  + "Page check: clossys check --pages <generated-manifest.json> --report <report.json> [--json]\n"
  + "Slots: clossys check [--slots] [--readiness] [--root <dir>] (enforced by default)\n"
  + "Decisions: clossys pin <agent>/<slot> <candidate-id> [--by <who>] | clossys pin <agent>/<slot> --not-needed --reason <text>; clossys decisions [--json]\n"
  + "Candidate options: clossys options [<agent>/<slot> [--more]] | clossys options --classes [--check]; clossys pick <agent>/<slot> <candidate-id> --by agent:<seat>\n"
  + "Record suites: clossys check --suites [--strict] [--root <dir>] (also run with --pages/--report when --root is a consumer root)\n"
  + "Install: clossys publish --install --page <page id | page record.json> --selection <component selection module>[#export] [--out <dir>] [--records <consumer dir>]...\n"
  + "Site: clossys publish --install --site <route pack id> [--origin <deployment origin>] [--build] [--out <dir>] [--records <consumer dir>]... (one routed app: content-map paths, route-pack slots, one frame)\n"
  + "Next app: clossys publish --install --site <publication> --next <app dir> --assembly <module> [--states <module>] [--live] [--check] (one route file per page, one [slug] route per leaf template; --states also installs the root layout and the loading, not-found, error and global-error files)";

export function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { help: false, check: false, brief: false, json: false, once: false, noOpen: false, suites: false, strict: false, records: [], install: false, build: false, live: false, slots: false, readiness: false };
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
      case "--brief": args.brief = true; break;
      case "--json": args.json = true; break;
      case "--root": args.root = value(); break;
      case "--once": args.once = true; break;
      case "--no-open": args.noOpen = true; break;
      case "--pages": args.pages = value(); break;
      case "--report": args.report = value(); break;
      case "--out": args.out = value(); break;
      case "--suites": args.suites = true; break;
      case "--strict": args.strict = true; break;
      case "--records": args.records.push(value()); break;
      case "--install": args.install = true; break;
      case "--page": args.page = value(); break;
      case "--selection": args.selection = value(); break;
      case "--site": args.site = value(); break;
      case "--build": args.build = true; break;
      case "--origin": args.origin = value(); break;
      case "--next": args.next = value(); break;
      case "--assembly": args.assembly = value(); break;
      case "--states": args.states = value(); break;
      case "--live": args.live = true; break;
      case "--slots": args.slots = true; break;
      case "--readiness": args.readiness = true; break;
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
  if (args.port !== undefined && args.verb !== "produce") throw new CliUsageError("--port requires produce");
  if (args.out !== undefined && args.verb === "check") throw new CliUsageError("--out requires direct, design, write, publish or produce");
  if ((args.pages !== undefined || args.report !== undefined) && args.verb !== "check") {
    throw new CliUsageError("--pages and --report require check");
  }
  if ((args.suites || args.strict) && args.verb !== "check") throw new CliUsageError("--suites and --strict require check");
  if ((args.slots || args.readiness) && args.verb !== "check") throw new CliUsageError("--slots and --readiness require check");
  if (args.records.length && args.verb !== "publish") throw new CliUsageError("--records requires publish");
  if ((args.install || args.page !== undefined || args.site !== undefined || args.build || args.origin !== undefined) && args.verb !== "publish") throw new CliUsageError("--install, --page, --site, --origin and --build require publish");
  if (args.page !== undefined && args.site !== undefined) throw new CliUsageError("publish --install takes --page or --site, not both");
  if (args.install && args.page === undefined && args.site === undefined && !args.help) throw new CliUsageError("publish --install requires --page <page id | page record.json> or --site <route pack id>");
  if (args.selection !== undefined && !args.install) throw new CliUsageError("--selection requires publish --install");
  if ((args.page !== undefined || args.site !== undefined) && !args.install) throw new CliUsageError("--page and --site require --install");
  if ((args.build || args.origin !== undefined) && args.site === undefined) throw new CliUsageError("--build and --origin require --site");
  if ((args.next !== undefined || args.assembly !== undefined || args.live) && (args.site === undefined || !args.install)) throw new CliUsageError("--next, --assembly and --live require publish --install --site");
  if (args.states !== undefined && args.next === undefined) throw new CliUsageError("--states requires publish --install --next");
  if ((args.next === undefined) !== (args.assembly === undefined)) throw new CliUsageError("publish --install --next requires --assembly <module>, and --assembly requires --next");
  if (args.next !== undefined && (args.build || args.origin !== undefined || args.selection !== undefined || args.records.length)) throw new CliUsageError("--next installs routes only; it takes no --build, --origin, --selection or --records");
  if (args.brief && args.verb !== "write" && args.verb !== "design" && args.verb !== "direct") throw new CliUsageError("--brief requires direct, design or write");
  if (args.brief && args.check) throw new CliUsageError("--brief and --check are mutually exclusive");
  if (!args.verb && !args.help) throw new CliUsageError("A verb is required");
  if (args.verb === "check" && !args.help) {
    const page = args.pages !== undefined || args.report !== undefined;
    if (page && (args.pages === undefined || args.report === undefined)) throw new CliUsageError("check requires --pages and --report");
  }
  return args;
}
