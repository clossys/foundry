/**
 * `clossys request` (foundry-build-0048 U5, SLOT-CREATE): a slotless need becomes a `clossys.queue-entry/2` kind
 * `slot` entry, never a refusal or a dropped input. Raise, check overlaps, decide reuse or create, close (link the requester
 * and notify it). `--scan` is the SCOPE demand step: it files a request for every consumer slot edge naming no slot.
 * The entries live at clossys/agents/producer/queue.slot/entries/<id>.json (records/request.ts): one queue, the
 * requester, assignee and target are fields. U7 adds kind change and kind fix about a placed slot (`--kind change|fix
 * --subject <ref>`): Producer's routing table (queue/routing.json) writes the route and the assignee, and a cross-agent
 * request is refused unless the requester's conform.json declares that issuing edge. A change or fix entry closes with
 * `<id> --close --outcome <o> --result <ref>` (records/request.ts closeWork): code re-runs the requester's check first,
 * and a fail records `rejected` and refuses, so the entry stays open; a pass closes it with a notify back to `from`.
 * An entry the owner answers carries options (U7 r4): `<id> --answer <option>` records the chosen id only and Producer
 * runs that option's step (records/request.ts answerRequest); free text never closes or decides anything.
 * CP1-L3: `<id> --receipt` writes the entry's lap metrics, `clossys.lap/1` (read/lap.ts).
 * CP1-REPORT: `--kind report --about <verb|skill|agent>/<name> --what bug|gap|ask` files tool feedback Producer owns
 * (records/report.ts); `--kind report --recheck` is loop.audit's step that takes reports back; `--list` shows ageHours.
 */
import { join, relative, resolve, sep } from "node:path";
import { readFileSync } from "node:fs";
import { runStep } from "../pipeline/runner.js";
import { writeLapReceipt } from "../read/lap.js";
import { ageHours, closeReport, evidenceOf, fileReport, listReports, readReport, recheckReports, REPORT_QUEUE, type CheckRunner, type ReportEntry } from "../records/report.js";
import {
  answerRequest, checkRequest, closeRequest, closeWork, decideRequest, isContentAgent, listWorkEntries, outcomesFor, raiseRequest, raiseWork, readRequest, REQUEST_SEATS, RequestError, slotlessNeeds, targetOf, type SlotRequest,
} from "../records/request.js";
import { CliUsageError } from "./args.js";
import type { CliResult } from "./main.js";
import { discoverRoot } from "./root.js";

