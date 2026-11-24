/** `clossys migrate copy-keys|inputs|ledger|contracts|citations-to-slots|placement|recut|requests|slots|state [--check|--apply] [--root <dir>] [--json]`: deterministic slot-record codemods. */
import { resolve } from "node:path";
import { applyCopyKeyMigration, planCopyKeyMigration } from "../migrate/copy-keys.js";
import { applyCitationsToSlots, planCitationsToSlots } from "../migrate/citations-to-slots.js";
import { applyInputsMigration, planInputsMigration } from "../migrate/inputs.js";
import { applyLedgerBackfill, planLedgerBackfill } from "../migrate/ledger.js";
import { applyPlacementBackfill, planPlacementBackfill } from "../migrate/placement.js";
import { RECUT_AGENTS, applyRecut, planFollowUp, planRecut, recutPending, recutProblems } from "../migrate/recut.js";
import { applyContracts, planContracts } from "../migrate/contracts.js";
import { applyRequestMigration, planRequestMigration } from "../migrate/requests.js";
import { applyStateMigration, pendingStateMigration, planStateMigration } from "../engine/migrate-state.js";
import { LEGACY_STATE_DIR, STATE_DIR } from "../engine/state-dir.js";
import "../constitution/guard.js"; // registers the write guard's runner (migrate slots runs the migrate guard per folder)
import { SLOTS_JOURNAL, SLOTS_MIGRATION_CLI, applySlotsMigration, planSlotsMigration, slotsPending } from "../migrate/slots.js";
import { cliActor } from "../records/pin.js";
import { nowIso } from "./ia-sync.js";
import { SLOT_AGENTS } from "../records/slot-model/index.js";
import type { CliResult } from "./main.js";
import { discoverRoot } from "./root.js";

