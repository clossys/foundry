/**
 * `clossys request` (foundry-build-0048 U5, SLOT-CREATE): a slotless need becomes a `clossys.queue-entry/2` kind
 * `slot` entry, never a refusal or a dropped input. Raise, check overlaps, decide reuse or create, close (link the requester
 * and notify it). `--scan` is the SCOPE demand step: it files a request for every consumer slot edge naming no slot.
 * The entries live at clossys/agents/producer/queue.slot/entries/<id>.json (records/request.ts): one queue, the
 * requester, assignee and target are fields.
 */
import { join, resolve } from "node:path";
import { readFileSync } from "node:fs";
import {
  checkRequest, closeRequest, decideRequest, isContentAgent, listRequests, raiseRequest, readRequest, REQUEST_SEATS, RequestError, slotlessNeeds, targetOf, type SlotRequest,
} from "../records/request.js";
import { CliUsageError } from "./args.js";
import type { CliResult } from "./main.js";
import { discoverRoot } from "./root.js";

export const REQUEST_USAGE = "Usage: clossys request --target <agent>/<slot> --from <agent>/<slot>|owner --why <text> [--rel input|uses] [--by <seat>] [--at <iso>] [--root <dir>]\n"
  + "       clossys request --list [--open] [--json] [--root <dir>]\n"
  + "       clossys request --scan [--dry] [--at <iso>] [--root <dir>]\n"
  + "       clossys request <id> --check | --decide reuse --slot <agent>/<slot> | --decide create --propose <slot> --under <l1>/<l2> [--kind <kind>] --inputs <ref,...> --contract <file> [--overlap-reason <text>] | --close [--approved queue.approve#<id>] [--owner-ref <ref>]\n"
  + "  --by is the seat acting (director, designer, writer, publisher, owner, planner, producer); a raise defaults to the\n"
  + "  requester slot's agent (owner for --from owner), a decide to the assignee, --scan and --close to producer. A raise\n"
  + "  needs the requester slot to cite the target; a target already placed is cited, not requested. A create over a\n"
  + "  placed slot of one L2 and kind family with overlapping inputs is refused (cite it) unless --overlap-reason says why\n"
  + "  the material differs; the reason and overlap ids go to the owner's sign.\n"
  + "  a need for a slot no agent holds is a queue entry (clossys.queue-entry/2 kind slot) at\n"
  + "  clossys/agents/producer/queue.slot/entries/<id>.json, assigned to the agent whose tree would hold it: that\n"
  + "  agent's <agent>.slot skill answers reuse or create, the owner signs a new leaf (--approved, the answered queue.approve\n"
  + "  entry of loop.slot step sign), clossys ia places it with a full\n"
  + "  contract, and --close links the requester slot-to-slot and notifies it. --scan files one for every consumer slot\n"
  + "  input or uses ref that names no slot (the SCOPE demand diff).";

const VALUED = new Set(["--target", "--from", "--why", "--rel", "--at", "--root", "--decide", "--slot", "--propose", "--under", "--kind", "--contract", "--owner-ref", "--approved", "--by", "--inputs", "--overlap-reason"]);
const BARE = new Set(["--list", "--open", "--scan", "--dry", "--check", "--close"]);