export const REQUEST_USAGE = "Usage: clossys request --target <agent>/<slot> --from <agent>/<slot>|owner --why <text> [--rel input|uses] [--by <seat>] [--at <iso>] [--root <dir>]\n"
  + "       clossys request --kind change|fix --subject <agent>/<slot> --from <agent>/<slot>|owner --why <text> [--want repin|candidate|contract] [--check <id> --findings <a;b> --cause <text>] [--by <seat>] [--at <iso>] [--root <dir>]\n"
  + "       clossys request --kind report --about <verb|skill|agent>/<name> --what bug|gap|ask --why <text> [--evidence <path in repo>|\"clossys check ...\"] [--from <agent>/<slot>|owner] [--by <seat>] [--at <iso>] [--root <dir>]\n"
  + "       clossys request --kind report --recheck [--at <iso>] [--root <dir>]\n"
  + "       clossys request --list [--open] [--kind slot|change|fix|report] [--agent <id>] [--json] [--root <dir>]\n"
  + "       clossys request --scan [--dry] [--at <iso>] [--root <dir>]\n"
  + "       clossys request <id> --check | --decide reuse --slot <agent>/<slot> | --decide create --propose <slot> --under <l1>/<l2> [--kind <kind>] --inputs <ref,...> --contract <file> [--overlap-reason <text>] | --close [--approved queue.approve#<id>] [--owner-ref <ref>]\n"
  + "       clossys request <id> --close --outcome changed|declined (change) | fixed|declined (fix) --result <agent>/<slot>|<queue>#<id> --by <assignee> [--at <iso>] [--root <dir>]\n"
  + "       clossys request <id> --close --outcome fixed|declined --result foundry@<version-or-sha>|queue.report#<id> --by owner|producer [--at <iso>] [--root <dir>] (a report)\n"
  + "       clossys request <id> --answer <option> --via cli|chat|app --quote <owner's words, verbatim> [--note <text>] [--at <iso>] [--root <dir>]\n"
  + "       clossys request <id> --receipt [--changed-since <text>] [--root <dir>]\n"
  + "  --by is the seat acting (director, designer, writer, publisher, owner, planner, producer); a raise defaults to the\n"
  + "  requester slot's agent (owner for --from owner), a decide to the assignee, --scan and a slot --close to producer; a change\n"
  + "  or fix --close needs --by its agent assignee (a fix only as fixed; a declined fix, or one whose check Producer cannot\n"
  + "  re-run, asks the owner). An entry the owner answers lists its options: --answer <option> records the chosen id (the\n"
  + "  note changes nothing) and Producer runs its step (pin, close, handoff or keep open); bare owner never closes one. A raise\n"
  + "  needs the requester slot to cite the target; a target already placed is cited, not requested. A create over a\n"
  + "  placed slot of one L2 and kind family with overlapping inputs is refused (cite it) unless --overlap-reason says why\n"
  + "  the material differs; the reason and overlap ids go to the owner's sign.\n"
  + "  a need for a slot no agent holds is a queue entry (clossys.queue-entry/2 kind slot) at\n"
  + "  clossys/agents/producer/queue.slot/entries/<id>.json, assigned to the agent whose tree would hold it: that\n"
  + "  agent's <agent>.slot skill answers reuse or create, the owner signs a new leaf (--approved, the answered queue.approve\n"
  + "  entry of loop.slot step sign), clossys ia places it with a full\n"
  + "  contract, and --close links the requester slot-to-slot and notifies it. --scan files one for every consumer slot\n"
  + "  input or uses ref that names no slot (the SCOPE demand diff).\n"
  + "  --kind change|fix is about a placed slot (--subject): a change says what it wants, a fix carries its check, findings\n"
  + "  and cause. Producer's routing table writes the route and assignee; a cross-agent request needs the requester's\n"
  + "  declared issuing edge (conform.json requests.issuing). A change or fix closes with --outcome and --result once its\n"
  + "  handler's work is done: code re-runs the requester's check first; a fail records rejected and the entry stays open,\n"
  + "  a pass closes it and notifies --from.\n"
  + "  --receipt writes the entry's lap metrics (clossys.lap/1) to clossys/.state/laps/<id>.json from the entry, the engine\n"
  + "  log, the queues and git; it reads records only, and a value no record holds is \"unknown\". --changed-since names the\n"
  + "  change the lap tests (free text).\n"
  + "  --kind report is tool feedback: a clossys verb refused with no next step, a step has no verb, or the tool should do\n"
  + "  more (--what bug, gap or ask; --about the verb, skill or agent). It is a queue entry at\n"
  + "  clossys/agents/producer/queue.report/entries/<id>.json, routed upstream and assigned to producer, one open per\n"
  + "  --about and --what (a second filing returns the open one). --evidence is a file in the repository (its sha256 is\n"
  + "  kept) or a clossys check command, run now: it must fail, and its exit code and output are kept. A fixed close\n"
  + "  re-runs that check: a fail records rejected and the report stays open. A declined duplicate names the report it\n"
  + "  merges into (--result queue.report#<id>). --recheck (loop.audit's reports step, after a reinstall) re-runs each\n"
  + "  open report's check and closes the passing ones fixed as foundry@<installed version>. --from defaults to owner.\n"
  + "  --list --json gives every entry its ageHours (hours since it was raised), so a stale queue shows.";