// The requests, slots and state lines are DRAFT copy (not owner-approved).
export const MIGRATE_USAGE = "Usage: clossys migrate copy-keys|inputs|ledger [--check] [--root <dir>] [--json]\n"
  + "       clossys migrate contracts [--check] [--at <iso>] [--root <dir>] [--json]\n"
  + "       clossys migrate citations-to-slots [--apply] [--root <dir>] [--json]\n"
  + "       clossys migrate placement [--apply|--check] [--at <iso>] [--root <dir>] [--json]\n"
  + "       clossys migrate recut [--apply|--check] [--at <iso>] [--root <dir>] [--json]\n"
  + "       clossys migrate requests [--apply|--check] [--at <iso>] [--root <dir>] [--json]\n"
  + "       clossys migrate slots [--apply|--check] [--at <iso>] [--root <dir>] [--json]\n"
  + "       clossys migrate state [--apply|--check] [--root <dir>] [--json]\n"
  + "copy-keys renames camelCase copy ids in Designer and Writer slot.json and Writer candidates to the catalog's kebab-case ids; record text is unchanged.\n"
  + "inputs declares Designer and Writer slot.json inputs from the read graph (the Designer brief, slot-contract theme and asset reads, pinned Writer source refs); inputs are only added.\n"
  + "citations-to-slots rewrites citations to slot ids, which resolve through the cited slot's pin: every versioned citation of a known slot (<slot>@<n>, <agent>:<slot>@<n>) in a candidate becomes <slot> or <agent>:<slot> (a line anchor <ref>@<n>#L<line> keeps a version: in the pinned candidate it moves to the version the pin's recited gave it), and every pin drops recited, its sha256 carried to the rewritten pinned bytes (the decision is kept). It is a dry run that reports counts per agent unless --apply is given; --apply records one migrated event per rewritten file in clossys/evidence/migrations.json (the provenance constitution R08.2 accepts); a second run plans nothing.\n"
  + "ledger backfills every slot and agent ledger.json from git history for records written before the ledger: a submit per candidate add, a migrate per change the migration manifest explains, a pin, pick or confirm per pin.json change, a slot event per slot.json change and an ia event per ia.json change, each naming its commit (backfill); an unexplained edit gets no event (a gap); a ledger holding any non-backfill event is kept; a second run changes nothing.\n"
  + "placement backfills the placement decision on slots placed before placement recorded one: every placed Director, Designer, Writer and Publisher slot whose ledger.json holds no slot event deciding reuse or create with its overlaps gets one slot event (verb migrate, by producer, migration placement) deciding create, with the overlaps the placement check finds among the agent's other placed slots (possibly none; no overlap reason or owner sign is added). A dry run unless --apply is given; a slot or ledger that does not read is a finding (exit 1); a second --apply writes nothing.\n"
  + "recut moves an int2 consumer onto the recut slot trees of the installed packages: a slot folder is found by its slot.json at any depth below agents/<agent>/ and first moves to agents/<agent>/<id>/ (the id from slot.json; a group folder left empty is removed, a duplicate id or an occupied flat place refuses the run); every Director, Designer, Writer and Publisher slot folder maps through its package tree and src/catalog/retired.json (a live id stays, a retired id with a live target moves its candidates there, any other retired id moves to agents/<agent>/_retired/<id> and leaves the agent ia.json, recorded in its retired list); every candidate gets the clossys.candidate/1 header (created by code: clossys migrate recut) with its body kept (a Publisher clossys.page/1 page record is kept as is), each rewrite a migrated event in clossys/evidence/migrations.json; each clossys/library/<slot>/<name>/v<n>/ cell becomes the candidate <name>-v<n>.md in its target slot (preview.json dropped); then slot-1-to-2, pin-1-to-2 and ia sync run. A dry run with counts per agent unless --apply is given; an id in no package tree and no retired.json (a slot folder, an ia.json placement or a library slot) is named and exits 1; any finding exits 1 in every mode, and --apply checks the whole plan first and writes nothing unless every write fits; a second --apply changes nothing.\n"
  + "contracts seeds every Director, Designer and Writer slot/2 slot.json with what CREATE and CHOOSE read, from package data only: family (options, varyOn, values and class from the option table; an agent the table maps nothing for offers one candidate), contract.requirements (every requirement check of the slot's standard) and contract.fixture where the contract determines it (a Writer copy contract's required keys in its source locale); each rewrite is one ledgered slot event (verb migrate), slot data the package does not determine is named as a gap, and a second run changes nothing.\n"
  + "requests moves the request records Director and Designer kept of their own (requests/REQ-NNNN.json, needs/NEED-NNN.json) into Producer's queue as clossys.queue-entry/2 entries, raised by producer and routed like any other: a Director request becomes one entry per cell (a contradiction on a placed cell a kind fix, another request on a placed cell a change wanting a candidate, a cell no slot holds a kind slot); a Designer need becomes one entry about its candidate slot, its why \"<raisedBy> needs <missing>\" as Designer dogfood links it; the requester is the record's raiser when that is a placed slot, the owner when the owner raised it, and otherwise the agent that kept it (a change or fix from its target slot, a slot entry from the agent's placed slot that cites the need), never the owner for an agent's record. Nothing is lost: each entry's raised event carries the whole record (its why, id, file and JSON), and a record whose work an earlier record of the run or an open entry already holds is a planned merge that --apply appends as one more raised event. Status maps faithfully: open, drafted or proposed is open work; resolved, built or closed closes changed (a fix fixed) and declined closes declined, as the assignee agent through the queue's close gates; a close those gates refuse, a slot entry to close, and an owner-approved need are findings. A dry run unless --apply is given; any finding (a record that does not read, a need with no candidate slot, an agent's slot entry no slot of its own cites, a raise, merge or close the queue refuses, a store or record reached through a symbolic link, a legacy store under --root outside clossys/) exits 1 and --apply then writes nothing; --apply removes each migrated file only after every entry it became is re-read from disk carrying it and synced, then a legacy folder left empty; a rerun after a stopped run finishes only what is missing, and a second run plans nothing.\n"
  + "slots converts the store to one format in place: every slot folder under clossys/agents/ (the Producer's seats too) ends with a clossys.slot/2 slot.json, a clossys.pin/2 (or clossys.pin-map/1) pin.json and candidates carrying a clossys.candidate/1 header (content kept; a pin moves to the headered bytes only when it pinned exactly the bytes the header was added to), then clossys/store-format.json is written, after which every reader refuses a slot/1 or pin/1 found in the store. A dry run unless --apply is given; any finding (a file that does not read, a slot/1 with no slot/2 form, a symbolic link anywhere below clossys/) exits 1 and --apply then writes nothing; --apply journals the plan, writes each new file beside the old one, syncs and re-reads it, and only then replaces the old one; a rerun after a stopped run resumes the journal, and a second run plans nothing.\n"
  + "state moves a legacy root .clossys/ folder into clossys/.state/, the consumer layout's one state folder (clossys check --engine fails while .clossys/ exists): each top-level entry (the event log, its index, run state, locks, check results, renders, builds) is renamed under the engine lock, the emptied folder is removed, and one state.migrate event names every record path the log logged under .clossys/ absent there and present at its new path with the bytes the log logged. A dry run unless --apply is given; a refusal (.clossys is not a folder, a lock file in it, a waiting or running loop run, an entry clossys/.state/ already holds: no merge) exits 1 and moves nothing; a second run plans nothing, or, after a run stopped between the moves and its event, logs the pending event (--check exits 1 while it is pending). While .clossys/ exists every other verb but clossys check --engine refuses (exit 2), so nothing starts a second log first.\n"
  + "--check reports pending changes and exits 1 when any remain.";

