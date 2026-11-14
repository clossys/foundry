/**
 * `clossys migrate ledger`: backfill W2-B's ledger (records/ledger.ts, `clossys.ledger/1`) for every
 * record that predates it, from git history only. Deterministic plumbing: no model, no judgement, no
 * hand-written records; every ledger is written by records/slot-write.ts `writeBackfilledLedger`.
 *
 * Events (verb `migrate`, the plumb migrate action's action.json, model none, tier none, `backfill {commit, at[,
 * authoredIn]}` naming the git evidence; `by` is the author kind git shows):
 * - a candidate's `submit {name, sha256}` at the change constitution R08.2 treats as its add (the last
 *   side-line `A`, else a merge `A`), then a `migrate {migration, files}` for each later change the
 *   migration manifest explains (the blob pair R08.2 accepts) whose `from` is the sha so far; an
 *   unexplained edit gets no event, so it still fails (no fabricated provenance);
 * - a retired candidate with a retire record: its `submit`, then `retire-candidate {name, sha256, code}`
 *   at the commit that took it out of `candidates/`;
 * - pin.json, per change on the first-parent chain: `migrate` (manifest-explained; its files carry the
 *   pinned candidate's sha from and to), `confirm` (only `confirmed` changed), else `pin` (`pick` when
 *   the basis is `agent`) with the pin's fields and `at: pin.at` (R02.3 compares it);
 * - slot.json: `slot {kind: ia | ia-position}` (green.ts slotWriteKind); ia.json: the agent ledger's
 *   `ia {kind: ia}`.
 * Each record event carries the record's sha256 after the change, so the last event of every record
 * file is its HEAD bytes (the first-parent chain ends at HEAD).
 *
 * Merge changes on the chain are attributed to the earliest side-line commit that produced the same
 * blob (`authoredIn`), else to the merge. Changes at or after the commit that added a folder's
 * ledger.json are never backfilled, and a folder whose ledger already holds an event without
 * `backfill` is kept as it is. Output depends only on git objects, the manifest and the installed
 * migrate action.json: a second run plans no change.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { addIndex } from "../constitution/checks/R08-immutability.js";
import { HISTORY_LOG_ARGS, parseNameStatusLog } from "../constitution/git.js";
import { slotWriteKind } from "../constitution/green.js";
import type { PathChange } from "../constitution/types.js";
import { NONE, RETIRE_EVENT_CODES, actionContractPath, type LedgerEvent, type LedgerRecordState, type Provenance } from "../records/ledger.js";
import { MIGRATIONS_FILE, validateMigrations, type MigrationsDoc } from "../records/migrations.js";
import { CANDIDATE_NAME, MODEL_AGENTS, type ModelAgent } from "../records/slot-model/index.js";
import { buildLedgerEvent, skillState, writeBackfilledLedger, type BackfillOutcome } from "../records/slot-write.js";
import { isModelDir, listModelDir } from "../records/slots.js";

/** What every backfilled event cites: migrate is a plumb action, so its action.json, not a skill (R14.2). */
const MIGRATE_ACTION = actionContractPath("producer", "migrate");
const ZERO = /^0+$/;

export interface BackfillFolder {
  /** Repository-relative folder (`clossys/agents/<agent>[/<slot>]`). */
  readonly path: string;
  readonly scope: "slot" | "agent";
  readonly events: readonly LedgerEvent[];
}
export interface BackfillGap { readonly path: string; readonly message: string }
export interface LedgerPlan {
  readonly folders: readonly BackfillFolder[];
  /** History the backfill cannot honestly turn into an event: each stays a constitution row. */
  readonly gaps: readonly BackfillGap[];
  /** Folders refused (an unreadable ledger, an event the writer refuses). */
  readonly refused: readonly BackfillGap[];
  readonly counts: Readonly<Record<string, number>>;
}
export interface LedgerApply { readonly written: number; readonly unchanged: number; readonly kept: number; readonly refused: readonly BackfillGap[] }