const VALUED = new Set(["--target", "--from", "--why", "--rel", "--at", "--root", "--decide", "--slot", "--propose", "--under", "--kind", "--contract", "--owner-ref", "--approved", "--by", "--inputs", "--overlap-reason", "--subject", "--want", "--check", "--findings", "--cause", "--agent", "--outcome", "--result", "--answer", "--note", "--via", "--quote", "--changed-since", "--about", "--what", "--evidence"]);
const BARE = new Set(["--list", "--open", "--scan", "--dry", "--close", "--receipt", "--recheck"]);

interface Flags { positional: string[]; values: Map<string, string>; bare: Set<string> }
function parse(argv: readonly string[]): Flags | "help" {
  const flags: Flags = { positional: [], values: new Map(), bare: new Set() };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--help") return "help";
    if (arg === "--json") continue;
    // `<id> --check` is the bare overlap check; `--check <id>` names a fix's failing check.
    if (arg === "--check" && (argv[index + 1] === undefined || argv[index + 1]!.startsWith("--"))) { flags.bare.add(arg); continue; }
    if (VALUED.has(arg)) {
      const value = argv[++index];
      if (value === undefined || value.startsWith("--")) throw new CliUsageError(`${arg} requires a value\n${REQUEST_USAGE}`);
      flags.values.set(arg, value);
    } else if (BARE.has(arg)) flags.bare.add(arg);
    else if (arg.startsWith("--")) throw new CliUsageError(`Unknown option ${arg}\n${REQUEST_USAGE}`);
    else flags.positional.push(arg);
  }
  return flags;
}

const atOf = (flags: Flags): string => {
  const at = flags.values.get("--at") ?? new Date().toISOString().replace(/\.\d+Z$/, "Z");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(at)) throw new CliUsageError(`--at must be an ISO timestamp with seconds, ending in Z\n${REQUEST_USAGE}`);
  return at;
};
const refuse = (message: string): CliResult => ({ exitCode: 1, message: `request refused: ${message}` });
const summary = (request: SlotRequest) => `${request.id} ${request.status} ${request.from} -> ${request.target}${request.decision ? ` (${request.decision}${request.link ? ` ${request.link}` : ""})` : ""}`;
const reportLine = (report: ReportEntry) => `${report.id} ${report.status} ${report.from} -> producer (report ${report.what} ${report.about})`;
/** A report's check, run in process in the consumer root (the verb's own exit and message; a throw is exit 2). */
const runCheck: CheckRunner = async (argv, root) => {
  try { const result = await runStep([...argv, "--root", root], root); return { exitCode: result.exitCode, message: result.message }; } catch (error) { return { exitCode: 2, message: error instanceof Error ? error.message : String(error) }; }
};
/** The owner's options of an entry, one line each (`--answer <id>`: label, then the step it runs). */
const optionLines = (request: SlotRequest): string[] => (request.options ?? []).map(option => `  --answer ${option.id}: ${option.label} (${option.then.verb}${option.then.args.length ? ` ${option.then.args.join(" ")}` : ""})`);

