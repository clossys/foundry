/**
 * R05 Certification (slot-constitution.md R05, W2-C). Status `building`: reported, never failing a
 * non-strict run (section 4), until the slots carry their fixtures and standards.
 *
 * - R05.1 every candidate of every live slot is certified (certify/index.ts): schema, contract
 *   fixture fit by kind, and the slot's standard with its requirements plus the contract's.
 * - R05.2 a pin points only to a certified candidate.
 * - R05.3 no borrowing: specimen, server and certify code reads fixtures only from slot.json
 *   (`contract.fixture`); no sibling or borrowed preview or fixture is read.
 *
 * A row's reason starts with the reason codes in brackets (`[no-standard,no-fixture]`), so the fit
 * failures (every code but no-standard and no-fixture) can be listed per agent and family.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative } from "node:path";
import { certifyWorld, resultKey } from "../certify/index.js";
import { pinnedOf } from "../certify/env.js";
import type { Reason } from "../certify/types.js";
import { focusedLiveSlots, row } from "../checks/shared.js";
import type { Check, Row, RuleModule } from "../types.js";

/** `[code,code] first message (+n more)`. */
export function reasonText(reasons: readonly Reason[]): string {
  const codes = [...new Set(reasons.map(item => item.code))];
  return `[${codes.join(",")}] ${reasons[0]?.message ?? "uncertified"}${reasons.length > 1 ? ` (+${reasons.length - 1} more)` : ""}`;
}

/** R05.1: one row per uncertified candidate of a live slot. */
export const r05_1: Check = ctx => {
  const rows: Row[] = [];
  for (const { slot, candidate, certification } of certifyWorld(ctx).results.values()) {
    if (!certification.certified) rows.push(row("R05", "R05.1", slot, reasonText(certification.reasons), candidate.path, candidate.name));
  }
  return rows;
};

/** R05.2: one row per pin whose candidate is uncertified. */
export const r05_2: Check = ctx => {
  const rows: Row[] = [];
  const { results } = certifyWorld(ctx);
  for (const slot of focusedLiveSlots(ctx)) {
    const candidate = pinnedOf(slot);
    if (!candidate) continue;
    const result = results.get(resultKey(slot.agent, slot.id, candidate.name));
    if (result && !result.certification.certified) rows.push(row("R05", "R05.2", slot, `pins ${candidate.name}, which is uncertified: ${reasonText(result.certification.reasons)}`, slot.pin!.path, candidate.name));
  }
  return rows;
};

/** Source folders whose fixture reads R05.3 scans (workspace-relative). */
export const R05_3_ROOTS = ["packages/producer/src/specimen", "packages/producer/src/server", "packages/producer/src/constitution/certify"];
/** A read of a fixture or preview that is not the slot's own: the deleted `slotFixture` fallback and its kin. */
export const BORROWING = /\bslotFixture\b|\bsibling(?:Preview|Fixture)s?\b|\bborrow(?:ed)?(?:Preview|Fixture)s?\b/;
const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
const TEST = /\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)__(?:fixtures|tests)__\//;
const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");

/** R05.3: no specimen, server or certify source reads a borrowed fixture. */
export const r05_3: Check = ctx => {
  const rows: Row[] = [];
  const walk = (abs: string) => {
    const stat = statSync(abs);
    if (stat.isDirectory()) { for (const name of readdirSync(abs).sort()) if (name !== "node_modules" && name !== "dist") walk(join(abs, name)); return; }
    const rel = relative(ctx.root, abs).split("\\").join("/");
    if (!SOURCE.test(rel) || TEST.test(rel) || rel.endsWith(".d.ts")) return;
    const hit = BORROWING.exec(stripComments(readFileSync(abs, "utf8")));
    if (hit) rows.push(row("R05", "R05.3", { agent: "producer", id: posix.basename(rel) }, `reads ${hit[0]}: a fixture comes only from slot.json contract.fixture`, rel));
  };
  for (const dir of R05_3_ROOTS) if (existsSync(join(ctx.root, dir))) walk(join(ctx.root, dir));
  return rows;
};

export const R05_CHECKS = { "R05.1": r05_1, "R05.2": r05_2, "R05.3": r05_3 } as const;
export const R05: RuleModule = { rule: "R05", checks: R05_CHECKS };

