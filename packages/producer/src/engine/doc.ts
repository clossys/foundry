/**
 * `packages/producer/docs/engine.md`, generated from the engine's own constants (never free prose):
 * `npm run generate:engine-doc -w @clossys/producer` writes it, and engine/doc.test.ts fails when the file differs from
 * engineDoc() or when a spec citation in the Producer source names a section CITED_SECTIONS does not hold.
 */
import { CHAIN_ISSUES, ENGINE_DIR, EVENTS_FILE, INDEX_FILE, LOCK_FILE, RECORD_AGENTS } from "./chain.js";
import { INDEX_FIELDS } from "./derived.js";
import { ENGINE_LOCK_WAIT_MS, FOREIGN_LOCK_MS, OWNERLESS_LOCK_MS } from "./lock.js";
import { ENGINE_SURFACE, surfaceFunctions, PAIRED_APPENDERS, PAIRED_WRITERS, SCRIPT_WRITERS, SIDE_DOOR_EXCLUDED, SIDE_DOOR_MESSAGES, SIDE_DOOR_READS, SIDE_DOOR_SCOPE, WRITE_CALLS } from "./side-door.js";
import { ENGINE_TYPES, GENESIS } from "./types.js";

export const ENGINE_DOC = "packages/producer/docs/engine.md";

/** The events each wired writer appends: kind, writer file (repo-relative), the literal the file holds, subject. */
export const EVENT_KINDS: readonly { readonly kind: string; readonly file: string; readonly literal: string; readonly subject: string }[] = [
  { kind: "<slot|agent>.<op>", file: "packages/producer/src/records/slot-write.ts", literal: "`${scope}.${engineOp(op)}`", subject: "<agent>[/<slot>]: one per ledger event, op from the ledger op" },
  { kind: "<slot|agent>.backfill", file: "packages/producer/src/records/slot-write.ts", literal: "\"backfill\"", subject: "<agent>[/<slot>]: a ledger rewritten by the ledger migration" },
  { kind: "pin.probe-repoint / pin.probe-restore", file: "packages/producer/src/records/slot-write.ts", literal: "\"pin.probe-repoint\"", subject: "designer/<slot>: the theme probe's pin swap and its restore" },
  { kind: "migration.record", file: "packages/producer/src/records/slot-write.ts", literal: "\"migration.record\"", subject: "migration:<id>" },
  { kind: "<pin kind>.write", file: "packages/producer/src/records/pin.ts", literal: "`${doc.kind}.write`", subject: "<agent>/<slot>: a pin or pin-map document" },
  { kind: "request.create / request.write", file: "packages/producer/src/records/request.ts", literal: "\"request.create\"", subject: "request:<id>" },
  { kind: "queue.create / queue.replace", file: "packages/producer/src/queue/entry.ts", literal: "\"queue.create\"", subject: "<queue>/<entry id>: every queue entry write, the chat answer path included" },
  { kind: "library.version", file: "packages/producer/src/records/library.ts", literal: "\"library.version\"", subject: "library:<slot>/<element>/v<n>" },
  { kind: "run.state / run.record / pin.revert", file: "packages/producer/src/loop/runner.ts", literal: "\"run.record\"", subject: "loop:<loop>/<run id>: run state, the run's ledger record, a reverted pin" },
];

/** The CLI verbs of the engine. */
export const ENGINE_VERBS: readonly (readonly [string, string])[] = [
  ["clossys index --rebuild", `rewrite ${INDEX_FILE} from the log plus the records, under the engine lock; exit 1 when the chain does not verify`],
  ["clossys index", "compare the stored index with a rebuild (read-only); exit 1 when they differ"],
  ["clossys check --engine", "verifyChain, index agreement and record drift on a consumer workspace; exit 1 on any issue"],
  ["clossys check --side-door", `the engine.side-door scan of a checkout (${SIDE_DOOR_SCOPE}); exit 1 on any finding`],
];

/**
 * The spec sections the Producer source cites (`system.md 6.3`, `flows.md F8`, `producer.md 10.4.1`), by id, each with
 * a neutral title and the file in this repository that now holds it. Ids and structure only.
 */