export async function runRequestCli(argv: readonly string[], cwd: string): Promise<CliResult> {
  const flags = parse(argv);
  if (flags === "help") return { exitCode: 0, message: REQUEST_USAGE };
  const root = discoverRoot(resolve(cwd, flags.values.get("--root") ?? "."));
  const consumer = join(root, "clossys");
  const given = flags.values.get("--by");
  // A seat only: the owner closes nothing by --by; an owner entry is answered with --answer <option> (U7 r4).
  if (given !== undefined && !(REQUEST_SEATS as readonly string[]).includes(given)) throw new CliUsageError(`--by must be one of ${REQUEST_SEATS.join(", ")} (the owner answers an entry's options with --answer <option>)\n${REQUEST_USAGE}`);
  let by = given ?? "producer";
  try {
    if (flags.bare.has("--list")) {
      const listKind = flags.values.get("--kind");
      if (listKind !== undefined && !["slot", "change", "fix", "report"].includes(listKind)) throw new CliUsageError(`--list --kind must be slot, change, fix or report\n${REQUEST_USAGE}`);
      const read = [...listWorkEntries(consumer).map(item => ({ ...item, entry: item.request as SlotRequest | ReportEntry | undefined })), ...listReports(consumer).map(item => ({ ...item, entry: item.report }))];
      const agent = flags.values.get("--agent");
      const shown = read.filter(item => (!flags.bare.has("--open") || item.entry?.status === "open")
        && (listKind === undefined || item.entry?.kind === listKind)
        && (agent === undefined || !item.entry || item.entry.assignee === agent || item.entry.from.split("/")[0] === agent));
      const bad = read.filter(item => item.issues.length);
      const now = atOf(flags);
      return {
        exitCode: bad.length ? 1 : 0, root, output: { requests: shown.map(item => item.entry ? { ...item.entry, ageHours: ageHours(item.entry.createdAt, now) } : { file: item.file, issues: item.issues }) },
        message: [`request --list: ${shown.length} request${shown.length === 1 ? "" : "s"}${bad.length ? `, ${bad.length} invalid` : ""}`, ...shown.map(item => `  ${item.entry ? `${item.entry.kind === "report" ? reportLine(item.entry as ReportEntry) : summary(item.entry as SlotRequest)} (${ageHours(item.entry.createdAt, now)}h)` : `${item.file}: ${item.issues.join("; ")}`}`)].join("\n"),
      };
    }
    if (flags.bare.has("--scan")) return scan(consumer, root, atOf(flags), by, flags.bare.has("--dry"));
    const [id, ...extra] = flags.positional;
    const kind = flags.values.get("--kind");
    if (flags.bare.has("--recheck")) {
      if (kind !== "report" || id !== undefined) throw new CliUsageError(`--recheck takes --kind report and no <id>\n${REQUEST_USAGE}`);
      const done = await recheckReports(consumer, atOf(flags), runCheck);
      return {
        exitCode: done.invalid.length ? 1 : 0, root, output: done,
        message: [`request --kind report --recheck: ${done.closed.length} closed fixed, ${done.open.length} still failing, ${done.unchecked.length} with no check`, ...done.closed.map(each => `  closed ${REPORT_QUEUE}#${each}`), ...done.invalid.map(each => `  invalid: ${each}`)].join("\n"),
      };
    }
    if (id === undefined && kind === "report") {
      const about = flags.values.get("--about"), what = flags.values.get("--what"), why = flags.values.get("--why");
      if (!about || !what || !why) throw new CliUsageError(`a report takes --about, --what and --why\n${REQUEST_USAGE}`);
      const from = flags.values.get("--from") ?? "owner";
      const head = from.split("/")[0]!;
      if (given === undefined) by = from === "owner" ? "owner" : (REQUEST_SEATS as readonly string[]).includes(head) ? head : by;
      const value = flags.values.get("--evidence");
      const evidence = value !== undefined ? await evidenceOf(root, value, runCheck) : undefined;
      const filed = fileReport(consumer, { about, what, why, from, by, at: atOf(flags), source: "cli", ...(evidence ? { evidence } : {}) }, { dry: flags.bare.has("--dry") });
      return { exitCode: 0, root, output: filed.report, message: `request: ${filed.created ? "filed" : "already open"} ${reportLine(filed.report)} (route ${filed.report.route.row} -> ${filed.report.route.assignee})` };
    }
    if (["--about", "--what", "--evidence"].some(flag => flags.values.has(flag))) throw new CliUsageError(`--about, --what and --evidence go with --kind report\n${REQUEST_USAGE}`);
    if (id === undefined && flags.values.has("--subject")) {
      if (kind !== "change" && kind !== "fix") throw new CliUsageError(`--subject takes --kind change or fix\n${REQUEST_USAGE}`);
      const subject = flags.values.get("--subject")!, from = flags.values.get("--from"), why = flags.values.get("--why");
      if (!from || !why) throw new CliUsageError(`a ${kind} request takes --subject, --from and --why\n${REQUEST_USAGE}`);
      const want = flags.values.get("--want");
      if (want !== undefined && want !== "repin" && want !== "candidate" && want !== "contract") throw new CliUsageError(`--want must be repin, candidate or contract\n${REQUEST_USAGE}`);
      if (kind === "change" && want === undefined) throw new CliUsageError(`a change request takes --want\n${REQUEST_USAGE}`);
      const check = flags.values.get("--check"), cause = flags.values.get("--cause");
      const findings = (flags.values.get("--findings") ?? "").split(";").map(item => item.trim()).filter(Boolean);
      if (kind === "fix" && (!check || !cause || !findings.length)) throw new CliUsageError(`a fix request takes --check, --findings and --cause\n${REQUEST_USAGE}`);
      const head = from.split("/")[0]!;
      if (given === undefined) by = from === "owner" ? "owner" : isContentAgent(head) ? head : by;
      const raised = raiseWork(consumer, {
        kind, target: subject, from, why, source: "cli", by, at: atOf(flags),
        ...(want !== undefined ? { want } : {}), ...(kind === "fix" ? { check: check!, findings, cause: cause! } : {}),
      }, { dry: flags.bare.has("--dry") });
      const route = raised.request.route;
      return { exitCode: 0, root, output: raised.request, message: [`request: ${raised.created ? "raised" : "already open"} ${summary(raised.request)}${route ? ` (route ${route.row} -> ${route.assignee})` : ""}`, ...optionLines(raised.request)].join("\n") };
    }
    if (id === undefined) {
      const target = flags.values.get("--target"), from = flags.values.get("--from"), why = flags.values.get("--why");
      if (!target || !from || !why) throw new CliUsageError(`a new request takes --target, --from and --why\n${REQUEST_USAGE}`);
      const rel = flags.values.get("--rel") ?? "input";
      if (rel !== "input" && rel !== "uses") throw new CliUsageError(`--rel must be input or uses\n${REQUEST_USAGE}`);
      const head = from.split("/")[0]!;
      if (given === undefined) by = from === "owner" ? "owner" : isContentAgent(head) ? head : by;
      const raised = raiseRequest(consumer, { target, from, rel, why, source: "cli", by, at: atOf(flags) }, { dry: flags.bare.has("--dry") });
      return { exitCode: 0, root, output: raised.request, message: [`request: ${raised.created ? "raised" : "already open"} ${summary(raised.request)}`, ...optionLines(raised.request)].join("\n") };
    }
    if (extra.length) throw new CliUsageError(`request takes one <id>\n${REQUEST_USAGE}`);
    const report = readReport(consumer, id);
    if (report) {
      if (!flags.bare.has("--close")) return { exitCode: 0, root, output: report, message: `request ${reportLine(report)}` };
      const outcome = flags.values.get("--outcome"), result = flags.values.get("--result");
      if (!outcome || !result || given === undefined) throw new CliUsageError(`a report closes with --outcome fixed|declined, --result foundry@<version-or-sha>|queue.report#<id> and --by owner|producer\n${REQUEST_USAGE}`);
      const closed = await closeReport(consumer, id, { outcome, result, by: given, at: atOf(flags) }, runCheck);
      return { exitCode: 0, root, output: closed, message: `request ${id}: closed ${closed.outcome} (${closed.result})${closed.events.at(-2)?.op === "verified" ? ", its check passed" : ""}; notified ${closed.from}` };
    }
    if (flags.bare.has("--receipt")) {
      const changedSince = flags.values.get("--changed-since");
      const { receipt, file } = writeLapReceipt(root, id, changedSince !== undefined ? { changedSince } : {});
      return { exitCode: 0, root, output: receipt, message: `request ${id} --receipt: wrote ${relative(root, file).split(sep).join("/")}` };
    }
    if (flags.values.has("--changed-since")) throw new CliUsageError(`--changed-since goes with --receipt\n${REQUEST_USAGE}`);
    const answer = flags.values.get("--answer");
    if (answer !== undefined) {
      if (given !== undefined && given !== "owner") throw new CliUsageError(`--answer is the owner's; it takes no --by ${given}\n${REQUEST_USAGE}`);
      const via = flags.values.get("--via");
      if (via !== undefined && via !== "cli" && via !== "chat" && via !== "app") throw new CliUsageError(`--via must be cli, chat or app\n${REQUEST_USAGE}`);
      const note = flags.values.get("--note"), quote = flags.values.get("--quote");
      const result = await answerRequest(consumer, id, { option: answer, at: atOf(flags), ...(note !== undefined ? { note } : {}), ...(via !== undefined ? { via } : {}), ...(quote !== undefined ? { quote } : {}) });
      return { exitCode: result.ok ? 0 : 1, root, output: { request: result.request, option: result.option, ok: result.ok, ...(result.fix ? { fix: result.fix } : {}) }, message: `request ${id} --answer ${result.option.id}: ${result.message}` };
    }
    if (flags.values.has("--note") || flags.values.has("--via") || flags.values.has("--quote")) throw new CliUsageError(`--note, --via and --quote go with --answer\n${REQUEST_USAGE}`);
    if (flags.bare.has("--check")) {
      const checked = checkRequest(consumer, id, { by, at: atOf(flags) });
      return { exitCode: 0, root, output: checked, message: [`request ${id} --check: ${checked.overlaps!.length ? `${checked.overlaps!.length} possible overlap(s)` : "no overlap"}`, ...checked.overlaps!.map(item => `  ${item.slot}: ${item.why}`)].join("\n") };
    }
    const decide = flags.values.get("--decide");
    if (decide !== undefined && given === undefined) by = targetOf(readRequest(consumer, id))?.agent ?? by;
    if (decide === "reuse") {
      const slot = flags.values.get("--slot");
      if (!slot) throw new CliUsageError(`--decide reuse takes --slot <agent>/<slot>\n${REQUEST_USAGE}`);
      const decided = decideRequest(consumer, id, { decision: "reuse", slot, by, at: atOf(flags) });
      return { exitCode: 0, root, output: decided, message: `request ${id}: decided reuse ${slot}` };
    }
    if (decide === "create") {
      const slot = flags.values.get("--propose"), under = flags.values.get("--under"), file = flags.values.get("--contract");
      const inputs = (flags.values.get("--inputs") ?? "").split(",").map(item => item.trim()).filter(Boolean);
      if (!slot || !under || !file || !inputs.length) throw new CliUsageError(`--decide create takes --propose <slot>, --under <l1>/<l2>, --inputs <ref,...> and --contract <file>\n${REQUEST_USAGE}`);
      let contract: unknown;
      try { contract = JSON.parse(readFileSync(resolve(cwd, file), "utf8")); } catch { return refuse(`--contract ${file} is not a readable JSON file`); }
      if (typeof contract !== "object" || contract === null || Array.isArray(contract)) return refuse("--contract must hold a JSON object");
      const kind = flags.values.get("--kind");
      const overlapReason = flags.values.get("--overlap-reason");
      const decided = decideRequest(consumer, id, { decision: "create", proposal: { slot, under, ...(kind ? { kind } : {}), inputs, contract: contract as Record<string, unknown> }, ...(overlapReason ? { overlapReason } : {}), by, at: atOf(flags) });
      return { exitCode: 0, root, output: decided, message: `request ${id}: decided create ${targetOf(decided)!.agent}/${slot} under ${under}` };
    }
    if (decide !== undefined) throw new CliUsageError(`--decide takes reuse or create\n${REQUEST_USAGE}`);
    if (flags.bare.has("--close")) {
      const request = readRequest(consumer, id);
      if (request.kind !== "slot") {
        const outcome = flags.values.get("--outcome"), result = flags.values.get("--result");
        if (!outcome || !result) throw new CliUsageError(`a ${request.kind} entry closes with --outcome and --result\n${REQUEST_USAGE}`);
        const outcomes = outcomesFor(request.kind);
        if (!(outcomes as readonly string[]).includes(outcome)) throw new CliUsageError(`a ${request.kind} entry closes with --outcome ${outcomes.join(" or ")}\n${REQUEST_USAGE}`);
        // Who closes is said, never defaulted: the assignee names itself with --by; the owner answers with --answer.
        if (given === undefined) throw new CliUsageError(`a ${request.kind} entry closes with --by ${request.assignee} (its assignee); an entry the owner answers takes --answer <option>\n${REQUEST_USAGE}`);
        const closed = closeWork(consumer, id, { by: given, at: atOf(flags), outcome: outcome as (typeof outcomes)[number], result });
        if (closed.asked) {
          const { asked: _asked, ...entry } = closed;
          return { exitCode: 0, root, output: entry, message: [`request ${id}: stays open; Producer asked the owner about ${given}'s ${outcome} claim`, ...optionLines(entry)].join("\n") };
        }
        return { exitCode: 0, root, output: closed, message: `request ${id}: closed ${closed.outcome} (${closed.result}), the requester check passed; notified ${closed.from}` };
      }
      if (flags.values.has("--outcome") || flags.values.has("--result")) throw new CliUsageError(`a slot entry closes by its decision; --outcome and --result are for change and fix\n${REQUEST_USAGE}`);
      if (request.decision === "create") {
        // The new leaf is placed by the one placing verb, which closes the request after its write.
        const ownerRef = flags.values.get("--owner-ref"), approved = flags.values.get("--approved");
        return await runStep(["ia", `${targetOf(request)!.agent}/${request.proposal!.slot}`, "--request", id, ...(approved ? ["--approved", approved] : []), ...(ownerRef ? ["--owner-ref", ownerRef] : []), "--at", atOf(flags), "--root", root], cwd);
      }
      const approved = flags.values.get("--approved");
      const closed = closeRequest(consumer, id, { by: approved ? "owner" : by, at: atOf(flags), ...(approved ? { approved } : {}) });
      return { exitCode: 0, root, output: closed.request, message: [`request ${id}: closed, ${closed.request.from} linked to ${closed.request.link}`, ...closed.wrote.map(file => `  write ${file}`)].join("\n") };
    }
    const request = readRequest(consumer, id);
    return { exitCode: 0, root, output: request, message: [`request ${summary(request)}`, ...optionLines(request)].join("\n") };
  } catch (error) {
    if (error instanceof RequestError) return refuse(error.message);
    throw error;
  }
}

