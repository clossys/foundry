/**
 * `publisher.admin-seated` (foundry-build-0048 Amendment 2026-11-18b, A1): the admin workspace is a fixed Publisher
 * responsibility of every consumer, so every workspace with a slot model (`clossys/agents/`) is judged, whether or not
 * its AGENTS.md carries the views pointer `clossys init` writes. The check is structural, against the installed
 * Publisher package's own `admin` starter, routes and compositions (cli/admin-plan.ts):
 *
 * - each admin page and the admin publication is placed, under the `admin` tab, as a page (publication) slot;
 * - each page contract names publication `admin`, the package route, package and layout, and composes the package
 *   composition; the publication contract names publication `admin`, the package root, and exactly the plan's pages
 *   in plan order; every other contract key equals the contract `clossys init` writes (admin-plan.ts adminContract),
 *   with no key extra or missing; the slot is clossys.slot/2, its standard is its kind, and it carries no tighten entry;
 * - each admin slot cites, as inputs and uses, every slot of its package plan the workspace holds (a page's composition
 *   and the Writer copy slots its seeded record cites, admin-plan.ts AdminPage.cites; a publication's pages): a held one
 *   not cited is a finding, `clossys init` rewires it; and nothing outside that plan (an undeclared input);
 * - the plan itself holds (admin-plan.ts adminPlanFindings): each data-bound section reads under route parameters its
 *   page supplies, and no agent id is a value a static admin route reserves for `<agent>`; the admin publication is fixed,
 *   so its root (the plan's, and the seated contract's) is a static prefix, never `/`, with every page route under it.
 *
 * A workspace with no slot model and no views pointer has no admin workspace to lack yet: `skip`, printed.
 * `clossys init` seats and rewires what is missing (cli/init-admin.ts).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ADMIN_L1, adminContract, adminPlan, adminPlanFindings, adminRefs, readAdminSlot } from "../cli/admin-plan.js";
import { publicationRootFindings } from "../constitution/certify/route.js";
import { sameJson } from "../records/slot.js";
import { iaPath } from "../records/slot-model/layout.js";
import { SLOT_AGENTS } from "../records/slot-model/types.js";
import { hasModelRoot, listSlots, modelExists } from "../records/slots.js";
import { POINTER_START } from "../views/agents-pointer.js";

export const ADMIN_SEATED = "publisher.admin-seated";

export interface AdminSeatedFinding { readonly subject: string; readonly detail: string }
export interface AdminSeatedResult { readonly check: typeof ADMIN_SEATED; readonly status: "pass" | "fail" | "skip"; readonly findings: readonly AdminSeatedFinding[] }

/** True when `clossys init` ran in the workspace at `root`: its AGENTS.md has the views pointer. */
export function initialised(root: string): boolean {
  const file = join(root, "AGENTS.md");
  try { return existsSync(file) && readFileSync(file, "utf8").includes(POINTER_START); } catch { return false; }
}

const same = (a: readonly unknown[], b: readonly unknown[]): boolean => a.length === b.length && a.every((value, index) => value === b[index]);
const list = (value: unknown): readonly unknown[] | undefined => Array.isArray(value) ? value : undefined;

/**
 * Judges the workspace at `root` (its consumer folder `<root>/clossys`). Never throws: a state the check cannot read is a
 * `fail` finding (indeterminate), never `pass`.
 */
export function runAdminSeated(root: string): AdminSeatedResult {
  const consumer = join(root, "clossys");
  if (!hasModelRoot(consumer) && !initialised(root)) return { check: ADMIN_SEATED, status: "skip", findings: [] };
  try { return judgeSeat(root, consumer); }
  catch (error) { return { check: ADMIN_SEATED, status: "fail", findings: [{ subject: ADMIN_SEATED, detail: `indeterminate (${(error as Error).message})` }] }; }
}