export async function runMigrateCli(argv: readonly string[], cwd: string): Promise<CliResult> {
  const [command, ...rest] = argv;
  if (command === "--help" || command === undefined) return { exitCode: command ? 0 : 2, message: MIGRATE_USAGE };
  if (command !== "copy-keys" && command !== "inputs" && command !== "ledger" && command !== "contracts" && command !== "citations-to-slots" && command !== "placement" && command !== "recut" && command !== "requests" && command !== "slots" && command !== "state") return { exitCode: 2, message: `Unknown migrate command: ${command}\n${MIGRATE_USAGE}` };
  let check = false, apply = false, root: string | undefined, at: string | undefined;
  // `clossys migrate <command> --help` prints the usage, like `clossys migrate --help`, and touches nothing.
  if (rest.includes("--help") || rest.includes("-h")) return { exitCode: 0, message: MIGRATE_USAGE };
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index]!;
    if (arg === "--check") check = true;
    else if (arg === "--json") continue;
    else if (arg === "--root" && rest[index + 1] && !rest[index + 1]!.startsWith("--")) root = rest[++index];
    else if (arg === "--apply" && (command === "citations-to-slots" || command === "placement" || command === "recut" || command === "requests" || command === "slots" || command === "state")) apply = true;
    else if (arg === "--at" && (command === "recut" || command === "contracts" || command === "placement" || command === "requests" || command === "slots") && rest[index + 1] && !rest[index + 1]!.startsWith("--")) at = rest[++index];
    else return { exitCode: 2, message: `Unknown argument: ${arg}\n${MIGRATE_USAGE}` };
  }
  const dir = discoverRoot(resolve(cwd, root ?? "."));
  const consumer = resolve(dir, "clossys");
  if (command === "state") {
    if (apply && check) return { exitCode: 2, message: `--apply and --check do not combine\n${MIGRATE_USAGE}` };
    return migrateState(dir, apply, check);
  }
  if (command === "inputs") return migrateInputs(consumer, dir, check);
  if (command === "ledger") return migrateLedger(consumer, dir, check);
  if (command === "contracts") {
    if (at !== undefined && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(at)) return { exitCode: 2, message: `--at takes an ISO time like 2026-11-18T09:12:00Z, got ${at}` };
    return migrateContracts(consumer, dir, check, at ?? nowIso());
  }
  if (command === "placement") {
    if (apply && check) return { exitCode: 2, message: `--apply and --check do not combine\n${MIGRATE_USAGE}` };
    if (at !== undefined && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(at)) return { exitCode: 2, message: `--at takes an ISO time like 2026-11-18T09:12:00Z, got ${at}` };
    return migratePlacement(consumer, dir, apply, check, at ?? nowIso());
  }
  if (command === "recut") {
    if (apply && check) return { exitCode: 2, message: `--apply and --check do not combine\n${MIGRATE_USAGE}` };
    if (at !== undefined && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(at)) return { exitCode: 2, message: `--at takes an ISO time like 2026-11-18T09:12:00Z, got ${at}` };
    return migrateRecut(dir, apply, check, at ?? nowIso());
  }
  if (command === "requests") {
    if (apply && check) return { exitCode: 2, message: `--apply and --check do not combine\n${MIGRATE_USAGE}` };
    if (at !== undefined && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(at)) return { exitCode: 2, message: `--at takes an ISO time like 2026-11-18T09:12:00Z, got ${at}` };
    return migrateRequests(consumer, dir, apply, check, at ?? nowIso());
  }
  if (command === "slots") {
    if (apply && check) return { exitCode: 2, message: `--apply and --check do not combine\n${MIGRATE_USAGE}` };
    if (at !== undefined && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(at)) return { exitCode: 2, message: `--at takes an ISO time like 2026-11-18T09:12:00Z, got ${at}` };
    return migrateSlots(dir, apply, check, at ?? nowIso());
  }
  if (command === "citations-to-slots") {
    if (apply && check) return { exitCode: 2, message: `--apply and --check do not combine\n${MIGRATE_USAGE}` };
    return migrateCitationsToSlots(consumer, dir, apply, check);
  }
  const plan = planCopyKeyMigration(consumer);
  if (!check) applyCopyKeyMigration(consumer, plan);
  const verb = check ? "pending" : "renamed";
  const lines = [
    `migrate copy-keys: ${plan.renames.length} copy key(s) ${verb}, ${plan.files.length} file(s)${check ? " to rewrite" : " rewritten"}, ${plan.repinned.length} pin(s) carried to renamed bytes; ${plan.findings.length} finding(s)`,
    ...plan.renames.map(rename => `${rename.agent}/${rename.slot}: ${rename.from} -> ${rename.to}`),
    ...plan.repinned.map(slot => `repinned (id rename only): ${slot}`),
    ...plan.findings.map(finding => `finding: ${finding.message}`),
  ];
  const exitCode = plan.findings.length || (check && plan.files.length) ? 1 : 0;
  return { exitCode, message: lines.join("\n"), root: dir, check };
}

