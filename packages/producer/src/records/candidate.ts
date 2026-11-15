/**
 * Target candidate files (system.md 4, 6.2; 14.1, 14.6): one immutable file per option of a slot, with a
 * `clossys.candidate/1` header that records where it came from.
 *
 * - JSON: a top-level `clossys` object beside `content`.
 * - Markdown: the `clossys` key of the YAML front matter.
 * - SVG: the JSON `{ "clossys": ... }` inside `<metadata>`.
 *
 * `createdBy` is never typed by hand: an agent actor carries the package-relative skill path and the sha256
 * of that skill file as installed; a package actor carries the version read from the installed
 * `package.json`. A candidate file is written once (`writeCandidateFile` refuses an existing name).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { packagePath } from "../package-path.js";
import { sha256Hex } from "./hash.js";
import { readRecordHeader, validateAgainst, type JsonSchema } from "./schema.js";
import type { Actor, AgentId, CandidateHeader, CandidateName, Iso, Ref, Sha256, SlotId, Tier } from "./types.js";

export const TARGET_AGENTS: readonly AgentId[] = ["director", "designer", "writer", "publisher", "producer"];
export const SLOT_ID = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*){1,3}$/;
export const CANDIDATE_NAME = /^([a-z0-9][a-z0-9.-]*)-v([1-9][0-9]*)\.(md|json|svg)$/;
export const SHA256 = /^[0-9a-f]{64}$/;
export const ISO = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$/;

/** packages/producer/ (src/records/ and dist/records/ both sit two levels below it). */
const PRODUCER_PACKAGE = fileURLToPath(new URL("../..", import.meta.url));
const schemaCache = new Map<string, JsonSchema>();

/** A JSON Schema shipped in packages/producer/schemas/ (`candidate`, `pin`, `pin-map`, ...). */
export function targetSchema(name: string): JsonSchema {
  let schema = schemaCache.get(name);
  if (!schema) {
    schema = JSON.parse(readFileSync(join(PRODUCER_PACKAGE, "schemas", `${name}.json`), "utf8")) as JsonSchema;
    schemaCache.set(name, schema);
  }
  return schema;
}

export const isAgentId = (value: string): value is AgentId => (TARGET_AGENTS as readonly string[]).includes(value);

export interface CandidateNameParts { readonly name: string; readonly version: number; readonly ext: "md" | "json" | "svg" }

/** `home.hero-v3.json` -> { name: "home.hero", version: 3, ext: "json" }; undefined when not a candidate name. */
export function parseCandidateName(file: string): CandidateNameParts | undefined {
  const match = CANDIDATE_NAME.exec(file);
  if (!match) return undefined;
  return { name: match[1]!, version: Number(match[2]), ext: match[3] as CandidateNameParts["ext"] };
}

/** The consumer slot folder `clossys/agents/<agent>/<slot-id>/` under a workspace root. */
export function slotDir(root: string, agent: AgentId, slotId: SlotId): string {
  return join(root, "clossys", "agents", agent, slotId);
}

/** The consumer candidate file path. */
export function candidatePath(root: string, agent: AgentId, slotId: SlotId, name: CandidateName): string {
  return join(slotDir(root, agent, slotId), "candidates", name);
}

/**
 * Where a package ships its default candidates, relative to the package root: the Writer under `defaults/`
 * (the folder its package.json `files` ships), every other agent under `src/catalog/defaults/`.
 */
export function packageDefaultsRel(agent: AgentId): string {
  return agent === "writer" ? "defaults" : "src/catalog/defaults";
}

/**
 * The installed package folder that holds the package default candidates of one slot: Producer loop
 * versions under `loops/<slot-id>/` (where the package ships them), every other agent under
 * `<packageDefaultsRel>/<slot-id>/`.
 */
export function packageDefaultDir(root: string, agent: AgentId, slotId: SlotId): string {
  const rel = agent === "producer" ? `packages/producer/loops/${slotId}` : `packages/${agent}/${packageDefaultsRel(agent)}/${slotId}`;
  return packagePath(root, rel);
}

/** The installed version of `@clossys/<agent>` as its package.json states it (system.md 14.6); undefined when not installed. */
export function installedPackageVersion(root: string, agent: AgentId): string | undefined {
  const file = packagePath(root, `packages/${agent}/package.json`);
  if (!existsSync(file)) return undefined;
  const version = (JSON.parse(readFileSync(file, "utf8")) as { version?: unknown }).version;
  return typeof version === "string" && version.length > 0 ? version : undefined;
}

/** The package that owns a package-relative path `packages/<agent>/...`. */
function owningAgent(rel: string): AgentId | undefined {
  const match = /^packages\/([a-z]+)\//.exec(rel);
  return match && isAgentId(match[1]!) ? match[1] : undefined;
}

export type CandidateActorInput =
  | { readonly actor: "agent"; readonly agent: AgentId; readonly skill: string; readonly model: string; readonly tier: Tier }
  | { readonly actor: "package"; readonly agent: AgentId }
  | { readonly actor: "owner" | "planner"; readonly ref: string };

/**
 * The `createdBy` of a new candidate. An agent's skill is a package-relative path (`packages/<agent>/actions/<step>/skill.md`)
 * whose sha256 is read from the installed file; a package actor's version is read from the installed package.json.
 * Throws when the skill file or package is not installed: a header never records a guessed digest or version.
 */
