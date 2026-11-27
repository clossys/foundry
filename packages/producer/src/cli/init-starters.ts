/**
 * `clossys init --starters <id>` (foundry-build-0048 SITE-PUBLICATION): seats an opt-in starter publication (today:
 * `site`) and its pages in a consumer workspace, after the plain init every mode runs first. It is the admin seat's
 * path (init-admin.ts) for an opt-in publication: the plan is the Publisher package's own starter and page archetypes
 * (starter-plan.ts), read as installed; this module only places them through `clossys ia` (the guarded IA writer) and
 * raises the gaps through the queue writer, never by writing slot or queue files itself.
 *
 * - Each routed page and the starter's publication are placed in the `<starter>` tab, one group each
 *   (starter-plan.ts starterUnder), as clossys.slot/2 with the package contract. A page's inputs and uses are the slots
 *   its archetype cites (its Designer frame, chrome units and sections; its Writer meta, section and chrome copy) that
 *   the workspace holds; the publication's are its pages.
 * - Each cited slot no workspace slot holds is raised as one kind slot request to its agent (from the owner, raised by
 *   Producer: a page cites only held slots), naming the pages that need it, so `loop.slot` places it.
 * - No candidate and no pin is written: a placed page with no candidate is the agent's first fill (`loop.create` on the
 *   slot, trigger T2), and the message names those pages.
 * - A status page is held, not seated (starter-plan.ts), and reported with its reason.
 * - A later run rewires each held starter slot whose inputs and uses are not the cited slots the workspace now holds,
 *   or whose contract or standard is not the package's, through `clossys ia` again.
 *
 * A second run on an unchanged workspace places, rewires and raises nothing new (a raise is idempotent).
 */
import type { AGENT_LISTS } from "../agent-lists.generated.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runStep } from "../pipeline/runner.js";
import { appendRaise, raiseRequest, RequestError } from "../records/request.js";
import { sameJson } from "../records/slot.js";
import { SLOT_AGENTS } from "../records/slot-model/types.js";
import { listSlots } from "../records/slots.js";
import { readAdminSlot } from "./admin-plan.js";
import type { CliResult } from "./main.js";
import { type HeldPage, StarterPlanError, starterContract, starterPlan, starterUnder } from "./starter-plan.js";

export interface StarterSeat {
  readonly starter: string;
  readonly placed: readonly string[];
  readonly rewired: readonly string[];
  readonly requests: readonly { readonly id: string; readonly target: string; readonly from: string; readonly created: boolean }[];
  /** Placed pages that hold no candidate yet: each is its agent's first fill (loop.create on the slot). */
  readonly unfilled: readonly string[];
  readonly held: readonly HeldPage[];
}

