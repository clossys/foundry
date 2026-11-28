import { AGENT_LISTS } from "../agent-lists.generated.js";

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
  /** publish --install --next --bind: Publisher generates the assembly, states and page modules from the pinned page records (needs --selection). */
  bind?: boolean;
  /** publish --install --next: resolve leaves at request time through the assembly. */
  live: boolean;
  /** publish --install: the consumer's component selection module, `<module>[#export]`. */
  selection?: string;
  /** check: validate the slot model and report coverage (slots / with candidate / pinned). */
  slots: boolean;
  /** check --slots: also report blocked-by per agent. */
  readiness: boolean;
  /** check: run the slot constitution suite (R01-R16, R20) over every record instead of the default checks. */
  constitution: boolean;
  /** check --constitution: the chain's constitution step; pending rows are listed, never failing; until E2 it exits by the delta against the last green report (constitution/green.ts), with --strict by every enforced row. */
  enforced?: boolean;
  /** check --constitution: write the last green report (a full run whose delta gate passes, or the bootstrap). */
  recordGreen?: boolean;
  /** check --constitution: the green report file (default `clossys/evidence/constitution-green.json` under the root). */
  green?: string;
  /** check --constitution: only these rules (R01..R16, R20); repeated --rule flags accumulate. */
  rule?: string[];
  /** check --constitution: only the rows about this agent's records (director, designer, writer, publisher or producer). */
  agent?: string;
  /** check --constitution: the per-slot preflight, only the rows about these slots (`<agent>/<slot>`); repeated --slot flags accumulate. */
  slot?: string[];
  /** check --constitution: only the slots whose records changed against this git ref (`npm run check:changed`). */
  changed?: string;
  /** check: the consumer.e2e gate (src/check/e2e.ts): pack the cohort, install it into an empty directory, drive the shipped scenario, assert the rendered page. */
  e2e?: boolean;
  /** check --e2e: take the cohort tarballs from this directory instead of packing them. */
  from?: string;
  /** check --e2e: run this scenario file instead of the shipped one. */
  scenario?: string;
  /** check --e2e: keep the temp directory. */
  keep?: boolean;
  /** check --engine: verify the event chain, the index against a rebuild and every logged record's bytes (engine/check.ts). */
  engine?: boolean;
  /** check --side-door: the engine.side-door static scan of a foundry checkout (engine/side-door.ts). */
  sideDoor?: boolean;
}

export class CliUsageError extends Error {
  readonly exitCode = 2;
}

