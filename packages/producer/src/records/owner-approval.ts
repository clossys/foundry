import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ElementRecord, ReferenceRef } from "./types.js";

export type OwnerApproval = {
  readonly id: string;
  readonly actor: "owner";
  readonly owner: string;
  readonly reference: string;
  readonly at: string;
  readonly action: "pin" | "create";
  readonly slot: string;
  readonly element?: string;
  readonly version?: number;
  readonly hash?: string;
};

/** Owner-maintained input. Agents consume approvals; this module never creates one.
 * A record is evidence of the owner's decision, not an identity authentication service.
 */
export function ownerApproval(root: string, id: string | undefined, target: {
  action: "pin" | "create"; slot: string; element?: string; version?: number; hash?: string;
}, agent?: string): OwnerApproval {
  const path = join(root, "approvals.json");
  const data = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
  const records: OwnerApproval[] = data?.schema === "clossys.owner-approvals/1" && Array.isArray(data.records) ? data.records : [];
  const matches = records.filter(row => row?.id === id);
  const record = matches.length === 1 ? matches[0] : undefined;
  const nonempty = (value: unknown): value is string => typeof value === "string" && !!value.trim();
  if (!id || !record || record.actor !== "owner" || !nonempty(record.owner) || record.owner === agent
    || !nonempty(record.reference) || !nonempty(record.at) || !Number.isFinite(Date.parse(record.at))
    || Object.entries(target).some(([key, value]) => record[key as keyof OwnerApproval] !== value)) {
    throw new Error(`OWNER-APPROVAL: ${target.action} ${target.slot} requires an owner decision record bound to this target; agent self-approval is refused`);
  }
  return record;
}

export type DesignerPath = "pick" | "adopt" | "create";
export type DesignerFlow = {
  readonly path: DesignerPath;
  readonly ownerRequest?: string;
  /** Two or three suitable trusted references to show when an owner decision is needed. */
  readonly candidates?: readonly ReferenceRef[];
};

export class DesignerNeedError extends Error {
  constructor(readonly needPath: string) {
    super(`NEED: Designer create requires an owner-request reference; candidate references recorded in ${needPath}`);
    this.name = "DesignerNeedError";
  }
}

/** Called before writing a candidate; a rejected create leaves no version behind. */
export function guardDesignerFlow(root: string, element: Pick<ElementRecord, "slot" | "id" | "package" | "creator" | "lineage">, flow?: DesignerFlow): void {
  if (element.package !== "designer" && !/^(themes|assets|components|frames|sections)\./.test(element.slot)) return;
  const path = flow?.path ?? element.lineage.path ?? (element.lineage.mode === "verbatim" ? "pick" : element.lineage.source ? "adopt" : "create");
  if (element.lineage.path === "create" && flow?.path && flow.path !== "create") throw new Error("Designer create cannot be relabelled as pick or adopt");
  if (path !== "create" && !element.lineage.source) throw new Error("NEED: pick/adopt requires a trusted reference source");
  if (path !== "create") return;
  const request = flow?.ownerRequest ?? element.lineage.ownerRequest;
  try {
    ownerApproval(root, request, { action: "create", slot: element.slot, element: element.id }, element.creator.agent);
    return;
  } catch (error) {
    const candidates = flow?.candidates ?? [];
    // Missing proposals are also a refusal: do not invent references to satisfy a count.
    if (candidates.length < 2 || candidates.length > 3 || candidates.some(row => !row.registry || !row.item || !row.version)
      || new Set(candidates.map(row => `${row.registry}/${row.item}@${row.version}`)).size !== candidates.length) {
      throw new Error(`NEED: ${element.slot}: create refused; supply 2-3 distinct candidate references for the owner before retrying`);
    }
    const needPath = join(root, "needs", `designer.${element.slot}.json`);
    mkdirSync(dirname(needPath), { recursive: true });
    writeFileSync(needPath, `${JSON.stringify({ schema: "clossys.designer-need/1", slot: element.slot, element: element.id, status: "NEED", reason: "No owner-request reference for create", candidates }, null, 2)}\n`);
    throw new DesignerNeedError(needPath);
  }
}
