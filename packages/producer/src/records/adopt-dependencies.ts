/**
 * CP1-DEPS: the code adopt (`clossys settle adopt`, loop.create's adopt step) declares the npm packages a stock item
 * imports in the consumer's root package.json and installs them, before it writes the item. The stock item's imports
 * must resolve before its candidate can be written (stockItemOf refuses an unlocked import), certified or rendered, so
 * this is the earliest step that needs them.
 *
 * The change is the one `publish --install` makes for its substrate, made at the consumer root: the entries come from
 * the publish collector (`substrateDependencies`) over the pinned registry entry's declared dependencies
 * (records/code-adopt.ts stockDependencyPlan), the missing ones are added to `dependencies`, and npm runs
 * `install --no-audit --no-fund` (publish/install.ts npmRunner: arguments only, never a shell; the same argv as
 * ensureSubstrateDependencies, so no install script runs that the publish path does not run). One engine event
 * (`dependency.add`, actor code:adopt, subject designer/<slot>) names package.json and package-lock.json at their new
 * bytes. A refused plan, a failed install or a lockfile that still lacks a package writes nothing: package.json and
 * package-lock.json are put back to their bytes before. A plan with nothing to install changes nothing.
 *
 * CP1-PKGS: the step also runs for a crafted stock slot (records/code-adopt.ts isCraftedStockSlot: a Designer frames or
 * sections slot whose contract fixture a stock row ships). Code adds the same declared packages by the same rules and
 * the same event, writes no candidate, and the agent crafts the frame or section. adoptDependencyPreview is the one
 * read of which step applies: `clossys run loop.<name> --dry` and `clossys options designer/<slot> --reference` print it.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ShadcnRunner } from "@clossys/publisher/install";
import { inputsOf } from "../engine/chain.js";
import { commitEvent } from "../engine/log.js";
import { npmRunner } from "../publish/install.js";
import { CODE_ADOPT, codeAdoptSlotRefusal, isCraftedStockSlot, lockedPackages, stockDependencyPlan, type DependencyPlan } from "./code-adopt.js";
import { readSlotEntry } from "./slots.js";
import type { AgentId } from "./types.js";

/** The event kind of a dependency change the code adopt made. */
export const DEPENDENCY_EVENT = "dependency.add";
/** The npm argv the adopt runs in the consumer root: ensureSubstrateDependencies' own. */
export const DEPENDENCY_INSTALL_ARGV: readonly string[] = ["install", "--no-audit", "--no-fund"];

export interface DependencyOutcome {
  /** 0: changed what the plan names, or nothing to change. 1: refused or failed, nothing written. */
  readonly exit: 0 | 1;
  readonly plan?: DependencyPlan;
  readonly refused?: string;
  /** The files written, relative to the root (package.json, package-lock.json); empty on a dry run or no change. */
  readonly wrote: readonly string[];
  readonly dry: boolean;
}

export interface DependencyOptions {
  /** Runs npm in the consumer root; defaults to npmRunner(). */
  readonly npm?: ShadcnRunner;
  /** Plan only: write nothing, run nothing. */
  readonly dryRun?: boolean;
  /** The event's time (ISO-8601 UTC). */
  readonly at?: string;
}

/** The dependency change in one line, for a settle's why and the dry run: what is added and whether npm runs. */
export function dependencyPlanText(plan: DependencyPlan): string {
  if (!plan.install.length) return `${plan.ref}: every package it imports is in the consumer lockfile; package.json is not changed`;
  const added = Object.entries(plan.add).map(([name, range]) => `${name}@${range}`);
  return `${plan.ref}: package.json dependencies ${added.length ? `+ ${added.join(", ")}` : "unchanged"}, then npm ${DEPENDENCY_INSTALL_ARGV.join(" ")} for ${plan.install.join(", ")} (declared by ${plan.declaredBy.join(", ")})`;
}

const readBytes = (file: string): Buffer | undefined => existsSync(file) ? readFileSync(file) : undefined;
function putBack(file: string, bytes: Buffer | undefined): void {
  // A file that was not there stays as npm left it (npm creates the lockfile); only bytes we read are restored.
  if (bytes !== undefined && !readFileSync(file).equals(bytes)) writeFileSync(file, bytes);
}

/**
 * Declare and install what the adopt of `designer/<slotId>`'s stock item needs (stockDependencyPlan). Idempotent: once
 * the lockfile holds every import, a second call changes nothing and runs nothing.
 */