function migrateState(dir: string, apply: boolean, check: boolean): CliResult {
  const plan = planStateMigration(dir);
  const refused = plan.refusals.map(reason => `refused: ${reason}`);
  if (!plan.legacy) {
    // A run that moved the folder and stopped before its event leaves the event pending; --apply logs it.
    const pending = pendingStateMigration(dir).filter(input => input.sha256 === null).length;
    if (!pending) return { exitCode: 0, message: `migrate state: no ${LEGACY_STATE_DIR}/ at ${dir}; engine state is in ${STATE_DIR}/`, root: dir, check, output: { legacy: false, moves: [], refusals: [] } };
    if (!apply) return { exitCode: check ? 1 : 0, message: `migrate state (dry run; --apply logs it): no ${LEGACY_STATE_DIR}/ at ${dir}, but the state.migrate event of an earlier move is pending for ${pending} logged record path(s)`, root: dir, check, output: { ...plan, pending } };
    const result = applyStateMigration(dir);
    return { exitCode: 0, message: `migrate state: no ${LEGACY_STATE_DIR}/ to move; logged the pending state.migrate event${result.event ? ` (seq ${result.event.seq}) for ${pending} logged record path(s)` : ""}`, root: dir, check, output: { ...plan, event: result.event } };
  }
  if (plan.refusals.length || !apply) {
    const lines = [`migrate state${apply ? "" : " (dry run; --apply moves)"}: ${plan.moves.length} entr${plan.moves.length === 1 ? "y" : "ies"} of ${LEGACY_STATE_DIR}/ to move into ${STATE_DIR}/; ${plan.refusals.length} refusal(s)`, ...plan.moves.map(name => `${LEGACY_STATE_DIR}/${name} -> ${STATE_DIR}/${name}`), ...refused];
    return { exitCode: plan.refusals.length || check ? 1 : 0, message: lines.join("\n"), root: dir, check, output: plan };
  }
  const result = applyStateMigration(dir);
  const logged = result.event ? result.event.inputs.filter(input => input.sha256 === null).length : 0;
  const lines = [
    `migrate state: moved ${plan.moves.length} entr${plan.moves.length === 1 ? "y" : "ies"} of ${LEGACY_STATE_DIR}/ into ${STATE_DIR}/ and removed ${LEGACY_STATE_DIR}/; ${result.event ? `state.migrate event seq ${result.event.seq} names ${logged} logged record path(s) at their new place` : "no logged record path moved"}`,
    ...plan.moves.map(name => `${LEGACY_STATE_DIR}/${name} -> ${STATE_DIR}/${name}`),
  ];
  return { exitCode: 0, message: lines.join("\n"), root: dir, check, output: { ...plan, event: result.event } };
}

