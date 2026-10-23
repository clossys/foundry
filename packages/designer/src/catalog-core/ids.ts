import type { Finding } from "./types.js";

export const LAYERS = ["tokens", "assets", "components", "sections", "frames"] as const;
const SEG = "[a-z][a-z0-9]*(?:-[a-z0-9]+)*";
const MSEG = "[a-z0-9]+(?:-[a-z0-9]+)*";
export const SLOT_ID = new RegExp(`^(?:${LAYERS.join("|")})\\.${SEG}$`);
export const MEMBER_ID = new RegExp(`^(?:${LAYERS.join("|")})\\.${SEG}(?:\\.${MSEG})+$`);
export const SOURCE_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:@[a-z][a-z0-9]*(?:-[a-z0-9]+)*)?$/;
export const FILL_ID = /^(?<source>[^/]+)\/(?<slot>[^/]+)$/;
export const CLAUSE_ID = /^[a-z][a-z0-9.-]*#[a-z0-9][a-z0-9.-]*$/;

export type IdKind = "slot" | "member" | "source" | "fill" | "clause";
const patterns = { slot: SLOT_ID, member: MEMBER_ID, source: SOURCE_ID, fill: FILL_ID, clause: CLAUSE_ID };
function isAscii(value: string): boolean {
  for (let index = 0; index < value.length; index++) if (value.charCodeAt(index) > 0x7f) return false;
  return true;
}

export function isValidId(kind: IdKind, value: string): boolean {
  if (!isAscii(value)) return false;
  return kind === "fill" ? splitFillId(value) !== undefined : patterns[kind].test(value);
}

export function idFinding(kind: IdKind, value: string, subject: string): Finding {
  return { code: "C1", rule: "id", severity: "error", subject, message: `id: ${kind} ${value} is not a valid ${kind} id` };
}

export function isPrefixOf(prefix: string, id: string): boolean {
  return id === prefix || id.startsWith(prefix + ".");
}

export function splitFillId(fillId: string): { source: string; slot: string } | undefined {
  if (!isAscii(fillId)) return undefined;
  const match = FILL_ID.exec(fillId);
  const source = match?.groups?.source;
  const slot = match?.groups?.slot;
  if (!source || !slot || !SOURCE_ID.test(source) || !SLOT_ID.test(slot)) return undefined;
  return { source, slot };
}
