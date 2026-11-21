/**
 * The admin workspace `clossys init` seats in every consumer (foundry-build-0048 Amendment 2026-11-18b, A1): a fixed
 * Publisher responsibility, where websites, docs and slides stay opt-in publications. The plan is the Publisher
 * package's own `admin` starter (starters/admin/publication.json) and its tree contracts, read as installed; this
 * module only places them, through `clossys ia` (the guarded IA writer), never by writing slot files itself.
 *
 * - The Publisher IA is started when the workspace has none (`clossys ia publisher --start`).
 * - Each admin page and the admin publication are placed in the `admin` tab, one group each (admin-plan.ts adminUnder); a page's inputs and uses are the
 *   Designer frame and sections its package default composes (the slot-model rule: a Publisher page reads its frame
 *   and sections) and the Writer copy slots its seeded record cites (admin-plan.ts AdminPage.cites: constitution R07.1
 *   holds a page record's copy to its dependency set), each that the workspace holds as a slot; a publication's are its
 *   pages. The page contract names the whole Designer composition (`composes`), held or not.
 * - The package default of each page (`defaults/<page>/starter-v1.json`) is what a placed page with no pin resolves to
 *   as a sample (records/resolve.ts). Each admin slot with no candidate is then seeded with that default as a real
 *   record (`admin-v1.json`, foundry-build-0048 U20) and pinned through the pin gate once it certifies.
 * - Each used Designer unit no workspace slot holds (a workspace that has not adopted the Designer IA, or one adopted
 *   before the data-bound admin sections) is raised as one kind slot request to the Designer (from the owner, raised by
 *   Producer: the page cannot cite an unheld unit in a slot/1 store), so the queue shows the gap. The data-bound
 *   sections (slot gallery, slot detail, candidate preview, question packet, queue list) read clossys records
 *   read-only, bound host-injected under their page's route scope (the page contract's `reads` and `routeFormat`,
 *   admin-plan.ts; foundry-build-0048 U20).
 *
 * - Each admin slot is written as `clossys.slot/2` (runIaCli `current`), whatever format the rest of the store holds.
 * - A later run rewires each held admin slot whose inputs and uses are not the composition units the workspace now
 *   holds (the Designer adopted its IA after the first init), through `clossys ia` again (`--inputs`/`--uses`):
 *   `publisher.admin-seated` fails a held unit an admin slot does not cite. A held slot whose contract or standard is
 *   not the package's (admin-plan.ts adminContract: tampered, or written by an older package) gets the package's back
 *   (`--contract`, `--standard`), so the check's advice to re-run init is true.
 *
 * A second run on an unchanged workspace places, rewires and raises nothing new (a raise is idempotent).
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { raiseRequest, RequestError } from "../records/request.js";
import { iaPath } from "../records/slot-model/layout.js";
import { toIsoZ } from "../records/pin.js";
import { writeCandidateBytes } from "../records/slot-write.js";
import { listSlots, modelExists } from "../records/slots.js";
import { SLOT_AGENTS } from "../records/slot-model/types.js";
import { sameJson } from "../records/slot.js";
import { adminContract, adminPlan, adminRefs, adminUnder, readAdminSlot } from "./admin-plan.js";
import type { CliResult } from "./main.js";
import { runIaCli } from "./owner.js";
import { runPinCli } from "./pin.js";

export interface AdminSeat {
  readonly started: boolean;
  readonly placed: readonly string[];
  /** Held admin slots whose inputs and uses this run rewrote to the composition units the workspace holds. */
  readonly rewired: readonly string[];
  readonly requests: readonly { readonly id: string; readonly target: string; readonly from: string; readonly created: boolean }[];
  /** Admin slots this run wrote the seeded candidate (`admin-v1.json`) into, and the ones it pinned through the gate. */
  readonly seeded: readonly string[];
  readonly pinned: readonly string[];
  /** Seeded admin slots the pin gate refused: what each waits for (an upstream Designer or Writer pin, mostly). */
  readonly waiting: readonly { readonly slot: string; readonly reason: string }[];
}