function migrateContracts(consumer: string, dir: string, check: boolean, at: string): CliResult {
  const plan = planContracts(consumer, dir);
  const pending = plan.seeds.filter(seed => seed.changes.length);
  const written = check ? [] : applyContracts(consumer, plan, at);
  const lines = [
    `migrate contracts: ${plan.seeds.length} slot(s) read, ${pending.length} ${check ? "pending" : "planned"}, ${written.length} written; ${plan.gaps.length} gap(s)`,
    ...pending.map(seed => `${seed.agent}/${seed.slot}: ${seed.changes.join(", ")}${seed.family?.class ? ` (${seed.family.class})` : ""}`),
    ...plan.gaps.map(gap => `gap: ${gap.agent}/${gap.slot} ${gap.field}: ${gap.reason}`),
  ];
  return { exitCode: check && pending.length ? 1 : 0, message: lines.join("\n"), root: dir, check };
}

function migrateInputs(consumer: string, dir: string, check: boolean): CliResult {
  const plan = planInputsMigration(consumer);
  if (!check) applyInputsMigration(consumer, plan);
  const lines = [
    `migrate inputs: ${plan.changes.length} slot(s) ${check ? "pending" : "declared"}, ${plan.files.length} file(s)${check ? " to rewrite" : " rewritten"}; ${plan.findings.length} finding(s)`,
    ...plan.changes.map(change => `${change.agent}/${change.slot}: + ${change.added.join(", ")}`),
    ...plan.findings.map(finding => `finding: ${finding.message}`),
  ];
  const exitCode = plan.findings.length || (check && plan.files.length) ? 1 : 0;
  return { exitCode, message: lines.join("\n"), root: dir, check };
}

