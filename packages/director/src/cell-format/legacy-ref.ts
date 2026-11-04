import type { Ref } from "./schema.js";

export const CELL_ID_PATTERN = /^[a-z]+(?:-[a-z]+)*\.[a-z]+(?:-[a-z]+)*\.[a-z]+(?:-[a-z]+)*$/;
export const RECORD_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export function positiveInteger(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
export function isoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function sessionId(value: string): boolean {
  const match = /^(\d{4}-\d{2}-\d{2})-([1-9]\d*)$/.exec(value);
  return !!match && isoDate(match[1]) && positiveInteger(Number(match[2]));
}
/** Strict whole-string reference parsing; surface strategy: markers are separate. */
export function parseRef(text: string): Ref | undefined {
  if (text.trim() !== text || /[\r\n]/.test(text)) return undefined;
  const cell = /^(.+)@([1-9]\d*)$/.exec(text);
  if (cell && CELL_ID_PATTERN.test(cell[1]!) && positiveInteger(Number(cell[2]))) return { kind: "cell", ref: { cell: cell[1]!, version: Number(cell[2]) } };
  const msg = /^msg:(.+)#([US])([1-9]\d*)$/.exec(text);
  if (msg && sessionId(msg[1]!) && positiveInteger(Number(msg[3]))) return { kind: "msg", session: msg[1]!, line: `${msg[2]}${msg[3]}` };
  if (text.startsWith("finding:") && RECORD_ID_PATTERN.test(text.slice(8))) return { kind: "finding", id: text.slice(8) };
  return undefined;
}
export function formatRef(ref: Ref): string {
  switch (ref.kind) {
    case "cell": return `${ref.ref.cell}@${ref.ref.version}`;
    case "msg": return `msg:${ref.session}#${ref.line}`;
    case "finding": return `finding:${ref.id}`;
  }
}
/** Finds whole reference tokens in conversation prose, preserving their order. */
export function refsInText(text: string): Ref[] {
  const refs: Ref[] = [];
  for (const match of text.matchAll(/(?:^|[\s(,])((?:msg:[a-zA-Z0-9-]+#[US]\d+)|(?:finding:[a-z0-9-]+)|(?:[a-z]+(?:-[a-z]+)*\.[a-z]+(?:-[a-z]+)*\.[a-z]+(?:-[a-z]+)*@\d+))(?=$|[\s),.;:!?])/g)) {
    const ref = parseRef(match[1]!); if (ref) refs.push(ref);
  }
  return refs;
}
