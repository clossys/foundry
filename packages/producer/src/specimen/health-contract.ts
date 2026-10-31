/**
 * The message a specimen page posts to the Studio card framing it.
 *
 * Publisher renders the specimen and its inline reporter (`@clossys/publisher/specimen`);
 * this module is the typed contract the card reads. It is dependency-free so a browser
 * bundle can import it. Every number is a report for people to read: nothing here is a
 * gate, a threshold or a pass/fail.
 */

export const SPECIMEN_HEALTH_MESSAGE_TYPE = "clossys:specimen-health" as const;
/** Post this to the specimen's window to ask for a fresh message. */
export const SPECIMEN_HEALTH_REQUEST_TYPE = "clossys:specimen-health-request" as const;
export const SPECIMEN_HEALTH_VERSION = 1 as const;

/** The measured fields, in card order. `errors` counts every source below. */
export const SPECIMEN_HEALTH_FIELDS = ["errors", "loadMs", "lcpMs", "cls", "longTasks", "weight.jsBytes", "weight.cssBytes"] as const;
export type SpecimenHealthField = (typeof SPECIMEN_HEALTH_FIELDS)[number];

/** Where an error came from: the record or build (before the page ran), or the page itself. */
export const SPECIMEN_ERROR_SOURCES = ["record", "build", "render", "recoverable", "error", "unhandledrejection", "console", "resource"] as const;
export type SpecimenErrorSource = (typeof SPECIMEN_ERROR_SOURCES)[number];

export interface SpecimenHealthError {
  readonly source: SpecimenErrorSource | (string & {});
  readonly message: string;
  /** Milliseconds since the page started. */
  readonly atMs: number;
}

export interface SpecimenHealthMessage {
  readonly type: typeof SPECIMEN_HEALTH_MESSAGE_TYPE;
  readonly version: typeof SPECIMEN_HEALTH_VERSION;
  /** 1 for the first message after load; increases with every update. */
  readonly sequence: number;
  readonly element: string;
  readonly elementVersion: number | null;
  /** visual, text, data, media, flow; `unknown` when the record was not found. */
  readonly kind: string;
  /** `<theme id>:<light|dark>`, `none:<mode>` without a theme. */
  readonly theme: string;
  readonly width: number | null;
  /** `items` keeps the first 20; `count` is the total. */
  readonly errors: { readonly count: number; readonly items: readonly SpecimenHealthError[] };
  /** Navigation start to the load event. */
  readonly loadMs: number | null;
  /** Largest contentful paint; null when the page painted no contentful element. */
  readonly lcpMs: number | null;
  /** Cumulative layout shift. */
  readonly cls: number;
  readonly longTasks: { readonly count: number; readonly totalMs: number };
  /** Transferred bytes of scripts and stylesheets the page loaded. */
  readonly weight: { readonly jsBytes: number; readonly cssBytes: number };
  /** Milliseconds since the page started, when this message was sent. */
  readonly atMs: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const isNullableCount = (value: unknown) => value === null || isCount(value);

/** True when `value` is a health message of this contract version. */
export function isSpecimenHealthMessage(value: unknown): value is SpecimenHealthMessage {
  return parseSpecimenHealthMessage(value).ok;
}

export type SpecimenHealthParse = { ok: true; message: SpecimenHealthMessage } | { ok: false; problems: string[] };

/** Validate a posted message field by field, naming each problem. */
export function parseSpecimenHealthMessage(value: unknown): SpecimenHealthParse {
  if (!isRecord(value)) return { ok: false, problems: ["message is not an object"] };
  const problems: string[] = [];
  if (value.type !== SPECIMEN_HEALTH_MESSAGE_TYPE) problems.push("type");
  if (value.version !== SPECIMEN_HEALTH_VERSION) problems.push("version");
  if (!(Number.isInteger(value.sequence) && (value.sequence as number) >= 1)) problems.push("sequence");
  if (typeof value.element !== "string" || !value.element) problems.push("element");
  if (!(value.elementVersion === null || (Number.isInteger(value.elementVersion) && (value.elementVersion as number) > 0))) problems.push("elementVersion");
  if (typeof value.kind !== "string") problems.push("kind");
  if (typeof value.theme !== "string") problems.push("theme");
  if (!isNullableCount(value.width)) problems.push("width");
  const errors = value.errors;
  if (!isRecord(errors) || !isCount(errors.count) || !Array.isArray(errors.items)
    || !errors.items.every(item => isRecord(item) && typeof item.source === "string" && typeof item.message === "string" && isCount(item.atMs))) problems.push("errors");
  if (!isNullableCount(value.loadMs)) problems.push("loadMs");
  if (!isNullableCount(value.lcpMs)) problems.push("lcpMs");
  if (!isCount(value.cls)) problems.push("cls");
  if (!isRecord(value.longTasks) || !isCount(value.longTasks.count) || !isCount(value.longTasks.totalMs)) problems.push("longTasks");
  if (!isRecord(value.weight) || !isCount(value.weight.jsBytes)) problems.push("weight.jsBytes");
  if (!isRecord(value.weight) || !isCount(value.weight.cssBytes)) problems.push("weight.cssBytes");
  if (!isCount(value.atMs)) problems.push("atMs");
  return problems.length ? { ok: false, problems } : { ok: true, message: value as unknown as SpecimenHealthMessage };
}

/** The value of one measured field, for a card row. */
export function specimenHealthValue(message: SpecimenHealthMessage, field: SpecimenHealthField): number | null {
  switch (field) {
    case "errors": return message.errors.count;
    case "longTasks": return message.longTasks.count;
    case "weight.jsBytes": return message.weight.jsBytes;
    case "weight.cssBytes": return message.weight.cssBytes;
    default: return message[field];
  }
}