function migrateLedger(consumer: string, dir: string, check: boolean): CliResult {
  const plan = planLedgerBackfill(consumer);
  const applied = applyLedgerBackfill(consumer, plan, { dryRun: check });
  const events = plan.folders.reduce((sum, folder) => sum + folder.events.length, 0);
  const counts = Object.entries(plan.counts).sort(([a], [b]) => (a < b ? -1 : 1)).map(([op, n]) => `${op} ${n}`).join(", ");
  const lines = [
    `migrate ledger${check ? " --check" : ""}: ${plan.folders.length} ledger(s) planned (${events} event(s)); ${applied.written} ${check ? "to write" : "written"}, ${applied.unchanged} unchanged, ${applied.kept} kept (hold non-backfill events), ${applied.refused.length} refused; ${plan.gaps.length} gap(s)`,
    `events: ${counts}`,
    ...applied.refused.map(item => `refused: ${item.path}: ${item.message}`),
    ...plan.gaps.map(gap => `gap: ${gap.path}: ${gap.message}`),
  ];
  const exitCode = applied.refused.length || (check && applied.written) ? 1 : 0;
  return { exitCode, message: lines.join("\n"), root: dir, check, output: { ledgers: plan.folders.length, events, counts: plan.counts, written: applied.written, unchanged: applied.unchanged, kept: applied.kept, refused: applied.refused, gaps: plan.gaps } };
}

function migrateCitationsToSlots(consumer: string, dir: string, apply: boolean, check: boolean): CliResult {
  const plan = planCitationsToSlots(consumer);
  const refused = apply ? applyCitationsToSlots(consumer, plan) : [];
  const verb = apply ? "rewritten" : "pending";
  const row = (name: string, counts: { candidates: number; citations: number; anchors: number; pins: number; rehashed: number }) =>
    `${name}: ${counts.candidates} candidate(s) ${verb} (${counts.citations} citation(s), ${counts.anchors} line anchor(s) re-addressed to the recited version), ${counts.pins} pin(s) drop recited, ${counts.rehashed} pin sha256(s) carried`;
  const lines = [
    `migrate citations-to-slots${apply ? "" : " (dry run; --apply rewrites)"}: ${plan.changes.length} slot(s) ${verb}; ${plan.findings.length} finding(s)${apply ? `, ${refused.length} refused` : ""}`,
    ...SLOT_AGENTS.map(agent => row(agent, plan.counts[agent])),
    row("total", plan.totals),
    ...plan.findings.map(finding => `finding: ${finding.agent}/${finding.slot}: ${finding.message}`),
    ...refused.map(finding => `refused: ${finding.agent}/${finding.slot}: ${finding.message}`),
  ];
  const pending = !apply && plan.changes.length > 0;
  const exitCode = refused.length || (check && (pending || plan.findings.length)) ? 1 : 0;
  return { exitCode, message: lines.join("\n"), root: dir, check, output: { counts: plan.counts, totals: plan.totals, slots: plan.changes.length, findings: plan.findings, refused, applied: apply } };
}

function migratePlacement(consumer: string, dir: string, apply: boolean, check: boolean, at: string): CliResult {
  const plan = planPlacementBackfill(consumer);
  const written = apply && !plan.findings.length ? applyPlacementBackfill(consumer, plan, at) : [];
  const withOverlaps = plan.pending.filter(item => item.overlaps.length);
  // DRAFT copy (not owner-approved).
  const lines = [
    `migrate placement${apply ? "" : check ? " --check" : " (dry run; --apply writes)"}: ${plan.slots} placed slot(s) read, ${plan.pending.length} without a placement decision ${apply ? `(${written.length} create decision(s) written)` : "pending"}, ${withOverlaps.length} with overlaps found; ${plan.findings.length} finding(s)`,
    ...plan.pending.map(item => `${item.agent}/${item.slot}: create${item.overlaps.length ? `, overlaps ${item.overlaps.map(overlap => `${overlap.slot} (${overlap.why})`).join(", ")}` : ""}`),
    ...plan.findings.map(finding => `finding: ${finding}`),
  ];
  const exitCode = plan.findings.length || (check && plan.pending.length) ? 1 : 0;
  return { exitCode, message: lines.join("\n"), root: dir, check, output: { slots: plan.slots, pending: plan.pending, withOverlaps: withOverlaps.length, findings: plan.findings, written, applied: apply && !plan.findings.length } };
}