export const CITED_SECTIONS: readonly { readonly doc: "system" | "flows" | "producer"; readonly id: string; readonly title: string; readonly home: string }[] = [
  { doc: "system", id: "1", title: "Package vs consumer", home: "packages/producer/src/package-path.ts" },
  { doc: "system", id: "2", title: "Folder trees; queue and ledger entries are append-only", home: "packages/producer/src/queue/append-only.ts" },
  { doc: "system", id: "2.2", title: "Consumer workspace tree", home: "packages/producer/src/consumer-root.ts" },
  { doc: "system", id: "3", title: "File kinds", home: "packages/producer/src/records/types.ts" },
  { doc: "system", id: "4", title: "Field classes and the shared record types", home: "packages/producer/src/records/types.ts" },
  { doc: "system", id: "5", title: "Id and naming rules", home: "packages/producer/src/read/ref.ts" },
  { doc: "system", id: "6", title: "Record shapes", home: "packages/producer/src/records/types.ts" },
  { doc: "system", id: "6.1", title: "Slot (brief) shape", home: "packages/producer/src/records/slot.ts" },
  { doc: "system", id: "6.2", title: "Candidate shape", home: "packages/producer/src/records/candidate.ts" },
  { doc: "system", id: "6.3", title: "Pin shape", home: "packages/producer/src/records/pin.ts" },
  { doc: "system", id: "6.4", title: "Check result shape", home: "packages/producer/src/read/status.ts" },
  { doc: "system", id: "6.5", title: "Loop version, queue entry and ledger entry shapes", home: "packages/producer/src/queue/entry.ts" },
  { doc: "system", id: "6.6", title: "View prompt shape", home: "packages/producer/src/views/catalog.ts" },
  { doc: "system", id: "7", title: "Versioning and immutability", home: "packages/producer/src/records/candidate.ts" },
  { doc: "system", id: "8", title: "Refs and resolution", home: "packages/producer/src/records/resolve.ts" },
  { doc: "system", id: "9", title: "How the tree checks read the files", home: "packages/producer/src/check" },
  { doc: "system", id: "9.4", title: "Tree checks: append-only queue and ledger entries", home: "packages/producer/src/check/ledger-append-only.ts" },
  { doc: "system", id: "10", title: "Keep, change, new", home: "packages/producer/src/migrate" },
  { doc: "system", id: "12", title: "The chat interface: read models, render, preview, answer, views", home: "packages/producer/src/read" },
  { doc: "system", id: "12.1", title: "What replaces the studio", home: "packages/producer/src/views" },
  { doc: "system", id: "12.2", title: "clossys status --json", home: "packages/producer/src/read/status.ts" },
  { doc: "system", id: "12.3", title: "clossys slot <ref> --json", home: "packages/producer/src/read/slot.ts" },
  { doc: "system", id: "12.4", title: "clossys render <ref>", home: "packages/producer/src/specimen/render.ts" },
  { doc: "system", id: "12.5", title: "clossys preview <publication>", home: "packages/producer/src/preview/serve.ts" },
  { doc: "system", id: "12.6", title: "Answering in chat: the write path", home: "packages/producer/src/queue/answer.ts" },
  { doc: "system", id: "12.7", title: "View prompts", home: "packages/producer/views" },
  { doc: "system", id: "13.5", title: "Open question 5: ia sync and tightened slots", home: "packages/producer/src/cli/ia-sync.ts" },
  { doc: "system", id: "14", title: "Review fixes", home: "packages/producer/src" },
  { doc: "system", id: "14.1", title: "Skill files", home: "packages/producer/src/loop/slots.ts" },
  { doc: "system", id: "14.2", title: "Dependency direction", home: "packages/producer/src/release/build.ts" },
  { doc: "system", id: "14.3", title: "Render already exists", home: "packages/producer/src/specimen/render.ts" },
  { doc: "system", id: "14.4", title: "Studio extraction order", home: "packages/producer/src/server" },
  { doc: "system", id: "14.5", title: "Fate of the CLI verbs and the pipeline runner", home: "packages/producer/src/pipeline/runner.ts" },
  { doc: "system", id: "14.6", title: "Models and versions in examples", home: "packages/producer/src/records/candidate.ts" },
  { doc: "system", id: "14.7", title: "Landing fixture", home: "packages/producer/test-fixtures/consumer" },
  { doc: "system", id: "14.9", title: "Views: discovery and the studio kit", home: "packages/producer/src/views/agents-pointer.ts" },
  { doc: "flows", id: "2", title: "Triggers", home: "packages/producer/src/loop/names.ts" },
  { doc: "flows", id: "3", title: "Flows", home: "packages/producer/src/loop/runner.ts" },
  { doc: "flows", id: "4", title: "Loops", home: "packages/producer/src/loop/names.ts" },
  { doc: "flows", id: "F1", title: "Init", home: "packages/producer/src/cli/init.ts" },
  { doc: "flows", id: "F2", title: "Starter fill", home: "packages/producer/src/loop/slots.ts" },
  { doc: "flows", id: "F3", title: "Tighten brief", home: "packages/producer/src/records/slot.ts" },
  { doc: "flows", id: "F4", title: "Add an L3", home: "packages/producer/src/records/slot.ts" },
  { doc: "flows", id: "F5", title: "Owner feedback", home: "packages/producer/src/queue/feedback.ts" },
  { doc: "flows", id: "F6", title: "Failed check", home: "packages/producer/src/check" },
  { doc: "flows", id: "F7", title: "Upstream cascade", home: "packages/producer/src/loop/cascade.ts" },
  { doc: "flows", id: "F8", title: "New release", home: "packages/producer/src/release/index.ts" },
  { doc: "flows", id: "N3", title: "Node: choose the next slot", home: "packages/producer/src/loop/slots.ts" },
  { doc: "flows", id: "N10", title: "Node: pin", home: "packages/producer/src/records/pin.ts" },
  { doc: "flows", id: "N13", title: "Node: build", home: "packages/producer/src/release/build.ts" },
  { doc: "flows", id: "N16", title: "Node: route a finding", home: "packages/producer/src/loop/route.ts" },
  { doc: "producer", id: "1", title: "Ownership per L0; the Producer slot tree", home: "packages/producer/src/loop/producer-ia.ts" },
  { doc: "producer", id: "2", title: "Tree", home: "packages/producer/src/loop/names.ts" },
  { doc: "producer", id: "3", title: "The four loops", home: "packages/producer/src/loop/names.ts" },
  { doc: "producer", id: "10", title: "Build spec", home: "packages/producer/src/loop/runner.ts" },
  { doc: "producer", id: "10.1", title: "Package vs consumer, per file kind", home: "packages/producer/src/loop/version.ts" },
  { doc: "producer", id: "10.2", title: "Trees", home: "packages/producer/src/loop/files.ts" },
  { doc: "producer", id: "10.4", title: "Literal files", home: "packages/producer/src/loop/files.ts" },
  { doc: "producer", id: "10.4.1", title: "loop.refine: slot, consumer version, pin", home: "packages/producer/src/loop/slots.ts" },
];