const posix = (path: string) => path.split(sep).join("/");
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const run = (cwd: string, args: readonly string[], input?: string): Buffer =>
  execFileSync("git", args, { cwd, maxBuffer: 2 * 1024 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"], ...(input !== undefined ? { input } : {}) });

/** `git cat-file --batch` over `ids`: id -> bytes (missing ids are absent). */
function catFile(top: string, ids: readonly string[]): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const unique = [...new Set(ids)].filter(id => !ZERO.test(id));
  if (!unique.length) return out;
  const buffer = run(top, ["cat-file", "--batch"], `${unique.join("\n")}\n`);
  let offset = 0;
  while (offset < buffer.length) {
    const end = buffer.indexOf(10, offset);
    if (end < 0) break;
    const header = buffer.subarray(offset, end).toString("utf8").split(" ");
    offset = end + 1;
    if (header[1] === "missing" || header.length < 3) continue;
    const size = Number(header[2]);
    out.set(header[0]!, buffer.subarray(offset, offset + size));
    offset += size + 1;
  }
  return out;
}

/** A commit's evidence: its committer time (ISO UTC) and the author kind its author and trailers show. */
interface CommitInfo { readonly at: string; readonly by: string }
export function commitInfo(text: string): CommitInfo {
  const split = text.indexOf("\n\n");
  const header = split < 0 ? text : text.slice(0, split);
  const message = split < 0 ? "" : text.slice(split + 2);
  const line = (key: string) => header.split("\n").find(row => row.startsWith(`${key} `)) ?? "";
  const stamp = /\s(\d+)\s[+-]\d{4}$/.exec(line("committer"));
  const at = new Date(Number(stamp?.[1] ?? 0) * 1000).toISOString();
  const author = line("author");
  const trailers = message.split("\n").filter(row => /^co-authored-by:/i.test(row.trim()));
  const by = trailers.some(row => /claude/i.test(row)) ? "history:claude"
    : /codex/i.test(author) || trailers.some(row => /codex/i.test(row)) ? "history:codex" : "history:unattributed";
  return { at, by };
}

interface Chain {
  /** Commit -> index on the first-parent chain, oldest 0. */
  readonly index: ReadonlyMap<string, number>;
  /** Repository path -> its chain changes, oldest first. */
  readonly changes: ReadonlyMap<string, readonly PathChange[]>;
}
function readChain(top: string, agents: string): Chain {
  const output = run(top, ["log", "--first-parent", ...HISTORY_LOG_ARGS.filter(arg => arg !== "--topo-order"), "--", agents]).toString("utf8");
  const commits = output.split("\0").map(block => block.split("\n")[0]!.trim().split(/\s+/)[0]).filter((commit): commit is string => !!commit).reverse();
  return { index: new Map(commits.map((commit, index) => [commit, index])), changes: parseNameStatusLog(output) };
}

/** The pin fields a decision event carries. */
const DECISION_FIELDS = ["candidate", "sha256", "decidedBy", "basis"] as const;
const withoutConfirmed = (pin: Record<string, unknown>) => { const { confirmed: _confirmed, ...rest } = pin; return JSON.stringify(rest); };
const RANK: Record<string, number> = { submit: 0, migrate: 1, "retire-candidate": 2, slot: 3, ia: 3, confirm: 4, pin: 4, pick: 4, "not-needed": 5 };

/** Plan the backfill of every ledger under `<consumer>/agents`. Reads only (git and the work tree). */
export function planLedgerBackfill(consumer: string): LedgerPlan {
  const top = run(consumer, ["rev-parse", "--show-toplevel"]).toString("utf8").trim();
  const repo = (abs: string) => posix(relative(top, abs));
  const agentsPath = repo(join(consumer, "agents"));
  const chain = readChain(top, agentsPath);
  const topo = parseNameStatusLog(run(top, ["log", ...HISTORY_LOG_ARGS, "--", agentsPath]).toString("utf8"));
  const manifest = readManifest(consumer);
  const explained = new Map<string, string>();
  for (const event of manifest?.events ?? []) explained.set(`${repo(join(consumer, event.file))} ${event.from.blob} ${event.to.blob}`, event.migration);
  const explains = (path: string, change: PathChange) => change.from !== undefined && change.to !== undefined ? explained.get(`${path} ${change.from} ${change.to}`) : undefined;

  const folders: { abs: string; scope: "slot" | "agent"; agent: ModelAgent }[] = [];
  for (const agent of MODEL_AGENTS) {
    const dir = join(consumer, "agents", agent);
    if (!isModelDir(dir)) continue;
    folders.push({ abs: dir, scope: "agent", agent });
    for (const name of listModelDir(dir).sort()) {
      if (name === "retired" || !isModelDir(join(dir, name))) continue;
      folders.push({ abs: join(dir, name), scope: "slot", agent });
    }
  }
  // Every blob and commit the plan reads (changes under a current folder), fetched in one batch.
  const prefixes = new Set(folders.map(folder => `${repo(folder.abs)}/`));
  const depth = agentsPath.split("/").length;
  const current = (path: string) => {
    const parts = path.split("/");
    const agentFolder = `${parts.slice(0, depth + 1).join("/")}/`, slotFolder = `${parts.slice(0, depth + 2).join("/")}/`;
    return parts.length === depth + 2 ? prefixes.has(agentFolder) : prefixes.has(slotFolder);
  };
  const ids = new Set<string>();
  for (const map of [chain.changes, topo]) for (const [path, list] of map) {
    if (!current(path)) continue;
    for (const change of list) { ids.add(change.commit); if (change.to) ids.add(change.to); if (change.from) ids.add(change.from); }
  }
  const objects = catFile(top, [...ids]);
  const info = new Map<string, CommitInfo>();
  const commit = (id: string) => { let found = info.get(id); if (!found) info.set(id, found = commitInfo(objects.get(id)?.toString("utf8") ?? "")); return found; };
  const blob = (id: string | undefined) => (id && !ZERO.test(id) ? objects.get(id) : undefined);
  const shaOf = (id: string | undefined) => { const bytes = blob(id); return bytes ? sha256(bytes) : undefined; };

  /** The earliest side-line commit whose change to `path` produced `to`, for a merge change. */
  const authoredIn = (path: string, change: PathChange): string | undefined => {
    if (!change.merge) return undefined;
    const side = (topo.get(path) ?? []).find(item => !item.merge && item.to === change.to && item.status !== "D");
    return side && side.commit !== change.commit ? side.commit : undefined;
  };
  const who: Provenance = { verb: "migrate", by: "", skill: skillState(MIGRATE_ACTION), model: NONE, tier: NONE };
  const counts: Record<string, number> = {};
  const count = (key: string) => { counts[key] = (counts[key] ?? 0) + 1; };
  const gaps: BackfillGap[] = [], refused: BackfillGap[] = [], planned: BackfillFolder[] = [];

  for (const folder of folders) {
    const path = repo(folder.abs);
    const ledgerChanges = chain.changes.get(`${path}/ledger.json`) ?? [];
    const firstLedger = ledgerChanges.find(change => change.status === "A");
    const cutoff = firstLedger ? chain.index.get(firstLedger.commit)! : Number.POSITIVE_INFINITY;
    const onChain = (change: PathChange) => (chain.index.get(change.commit) ?? Number.POSITIVE_INFINITY) < cutoff;
    type Entry = { position: number; rank: number; name: string; op: string; at?: string; by?: string; fields: Record<string, unknown>; records?: LedgerRecordState[]; evidence: Record<string, unknown> };
    const entries: Entry[] = [];
    const evidence = (change: PathChange, sideCommit?: string): { at: string; by: string; evidence: Record<string, unknown> } => {
      const source = sideCommit ?? change.commit;
      const meta = commit(source);
      return { at: meta.at, by: meta.by, evidence: { commit: change.commit, at: meta.at, ...(sideCommit ? { authoredIn: sideCommit } : {}) } };
    };
    const migrateFiles = new Map<number, { files: Map<string, { name: string; from: string; to: string }>; migration: string; change: PathChange; side?: string; records?: LedgerRecordState[] }>();
    const addMigrate = (change: PathChange, changedPath: string, migration: string, files: readonly { name: string; from: string; to: string }[], records?: LedgerRecordState[]) => {
      const position = chain.index.get(change.commit)!;
      let group = migrateFiles.get(position);
      if (!group) migrateFiles.set(position, group = { files: new Map(), migration, change, side: authoredIn(changedPath, change) });
      for (const file of files) if (!group.files.has(file.name)) group.files.set(file.name, file);
      if (records) { group.records = records; group.change = change; group.side = authoredIn(changedPath, change); }
    };

    /** A candidate's submit and explained migrates; returns its sha so far (undefined when it has no add). */
    function candidateEvents(candidatePath: string, name: string, retired = false): string | undefined {
      const changes = topo.get(candidatePath) ?? [];
      const added = addIndex(changes);
      if (added < 0) { gaps.push({ path: candidatePath, message: "no commit added it: no submit event" }); return undefined; }
      let add = changes[added]!;
      const own = chain.changes.get(candidatePath) ?? [];
      const at = own.findIndex(change => change.to === add.to && change.status !== "D");
      const anchor = at >= 0 ? own[at]! : own.find(change => change.status === "A");
      // The chain first got other bytes than R08's add (the last side-line `A`): when another side-line
      // `A` produced exactly those bytes (parallel adds, one kept by a merge), that add is the genesis.
      if (anchor && anchor.to !== add.to) {
        const parallel = changes.filter(change => change.status === "A" && !change.merge && change.to === anchor.to).pop();
        if (parallel) add = parallel;
      }
      const genesis = add.to;
      let sha = shaOf(genesis);
      if (!sha || !anchor || !onChain(anchor)) { gaps.push({ path: candidatePath, message: "its add is not on the first-parent chain before the ledger: no submit event" }); return undefined; }
      const proof = evidence(anchor, anchor.commit === add.commit ? undefined : add.commit);
      entries.push({ position: chain.index.get(anchor.commit)!, rank: RANK.submit!, name, op: "submit", at: proof.at, by: proof.by, fields: { name, sha256: sha }, evidence: proof.evidence });
      count("submit");
      // Still other bytes: a side-line edit made them before they reached the chain. Only a manifest
      // explained edit of the sha so far becomes a migrate event; anything else stays a gap.
      if (anchor.to !== genesis) {
        const edit = changes.find(change => !change.merge && (change.status === "M" || change.status === "T") && change.to === anchor.to);
        const migration = edit ? explains(candidatePath, edit) : undefined;
        const to = shaOf(anchor.to);
        if (edit && migration && to && shaOf(edit.from) === sha) {
          const side = evidence(anchor, edit.commit);
          entries.push({ position: chain.index.get(anchor.commit)!, rank: RANK.migrate!, name, op: "migrate", at: side.at, by: side.by, fields: { migration, files: [{ name, from: sha, to }] }, evidence: side.evidence });
          count("migrate");
          sha = to;
        } else {
          if (!retired) gaps.push({ path: candidatePath, message: `edited in ${edit ? edit.commit.slice(0, 9) : "an unknown commit"} before it reached the first-parent chain (${anchor.commit.slice(0, 9)}) without a recorded migration: no event` });
          count("unexplained-edit");
        }
      }
      for (const change of own.slice(own.indexOf(anchor) + 1)) {
        if (!onChain(change) || change.status === "D") continue;
        const from = shaOf(change.from), to = shaOf(change.to);
        if (!to || to === sha) continue;
        const migration = explains(candidatePath, change);
        if (!migration || from !== sha) {
          if (!retired) gaps.push({ path: candidatePath, message: `edited in ${change.commit.slice(0, 9)} without a recorded migration: no event` });
          count("unexplained-edit");
          continue;
        }
        addMigrate(change, candidatePath, migration, [{ name, from: sha, to }]);
        sha = to;
      }
      return sha;
    }

    function recordEvents(file: "pin.json" | "slot.json" | "ia.json"): void {
      const recordPath = `${path}/${file}`;
      let before: Buffer | undefined;
      for (const change of chain.changes.get(recordPath) ?? []) {
        if (!onChain(change)) continue;
        if (change.status === "D") {
          if (file !== "pin.json" || !notNeeded(change)) gaps.push({ path: recordPath, message: `removed in ${change.commit.slice(0, 9)}: no event` });
          before = undefined;
          continue;
        }
        const after = blob(change.to);
        if (!after) { gaps.push({ path: recordPath, message: `blob ${String(change.to)} unreadable: no event` }); continue; }
        const records: LedgerRecordState[] = [{ file, sha256: sha256(after) }];
        const position = chain.index.get(change.commit)!;
        const proof = evidence(change, authoredIn(recordPath, change));
        if (file === "pin.json") pinEvent(change, before, after, records, position, proof);
        else {
          const kind = file === "slot.json" ? slotWriteKind(before?.toString("utf8") ?? null, after.toString("utf8")) : "ia";
          entries.push({ position, rank: RANK[file === "slot.json" ? "slot" : "ia"]!, name: file, op: file === "slot.json" ? "slot" : "ia", at: proof.at, by: proof.by, fields: { kind }, records, evidence: proof.evidence });
          count(file === "slot.json" ? "slot" : "ia");
        }
        before = after;
      }
    }

    /** A pin removed by a not-needed decision (slot.json gained notNeeded in the same commit): `not-needed`, as writeNotNeeded records it. */
    function notNeeded(change: PathChange): boolean {
      const position = chain.index.get(change.commit)!;
      const slotState = [...(chain.changes.get(`${path}/slot.json`) ?? [])].reverse().find(item => chain.index.get(item.commit)! <= position);
      const bytes = slotState?.status === "D" ? undefined : blob(slotState?.to);
      let doc: unknown;
      try { doc = bytes ? JSON.parse(bytes.toString("utf8")) : undefined; } catch { doc = undefined; }
      const decision = isObject(doc) && isObject(doc.notNeeded) ? doc.notNeeded : undefined;
      if (!bytes || !decision) return false;
      const proof = evidence(change, authoredIn(`${path}/pin.json`, change));
      entries.push({ position, rank: RANK["not-needed"]!, name: "pin.json", op: "not-needed", at: proof.at, by: proof.by,
        fields: { reason: decision.reason, since: decision.since, decidedBy: decision.decidedBy },
        records: [{ file: "slot.json", sha256: sha256(bytes) }, { file: "pin.json", sha256: null }], evidence: proof.evidence });
      count("not-needed");
      return true;
    }

    function pinEvent(change: PathChange, before: Buffer | undefined, after: Buffer, records: LedgerRecordState[], position: number, proof: { at: string; by: string; evidence: Record<string, unknown> }): void {
      const recordPath = `${path}/pin.json`;
      let pin: unknown, was: unknown;
      try { pin = JSON.parse(after.toString("utf8")); was = before ? JSON.parse(before.toString("utf8")) : undefined; } catch { pin = undefined; }
      if (!isObject(pin)) { gaps.push({ path: recordPath, message: `pin.json in ${change.commit.slice(0, 9)} is not a JSON object: no event` }); return; }
      const migration = explains(recordPath, change);
      if (migration) {
        const files = isObject(was) && was.candidate === pin.candidate && typeof was.sha256 === "string" && typeof pin.sha256 === "string" && was.sha256 !== pin.sha256
          ? [{ name: String(pin.candidate), from: was.sha256, to: pin.sha256 }] : [];
        addMigrate(change, recordPath, migration, files, records);
        return;
      }
      if (isObject(was) && isObject(pin.confirmed) && withoutConfirmed(was) === withoutConfirmed(pin)) {
        entries.push({ position, rank: RANK.confirm!, name: "pin.json", op: "confirm", at: proof.at, by: proof.by, fields: { candidate: pin.candidate, sha256: pin.sha256, confirmed: pin.confirmed }, records, evidence: proof.evidence });
        count("confirm");
        return;
      }
      const fields: Record<string, unknown> = {};
      for (const key of DECISION_FIELDS) fields[key] = pin[key];
      const op = pin.basis === "agent" ? "pick" : "pin";
      entries.push({ position, rank: RANK[op]!, name: "pin.json", op, at: typeof pin.at === "string" ? pin.at : proof.at, by: proof.by, fields, records, evidence: proof.evidence });
      count(op);
    }

    if (folder.scope === "slot") {
      // Candidates: the add, then each manifest-explained rewrite.
      const candidateDir = join(folder.abs, "candidates");
      for (const name of listModelDir(candidateDir).sort()) {
        if (isModelDir(join(candidateDir, name))) continue;
        candidateEvents(`${path}/candidates/${name}`, name);
      }
      // Retired candidates with a retire record: their add and their removal, placed where the
      // retire record reached the chain (a retire made on a side line never touches the chain's candidates/).
      const retiredDir = join(folder.abs, "retired");
      for (const name of listModelDir(retiredDir).sort()) {
        if (!CANDIDATE_NAME.test(name) || !existsSync(join(retiredDir, `${name}.json`))) continue;
        let record: unknown;
        try { record = JSON.parse(readFileSync(join(retiredDir, `${name}.json`), "utf8")); } catch { record = undefined; }
        const reason = isObject(record) && typeof record.reason === "string" ? record.reason : "";
        const code = reason.split(":")[0]!.trim();
        const candidatePath = `${path}/candidates/${name}`;
        const history = topo.get(candidatePath) ?? [];
        const added = addIndex(history);
        const removed = [...history].reverse().find(change => change.status === "D");
        const placed = (chain.changes.get(`${path}/retired/${name}.json`) ?? []).find(change => change.status === "A" && onChain(change));
        const genesis = added >= 0 ? shaOf(history[added]!.to) : undefined;
        if (!(RETIRE_EVENT_CODES as readonly string[]).includes(code) || !removed || !placed || !genesis) { gaps.push({ path: `${path}/retired/${name}`, message: "retired candidate: no retire code, add, removal or chain commit for its retire record; no events" }); continue; }
        const position = chain.index.get(placed.commit)!;
        const born = evidence(placed, history[added]!.commit === placed.commit ? undefined : history[added]!.commit);
        entries.push({ position, rank: RANK.submit!, name, op: "submit", at: born.at, by: born.by, fields: { name, sha256: genesis }, evidence: born.evidence });
        const gone = evidence(placed, removed.commit === placed.commit ? undefined : removed.commit);
        const sha = isObject(record) && typeof record.sha256 === "string" ? record.sha256 : genesis;
        entries.push({ position, rank: RANK["retire-candidate"]!, name, op: "retire-candidate", at: gone.at, by: gone.by, fields: { name, sha256: sha, code }, evidence: gone.evidence });
        count("submit");
        count("retire-candidate");
      }
      // pin.json and slot.json along the chain.
      recordEvents("pin.json");
      recordEvents("slot.json");
    } else {
      recordEvents("ia.json");
    }

    for (const [position, group] of migrateFiles) {
      const proof = evidence(group.change, group.side);
      entries.push({ position, rank: RANK.migrate!, name: "", op: "migrate", at: proof.at, by: proof.by, fields: { migration: group.migration, files: [...group.files.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) }, ...(group.records ? { records: group.records } : {}), evidence: proof.evidence });
      count("migrate");
    }
    if (!entries.length) continue;
    entries.sort((a, b) => a.position - b.position || a.rank - b.rank || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    try {
      const events = entries.map(entry => buildLedgerEvent(entry.op, entry.at!, { ...who, by: entry.by! }, { ...entry.fields, backfill: entry.evidence }, entry.records));
      planned.push({ path, scope: folder.scope, events });
    } catch (error) { refused.push({ path, message: (error as Error).message }); }

  }
  return { folders: planned, gaps, refused, counts };
}

function readManifest(consumer: string): MigrationsDoc | undefined {
  const path = join(consumer, MIGRATIONS_FILE);
  if (!existsSync(path)) return undefined;
  const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const issues = validateMigrations(value);
  if (issues.length) throw new Error(`${MIGRATIONS_FILE} is invalid, it explains no change: ${issues.slice(0, 3).join("; ")}`);
  return value as MigrationsDoc;
}

/** Write (or, with `dryRun`, measure) a plan's ledgers through the one ledger writer. */
export function applyLedgerBackfill(consumer: string, plan: LedgerPlan, options: { readonly dryRun?: boolean } = {}): LedgerApply {
  const top = run(consumer, ["rev-parse", "--show-toplevel"]).toString("utf8").trim();
  const tally: Record<BackfillOutcome, number> = { written: 0, unchanged: 0, kept: 0 };
  const refused: BackfillGap[] = [...plan.refused];
  for (const folder of plan.folders) {
    try { tally[writeBackfilledLedger(join(top, folder.path), folder.scope, folder.events, options)]++; }
    catch (error) { refused.push({ path: folder.path, message: (error as Error).message }); }
  }
  return { ...tally, refused };
}