function migrateRecut(dir: string, apply: boolean, check: boolean, at: string): CliResult {
  const plan = planRecut(dir, { at });
  const pending = recutPending(plan);
  const verb = apply ? "applied" : "pending";
  const lines = [
    `migrate recut${apply ? "" : check ? " --check" : " (dry run; --apply writes)"}: ${plan.rows.length} slot folder(s), ${pending} write(s) ${verb}; ${plan.unknown.length} unknown id(s), ${plan.findings.length} finding(s)`,
    ...RECUT_AGENTS.map(agent => {
      const c = plan.counts[agent];
      return `${agent}: ${c.live} live, ${c.moved} moved, ${c.retired} retired, ${c.unknown} unknown; ${c.headers} header(s) added, ${c.carried} candidate(s) carried, ${c.cells} library cell(s), ${c.refs} slot.json ref list(s) repointed; ${c.flattened} nested folder(s) flattened`;
    }),
    ...(plan.skipped.length ? [`producer: ${plan.skipped.length} seat folder(s) not recut`] : []),
    ...plan.missingRetired.map(name => `STOP: ${name} ships no src/catalog/retired.json; its unknown ids need a row there`),
    ...plan.unknown.map(id => `unknown: ${id} is in no package tree and no retired.json`),
    ...plan.findings.map(finding => `finding: ${finding}`),
  ];
  // An unknown id, a finding or a write that would not fit leaves work the run cannot do: every mode exits 1,
  // and --apply writes nothing (the plan applies whole or not at all).
  const problems = recutProblems(plan);
  const known = new Set([...plan.unknown.map(id => `unknown: ${id}`), ...plan.findings]);
  if (plan.missingRetired.length || problems.length) {
    lines.push(...problems.filter(problem => !known.has(problem)).map(problem => `refused: ${problem}`), apply ? "nothing written" : "--apply would write nothing");
    return { exitCode: 1, message: lines.join("\n"), root: dir, check, output: { counts: plan.counts, unknown: plan.unknown, missingRetired: plan.missingRetired, findings: plan.findings, problems, applied: false } };
  }
  if (apply) {
    const result = applyRecut(plan);
    lines.push(
      `wrote ${result.written} file(s), ${result.events} migrated event(s); slot-1-to-2 ${result.slot1To2} slot(s), pin-1-to-2 ${result.pins} pin(s), ia sync ${result.iaSync} slot(s)`,
      ...result.slot1To2Findings.map(finding => `slot-1-to-2 finding: ${finding}`),
      ...result.pinRefused.map(slot => `pin-1-to-2 refused: ${slot}`),
      ...result.iaSyncFindings.map(finding => `ia sync finding: ${finding}`),
    );
    return { exitCode: 0, message: lines.join("\n"), root: dir, check, output: { counts: plan.counts, findings: plan.findings, applied: true, result } };
  }
  const follow = pending ? undefined : planFollowUp(dir, at, plan.version);
  if (follow) lines.push(`then: slot-1-to-2 ${follow.slot1To2} slot(s), pin-1-to-2 ${follow.pins} pin(s), ia sync ${follow.iaSync} slot(s) pending`);
  const remaining = pending + (follow ? follow.slot1To2 + follow.pins + follow.iaSync : 0);
  return { exitCode: check && remaining ? 1 : 0, message: lines.join("\n"), root: dir, check, output: { counts: plan.counts, pending, follow, findings: plan.findings, applied: false } };
}