/** A spec citation in source text: `<doc>[.md] <id>[, <id>...]`, ids like `6.3`, `F8`, `N13`, `2-3`, `14.4 step 6`. */
export const CITATION = /\b(system|flows|producer)(?:\.md)?((?:\s*(?:section\s+)?(?:[0-9]+(?:\.[0-9]+)*|[FN][0-9]+)(?:\s+(?:step|row)\s+[0-9]+)?(?:\s*(?:,|-|and)\s*)?)+)/g;
/** The section ids one citation names (step and row numbers dropped). */
export const citedIds = (ids: string): string[] => ids.replace(/\b(?:step|row)\s+[0-9]+/g, "").match(/[FN][0-9]+|[0-9]+(?:\.[0-9]+)*/g) ?? [];

const table = (head: readonly string[], rows: readonly (readonly string[])[]) =>
  [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map(row => `| ${row.map(cell => cell.replace(/\|/g, "\\|")).join(" | ")} |`)].join("\n");
const code = (text: string) => `\`${text}\``;

/** The text of docs/engine.md. */
export function engineDoc(): string {
  const parts = [
    "# Producer engine",
    "",
    "<!-- Generated by `npm run generate:engine-doc -w @clossys/producer` from `src/engine/`. Do not edit by hand; engine/doc.test.ts fails when this file and the code differ. -->",
    "",
    "Every record write of a consumer workspace goes through one engine: it appends one event to a hash-chained, append-only log, under one lock per workspace, and keeps a derived index that is never the source of truth. Files only, no database. The record files themselves (slots, candidates, pins, ledgers, queue entries, requests, library versions, run records) stay where and how they are; the events name them by path and sha256.",
    "",
    "## Files",
    "",
    "Paths are relative to the workspace root (the folder that holds `clossys/`).",
    "",
    table(["Path", "What"], [
      [code(EVENTS_FILE), "the event log: one JSON event per line, append-only, each line chained to the one before"],
      [code(LOCK_FILE), "the engine lock: created with O_EXCL, holds `{ pid, host, at, token }` of its writer"],
      [code(INDEX_FILE), "the derived index, rebuilt from the log plus the records"],
    ]),
    "",
    `Records under ${code(`clossys/agents/<${RECORD_AGENTS.join("|")}>/`)} and ${code("clossys/library/")} log to the workspace that holds them; ${code(ENGINE_DIR)} is never committed.`,
    "",
    "## Types",
    "",
    "`src/engine/types.ts` holds each type and its runtime validator (`eventIssues`, `stepIssues`, `runIssues`, `attestationIssues`, `gateIssues`, `draftIssues`).",
    "",
    ...ENGINE_TYPES.flatMap(type => [`### ${type.name}`, "", table(["Field", "Rule"], type.fields.map(([field, rule]) => [code(field), rule])), ""]),
    "## The chain",
    "",
    `Line n carries ${code("seq")} n and ${code("prev")}, the sha256 of line n-1's bytes (line 0: ${code("GENESIS")}, ${GENESIS.length} zeros). Its ${code("id")} is the sha256 of its canonical JSON without ${code("id")}. ${code("verifyChain(root)")} reads the whole log and reports:`,
    "",
    table(["Issue", "When"], CHAIN_ISSUES.map(([issue, when]) => [code(issue), when])),
    "",
    "Removing lines from the end leaves a valid shorter chain; the index head is what notices it.",
    "",
    "## The one writer",
    "",
    `${code("appendEvent(root, draft)")} validates the draft, takes the engine lock, chains the event to the last line, appends it as one line (fsync) and updates the index, all under the lock. It writes nothing on an invalid draft (EngineEventError), a torn or invalid last line (EngineLogError) or a busy lock (EngineBusyError). ${code("recordEvent(paths, draft)")} is the call a record writer makes after it wrote its files: the root comes from the first path, the inputs are every path with the sha256 of its bytes now. Since its files are already on disk, any failure of that append (a busy lock past the wait, a torn log) is a RecordCommittedError (code ${code("RECORD_COMMITTED")}), never an EngineBusyError: the write is done and must not be retried. The loop runner's own events (${code("commitEvent")}) and a transaction's commit refuse the same way.`,
    "",
    `A record write under a slot-record lock is one transaction of events (${code("deferEvents(write)")}): its events are held and appended in order when the write returns. A write its guard refuses puts its files back and drops the held events that name them, so a refused write logs nothing and the log never names bytes that are gone. A write that throws without undoing keeps its events. A scope opened inside another joins the outer one, so its events append when the outermost write returns.`,
    "",
    `An agent step of a loop is judged by what it changed: the log may change only by a pure append that verifies on the chain, and the index only to its rebuild (${code("engineLogIssue")} and ${code("engineIndexIssue")}, loop/agent-snapshot.ts). Each new event is either the step's own (a kind its decider verb makes, by the step's agent or the Producer code that verb runs, never an owner, a planner or another agent: ${code("AGENT_STEP_EVENTS")}) naming only files the step changed, each by the sha256 of its bytes; or the runner's run.state event for the run's own state file, by its bytes. A forged approval line chains as well as a real one, so the chain alone never clears it.`,
    "",
    "### Lock",
    "",
    table(["Rule", "Value"], [
      ["create", "`open(lock, \"wx\")`: exactly one writer creates it"],
      ["wait for a live holder", `${ENGINE_LOCK_WAIT_MS} ms, then EngineBusyError (code ${code("ENGINE_BUSY")}) naming the holder; nothing is written`],
      ["stale: same host", "the owner pid is no longer alive"],
      ["stale: another host", `held longer than ${FOREIGN_LOCK_MS / 60_000} min`],
      ["stale: no readable owner", `older than ${OWNERLESS_LOCK_MS / 1000} s`],
      ["takeover", "read the stale lock instance (its bytes, device, inode and mtime from one open), create that instance's own recovery marker (O_EXCL, named by a hash of the instance), re-read and re-judge the lock under the marker, then rename a fresh lock over it: the lock file is never absent, and only the one process holding the marker of the exact instance it judged replaces it; a marker whose owner died is itself recovered the same way"],
      ["release", "only while the lock still carries the holder's token"],
      ["order", "a writer takes its record lock (slot, agent, entry) first and the engine lock last"],
    ]),
    "",
    `Limit of the stale rule: staleness is judged by pid, host and age, never by asking the holder. A second writer is possible only when a live holder is judged stale under these time rules: a writer on another host still holding the lock after ${FOREIGN_LOCK_MS / 60_000} min (or seen that old through clock skew between the hosts), a writer on another machine that reports the same host name (its pid is not alive here), or a live writer whose lock still has no readable owner after ${OWNERLESS_LOCK_MS / 1000} s. No other path admits two writers.`,
    "",
    "## Writers",
    "",
    "Each wired writer keeps its on-disk record and adds one event per write.",
    "",
    table(["Event kind", "Writer", "Subject"], EVENT_KINDS.map(row => [code(row.kind), code(row.file), row.subject])),
    "",
    "## Derived index",
    "",
    table(["Field", "What"], INDEX_FIELDS.map(([field, what]) => [code(field), what])),
    "",
    "The index is never the source of truth: `appendEvent` keeps it current, a rebuild writes it from scratch, and `clossys check --engine` fails when the stored index differs from a rebuild or a record's bytes differ from the sha256 its last event logged.",
    "",
    "## Verbs",
    "",
    table(["Verb", "What"], ENGINE_VERBS.map(([verb, what]) => [code(verb), what])),
    "",
    "## Check engine.side-door",
    "",
    `Rule R-ENGINE-SIDE-DOOR. A static scan of ${code(SIDE_DOOR_SCOPE)} for writes to ${code(".clossys/**")} or to a slot record outside the engine API. It fails on every finding of the rules stated below. No allowlist and no baseline. Excluded: ${SIDE_DOOR_EXCLUDED}`,
    "",
    SIDE_DOOR_READS,
    "",
    table(["Finding", "Means"], Object.entries(SIDE_DOOR_MESSAGES).map(([kind, means]) => [code(kind), means])),
    "",
    `Write calls: ${WRITE_CALLS.map(code).join(", ")}, and an open with a write flag.`,
    "",
    "The engine API (writes here log events):",
    "",
    table(["File", "Functions", "Why"], ENGINE_SURFACE.map(row => [code(row.file), surfaceFunctions(row.functions), row.why])),
    "",
    `Record writers a script must not call directly: ${SCRIPT_WRITERS.map(code).join(", ")}.`,
    "",
    `Slot-model file primitives (${PAIRED_WRITERS.map(code).join(", ")}) must be paired in the same file with a ledger appender (${PAIRED_APPENDERS.map(code).join(", ")}).`,
    "",
    "## Cited spec sections",
    "",
    "The Producer source cites spec sections as `system.md <id>`, `flows.md <id>` and `producer.md <id>`. Each id resolves here, to the file in this repository that now holds it.",
    "",
    ...(["system", "flows", "producer"] as const).flatMap(doc => [
      `### ${doc}.md`, "",
      table(["Id", "Section", "Held by"], CITED_SECTIONS.filter(row => row.doc === doc).map(row => [row.id, row.title, code(row.home)])), "",
    ]),
  ];
  return `${parts.join("\n").replace(/\n+$/, "")}\n`;
}
