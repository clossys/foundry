/**
 * The admin workspace `clossys init` seats in every consumer (foundry-build-0048 Amendment 2026-11-18b, A1): a fixed
 * Publisher responsibility, where websites, docs and slides stay opt-in publications. The plan is the Publisher
 * package's own `admin` starter (starters/admin/publication.json) and its tree contracts, read as installed; this
 * module only places them, through `clossys ia` (the guarded IA writer), never by writing slot files itself.
 *
 * - The Publisher IA is started when the workspace has none (`clossys ia publisher --start`).
 * - Each admin page and the admin publication are placed in the `admin` tab, one group each (admin-plan.ts adminUnder); a page's inputs and uses are the
 *   Designer frame and sections its package default composes (the slot-model rule: a Publisher page reads its frame
 *   and sections) that the workspace holds as slots, a publication's are its pages. The page contract names the
 *   whole composition (`composes`), held or not.
 * - The package default of each page (`defaults/<page>/starter-v1.json`) is the seeded candidate: a placed page with
 *   no pin resolves to it as a sample (records/resolve.ts), so nothing is copied into the workspace.
 * - Each used Designer unit no workspace slot holds (a workspace that has not adopted the Designer IA, or one adopted
 *   before the data-bound admin sections) is raised as one kind slot request to the Designer (from the owner, raised by
 *   Producer: the page cannot cite an unheld unit in a slot/1 store), so the queue shows the gap. The data-bound
 *   sections (slot gallery, slot detail, candidate preview, question packet, queue list) read clossys records
 *   read-only; their section contract binding and the dynamic route format are a declared requirement, not built here.
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
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { raiseRequest, RequestError } from "../records/request.js";
import { iaPath } from "../records/slot-model/layout.js";
import { listSlots, modelExists } from "../records/slots.js";
import { SLOT_AGENTS } from "../records/slot-model/types.js";
import { sameJson } from "../records/slot.js";
import { adminContract, adminPlan, adminRefs, adminUnder, readAdminSlot } from "./admin-plan.js";
import type { CliResult } from "./main.js";
import { runIaCli } from "./owner.js";

export interface AdminSeat {
  readonly started: boolean;
  readonly placed: readonly string[];
  /** Held admin slots whose inputs and uses this run rewrote to the composition units the workspace holds. */
  readonly rewired: readonly string[];
  readonly requests: readonly { readonly id: string; readonly target: string; readonly from: string; readonly created: boolean }[];
}

/** Seats the admin publication in the workspace at `root` (`<root>/clossys`); a refusal ends it with exit 1. */
export async function seatAdmin(root: string, at: string): Promise<{ result?: CliResult; seat: AdminSeat }> {
  const consumer = join(root, "clossys");
  const placed: string[] = [], rewired: string[] = [], requests: { id: string; target: string; from: string; created: boolean }[] = [];
  let started = false;
  const fail = (message: string) => ({ result: { exitCode: 1 as const, root, message: `init refused: ${message}` }, seat: { started, placed, rewired, requests } });
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
      const refs = adminRefs(page.uses, known);
      const refused = await place(page.id, "page", adminContract(plan, page.id), refs) ?? await rewire(page.id, "page", refs);
      if (refused) return fail(refused);
    }
    const pageRefs = adminRefs(plan.pages.map(page => page.id), held());
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
      + (entry.bound ? "; a data-bound admin section that reads clossys records read-only, its section contract binding is not built yet" : "");
    try {
      const raised = raiseRequest(consumer, { target: `designer/${use}`, from: "owner", rel: "uses", why, source: "ia", by: "producer", at });
      requests.push({ id: raised.request.id, target: raised.request.target, from: raised.request.from, created: raised.created });
    } catch (error) {
      if (error instanceof RequestError) return fail(error.message);
      throw error;
    }
  }
  return { seat: { started, placed, rewired, requests } };
}

const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((value, index) => value === b[index]);