function migrateSlots(dir: string, apply: boolean, check: boolean, at: string): CliResult {
  const options = { at, version: cliActor(SLOTS_MIGRATION_CLI).version };
  let plan;
  try { plan = planSlotsMigration(dir, options); } catch (error) { return { exitCode: 1, message: `migrate slots refused: ${(error as Error).message}`, root: dir, check }; }
  const pending = slotsPending(plan);
  const count = (kind: string) => plan.changes.filter(each => each.kind === kind).length;
  let applied;
  if (apply && !plan.findings.length && pending) {
    try { applied = applySlotsMigration(dir, plan, options); } catch (error) { return { exitCode: 1, message: `migrate slots stopped: ${(error as Error).message}`, root: dir, check, output: { findings: plan.findings } }; }
  }
  // DRAFT copy (not owner-approved).
  const lines = [
    `migrate slots${apply ? "" : " (dry run; --apply converts)"}${plan.resumed ? ` (resuming the stopped run in ${SLOTS_JOURNAL})` : ""}: ${plan.folders} slot folder(s) read; ${count("slot")} slot.json, ${count("pin")} pin.json and ${count("candidate")} candidate(s) ${applied ? "converted" : "pending"}; store-format.json ${plan.converted ? "present" : applied?.marker ? "written" : "pending"}; ${plan.findings.length} finding(s)`,
    ...(applied ? applied.skipped.map(file => `already converted: ${file}`) : plan.changes.map(each => `${each.kind}: ${each.file}`)),
    ...plan.needsOwnerAnswer.map(slot => `owner pin with no queue answer (pins.resolve still fails it): ${slot}`),
    ...plan.findings.map(finding => `finding: ${finding.subject}: ${finding.detail}`),
  ];
  const exitCode = plan.findings.length || (check && pending) ? 1 : 0;
  return { exitCode, message: lines.join("\n"), root: dir, check, output: { pending, converted: plan.converted || !!applied?.marker, resumed: plan.resumed, changes: plan.changes.map(({ bytes: _bytes, ...rest }) => rest), findings: plan.findings, needsOwnerAnswer: plan.needsOwnerAnswer, ...(applied ? { written: applied.written, skipped: applied.skipped, events: applied.events, marker: applied.marker } : {}) } };
}

const raisesOf = (plan: ReturnType<typeof planRequestMigration>) => plan.records.flatMap(record => record.raises);

function migrateRequests(consumer: string, dir: string, apply: boolean, check: boolean, at: string): CliResult {
  const plan = planRequestMigration(consumer, at, dir);
  const raises = plan.records.reduce((sum, record) => sum + record.raises.length, 0);
  const applied = apply && !plan.findings.length ? applyRequestMigration(consumer, plan, at) : undefined;
  const verb = applied ? "migrated" : "pending";
  // DRAFT copy (not owner-approved).
  const lines = [
    `migrate requests${apply ? "" : " (dry run; --apply migrates)"}: ${plan.records.length} legacy record(s) ${verb} (${raises} queue entr${raises === 1 ? "y" : "ies"}, ${plan.merges.length} merge(s), ${raisesOf(plan).filter(raise => raise.close).length} closed as migrated); ${plan.findings.length} finding(s)${plan.kept.length ? `, ${plan.kept.length} other file(s) left in place` : ""}`,
    ...(applied
      ? applied.raised.map(row => `${row.file} -> ${row.entry}${row.close ? ` (closed ${row.close})` : ""}${row.created ? "" : ` (${row.event ? `its record is raised event ${row.event}` : "already carried"})`}`)
      : plan.records.flatMap(record => record.raises.map(raise => `${record.file} -> ${raise.kind} ${raise.target} from ${raise.from}${raise.close ? `, closes ${raise.close} (${raise.legacy})` : ""}${raise.into ? ` (into ${raise.into})` : ""}`))),
    ...plan.kept.map(file => `left in place: ${file} (no legacy record)`),
    ...plan.findings.map(finding => `finding: ${finding.file}: ${finding.message}`),
  ];
  const exitCode = plan.findings.length || (check && plan.records.length) ? 1 : 0;
  return { exitCode, message: lines.join("\n"), root: dir, check, output: { records: plan.records, merges: plan.merges, kept: plan.kept, findings: plan.findings, ...(applied ? { raised: applied.raised, removed: applied.removed } : {}) } };
}
