/**
 * The ref string of the CLI and prose (system.md section 5):
 * `<agent>/<slot-id>[/<candidate>][#<record>][:<Key>]`, where `<candidate>` is a consumer candidate
 * file name or `package:<name>-v<n>.<ext>` for the package default of that slot.
 *
 * Parsing checks the grammar only; whether the slot or candidate exists is the reader's job
 * (a ref that parses can still dangle).
 */
export const REF_AGENTS = ["director", "designer", "writer", "publisher", "producer"] as const;
export type RefAgent = typeof REF_AGENTS[number];

export const SLOT_ID = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*){1,3}$/;
export const REF_CANDIDATE = /^[a-z0-9][a-z0-9.-]*-v[1-9][0-9]*\.(md|json|svg)$/;
const RECORD = /^[a-z0-9][a-z0-9.-]*$/;
const KEY = /^[A-Za-z][A-Za-z0-9-]*$/;
export const PACKAGE_PREFIX = "package:";

export interface ParsedRef {
  readonly agent: RefAgent;
  readonly slot: string;
  /** The candidate file name (without the `package:` prefix). */
  readonly candidate?: string;
  /** True when the candidate segment is `package:<name>`: the package default of that slot. */
  readonly packageDefault?: boolean;
  readonly record?: string;
  readonly key?: string;
}

export class RefError extends Error {
  readonly exitCode = 2;
  constructor(readonly ref: string, reason: string) {
    super(`Invalid ref ${JSON.stringify(ref)}: ${reason}`);
    this.name = "RefError";
  }
}

export function parseRef(ref: string): ParsedRef {
  let rest = ref, key: string | undefined, record: string | undefined;
  const colon = rest.lastIndexOf(":");
  // `package:` inside the candidate segment is not a key separator.
  if (colon >= 0 && !rest.slice(0, colon + 1).endsWith(PACKAGE_PREFIX)) {
    key = rest.slice(colon + 1);
    rest = rest.slice(0, colon);
    if (!KEY.test(key)) throw new RefError(ref, `key ${JSON.stringify(key)} is not a Director key`);
  }
  const hash = rest.indexOf("#");
  if (hash >= 0) {
    record = rest.slice(hash + 1);
    rest = rest.slice(0, hash);
    if (!RECORD.test(record)) throw new RefError(ref, `record ${JSON.stringify(record)} is not a record key`);
  }
  const parts = rest.split("/");
  if (parts.length < 2 || parts.length > 3) throw new RefError(ref, "expected <agent>/<slot-id>[/<candidate>]");
  const [agent, slot, candidate] = parts as [string, string, string | undefined];
  if (!(REF_AGENTS as readonly string[]).includes(agent)) throw new RefError(ref, `agent must be one of ${REF_AGENTS.join(", ")}`);
  if (!SLOT_ID.test(slot)) throw new RefError(ref, `slot id ${JSON.stringify(slot)} does not match ${SLOT_ID.source}`);
  let file: string | undefined, packageDefault = false;
  if (candidate !== undefined) {
    packageDefault = candidate.startsWith(PACKAGE_PREFIX);
    file = packageDefault ? candidate.slice(PACKAGE_PREFIX.length) : candidate;
    if (!REF_CANDIDATE.test(file)) throw new RefError(ref, `candidate ${JSON.stringify(candidate)} is not <name>-v<n>.<ext>`);
  }
  return {
    agent: agent as RefAgent, slot,
    ...(file !== undefined ? { candidate: file } : {}), ...(packageDefault ? { packageDefault: true } : {}),
    ...(record !== undefined ? { record } : {}), ...(key !== undefined ? { key } : {}),
  };
}

export function formatRef(ref: ParsedRef): string {
  const candidate = ref.candidate === undefined ? "" : `/${ref.packageDefault ? PACKAGE_PREFIX : ""}${ref.candidate}`;
  return `${ref.agent}/${ref.slot}${candidate}${ref.record ? `#${ref.record}` : ""}${ref.key ? `:${ref.key}` : ""}`;
}