export async function declareStockDependencies(root: string, slotId: string, options: DependencyOptions = {}): Promise<DependencyOutcome> {
  const dry = options.dryRun === true;
  const found = stockDependencyPlan(root, slotId);
  if ("none" in found) return { exit: 0, wrote: [], dry };
  if ("refused" in found) return { exit: 1, refused: found.refused, wrote: [], dry };
  const { plan } = found;
  if (!plan.install.length || dry) return { exit: 0, plan, wrote: [], dry };
  const manifestFile = join(root, "package.json"), lockFile = join(root, "package-lock.json");
  const manifestBefore = readFileSync(manifestFile), lockBefore = readBytes(lockFile);
  const refuse = (why: string): DependencyOutcome => {
    putBack(manifestFile, manifestBefore);
    if (lockBefore !== undefined && existsSync(lockFile)) putBack(lockFile, lockBefore);
    return { exit: 1, plan, refused: why, wrote: [], dry };
  };
  if (Object.keys(plan.add).length) {
    const manifest = JSON.parse(manifestBefore.toString("utf8")) as { dependencies?: Record<string, string> };
    const dependencies = { ...manifest.dependencies, ...plan.add };
    writeFileSync(manifestFile, `${JSON.stringify({ ...manifest, dependencies: Object.fromEntries(Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b))) }, null, 2)}\n`);
  }
  let run: Awaited<ReturnType<ShadcnRunner>>;
  try { run = await (options.npm ?? npmRunner())(DEPENDENCY_INSTALL_ARGV, { cwd: root }); }
  catch (error) { return refuse(`npm ${DEPENDENCY_INSTALL_ARGV.join(" ")} could not run: ${error instanceof Error ? error.message : String(error)}`); }
  if (run.code !== 0) return refuse(`npm ${DEPENDENCY_INSTALL_ARGV.join(" ")} in the consumer root exited ${run.code} (for ${plan.install.join(", ")}): ${(run.stderr || run.stdout).trim().split("\n").slice(-3).join(" ")}`);
  const locked = lockedPackages(root);
  const still = plan.install.filter(name => locked[name] === undefined);
  if (still.length) return refuse(`npm ${DEPENDENCY_INSTALL_ARGV.join(" ")} left ${still.join(", ")} out of the consumer's package-lock.json`);
  const changed = (file: string, before: Buffer | undefined) => existsSync(file) && (before === undefined || !readFileSync(file).equals(before));
  const wrote = [...(changed(manifestFile, manifestBefore) ? ["package.json"] : []), ...(changed(lockFile, lockBefore) ? ["package-lock.json"] : [])];
  commitEvent(root, { actor: CODE_ADOPT, kind: DEPENDENCY_EVENT, subject: `designer/${slotId}`, ...(options.at ? { at: options.at } : {}), inputs: inputsOf(root, [manifestFile, lockFile]) });
  return { exit: 0, plan, wrote, dry };
}

/** Why code adopts nothing into `<agent>/<slotId>` (not a byte-exact adopt slot, or a held candidate), or undefined. */
export function adoptGate(root: string, agent: AgentId, slotId: string): { readonly why: string; readonly cites: readonly string[] } | undefined {
  const slotFile = `clossys/agents/${agent}/${slotId}/slot.json`;
  const notCode = codeAdoptSlotRefusal(root, agent, slotId);
  if (notCode !== undefined) return { why: `${notCode}; the agent creates`, cites: [slotFile] };
  const held = readSlotEntry(join(root, "clossys"), agent, slotId)?.candidates ?? [];
  if (held.length) return { why: `${agent}/${slotId} holds ${held.join(", ")}; code adopts only into a slot with no candidate, so the agent creates`, cites: [slotFile, `clossys/agents/${agent}/${slotId}/ledger.json`] };
  return undefined;
}

/** Which dependency step the adopt step of `<agent>/<slotId>` runs: none (`skip`), or the plan or its refusal, and whether code then adopts the item (`adopts`) or the agent crafts (`crafted`, the adopt gate's why). */
export type DependencyPreview =
  | { readonly skip: string }
  | { readonly plan: DependencyPlan; readonly adopts: true }
  | { readonly plan: DependencyPlan; readonly adopts: false; readonly crafted: string }
  | { readonly refused: string };

/**
 * What the adopt step of `<agent>/<slotId>` would change in the consumer's package.json (CP1-DEPS, CP1-PKGS), by the
 * step's own rules and writing nothing: `skip` when it runs no dependency step there (code adopts nothing and the slot
 * is no crafted stock slot, or no stock item ships it), else the dependency plan or its refusal.
 */
export function adoptDependencyPreview(root: string, agent: AgentId, slotId: string): DependencyPreview {
  const gate = adoptGate(root, agent, slotId);
  if (gate !== undefined && !isCraftedStockSlot(agent, slotId)) return { skip: gate.why };
  const found = stockDependencyPlan(root, slotId);
  if ("none" in found) return { skip: gate !== undefined ? gate.why : `${found.none}; the agent creates` };
  if ("refused" in found) return found;
  return gate === undefined ? { plan: found.plan, adopts: true } : { plan: found.plan, adopts: false, crafted: gate.why };
}