export const USAGE = "Usage: clossys <direct|design|write|publish|produce|check> [--check] [--root <dir>] [--json]\n"
  + "Options: --help; produce --once --port <0-65535> --no-open [--out <install out folder>]; publish --install --page <id> | --site <pack id> [--origin <url>] [--build] [--out <dir>]\n"
  + "Agents (pinned slot model, read-only): direct|design|write [--brief | --check] [--out <projection.json>]; publish (dry run: every pinned page compiled and checked, nothing installed)\n"
  + "Migrate: clossys migrate copy-keys [--check] [--root <dir>] (camelCase copy ids to the catalog's kebab-case ids; record text unchanged)\n"
  + "Migrate: clossys migrate inputs [--check] [--root <dir>] (declare Designer and Writer slot inputs from the read graph; only adds)\n"
  + "Migrate: clossys migrate ledger [--check] [--root <dir>] (backfill slot and agent ledger.json from git history; unexplained edits stay gaps; a second run changes nothing)\n"
  + "Migrate: clossys migrate state [--apply|--check] [--json] [--root <dir>] (dry run by default: the entries of a root .clossys/ folder that move into clossys/.state/; --apply moves them under the engine lock, logs one state.migrate event and removes the emptied folder; a second run plans nothing, or logs the event a stopped run left pending; while the folder exists every other verb but check --engine refuses, exit 2)\n"
  + "Migrate: clossys migrate citations-to-slots [--apply] [--json] [--root <dir>] (dry run by default: counts per agent of candidates whose citations still name a version and pins that still carry recited; --apply rewrites them in place)\n"
  + "Page check: clossys check --pages <generated-manifest.json> --report <report.json> [--json]\n"
  + "Slots: clossys check [--slots] [--readiness [--strict]] [--root <dir>] (enforced by default; --readiness --strict fails on every blocked slot; exits 1 while any slot anywhere is unpinned, so to judge one slot's own records run clossys check --constitution --slot <agent>/<slot>)\n"
  + "Chain: clossys run [--from <step>] [--until <step>] [--dry] [--explain] [--json] (runs every stale plumb step in order, stops at the first open decide step); clossys next [--owner [--agent <id>]] [--json] (that step's packet; --owner the interview's questions); clossys gaps [--agent <id>] [--json] (coverage, wiring and request gaps, read-only)\n"
  + "Submit: clossys next <agent>/<slot> --submit <file> --model <id> --tier <tier> --basis <basis> --skill <path> --rung <rung> [--seed <id>] [--reason <text>] (an agent's candidate, checked and recorded with its skill hash and selection-ladder rung)\n"
  + "Recipe: clossys recipe check <recipe-id> <stage> <slot> <file> [--root <dir>] (the stage check of the agent that owns the recipe, by recipe id, at a stage that check takes: clossys recipe --help lists them; exit 0 clean, 1 with one line per issue); clossys recipe generate <recipe-id> <spec.json> [--root <dir>] (the generator the recipe declares; prints the draft)\n"
  + "Critique: clossys critique-packet <agent>/<slot> --standard <id> --render <path>... (read-only: the blind critic's packet and every hash it carries); clossys critique <agent>/<slot> --record <file> --model <id> --tier <tier> [--candidate <name>] (records critiques/<stem>-v<n>.json, the stage after render; then next --submit)\n"
  + "Craft: clossys craft brief|diverge|render|critique|refine <agent>/<slot> --model <id> --tier <tier> --skill <path> [--file <json>] [--recipe <id>] (the P2 stages in order, as next --stage; brief assembles the pinned inputs, contract and standard; diverge refuses directions that share an axis value)\n"
  + "Owner: clossys ia <agent>/<slot> --contract <file> | --remove; clossys ia <agent> --adopt | --start; clossys evidence <id> --source <s> --observed <date> --by <who> --body <file>; clossys config --init; clossys seat <step> --by <who> ...; clossys rule <R-ID> --quote <text> --date <date> --status <status>; clossys answer <entry> <answer> --by owner --via chat|app|cli --quote \"<the owner's words>\" (closes one open queue entry)\n"
  + "Decisions: clossys pin <agent>/<slot> <candidate-id> [--by <who>] | clossys pin <agent>/<slot> --not-needed --reason <text>; clossys decisions [--json]\n"
  + "Brief: clossys brief <agent>/<slot> [--json] (the resolved brief: base plus tighten); clossys brief <agent>/<slot> --tighten --path <path> --op <max|min|require|add|remove|narrow> --value <json> --why <text> --by owner:<ref>|planner:<ref> (appends one stricter entry; a looser one is refused)\n"
  + "Candidate options: clossys options [<agent>/<slot> [--more]] | clossys options --classes [--check]; clossys pick <agent>/<slot> <candidate-id> --by agent:<seat>\n"
  + "Constitution: clossys check --constitution [--enforced | --strict] [--record-green] [--green <file>] [--rule <R01..R16|R20>] [--agent <agent>] [--slot <agent>/<slot>]... [--changed <ref>] [--json] [--root <dir>] (every rule over every record; exits 1 on any enforced or pending row; building checks report only unless --strict; warn checks never fail; --enforced, the chain's constitution step, exits 1 until E2 only on a new finding (an enforced row whose key the last green report lacks) or a hand-edited report; rows on records changed since that report (and their R07 dependants) and stale keys are counted, never blocking; --strict exits 1 on every enforced row, building rows included (the full gate); every run prints the new, changed-record, stale and total counts; --record-green seeds a missing green report, or rewrites it only when it adds no key (removals only); --agent keeps the rows about one agent's records; --slot <agent>/<slot> (repeatable) is the per-slot preflight: only that slot's rows, each with its one-line fix; --changed <git ref> runs it on every slot whose records changed against the ref, npm run check:changed)\n"
  + "End to end: clossys check --e2e [--from <tarball dir>] [--scenario <file>] [--keep] [--json] (consumer.e2e: packs the six first-party packages, installs the tarballs into an empty directory, drives the scenario Producer ships with the installed bin only and asserts the built HTML; a finding names its cause)\n"
  + "Engine: clossys check --engine [--root <dir>] [--json] (the event chain clossys/.state/events.jsonl verifies, clossys/.state/index.json agrees with a rebuild, every logged record holds its logged bytes and no root .clossys/ folder exists, the consumer layout keeping engine state only in clossys/.state/ (clossys migrate state --apply moves one); exits 1 on any finding); clossys index [--rebuild] [--root <dir>] (compare, or rewrite, the derived index); clossys check --side-door [--root <foundry checkout>] (engine.side-door: every engine state or slot-record write goes through the engine API)\n"
  + "Record suites: clossys check --suites [--strict] [--root <dir>] (also run with --pages/--report when --root is a consumer root; exits 1 while any slot anywhere is unpinned: scope to one slot with clossys check --constitution --slot <agent>/<slot>)\n"
  + "Install: clossys publish --install --page <page id | page record.json> --selection <component selection module>[#export] [--out <dir>] [--records <consumer dir>]...\n"
  + "Site: clossys publish --install --site <route pack id> [--origin <deployment origin>] [--build] [--out <dir>] [--records <consumer dir>]... (one routed app: content-map paths, route-pack slots, one frame)\n"
  + "Next app: clossys publish --install --site <publication> --next <app dir> --assembly <module> [--states <module>] [--live] [--check] (one route file per page, one [slug] route per leaf template; --states also installs the root layout and the loading, not-found, error and global-error files)\n"
  + "Bound Next app: clossys publish --install --site <publication> --next <app dir> --bind --selection <component selection module>[#export] [--check] (Publisher also generates the assembly, states and page modules from the pinned page records and installs their items into the app's project)\n"
  + "Slide deck: a deck.16x9 publication installs one page per slide at /<deck route>/<n> (from 1), each at a fixed 16:9 stage linking the previous and next slides (an --assembly serves them as pages <deck page>-<n>)";

