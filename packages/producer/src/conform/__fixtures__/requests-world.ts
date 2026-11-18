/**
 * The request lens's own consumer world (foundry-build-0048 U7, Q rows): the release world (release/__fixtures__)
 * with one request of each kind about every content agent, raised and closed by the production paths only, so Q3, Q4
 * and Q6-Q9 and Q11 judge real entries instead of an empty store. The default consumer fixture stays untouched.
 *
 * - kind slot: four slotless needs the slots cite (Designer -> Director, Publisher -> Designer and Writer, Writer ->
 *   Publisher), filed by `clossys request --scan`;
 * - kind change: Writer -> Director, Designer and Publisher, and Publisher -> Writer, each closed by
 *   `clossys request <id> --close --outcome changed` once the requester check passes;
 * - kind fix: one from the owner about each agent's slot; Director's, Designer's and Publisher's close as fixed, and
 *   Writer's (a record slot, sections.hero.copy#home.hero) stays open, so the release gate must refuse it;
 * - a done loop.create run answering each closed fix and Writer's change, each step writing only the agent's own folder;
 * - each agent's ia.json placing the world's slots (the release world's voice and site frame included), Publisher's release input edge to Director (its locales), and each
 *   pin's scorecard verdict as the pin gate records it.
 *
 * Structure and real slot ids only; nothing outside the tmp root is written.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runRequestCli } from "../../cli/request.js";
import { pinChecks } from "../../constitution/cascade.js";
import { certifyEnv } from "../../constitution/certify/index.js";
import { liveSlotRecords } from "../../constitution/checks/shared.js";
import { buildContext } from "../../constitution/context.js";
import { SCORECARD_SCHEMA, writeScorecard, type ScorecardRow } from "../../constitution/pin-gate.js";
import { listRequests, raiseWork } from "../../records/request.js";
import { writeSlot } from "../../records/slot.js";
import type { Ref, SlotRequest } from "../../records/types.js";
import { releaseWorld, type ReleaseWorld } from "../../release/__fixtures__/world.js";

const FIXTURE_AGENTS = fileURLToPath(new URL("../../../test-fixtures/consumer/clossys/agents", import.meta.url));

export const REQUESTS_AT = "2026-11-20T09:00:00Z";

/** The slotless needs the world's slots cite: `<from>` names `<to>` as rel. */
export const NEEDS: readonly { readonly from: string; readonly to: string; readonly rel: "input" | "uses" }[] = [
  { from: "designer/sections.hero", to: "director/focus.segment.core", rel: "input" },
  { from: "publisher/page.home", to: "designer/sections.features", rel: "uses" },
  { from: "publisher/page.home", to: "writer/sections.features.copy", rel: "uses" },
  { from: "writer/sections.hero.copy", to: "publisher/page.about", rel: "uses" },
];
/** Change entries: requester -> placed target. */
export const CHANGES: readonly { readonly from: string; readonly target: string; readonly want: "repin" | "candidate" | "contract" }[] = [
  { from: "writer/sections.hero.copy", target: "director/focus.reach.geography", want: "repin" },
  { from: "writer/sections.hero.copy", target: "designer/sections.hero", want: "candidate" },
  { from: "writer/sections.hero.copy", target: "publisher/page.home", want: "contract" },
  { from: "publisher/page.home", target: "writer/sections.hero.copy", want: "candidate" },
];
export const FIXES = ["director/focus.reach.geography", "designer/sections.hero", "writer/sections.hero.copy", "publisher/page.home"] as const;
/** The one fix left open: a Writer record slot the release reads. */
export const OPEN_FIX = "writer/sections.hero.copy";

export interface RequestsWorld extends ReleaseWorld {
  readonly consumer: string;
  /** Every entry the world raised, by kind, as raised. */
  readonly raised: { readonly slot: readonly SlotRequest[]; readonly change: readonly SlotRequest[]; readonly fix: readonly SlotRequest[] };
}