/** The seeded candidate's name in every admin slot. */
export const ADMIN_SEED = "admin-v1.json";
export const ADMIN_SEED_BY = "planner:package-default";

/** Seats the admin publication in the workspace at `root` (`<root>/clossys`); a refusal ends it with exit 1. */
export async function seatAdmin(root: string, at: string): Promise<{ result?: CliResult; seat: AdminSeat }> {
  const consumer = join(root, "clossys");
  const placed: string[] = [], rewired: string[] = [], requests: { id: string; target: string; from: string; created: boolean }[] = [];
  const seeded: string[] = [], pinned: string[] = [], waiting: { slot: string; reason: string }[] = [];
  let started = false;
  const fail = (message: string) => ({ result: { exitCode: 1 as const, root, message: `init refused: ${message}` }, seat: { started, placed, rewired, requests, seeded, pinned, waiting } });
  let plan: ReturnType<typeof adminPlan>;
  try { plan = adminPlan(root); } catch (error) { return fail(`the admin workspace plan could not be read from the installed Publisher and Designer packages (${(error as Error).message})`); }
  if (!modelExists(iaPath(consumer, "publisher"))) {
    const start = await runIaCli(["publisher", "--start", "--root", root], root);
    if (start.exitCode !== 0) return fail(start.message ?? "ia publisher --start failed");
    started = true;
  }
  const held = () => new Set(listSlots(consumer, "publisher").map(entry => entry.id));
  // Refs resolve against every slot the workspace places (the slot-model check refuses a ref no IA slot names).
  const known = new Set<string>();
  for (const agent of SLOT_AGENTS) {
    try { for (const entry of listSlots(consumer, agent)) known.add(entry.id); }
    catch (error) { return fail(`${agent}/ia.json is unreadable (${(error as Error).message}): the admin wiring cannot be judged; fix or restore the IA`); }
  }
  const dir = mkdtempSync(join(tmpdir(), "clossys-init-admin-"));
  try {
    const place = async (slot: string, kind: "page" | "publication", contract: unknown, refs: readonly string[]) => {
      if (held().has(slot)) return undefined;
      const file = join(dir, `${slot}.json`);
      writeFileSync(file, `${JSON.stringify(contract, null, 2)}\n`);
      const args = [`publisher/${slot}`, "--contract", file, "--standard", kind, "--under", adminUnder(slot), "--kind", kind, "--inputs", refs.join(","), "--uses", refs.join(","), "--at", at, "--root", root];
      const result = await runIaCli(args, root, { current: true });
      if (result.exitCode !== 0) return result.message ?? `ia publisher/${slot} failed`;
      placed.push(slot);
      return undefined;
    };
    // A held slot's refs follow the composition units the workspace holds now; a contract or standard that is not the
    // package's (tampered, or an older package's) is restored to it.
    const rewire = async (slot: string, kind: "page" | "publication", refs: readonly string[]) => {
      if (placed.includes(slot)) return undefined;
      const entry = listSlots(consumer, "publisher").find(each => each.id === slot);
      const read = entry && readAdminSlot(entry.dir);
      if (!read) return undefined;
      const expected = adminContract(plan, slot);
      const restore = !sameJson(read.doc.contract, expected) || read.doc.standard !== kind;
      if (same(read.doc.inputs, refs) && same(read.doc.uses, refs) && read.current && !restore) return undefined;
      let contractArgs: string[] = [];
      if (restore) {
        const file = join(dir, `${slot}.json`);
        writeFileSync(file, `${JSON.stringify(expected, null, 2)}\n`);
        contractArgs = ["--contract", file];
      }
      const args = [`publisher/${slot}`, ...contractArgs, "--standard", restore ? kind : read.doc.standard ?? kind, "--inputs", refs.join(","), "--uses", refs.join(","), "--at", at, "--root", root];
      const result = await runIaCli(args, root, { current: true });
      if (result.exitCode !== 0) return result.message ?? `ia publisher/${slot} failed`;
      rewired.push(slot);
      return undefined;
    };
    for (const page of plan.pages) {
      const refs = adminRefs(page.cites, known);
      const refused = await place(page.id, "page", adminContract(plan, page.id), refs) ?? await rewire(page.id, "page", refs);
      if (refused) return fail(refused);
    }
    // The publication cites its pages and the slots its package default names (the Writer publication meta), each
    // that the workspace holds: a page this run placed, or a slot of any agent.
    const pageRefs = adminRefs(plan.publicationCites, new Set([...held(), ...known]));
    const refused = await place(plan.publication, "publication", adminContract(plan, plan.publication), pageRefs) ?? await rewire(plan.publication, "publication", pageRefs);
    if (refused) return fail(refused);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  // The gap: each used Designer unit no workspace slot holds is one request to the Designer, naming the pages that use it.
  const unheld = new Map<string, { pages: string[]; bound: boolean }>();
  for (const page of plan.pages) for (const use of page.uses) {
    if (known.has(use)) continue;
    const entry = unheld.get(use) ?? { pages: [], bound: false };
    entry.pages.push(page.id);
    entry.bound ||= page.dataBound.includes(use);
    unheld.set(use, entry);
  }
  for (const [use, entry] of unheld) {
    const why = `the admin workspace (${entry.pages.join(", ")}) composes ${use}, which no workspace slot holds`
      + (entry.bound ? "; a data-bound admin section that reads clossys records read-only, bound host-injected (its Designer slot contract)" : "");
    try {
      const raised = raiseRequest(consumer, { target: `designer/${use}`, from: "owner", rel: "uses", why, source: "ia", by: "producer", at });
      requests.push({ id: raised.request.id, target: raised.request.target, from: raised.request.from, created: raised.created });
    } catch (error) {
      if (error instanceof RequestError) return fail(error.message);
      throw error;
    }
  }
  // The seed (foundry-build-0048 U20): each admin slot with no candidate gets its package default as a real record
  // (admin-plan.ts adminPageRecord / adminPublicationRecord), submitted through the guarded candidate writer, then
  // pinned through the pin gate when it certifies (its frame, sections and copy are pinned upstream). A refused pin
  // leaves the candidate submitted and is reported; a later init retries the seeded candidate. A slot holding any other
  // candidate, or a pin, is the consumer's and is left alone. Pages pin before the publication that orders them.
  const when = toIsoZ(at) ?? at;
  const seeds: [string, Readonly<Record<string, unknown>>][] = [...plan.pages.map(page => [page.id, page.record] as [string, Readonly<Record<string, unknown>>]), [plan.publication, plan.record]];
  for (const [slot, record] of seeds) {
    const entry = listSlots(consumer, "publisher").find(each => each.id === slot);
    if (!entry || existsSync(join(entry.dir, "pin.json"))) continue;
    // The slot's candidates are its candidate-named files only: a stray file (.DS_Store) is not a candidate.
    const held = entry.candidates;
    if (held.some(name => name !== ADMIN_SEED)) continue;
    if (!held.includes(ADMIN_SEED)) {
      try { writeCandidateBytes(consumer, "publisher", slot, ADMIN_SEED, `${JSON.stringify(record, null, 2)}\n`, { at: when, fields: { reason: "clossys init: the Publisher package default, as a record" } }); }
      catch (error) { return fail(`seed publisher/${slot}: ${(error as Error).message}`); }
      seeded.push(slot);
    }
    const pin = await runPinCli([`publisher/${slot}`, ADMIN_SEED, "--by", ADMIN_SEED_BY, "--at", when, "--root", root], root);
    if (pin.exitCode === 0) pinned.push(slot);
    else waiting.push({ slot, reason: (pin.message ?? "the pin gate refused").split("\n").filter(Boolean).slice(0, 3).join(" ") });
  }
  return { seat: { started, placed, rewired, requests, seeded, pinned, waiting } };
}

const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((value, index) => value === b[index]);