/** SCOPE's demand step: files a kind slot entry for every slotless need (records/request.ts slotlessNeeds). */
function scan(consumer: string, root: string, at: string, by: string, dry: boolean): CliResult {
  const lines: string[] = [];
  const unowned: string[] = [];
  const refused: string[] = [];
  let raised = 0, open = 0;
  for (const need of slotlessNeeds(consumer)) {
    if (!need.target) { unowned.push(`${need.from} -> ${need.to}`); continue; }
    let result: { request: SlotRequest; created: boolean };
    try {
      result = raiseRequest(consumer, { target: need.target, from: need.from, rel: need.rel, why: `${need.from} names ${need.to} as ${need.rel === "input" ? "an input" : "a used slot"}; no slot holds it`, source: "scope", by, at }, { dry });
    } catch (error) {
      // One refused need never hides the rest: it is listed and the scan exits 1.
      if (!(error instanceof RequestError)) throw error;
      refused.push(`${need.from} -> ${need.to}: ${error.message}`);
      continue;
    }
    if (result.created) raised++; else open++;
    lines.push(`  ${result.created ? (dry ? "would raise" : "raised") : "open"} ${summary(result.request)}`);
  }
  for (const edge of unowned) lines.push(`  no owner: ${edge} (no agent holds its first id segment; raise it with --target)`);
  for (const edge of refused) lines.push(`  refused: ${edge}`);
  return {
    exitCode: unowned.length || refused.length ? 1 : 0, root, output: { raised, open, unowned, refused },
    message: [`request --scan: ${raised} ${dry ? "to raise" : "raised"}, ${open} already open${unowned.length ? `, ${unowned.length} with no owner` : ""}${refused.length ? `, ${refused.length} refused` : ""}`, ...lines].join("\n"),
  };
}