/** Each agent's ia.json placing exactly the world's slots, so listSlots (and SCOPE's demand diff) sees them. */
function placeSlots(root: string): void {
  const source = (agent: string): string => (JSON.parse(readFileSync(join(FIXTURE_AGENTS, agent, "ia.json"), "utf8")) as { source: string }).source;
  const node = (id: string, label: string, children: readonly [string, string, readonly string[]][]) => ({ id, label, children: children.map(([child, name, slots]) => ({ id: child, label: name, slots })) });
  // The release world also holds Director's voice and Designer's site frame (the copy and the page cite them), so they
  // stay placed: a held slot outside its agent's IA would read as a slotless need.
  const ias: Record<string, Record<string, unknown>> = {
    director: { nodes: [node("focus", "Focus", [["focus.reach", "Reach", ["focus.reach.geography"]]]), node("identity", "Identity", [["identity.verbal", "Verbal", ["identity.verbal.voice"]]])] },
    designer: { nodes: [node("frames", "Frames", [["frames.site", "Site", ["frames.site-shell"]]]), node("sections.sections", "Sections", [["sections-story", "Story", ["sections.hero"]]])] },
    writer: { nodes: [node("copy.section-copy", "Section copy", [["story", "Story", ["sections.hero.copy"]]])] },
  };
  for (const [agent, ia] of Object.entries(ias)) {
    writeFileSync(join(root, "clossys/agents", agent, "ia.json"), `${JSON.stringify({ schema: "clossys.ia/1", source: source(agent), extensions: [], ...ia }, null, 2)}\n`);
  }
  // Publisher's ia.json keeps the release world's publications and gains its slot nodes.
  const publisher = join(root, "clossys/agents/publisher/ia.json");
  const doc = JSON.parse(readFileSync(publisher, "utf8")) as Record<string, unknown>;
  writeFileSync(publisher, `${JSON.stringify({ ...doc, source: "workspace#owner", extensions: [], nodes: [node("composition.pages", "Pages", [["pages-site", "Site", ["page.home"]], ["releases-site", "Releases", ["release.site"]]])] }, null, 2)}\n`);
}

/**
 * The world's pins as the pin gate leaves them: each pinned candidate's scorecard row records a passing verdict on
 * its pinSet at pin time (pin-gate.ts writeScorecard). The release world pins by hand-written pin.json, so without
 * this every pin reads as legacy and the requester check re-judges it.
 */
function recordPinVerdicts(root: string): void {
  const ctx = buildContext(root, join(root, "clossys"));
  const env = certifyEnv(ctx);
  const rows = new Map<string, { agent: string; id: string; rows: ScorecardRow[] }>();
  for (const check of pinChecks(ctx, env, liveSlotRecords(ctx))) {
    const key = `${check.slot.agent}/${check.slot.id}`;
    const entry = rows.get(key) ?? { agent: check.slot.agent, id: check.slot.id, rows: [] };
    entry.rows.push({ rank: entry.rows.length + 1, candidate: check.candidate.name, sha256: check.candidate.sha256, submitted: true, certified: true, verdict: "certify", reasons: [], pinSet: check.current });
    rows.set(key, entry);
  }
  for (const [slot, entry] of rows) {
    writeScorecard(root, entry.agent, entry.id, { schema: SCORECARD_SCHEMA, slot, at: REQUESTS_AT, pick: entry.rows[0]!.candidate, candidates: entry.rows });
  }
}

/** Makes a slot's scorecard verdicts stale: each row's pinSet becomes zeros, so the pinned candidate is re-judged. */
export function staleVerdicts(root: string, agent: string, slotId: string): void {
  const file = join(root, ".clossys/checks", agent, slotId, "scorecard.json");
  const doc = JSON.parse(readFileSync(file, "utf8")) as { candidates: { pinSet: string }[] };
  writeFileSync(file, `${JSON.stringify({ ...doc, candidates: doc.candidates.map(row => ({ ...row, pinSet: "0".repeat(64) })) })}\n`);
}

/**
 * Adds a required copy field (`header.subheading`) to Writer's sections.hero.copy contract that its pinned record lacks.
 * A fresh recorded verdict is taken as it stands, so nothing re-judges the record until its verdict goes stale; then
 * the real certifier refuses it. (The release world's candidates certify on the real standards, so a stale verdict
 * alone re-judges green.)
 */
export function requireMissingCopyField(root: string): void {
  const file = join(root, "clossys/agents/writer/sections.hero.copy/slot.json");
  const doc = JSON.parse(readFileSync(file, "utf8")) as { contract: { copy: { fields: unknown[] }; records: Record<string, { uses: string[] }> } };
  const { contract } = doc;
  writeSlot(file, { ...doc, contract: {
    ...contract, copy: { ...contract.copy, fields: [...contract.copy.fields, { key: "header.subheading", required: true }] },
    records: { ...contract.records, "home.hero": { uses: [...contract.records["home.hero"]!.uses, "header.subheading"] } },
  } } as never);
}

function cite(root: string, from: string, refs: readonly Ref[]): void {
  const [agent, id] = from.split("/") as [string, string];
  const file = join(root, "clossys", "agents", agent, id, "slot.json");
  const doc = JSON.parse(readFileSync(file, "utf8")) as { refs: Ref[] };
  writeSlot(file, { ...doc, refs: [...doc.refs, ...refs] } as never);
}