export function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { help: false, check: false, brief: false, json: false, once: false, noOpen: false, suites: false, strict: false, records: [], install: false, build: false, live: false, slots: false, readiness: false, constitution: false };
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
      case "--bind": args.bind = true; break;
      case "--slots": args.slots = true; break;
      case "--readiness": args.readiness = true; break;
      case "--constitution": args.constitution = true; break;
      case "--enforced": args.enforced = true; break;
      case "--record-green": args.recordGreen = true; break;
      case "--green": args.green = value(); break;
      case "--rule": args.rule = [...(args.rule ?? []), value()]; break;
      case "--agent": args.agent = value(); break;
      case "--slot": args.slot = [...(args.slot ?? []), value()]; break;
      case "--changed": args.changed = value(); break;
      case "--e2e": args.e2e = true; break;
      case "--from": args.from = value(); break;
      case "--scenario": args.scenario = value(); break;
      case "--keep": args.keep = true; break;
      case "--engine": args.engine = true; break;
      case "--side-door": args.sideDoor = true; break;
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
  if (args.constitution && args.verb !== "check") throw new CliUsageError("--constitution requires check");
  if ((args.engine || args.sideDoor) && args.verb !== "check") throw new CliUsageError("--engine and --side-door require check");
  if ([args.engine, args.sideDoor, args.constitution].filter(Boolean).length > 1) throw new CliUsageError("check takes one of --engine, --side-door or --constitution");
  if (args.enforced && !args.constitution) throw new CliUsageError("--enforced requires check --constitution");
  if ((args.recordGreen || args.green !== undefined) && !args.constitution) throw new CliUsageError("--record-green and --green require check --constitution");
  if (args.recordGreen && (args.rule !== undefined || args.agent !== undefined)) throw new CliUsageError("--record-green needs a full run: no --rule or --agent");
  if (args.rule !== undefined && !args.constitution) throw new CliUsageError("--rule requires check --constitution");
  if (args.rule !== undefined && !args.rule.every(id => /^R(?:0[1-9]|1[0-6]|20)$/.test(id))) throw new CliUsageError("--rule must be a rule id R01..R16 or R20");
  if (args.agent !== undefined && !args.constitution) throw new CliUsageError("--agent requires check --constitution");
  if (args.agent !== undefined && !(AGENT_LISTS.live as readonly string[]).includes(args.agent)) throw new CliUsageError("--agent must be director, designer, writer, publisher or producer");
  if ((args.slot !== undefined || args.changed !== undefined) && !args.constitution) throw new CliUsageError("--slot and --changed require check --constitution");
  if (args.recordGreen && (args.slot !== undefined || args.changed !== undefined)) throw new CliUsageError("--record-green needs a full run: no --slot or --changed");
  if (args.slot !== undefined && !args.slot.every(target => new RegExp(String.raw`^(${AGENT_LISTS.live.join("|")})\/[a-z0-9][a-z0-9._-]*$`).test(target))) throw new CliUsageError("--slot must be <agent>/<slot> (agent director, designer, writer, publisher or producer)");
  if (args.e2e && args.verb !== "check") throw new CliUsageError("--e2e requires check");
  if ((args.from !== undefined || args.scenario !== undefined || args.keep) && !args.e2e) throw new CliUsageError("--from, --scenario and --keep require check --e2e");
  if (args.e2e && (args.constitution || args.suites || args.slots || args.readiness || args.pages !== undefined || args.strict)) throw new CliUsageError("check --e2e runs alone: no --constitution, --suites, --slots, --readiness, --pages or --strict");
  if (args.records.length && args.verb !== "publish") throw new CliUsageError("--records requires publish");
  if ((args.install || args.page !== undefined || args.site !== undefined || args.build || args.origin !== undefined) && args.verb !== "publish") throw new CliUsageError("--install, --page, --site, --origin and --build require publish");
  if (args.page !== undefined && args.site !== undefined) throw new CliUsageError("publish --install takes --page or --site, not both");
  if (args.install && args.page === undefined && args.site === undefined && !args.help) throw new CliUsageError("publish --install requires --page <page id | page record.json> or --site <route pack id>");
  if (args.selection !== undefined && !args.install) throw new CliUsageError("--selection requires publish --install");
  if ((args.page !== undefined || args.site !== undefined) && !args.install) throw new CliUsageError("--page and --site require --install");
  if ((args.build || args.origin !== undefined) && args.site === undefined) throw new CliUsageError("--build and --origin require --site");
  if ((args.next !== undefined || args.assembly !== undefined || args.live) && (args.site === undefined || !args.install)) throw new CliUsageError("--next, --assembly and --live require publish --install --site");
  if (args.states !== undefined && args.next === undefined) throw new CliUsageError("--states requires publish --install --next");
  if (args.bind && args.next === undefined) throw new CliUsageError("--bind requires publish --install --next");
  if (args.bind && (args.assembly !== undefined || args.states !== undefined || args.live)) throw new CliUsageError("--bind generates the assembly and states: it takes no --assembly, --states or --live");
  if (args.bind && args.selection === undefined) throw new CliUsageError("publish --install --next --bind requires --selection <component selection module>[#export]");
  if (!args.bind && (args.next === undefined) !== (args.assembly === undefined)) throw new CliUsageError("publish --install --next requires --assembly <module>, and --assembly requires --next");
  if (args.next !== undefined && (args.build || args.origin !== undefined || (!args.bind && args.selection !== undefined) || args.records.length)) throw new CliUsageError("--next installs routes only; it takes no --build, --origin, --selection or --records");
  if (args.brief && args.verb !== "write" && args.verb !== "design" && args.verb !== "direct") throw new CliUsageError("--brief requires direct, design or write");
  if (args.brief && args.check) throw new CliUsageError("--brief and --check are mutually exclusive");
  if (!args.verb && !args.help) throw new CliUsageError("A verb is required");
  if (args.verb === "check" && !args.help) {
    const page = args.pages !== undefined || args.report !== undefined;
    if (page && (args.pages === undefined || args.report === undefined)) throw new CliUsageError("check requires --pages and --report");
  }
  return args;
}