/** Seats starter `starter` in the workspace at `root` (`<root>/clossys`); a refusal ends it with exit 1, naming the error. */
export async function seatStarter(root: string, starter: string, at: string): Promise<{ result?: CliResult; seat: StarterSeat }> {
  const consumer = join(root, "clossys");
  const placed: string[] = [], rewired: string[] = [], requests: { id: string; target: string; from: string; created: boolean }[] = [];
  let held: readonly HeldPage[] = [];
  const seat = (): StarterSeat => ({ starter, placed, rewired, requests, unfilled: [], held });
  const fail = (message: string, error = "StarterSeatError") => ({ result: { exitCode: 1 as const, root, output: { error }, message: `init --starters refused: ${message}` }, seat: seat() });
  let plan: ReturnType<typeof starterPlan>;
  try { plan = starterPlan(root, starter); }
  catch (error) {
    if (error instanceof StarterPlanError) return fail(`${error.name}: ${error.message}`, error.name);
    throw error;
  }
  held = plan.held;
  const heldSlots = () => new Set(listSlots(consumer, "publisher").map(entry => entry.id));
  // Refs resolve against every slot the workspace places; the agent that holds each one routes its gap.
  const known = new Map<string, string>();
  for (const agent of SLOT_AGENTS) {
    try { for (const entry of listSlots(consumer, agent)) known.set(entry.id, agent); }
    catch (error) { return fail(`${agent}/ia.json is unreadable (${(error as Error).message}): the ${starter} wiring cannot be judged; fix or restore the IA`); }
  }
  const refsOf = (wanted: readonly string[], have: ReadonlySet<string> | ReadonlyMap<string, string>) => wanted.filter(id => have.has(id));
  const dir = mkdtempSync(join(tmpdir(), "clossys-init-starters-"));
  try {
    const place = async (slot: string, kind: "page" | "publication", refs: readonly string[]) => {
      if (heldSlots().has(slot)) return undefined;
      const file = join(dir, `${slot}.json`);
      writeFileSync(file, `${JSON.stringify(starterContract(plan, slot), null, 2)}\n`);
      const args = [`publisher/${slot}`, "--contract", file, "--standard", kind, "--under", starterUnder(plan, slot), "--kind", kind, "--inputs", refs.join(","), "--uses", refs.join(","), "--at", at, "--root", root];
      const result = await runStep(["ia", ...args], root);
      if (result.exitCode !== 0) return result.message ?? `ia publisher/${slot} failed`;
      placed.push(slot);
      return undefined;
    };
    const rewire = async (slot: string, kind: "page" | "publication", refs: readonly string[]) => {
      if (placed.includes(slot)) return undefined;
      const entry = listSlots(consumer, "publisher").find(each => each.id === slot);
      const read = entry && readAdminSlot(entry.dir);
      if (!read) return undefined;
      const expected = starterContract(plan, slot);
      const restore = !sameJson(read.doc.contract, expected) || read.doc.standard !== kind;
      if (same(read.doc.inputs, refs) && same(read.doc.uses, refs) && read.current && !restore) return undefined;
      let contractArgs: string[] = [];
      if (restore) {
        const file = join(dir, `${slot}.json`);
        writeFileSync(file, `${JSON.stringify(expected, null, 2)}\n`);
        contractArgs = ["--contract", file];
      }
      const args = [`publisher/${slot}`, ...contractArgs, "--standard", restore ? kind : read.doc.standard ?? kind, "--inputs", refs.join(","), "--uses", refs.join(","), "--at", at, "--root", root];
      const result = await runStep(["ia", ...args], root);
      if (result.exitCode !== 0) return result.message ?? `ia publisher/${slot} failed`;
      rewired.push(slot);
      return undefined;
    };
    for (const page of plan.pages) {
      const refs = refsOf(page.cites, known);
      const refused = await place(page.id, "page", refs) ?? await rewire(page.id, "page", refs);
      if (refused) return fail(refused);
    }
    const pageRefs = refsOf(plan.pages.map(page => page.id), heldSlots());
    const refused = await place(plan.publication, "publication", pageRefs) ?? await rewire(plan.publication, "publication", pageRefs);
    if (refused) return fail(refused);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  // The gaps: each cited slot no workspace slot holds is one request to its agent, naming the pages that need it.
  const unheld = new Map<string, { agent: (typeof AGENT_LISTS)["copy-keys"][number]; rel: "uses" | "input"; pages: string[] }>();
  for (const page of plan.pages) {
    for (const [ids, agent, rel] of [[page.uses, "designer", "uses"], [page.copy, "writer", "input"]] as const) {
      for (const id of ids) {
        if (known.has(id)) continue;
        const entry = unheld.get(`${agent}/${id}`) ?? { agent, rel, pages: [] };
        entry.pages.push(page.id);
        unheld.set(`${agent}/${id}`, entry);
      }
    }
  }
  for (const [target, entry] of unheld) {
    const why = `the ${starter} publication (${entry.pages.join(", ")}) ${entry.rel === "uses" ? "composes" : "reads"} ${target}, which no workspace slot holds`;
    try {
      const raised = raiseRequest(consumer, { target, from: "owner", rel: entry.rel, why, source: "ia", by: "producer", at });
      // An open owner entry another seat raised (the admin pages compose sections.page-header too) keeps this need as
      // one more raised event, so the queue shows every page waiting on it; a rerun finds it merged and writes nothing.
      if (!raised.created && raised.request.why !== why) appendRaise(consumer, raised.request.id, { at, by: "producer", detail: why });
      requests.push({ id: raised.request.id, target: raised.request.target, from: raised.request.from, created: raised.created });
    } catch (error) {
      if (error instanceof RequestError) return fail(error.message);
      throw error;
    }
  }
  const unfilled = listSlots(consumer, "publisher")
    .filter(entry => plan.pages.some(page => page.id === entry.id) && !entry.candidates.length && !entry.pin)
    .map(entry => entry.id);
  return { seat: { ...seat(), unfilled } };
}

/** The lines a starter seat adds to the init message. */
export function starterLines(seat: StarterSeat): string[] {
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  const raised = seat.requests.filter(item => item.created);
  return [
    seat.placed.length ? `seated the ${seat.starter} publication: ${plural(seat.placed.length, "Publisher slot")} placed` : `the ${seat.starter} publication is already seated`,
    ...(seat.rewired.length ? [`rewired ${plural(seat.rewired.length, `${seat.starter} slot`)} to the slots the workspace now holds: ${seat.rewired.join(", ")}`] : []),
    ...(raised.length ? [`raised ${plural(raised.length, "slot request")} for ${seat.starter} units no workspace slot holds: ${raised.map(item => item.target).join(", ")}`] : []),
    ...(seat.unfilled.length ? [`${plural(seat.unfilled.length, `${seat.starter} page`)} hold no candidate yet (first fill: clossys run loop.create --slot publisher/<page> on each): ${seat.unfilled.join(", ")}`] : []),
    ...seat.held.map(page => `held publisher/${page.id}: ${page.reason}`),
  ];
}

const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((value, index) => value === b[index]);
