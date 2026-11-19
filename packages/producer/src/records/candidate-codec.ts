/**
 * The one candidate codec (foundry-build-0048 U13 r4): how a clossys.candidate/1 file is read and written.
 *
 * - `candidateCodec.parse(name, bytes)`: the header (undefined when the bytes carry none), the view the kind rules
 *   read (records/slot-current.ts candidateView: the candidate without its header, the header's source where the
 *   int2 rules read it), and the content and Markdown front fields a writer transforms (`clossys reissue`).
 * - `candidateCodec.serialize`: records/candidate.ts serializeCandidate.
 * - `candidateCodec.headered` (`recutCandidateBytes`): int2 bytes as a headered candidate/1 file, its source moved
 *   into the header and every other field kept; a file that already carries a header is re-addressed to its slot.
 *   Submit (records/slot-write.ts writeCandidate), migrate, recut, reissue and seat write headers only through it.
 *
 * Readers that render or publish a candidate consume its view or content, never its raw bytes, so the header never
 * reaches a page.
 */
import { buildCandidateHeader, parseCandidateName, serializeCandidate, targetSchema } from "./candidate.js";
import { parseYamlSubset, validateAgainst } from "./schema.js";
import { parseFrontmatter } from "./slot-model/frontmatter.js";
import { candidateHeaderOf, candidateView } from "./slot-current.js";
import { PAGE_SCHEMA, PUBLICATION_SCHEMA } from "./slot-model/types.js";
import type { AgentId, CandidateHeader, Iso } from "./types.js";

/** The command a header created by `clossys migrate recut` names (the default creator of recutCandidateBytes). */
export const RECUT_HEADER_CLI = "clossys migrate recut";
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const FRONT = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/;
const SVG_META = /<metadata[^>]*>([\s\S]*?)<\/metadata>/;

export interface HeaderContext {
  readonly agent: AgentId;
  readonly slotId: string;
  readonly at: Iso;
  readonly version: string;
  /** Where the bytes came from, relative to the consumer folder: the source ref of a derived header. */
  readonly sourceRef: string;
  /** The slot id a moved candidate (or a routed library cell) left: its int2 `slot` field follows it to `slotId`. */
  readonly movedFrom?: string;
  /** The command a new header names as its creator (default this recut; `clossys migrate slots` passes its own). */
  readonly cli?: string;
}

/**
 * The first int2 source of `values` that is present, as it is; else a derived source naming `fallback`. The
 * header check (`checked`) fails the file when the candidate/1 source cannot hold it: never a silent derived.
 */
function sourceOf(values: readonly unknown[], fallback: string): CandidateHeader["source"] {
  for (const value of values) if (value !== undefined) return value as CandidateHeader["source"];
  return { kind: "derived", ref: [fallback] };
}

/** A Markdown front matter's fields: the int2 `key: <JSON>` lines exactly, else the YAML subset (which throws on what it cannot read). */
function frontFields(name: string, text: string, match: RegExpExecArray): { fields: Record<string, unknown>; body: string } | undefined {
  const exact = parseFrontmatter(text);
  if (exact.ok) return { fields: { ...exact.value.fields }, body: exact.value.body };
  let front: unknown;
  try { front = parseYamlSubset(match[1] ?? ""); } catch (error) { throw new Error(`${name}: its front matter cannot be read (${(error as Error).message}); not rewritten`); }
  return object(front) ? { fields: front, body: text.slice(match[0].length) } : undefined;
}

function checked(header: CandidateHeader, name: string): CandidateHeader {
  const issues = validateAgainst(targetSchema("candidate"), header);
  if (issues.length) throw new Error(`${name}: the recut header is not a valid clossys.candidate/1: ${issues.slice(0, 3).map(issue => `${issue.path} ${issue.message}`).join("; ")}`);
  return header;
}

/**
 * The bytes of a candidate under the recut: the existing candidate/1 header re-addressed to the slot it now
 * sits in, or a new one created by this command; the body is never changed.
 */
