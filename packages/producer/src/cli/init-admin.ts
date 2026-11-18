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
 * A second run places nothing and raises nothing new (placement skips a placed slot; a raise is idempotent).
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { raiseRequest, RequestError } from "../records/request.js";
import { iaPath } from "../records/slot-model/layout.js";
import { listSlots, modelExists } from "../records/slots.js";
import { SLOT_AGENTS } from "../records/slot-model/types.js";
import { adminPlan, adminUnder, type AdminPage } from "./admin-plan.js";
import type { CliResult } from "./main.js";
import { runIaCli } from "./owner.js";

/** The consumer-side contract `clossys ia` places for one admin page (free-form besides its fixture and requirements). */
function pageContract(page: AdminPage): Record<string, unknown> {
  return {
    kind: "page", publication: "admin", route: page.route, package: `publisher/${page.id}`, layout: `publisher/${page.layout}`,
    frame: "required", sections: "ordered", meta: "required", composes: page.uses.map(id => `designer/${id}`),
    ...(page.dataBound.length ? { reads: { access: "read-only", sections: page.dataBound, binding: "declared requirement: the data-bound section contract and its runtime binding are not built yet" } } : {}),
    ...(page.route.includes("<") ? { routeFormat: "declared requirement: a dynamic route page format is not built yet" } : {}),
    requirements: [{ check: "page.assembled" }], fixture: { route: { path: page.sample } },
  };
}

export interface AdminSeat {
  readonly started: boolean;
  readonly placed: readonly string[];
  readonly requests: readonly { readonly id: string; readonly target: string; readonly from: string; readonly created: boolean }[];
}

/** Seats the admin publication in the workspace at `root` (`<root>/clossys`); a refusal ends it with exit 1. */
export async function seatAdmin(root: string, at: string): Promise<{ result?: CliResult; seat: AdminSeat }> {
  const consumer = join(root, "clossys");
  const placed: string[] = [], requests: { id: string; target: string; from: string; created: boolean }[] = [];
  let started = false;
  const fail = (message: string) => ({ result: { exitCode: 1 as const, root, message: `init refused: ${message}` }, seat: { started, placed, requests } });
  let plan: ReturnType<typeof adminPlan>;
  try { plan = adminPlan(root); } catch (error) { return fail(`the admin workspace plan could not be read from the installed Publisher and Designer packages (${(error as Error).message})`); }
  if (!modelExists(iaPath(consumer, "publisher"))) {
    const start = await runIaCli(["publisher", "--start", "--root", root], root);
    if (start.exitCode !== 0) return fail(start.message ?? "ia publisher --start failed");
    started = true;
  }
  const held = () => new Set(listSlots(consumer, "publisher").map(entry => entry.id));
  // Refs resolve against every slot the workspace places (the slot-model check refuses a ref no IA slot names).
  const known = new Set(SLOT_AGENTS.flatMap(agent => listSlots(consumer, agent).map(entry => entry.id)));
  const dir = mkdtempSync(join(tmpdir(), "clossys-init-admin-"));
  try {
    const place = async (slot: string, kind: "page" | "publication", contract: unknown, refs: readonly string[]) => {
      if (held().has(slot)) return undefined;
      const file = join(dir, `${slot}.json`);
      writeFileSync(file, `${JSON.stringify(contract, null, 2)}\n`);
      const args = [`publisher/${slot}`, "--contract", file, "--standard", kind, "--under", adminUnder(slot), "--kind", kind, "--inputs", refs.join(","), "--uses", refs.join(","), "--at", at, "--root", root];
      const result = await runIaCli(args, root);
      if (result.exitCode !== 0) return result.message ?? `ia publisher/${slot} failed`;
      placed.push(slot);
      return undefined;
    };
    for (const page of plan.pages) {
      const refused = await place(page.id, "page", pageContract(page), page.uses.filter(id => known.has(id)));
      if (refused) return fail(refused);
    }
    const publication = { kind: "publication", publication: "admin", root: plan.root, pages: plan.pages.map(page => page.id), requirements: [{ check: "publication.routes" }], fixture: { route: { path: plan.pages[0]?.route ?? "/admin" } } };
    const refused = await place(plan.publication, "publication", publication, plan.pages.map(page => page.id));
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
  return { seat: { started, placed, requests } };
}