interface Flags { positional: string[]; values: Map<string, string>; bare: Set<string> }
function parse(argv: readonly string[]): Flags | "help" {
  const flags: Flags = { positional: [], values: new Map(), bare: new Set() };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--help") return "help";
    if (arg === "--json") continue;
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

export async function runRequestCli(argv: readonly string[], cwd: string): Promise<CliResult> {
  const flags = parse(argv);
  if (flags === "help") return { exitCode: 0, message: REQUEST_USAGE };
  const root = discoverRoot(resolve(cwd, flags.values.get("--root") ?? "."));
  const consumer = join(root, "clossys");
  const given = flags.values.get("--by");
  if (given !== undefined && !(REQUEST_SEATS as readonly string[]).includes(given)) throw new CliUsageError(`--by must be one of ${REQUEST_SEATS.join(", ")}\n${REQUEST_USAGE}`);
  let by = given ?? "producer";
  try {
    if (flags.bare.has("--list")) {
      const read = listRequests(consumer);
      const shown = read.filter(item => !flags.bare.has("--open") || item.request?.status === "open");
      const bad = read.filter(item => item.issues.length);
      return {
        exitCode: bad.length ? 1 : 0, root, output: { requests: shown.map(item => item.request ?? { file: item.file, issues: item.issues }) },
        message: [`request --list: ${shown.length} request${shown.length === 1 ? "" : "s"}${bad.length ? `, ${bad.length} invalid` : ""}`, ...shown.map(item => `  ${item.request ? summary(item.request) : `${item.file}: ${item.issues.join("; ")}`}`)].join("\n"),
      };
    }
    if (flags.bare.has("--scan")) return scan(consumer, root, atOf(flags), by, flags.bare.has("--dry"));
    const [id, ...extra] = flags.positional;
    if (id === undefined) {
      const target = flags.values.get("--target"), from = flags.values.get("--from"), why = flags.values.get("--why");
      if (!target || !from || !why) throw new CliUsageError(`a new request takes --target, --from and --why\n${REQUEST_USAGE}`);
      const rel = flags.values.get("--rel") ?? "input";
      if (rel !== "input" && rel !== "uses") throw new CliUsageError(`--rel must be input or uses\n${REQUEST_USAGE}`);
      const head = from.split("/")[0]!;
      if (given === undefined) by = from === "owner" ? "owner" : isContentAgent(head) ? head : by;
      const raised = raiseRequest(consumer, { target, from, rel, why, source: "cli", by, at: atOf(flags) }, { dry: flags.bare.has("--dry") });
      return { exitCode: 0, root, output: raised.request, message: `request: ${raised.created ? "raised" : "already open"} ${summary(raised.request)}` };
    }
    if (extra.length) throw new CliUsageError(`request takes one <id>\n${REQUEST_USAGE}`);
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
      if (request.decision === "create") {
        // The new leaf is placed by the one placing verb, which closes the request after its write.
        const { runIaCli } = await import("./owner.js");
        const ownerRef = flags.values.get("--owner-ref"), approved = flags.values.get("--approved");
        return await runIaCli([`${targetOf(request)!.agent}/${request.proposal!.slot}`, "--request", id, ...(approved ? ["--approved", approved] : []), ...(ownerRef ? ["--owner-ref", ownerRef] : []), "--at", atOf(flags), "--root", root], cwd);
      }
      const approved = flags.values.get("--approved");
      const closed = closeRequest(consumer, id, { by: approved ? "owner" : by, at: atOf(flags), ...(approved ? { approved } : {}) });
      return { exitCode: 0, root, output: closed.request, message: [`request ${id}: closed, ${closed.request.from} linked to ${closed.request.link}`, ...closed.wrote.map(file => `  write ${file}`)].join("\n") };
    }
    const request = readRequest(consumer, id);
    return { exitCode: 0, root, output: request, message: `request ${summary(request)}` };
  } catch (error) {
    if (error instanceof RequestError) return refuse(error.message);
    throw error;
  }
}

/** SCOPE's demand step: files a kind slot entry for every slotless need (records/request.ts slotlessNeeds). */
function scan(consumer: string, root: string, at: string, by: string, dry: boolean): CliResult {
  const lines: string[] = [];
  const unowned: string[] = [];
  let raised = 0, open = 0;
  for (const need of slotlessNeeds(consumer)) {
    if (!need.target) { unowned.push(`${need.from} -> ${need.to}`); continue; }
    const result = raiseRequest(consumer, { target: need.target, from: need.from, rel: need.rel, why: `${need.from} names ${need.to} as ${need.rel === "input" ? "an input" : "a used slot"}; no slot holds it`, source: "scope", by, at }, { dry });
    if (result.created) raised++; else open++;
    lines.push(`  ${result.created ? (dry ? "would raise" : "raised") : "open"} ${summary(result.request)}`);
  }
  for (const edge of unowned) lines.push(`  no owner: ${edge} (no agent holds its first id segment; raise it with --target)`);
  return {
    exitCode: unowned.length ? 1 : 0, root, output: { raised, open, unowned },
    message: [`request --scan: ${raised} ${dry ? "to raise" : "raised"}, ${open} already open${unowned.length ? `, ${unowned.length} with no owner` : ""}`, ...lines].join("\n"),
  };
}