function judgeSeat(root: string, consumer: string): AdminSeatedResult {
  let plan: ReturnType<typeof adminPlan>;
  try { plan = adminPlan(root); }
  catch (error) { return { check: ADMIN_SEATED, status: "fail", findings: [{ subject: "publisher/starters/admin", detail: `the admin workspace plan could not be read from the installed Publisher package (${(error as Error).message})` }] }; }
  const wanted = [...plan.pages.map(page => page.id), plan.publication];
  const fix = "run clossys init: the admin workspace is a fixed Publisher publication";
  if (!modelExists(iaPath(consumer, "publisher"))) {
    return { check: ADMIN_SEATED, status: "fail", findings: [{ subject: "publisher/ia.json", detail: `missing: no Publisher IA, so no admin publication (${wanted.length} slots); ${fix}` }] };
  }
  let entries: Map<string, ReturnType<typeof listSlots>[number]>;
  try { entries = new Map(listSlots(consumer, "publisher").map(entry => [entry.id, entry])); }
  catch (error) { return { check: ADMIN_SEATED, status: "fail", findings: [{ subject: "publisher/ia.json", detail: `unreadable (${(error as Error).message}), so no admin publication can be judged; ${fix}` }] }; }
  // An agent IA that cannot be read leaves the wiring indeterminate: a finding, so no admin seat counts as seated.
  const unreadable: AdminSeatedFinding[] = [];
  const held = new Set(SLOT_AGENTS.flatMap(agent => {
    try { return listSlots(consumer, agent).map(entry => entry.id); }
    catch (error) {
      unreadable.push({ subject: `${agent}/ia.json`, detail: `unreadable (${(error as Error).message}): the admin wiring cannot be judged, so no admin seat counts as seated; fix or restore the IA` });
      return [];
    }
  }));
  // The plan's own rules (foundry-build-0048 U20): data-bound scope within the page route, no agent id reserved.
  const findings: AdminSeatedFinding[] = [...unreadable, ...adminPlanFindings(plan)];
  // The named checks (`named` keys) give a precise message; every other contract key is held to the package contract
  // (admin-plan.ts adminContract, the one `clossys init` writes): no extra key, none missing, each equal.
  const closed = (id: string, actual: unknown, named: readonly string[]): string[] => {
    const expected = adminContract(plan, id);
    const have = actual !== null && typeof actual === "object" && !Array.isArray(actual) ? actual as Readonly<Record<string, unknown>> : {};
    const extra = Object.keys(have).filter(key => !named.includes(key) && !Object.hasOwn(expected, key));
    const missing = Object.keys(expected).filter(key => !named.includes(key) && !Object.hasOwn(have, key));
    const differ = Object.keys(expected).filter(key => !named.includes(key) && Object.hasOwn(have, key) && !sameJson(have[key], expected[key]));
    const parts = ([["extra", extra], ["missing", missing], ["differs", differ]] as const).filter(([, keys]) => keys.length).map(([label, keys]) => `${label} ${keys.join(", ")}`);
    return parts.length ? [`contract differs from the package contract: ${parts.join("; ")} (run clossys init to restore it)`] : [];
  };
  const judge = (id: string, kind: "page" | "publication", contract: (value: Readonly<Record<string, unknown>>) => string[], composition: readonly string[], named: readonly string[]) => {
    const subject = `publisher/${id}`;
    const entry = entries.get(id);
    if (!entry) { findings.push({ subject, detail: `not placed in the Publisher IA; ${fix}` }); return; }
    const issues: string[] = [];
    if (entry.position.l1 !== ADMIN_L1) issues.push(`sits under the ${entry.position.l1} tab, not ${ADMIN_L1}`);
    const read = readAdminSlot(entry.dir);
    if (!read) { findings.push({ subject, detail: [...issues, "slot.json is missing or not a valid slot"].join("; ") }); return; }
    if (!read.current) issues.push(`slot.json is ${String(read.doc.schema)}; run clossys init to rewrite it as clossys.slot/2`);
    if (read.doc.kind !== kind) issues.push(`kind is ${String(read.doc.kind)}, not ${kind}`);
    if (read.doc.standard !== kind) issues.push(`standard is ${String(read.doc.standard)}, not ${kind} (run clossys init to restore it)`);
    const raw = read.doc.contract as unknown;
    issues.push(...contract(raw !== null && typeof raw === "object" ? raw as Readonly<Record<string, unknown>> : {}));
    issues.push(...closed(id, raw, named));
    const tighten = read.current?.tighten.length ?? 0;
    if (tighten) issues.push(`carries ${tighten} tighten entries; the admin seat is the Publisher package's and takes none (remove them)`);
    // Wiring: every held composition unit is cited as an input and a use; nothing outside the composition is.
    const cited = adminRefs(composition, held);
    const wiring = (refs: readonly string[]) => ({ uncited: cited.filter(ref => !refs.includes(ref)).join(", "), undeclared: refs.filter(ref => !composition.includes(ref)).join(", ") });
    const inputs = wiring(read.doc.inputs), uses = wiring(read.doc.uses);
    for (const field of ["uncited", "undeclared"] as const) {
      const rels = inputs[field] && inputs[field] === uses[field] ? [["inputs and uses", inputs[field]]] : [["inputs", inputs[field]], ["uses", uses[field]]].filter(([, ids]) => ids);
      for (const [rel, ids] of rels) issues.push(field === "uncited"
        ? `${rel} cite no ${ids}, which the workspace holds (run clossys init to rewire)`
        : `${rel} name ${ids}, outside its package composition (undeclared input)`);
    }
    if (issues.length) findings.push({ subject, detail: `${issues.join("; ")}; the admin seat is the Publisher package's, not the workspace's` });
  };
  for (const page of plan.pages) {
    judge(page.id, "page", contract => {
      const issues: string[] = [];
      if (contract.publication !== "admin") issues.push(`contract publication is ${JSON.stringify(contract.publication)}, not "admin"`);
      if (contract.route !== page.route) issues.push(`contract route is ${JSON.stringify(contract.route)}, not the package route ${page.route}`);
      if (contract.package !== `publisher/${page.id}`) issues.push(`contract package is ${JSON.stringify(contract.package)}, not publisher/${page.id}`);
      if (contract.layout !== `publisher/${page.layout}`) issues.push(`contract layout is ${JSON.stringify(contract.layout)}, not publisher/${page.layout}`);
      const composes = list(contract.composes);
      const expected = page.uses.map(id => `designer/${id}`);
      if (!composes || !same(composes, expected)) issues.push(`contract composes ${JSON.stringify(contract.composes ?? null)}, not the package composition ${expected.join(", ")}`);
      return issues;
    }, page.cites, ["publication", "route", "package", "layout", "composes"]);
  }
  const pageIds = plan.pages.map(page => page.id);
  judge(plan.publication, "publication", contract => {
    const issues: string[] = [];
    if (contract.publication !== "admin") issues.push(`contract publication is ${JSON.stringify(contract.publication)}, not "admin"`);
    if (contract.root !== plan.root) issues.push(`contract root is ${JSON.stringify(contract.root)}, not the package root ${plan.root}`);
    // The admin publication is fixed: whatever root the seat names, it is a static prefix, never /, over every page route.
    if (typeof contract.root === "string") issues.push(...publicationRootFindings("contract", contract.root, plan.pages.map(page => page.route), true));
    const pages = list(contract.pages) ?? [];
    const absent = pageIds.filter(id => !pages.includes(id));
    if (absent.length) issues.push(`contract pages lack ${absent.join(", ")}`);
    const outside = pages.filter(id => !pageIds.includes(id as string));
    if (outside.length) issues.push(`contract pages name ${outside.map(String).join(", ")} outside the package plan`);
    if (!absent.length && !outside.length && !same(pages, pageIds)) issues.push(`contract pages are not in package order (${pageIds.join(", ")})`);
    return issues;
  }, pageIds, ["publication", "root", "pages"]);
  return { check: ADMIN_SEATED, status: findings.length ? "fail" : "pass", findings };
}

/** The `clossys check` line: always printed, a skip included. */
export const adminSeatedSummary = (result: AdminSeatedResult): string => result.status === "skip" ? `${ADMIN_SEATED}: skip (no slot model and no clossys init: no admin workspace to judge)`
  : result.status === "pass" ? `${ADMIN_SEATED}: pass` : [`${ADMIN_SEATED}: fail (${result.findings.length})`, ...result.findings.map(finding => `  ${finding.subject}: ${finding.detail}`)].join("\n");