/** A done loop.create run of `agent` answering `<queue>#<id>`, its one step writing only under `target`. */
function answeringRun(consumer: string, run: string, at: string, answers: { readonly queue: string; readonly id: string }, agent: string, target: string): void {
  const ledger = join(consumer, "agents/producer/ledger.create/entries");
  mkdirSync(ledger, { recursive: true });
  writeFileSync(join(ledger, `${run}.json`), `${JSON.stringify({
    schema: "clossys.ledger-entry/1", id: run, loop: "loop.create", createdAt: at, status: "done",
    refs: [{ to: `producer/${answers.queue}`, record: answers.id, rel: "answers" }],
    steps: [{ id: "create", decider: { by: "agent", agent }, cli: "clossys submit", exit: 0, wrote: [{ file: `${target}/candidates/${agent}-answer-v2.json`, sha256: null }] }],
  })}\n`);
}

async function cli(root: string, argv: readonly string[]): Promise<unknown> {
  const result = await runRequestCli([...argv, "--root", root], root);
  if (result.exitCode !== 0) throw new Error(`clossys request ${argv.join(" ")} exited ${result.exitCode}: ${result.message}`);
  return result.output;
}

export async function requestsWorld(): Promise<RequestsWorld> {
  const world = releaseWorld();
  const { root } = world;
  const consumer = join(root, "clossys");
  placeSlots(root);
  // The release reads its locales from Director's geography brief: Publisher's input edge to Director.
  cite(root, "publisher/release.site", [{ to: "director/focus.reach.geography", key: "Language", rel: "input" } as Ref]);
  for (const from of new Set(NEEDS.map(need => need.from))) cite(root, from, NEEDS.filter(need => need.from === from).map(need => ({ to: need.to, rel: need.rel } as Ref)));

  recordPinVerdicts(root);

  // kind slot: SCOPE's demand step files one entry per slotless need.
  await cli(root, ["--scan", "--at", REQUESTS_AT]);
  const slot = listRequests(consumer, "slot").flatMap(read => read.request ? [read.request] : []);

  // kind change: raised by the requester slot's agent over its declared issuing edge, closed through the verb.
  const change: SlotRequest[] = [];
  for (const [index, item] of CHANGES.entries()) {
    const at = `2026-11-20T09:1${index}:00Z`;
    let raised = raiseWork(consumer, { kind: "change", target: item.target, from: item.from, want: item.want, why: `${item.from} needs ${item.target} to change`, source: "cli", by: item.from.split("/")[0]!, at }).request;
    // An owner-class target asks the owner a closed question; the owner's typed answer hands it to the slot's agent.
    if (raised.assignee === "owner") {
      await cli(root, [raised.id, "--answer", "handoff", "--by", "owner", "--at", `2026-11-20T09:1${index}:10Z`]);
      raised = listRequests(consumer, "change").flatMap(read => read.request?.id === raised.id ? [read.request] : [])[0]!;
    }
    change.push(raised);
    if (raised.assignee === "writer") answeringRun(consumer, `20261120T091${index}Z-create-writer`, `2026-11-20T09:1${index}:30Z`, { queue: "queue.change", id: raised.id }, "writer", item.target);
    await cli(root, [raised.id, "--close", "--outcome", "changed", "--result", item.target, "--by", raised.assignee, "--at", `2026-11-20T09:2${index}:00Z`]);
  }

  // kind fix: one from the owner about each agent's slot; all but the Writer record slot's close as fixed.
  const fix: SlotRequest[] = [];
  for (const [index, target] of FIXES.entries()) {
    const raised = raiseWork(consumer, {
      kind: "fix", target, from: "owner", why: `${target} fails its check`, source: "check", by: "producer", at: `2026-11-20T09:3${index}:00Z`,
      check: "pins.resolve", findings: [`${target} does not resolve`], cause: "the slot had no pin",
    }).request;
    fix.push(raised);
    if (target === OPEN_FIX) continue;
    const agent = target.split("/")[0]!;
    // The handler's loop.create run answers the entry, writing only the agent's own folder.
    answeringRun(consumer, `20261120T094${index}Z-create-${agent}`, `2026-11-20T09:4${index}:00Z`, { queue: "queue.fix", id: raised.id }, agent, target);
    await cli(root, [raised.id, "--close", "--outcome", "fixed", "--result", target, "--by", agent, "--at", `2026-11-20T09:5${index}:00Z`]);
  }
  return { ...world, consumer, raised: { slot, change, fix } };
}
