/**
 * `publisher.admin-seated` (foundry-build-0048 Amendment 2026-11-18b, A1): the admin workspace is a fixed Publisher
 * responsibility, so an initialised consumer (its `AGENTS.md` carries the views pointer `clossys init` writes) fails
 * when its Publisher IA lacks the admin publication or any admin page the Publisher `admin` starter names. A
 * workspace `clossys init` has not run in is not judged (status `skip`): it has no admin workspace to lack yet.
 * `clossys init` seats what is missing (cli/init-admin.ts).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { adminPlan } from "../cli/admin-plan.js";
import { iaPath } from "../records/slot-model/layout.js";
import { listSlots, modelExists } from "../records/slots.js";
import { POINTER_START } from "../views/agents-pointer.js";

export const ADMIN_SEATED = "publisher.admin-seated";

export interface AdminSeatedFinding { readonly subject: string; readonly detail: string }
export interface AdminSeatedResult { readonly check: typeof ADMIN_SEATED; readonly status: "pass" | "fail" | "skip"; readonly findings: readonly AdminSeatedFinding[] }

/** True when `clossys init` ran in the workspace at `root`: its AGENTS.md has the views pointer. */
export function initialised(root: string): boolean {
  const file = join(root, "AGENTS.md");
  try { return existsSync(file) && readFileSync(file, "utf8").includes(POINTER_START); } catch { return false; }
}

/** Judges the workspace at `root` (its consumer folder `<root>/clossys`). */
export function runAdminSeated(root: string): AdminSeatedResult {
  if (!initialised(root)) return { check: ADMIN_SEATED, status: "skip", findings: [] };
  const consumer = join(root, "clossys");
  let plan: ReturnType<typeof adminPlan>;
  try { plan = adminPlan(root); }
  catch (error) { return { check: ADMIN_SEATED, status: "fail", findings: [{ subject: "publisher/starters/admin", detail: `the admin workspace plan could not be read from the installed Publisher package (${(error as Error).message})` }] }; }
  const wanted = [...plan.pages.map(page => page.id), plan.publication];
  const fix = "run clossys init: the admin workspace is a fixed Publisher publication";
  if (!modelExists(iaPath(consumer, "publisher"))) {
    return { check: ADMIN_SEATED, status: "fail", findings: [{ subject: "publisher/ia.json", detail: `missing: no Publisher IA, so no admin publication (${wanted.length} slots); ${fix}` }] };
  }
  const placed = new Set(listSlots(consumer, "publisher").map(entry => entry.id));
  const findings = wanted.filter(id => !placed.has(id)).map(id => ({ subject: `publisher/${id}`, detail: `not placed in the Publisher IA; ${fix}` }));
  return { check: ADMIN_SEATED, status: findings.length ? "fail" : "pass", findings };
}

export const adminSeatedSummary = (result: AdminSeatedResult): string | undefined => result.status === "skip" ? undefined
  : result.status === "pass" ? `${ADMIN_SEATED}: pass` : [`${ADMIN_SEATED}: fail (${result.findings.length})`, ...result.findings.map(finding => `  ${finding.subject}: ${finding.detail}`)].join("\n");