export function recutCandidateBytes(name: string, text: string, context: HeaderContext, int2?: { readonly source?: unknown }): string {
  const parts = parseCandidateName(name);
  if (!parts) throw new Error(`${name} is not a candidate file name (<name>-v<n>.md|json|svg)`);
  const id = `${context.agent}/${context.slotId}/${name}`;
  const slot = `${context.agent}/${context.slotId}`;
  const fresh = (source: CandidateHeader["source"]) => checked(buildCandidateHeader({
    agent: context.agent, slotId: context.slotId, name, status: "submitted",
    createdBy: { actor: "code", cli: context.cli ?? RECUT_HEADER_CLI, version: context.version }, createdAt: context.at, source,
  }), name);
  const readdressed = (header: Record<string, unknown>) => checked({ ...header, id, agent: context.agent, slot } as unknown as CandidateHeader, name);
  const current = (header: unknown) => object(header) && header.schema === "clossys.candidate/1" && header.id === id && header.slot === slot && header.agent === context.agent;
  // The int2 `slot` field names the slot the file sits in: on a move it follows the candidate, as the header does.
  // Any other value is kept as it is, for the kind rules to judge.
  const follows = (fields: Record<string, unknown>) => context.movedFrom !== undefined && fields.slot === context.movedFrom ? { ...fields, slot: context.slotId } : fields;

  if (parts.ext === "md") {
    const match = FRONT.exec(text);
    const front = match ? frontFields(name, text, match) : undefined;
    if (front && "clossys" in front.fields) {
      const { clossys, ...rest } = front.fields;
      if (current(clossys)) return text;
      if (!object(clossys)) throw new Error(`${name}: the clossys front matter is not an object`);
      return serializeCandidate(name, readdressed(clossys), front.body, follows(rest));
    }
    // The int2 front matter: its source moves into the header, every other field stays beside it.
    if (front) {
      const { source, ...rest } = front.fields;
      return serializeCandidate(name, fresh(sourceOf([source, int2?.source], context.sourceRef)), front.body, follows(rest));
    }
    return serializeCandidate(name, fresh(sourceOf([int2?.source], context.sourceRef)), text);
  }
  if (parts.ext === "json") {
    const doc = JSON.parse(text) as unknown;
    if (object(doc) && object(doc.clossys)) {
      if (Object.keys(doc).some(key => key !== "clossys" && key !== "content")) throw new Error(`${name}: holds keys beside clossys and content; not rewritten`);
      if (current(doc.clossys)) return text;
      const content = object(doc.content) && object(doc.content.meta) ? { ...doc.content, meta: follows(doc.content.meta) } : doc.content;
      return serializeCandidate(name, readdressed(doc.clossys), content);
    }
    // A Publisher page or publication record (clossys.page/1, clossys.publication/1) is the record today's install,
    // projector and slot check read: kept as is.
    if (context.agent === "publisher" && object(doc) && (doc.schema === PAGE_SCHEMA || doc.schema === PUBLICATION_SCHEMA)) return text;
    if (object(doc) && typeof doc.schema === "string") throw new Error(`${name}: a top-level schema key (${doc.schema}) is a record, not an int2 candidate`);
    let content: unknown = doc;
    const sources: unknown[] = [int2?.source];
    if (object(doc) && "meta" in doc) {
      const meta = object(doc.meta) ? doc.meta : undefined;
      const element = meta && object(meta.element) ? meta.element : undefined;
      sources.push(meta?.source, element?.source);
      // Only meta.source moves into the header; the rest of meta stays in the content, where the candidate view reads it.
      if (meta) {
        const { source: _moved, ...kept } = meta;
        content = Object.keys(kept).length ? { ...doc, meta: follows(kept) } : Object.fromEntries(Object.entries(doc).filter(([key]) => key !== "meta"));
      }
    } else if (object(doc) && Object.keys(doc).length === 1 && "content" in doc) content = doc.content;
    return serializeCandidate(name, fresh(sourceOf(sources, context.sourceRef)), content);
  }
  const meta = SVG_META.exec(text);
  if (meta) {
    let value: unknown;
    try { value = JSON.parse(meta[1] ?? ""); } catch { throw new Error(`${name}: an SVG <metadata> that is not the clossys header; not rewritten`); }
    if (!object(value) || !object(value.clossys)) throw new Error(`${name}: an SVG <metadata> that is not the clossys header; not rewritten`);
    if (current(value.clossys)) return text;
    return text.replace(meta[0], `<metadata>${JSON.stringify({ clossys: readdressed(value.clossys) })}</metadata>`);
  }
  return serializeCandidate(name, fresh(sourceOf([int2?.source], context.sourceRef)), text);
}


/** A candidate file as the codec reads it. */
export interface ParsedCandidate {
  /** The clossys.candidate/1 header; undefined for bytes that carry none (an int2 candidate, a page/1 record). */
  readonly header?: CandidateHeader;
  /** What the kind rules read (candidateView): the bytes themselves when there is no header. */
  readonly view: string;
  /** JSON: the `content` value as two-space JSON text; Markdown: the body; SVG: the document without the header. */
  readonly content: string;
  /** A Markdown candidate's own front matter fields beside the header. */
  readonly front: Readonly<Record<string, unknown>>;
}

/** Read one candidate file: header, view, content and front fields. Bytes with no header are their own view and content. */
function parse(name: string, bytes: string): ParsedCandidate {
  const header = candidateHeaderOf(name, bytes) as CandidateHeader | undefined;
  if (!header) return { view: bytes, content: bytes, front: {} };
  const view = candidateView(name, bytes);
  if (name.endsWith(".json")) {
    const doc = JSON.parse(bytes) as { content?: unknown };
    return { header, view, content: `${JSON.stringify(doc.content ?? null, null, 2)}\n`, front: {} };
  }
  if (name.endsWith(".md")) {
    const match = FRONT.exec(bytes);
    const read = match ? frontFields(name, bytes, match) : undefined;
    if (!read) return { header, view, content: bytes, front: {} };
    const { clossys: _header, ...front } = read.fields;
    return { header, view, content: read.body, front };
  }
  return { header, view, content: bytes.replace(SVG_META, "").replace(/\n\s*(?=\n)/, ""), front: {} };
}

/** The one candidate codec (see the file comment). */
export const candidateCodec = { parse, serialize: serializeCandidate, headered: recutCandidateBytes } as const;