export function candidateCreatedBy(root: string, input: CandidateActorInput): Actor {
  if (input.actor === "agent") {
    if (!owningAgent(input.skill)) throw new Error(`createdBy.skill must be a package-relative path packages/<agent>/..., got ${input.skill}`);
    const file = packagePath(root, input.skill);
    if (!existsSync(file)) throw new Error(`createdBy.skill ${input.skill} is not installed (looked at ${file})`);
    return { actor: "agent", agent: input.agent, skill: input.skill, skillSha256: sha256Hex(readFileSync(file)), model: input.model, tier: input.tier };
  }
  if (input.actor === "package") {
    const version = installedPackageVersion(root, input.agent);
    if (!version) throw new Error(`@clossys/${input.agent} is not installed: no version to record`);
    return { actor: "package", package: `@clossys/${input.agent}`, version };
  }
  return { actor: input.actor, ref: input.ref };
}

export interface NewCandidateHeader {
  readonly agent: AgentId;
  readonly slotId: SlotId;
  readonly name: CandidateName;
  readonly createdBy: Actor;
  readonly createdAt: Iso;
  readonly status?: CandidateHeader["status"];
  readonly record?: string;
  readonly briefSha256?: Sha256;
  readonly refs?: Ref[];
  readonly source: CandidateHeader["source"];
  readonly rationale?: CandidateHeader["rationale"];
  /** A package default is addressed as `package:<name>` in its id (system.md 5). */
  readonly packageDefault?: boolean;
}

/** A complete candidate header, in schema key order. */
export function buildCandidateHeader(input: NewCandidateHeader): CandidateHeader {
  return {
    schema: "clossys.candidate/1",
    id: `${input.agent}/${input.slotId}/${input.packageDefault ? "package:" : ""}${input.name}`,
    agent: input.agent,
    kind: "candidate",
    status: input.status ?? "submitted",
    slot: `${input.agent}/${input.slotId}`,
    ...(input.record !== undefined ? { record: input.record } : {}),
    ...(input.briefSha256 !== undefined ? { briefSha256: input.briefSha256 } : {}),
    createdBy: input.createdBy,
    createdAt: input.createdAt,
    refs: input.refs ?? [],
    source: input.source,
    rationale: input.rationale ?? [],
  };
}

/**
 * The bytes of a candidate file: `content` is the JSON `content` value, the Markdown body, or the SVG document
 * (which must not already carry a `<metadata>` element).
 */
export function serializeCandidate(name: CandidateName, header: CandidateHeader, content: unknown): string {
  const parts = parseCandidateName(name);
  if (!parts) throw new Error(`not a candidate file name: ${name}`);
  if (parts.ext === "json") return `${JSON.stringify({ clossys: header, content }, null, 2)}\n`;
  if (typeof content !== "string") throw new Error(`${name}: ${parts.ext} content must be text`);
  if (parts.ext === "md") return `---\nclossys: ${JSON.stringify(header)}\n---\n${content}`;
  if (/<metadata[\s>]/.test(content)) throw new Error(`${name}: the SVG already has a <metadata> element`);
  const open = /<svg\b[^>]*>/.exec(content);
  if (!open) throw new Error(`${name}: no <svg> element`);
  const at = open.index + open[0].length;
  return `${content.slice(0, at)}\n  <metadata>${JSON.stringify({ clossys: header })}</metadata>${content.slice(at)}`;
}

/** Writes a new candidate file. Refuses an existing file: a candidate is never edited (system.md 7). */
export function writeCandidateFile(file: string, bytes: string): Sha256 {
  if (existsSync(file)) throw new Error(`candidate ${file} already exists: candidates are immutable, write a new -v<n>`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, bytes, { flag: "wx" });
  return sha256Hex(bytes);
}

export interface CandidateFile {
  readonly file: string;
  readonly name: CandidateName;
  readonly sha256: Sha256;
  readonly header?: CandidateHeader;
  readonly issues: readonly string[];
}

/**
 * Reads one candidate file and checks its header: schema `clossys.candidate/1`, and `id`, `agent`, `slot`
 * (and `record`, for a record-keyed name) matching where the file sits.
 */
export function readCandidateFile(file: string, expect: { agent: AgentId; slotId: SlotId; packageDefault?: boolean }): CandidateFile {
  const name = file.split(/[\\/]/).pop()!;
  const bytes = readFileSync(file);
  const sha256 = sha256Hex(bytes);
  const issues: string[] = [];
  if (!parseCandidateName(name)) issues.push(`${name} is not a candidate file name (<name>-v<n>.md|json|svg)`);
  let header: CandidateHeader | undefined;
  try {
    const raw = readRecordHeader(name, bytes.toString("utf8"));
    for (const issue of validateAgainst(targetSchema("candidate"), raw)) issues.push(`header ${issue.path}: ${issue.message}`);
    header = raw as CandidateHeader;
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }
  if (header && issues.length === 0) {
    const id = `${expect.agent}/${expect.slotId}/${expect.packageDefault ? "package:" : ""}${name}`;
    if (header.id !== id) issues.push(`header id ${header.id} does not match the file (${id})`);
    if (header.agent !== expect.agent) issues.push(`header agent ${header.agent} is not ${expect.agent}`);
    if (header.slot !== `${expect.agent}/${expect.slotId}`) issues.push(`header slot ${header.slot} is not ${expect.agent}/${expect.slotId}`);
    if (expect.packageDefault && header.createdBy.actor !== "package") issues.push(`a package default is created by the package, not ${header.createdBy.actor}`);
  }
  return { file, name, sha256, ...(header ? { header } : {}), issues };
}
