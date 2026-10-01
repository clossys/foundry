/**
 * What the dev-only pack-review page and its export route show, decided
 * without Next.js.
 *
 * `packReviewGate` is the one gate for both: it is open only when
 * `SITE_TARGET` is `development` or `test`, the hosting environment
 * (`VERCEL_ENV`) is absent or `development`, and `NODE_ENV` is absent,
 * `development` or `test`. It never throws: a `SITE_TARGET` that is absent,
 * unlisted or unknown is closed, so the caller ends in `notFound` and never
 * in a 500 raised here.
 *
 * `resolvePackReviewPage` and `resolvePackReviewExport` check the gate first
 * and return `not-found` before they call any loader, so a closed gate reads
 * no record and no file. Neither takes a path from a request: the export
 * route's `name` is only looked up among the ids the review index lists, and
 * the file read is the path the index lists for that id. A manifest that
 * cannot be loaded, or that the review index refuses, is `unavailable` on the
 * page and `not-found` on the export route, with no reason: the loader's
 * error names a path and an index finding names a position, and neither is
 * shown.
 *
 * `resolvePackReviewSections` builds the strategy brief, the brand kit and
 * the voice and copy the same way: the gate first, then one loader per
 * record, each validated by the package that owns its contract
 * (`validateStrategyContract` and `readEngagementContextFromBriefData` from
 * Strategist, `parseVoiceRecord` from Writer). A record whose loader throws,
 * or that its owner's check refuses, is absent, never a reason to fail the
 * page, and a section with no record is left out for the view's empty label.
 *
 * Server-only in practice (the loaders read files), but it imports no `next`
 * module and no record.
 */
import { buildPackReviewIndex } from "@clossys/publisher/pack";
import type { PackManifest, PackReviewInput } from "@clossys/publisher/pack";
import type {
  PackReviewViewBrandKit,
  PackReviewViewExport,
  PackReviewViewFact,
  PackReviewViewFaqItem,
  PackReviewViewPage,
  PackReviewViewStrategy,
  PackReviewViewVoice,
} from "@clossys/publisher/web";
import { ENGAGEMENT_CONTEXT_FIELD_IDS, readEngagementContextFromBriefData, validateStrategyContract } from "@clossys/strategist";
import {
  MESSAGING_BOILERPLATE_LONG_COPY_ID,
  MESSAGING_BOILERPLATE_MEDIUM_COPY_ID,
  MESSAGING_BOILERPLATE_SHORT_COPY_ID,
  MESSAGING_PITCH_ELEVATOR_COPY_ID,
  MESSAGING_PITCH_ONE_LINER_COPY_ID,
  MESSAGING_PITCH_PARAGRAPH_COPY_ID,
  SITE_TAGLINE_COPY_ID,
} from "@clossys/writer";
import type { CopyResolver } from "@clossys/writer";
import { parseVoiceRecord } from "@clossys/writer/voice";
import type { PackReviewText } from "./pack-review-copy";
import { packReviewAvailable, packReviewHref, resolveSiteTarget } from "./site-wiring";

export type PackReviewPageModel =
  | { kind: "not-found" }
  | { kind: "unavailable" }
  | { kind: "review"; pages: PackReviewViewPage[]; exports: PackReviewViewExport[] };

/** The process environment, or a stand-in: only `SITE_TARGET`, `VERCEL_ENV` and `NODE_ENV` are read. */
export type PackReviewEnv = Readonly<Record<string, string | undefined>>;

/** The hosting values that mean a real deployment; `VERCEL_ENV` is also closed for any value that is not `development`. */
const HOSTED_ENVIRONMENTS: readonly string[] = ["production", "preview"];

/** The `NODE_ENV` values that may serve the review; absent is allowed too, and every other value (an empty string included) is closed. */
const DEVELOPMENT_NODE_ENVS: readonly string[] = ["development", "test"];

/**
 * Whether the review may be served at all. All three must hold: `SITE_TARGET`
 * is `development` or `test` (`packReviewAvailable`); `VERCEL_ENV` is absent
 * or `development`, so a deployment that carries a development `SITE_TARGET`
 * by mistake still refuses on `production` and `preview`; and `NODE_ENV` is
 * absent, `development` or `test`, so a self-hosted production build, which
 * sets no `VERCEL_ENV`, refuses too. Any other `VERCEL_ENV` or `NODE_ENV`
 * value is closed, and a `SITE_TARGET` that `resolveSiteTarget` refuses is
 * closed, not an error.
 */
export function packReviewGate(env: PackReviewEnv): boolean {
  const mode = env["NODE_ENV"];
  if (mode !== undefined && !DEVELOPMENT_NODE_ENVS.includes(mode)) return false;
  const hosting = env["VERCEL_ENV"];
  if (hosting !== undefined && (HOSTED_ENVIRONMENTS.includes(hosting) || hosting !== "development")) return false;
  try {
    return packReviewAvailable(resolveSiteTarget(env));
  } catch {
    return false;
  }
}

export interface PackReviewPageInput extends PackReviewInput {
  env: PackReviewEnv;
  /** Reads the pack manifest. Called only when the gate is open. */
  loadManifest: () => unknown;
}

/** The same-site address of an export on the export route. The id comes from the review index. */
export function packReviewExportHref(id: string): string {
  return `/pack/export?name=${encodeURIComponent(id)}`;
}

export function resolvePackReviewPage(input: PackReviewPageInput): PackReviewPageModel {
  if (!packReviewGate(input.env)) return { kind: "not-found" };

  let result: ReturnType<typeof buildPackReviewIndex>;
  try {
    result = buildPackReviewIndex(input.loadManifest() as PackManifest, { routes: input.routes, states: input.states });
  } catch {
    return { kind: "unavailable" };
  }
  if (!result.ok) return { kind: "unavailable" };

  return {
    kind: "review",
    pages: result.index.pages.map((page) => ({
      id: page.id,
      href: packReviewHref(page.id),
      status: page.status,
      states: page.states.map((state) => ({ id: state, href: packReviewHref(page.id, state) })),
    })),
    exports: result.index.exports.map((entry) => ({ ...entry, href: packReviewExportHref(entry.id) })),
  };
}

export interface PackReviewSectionsInput {
  env: PackReviewEnv;
  /** Reads `clossys/strategist/contract.json`. Called only when the gate is open; a throw means it is absent. */
  loadStrategyContract: () => unknown;
  /** Reads `clossys/brief.json`. Called only when the gate is open; a throw means it is absent. */
  loadEngagementBrief: () => unknown;
  /** Reads `clossys/writer/voice.json`. Called only when the gate is open; a throw means it is absent. */
  loadVoiceRecord: () => unknown;
  /** Reads the brand file's declarations. Called only when the gate is open; a throw means it is absent. */
  loadBrandDeclarations: () => Readonly<Record<string, string>>;
  /** The approved-copy resolver for the site's target, over the repository's copy registry. */
  resolveCopy: CopyResolver;
  /** Every id in the copy registry, in registry order; the FAQ is read from these. */
  copyIds: readonly string[];
  brand: { label: string; entity: string; canonicalOrigin: string; taglineCopyId: string | undefined };
  /** The review's exports, as `resolvePackReviewPage` listed them; brand assets are taken from these. */
  exports: readonly PackReviewViewExport[];
  text: PackReviewText;
}

export interface PackReviewSections {
  strategy?: PackReviewViewStrategy;
  brandKit?: PackReviewViewBrandKit;
  voice?: PackReviewViewVoice;
}

/** The export kinds the brand kit lists as assets. */
const BRAND_ASSET_KINDS: ReadonlySet<string> = new Set(["logo", "favicon", "app-icon"]);

/** The faces the type specimen sets, in this order, when the brand file declares them. */
const SPECIMEN_FACES: readonly string[] = ["--font-display", "--font-body", "--font-mono"];

/** A FAQ question's copy id; its answer is the same id ending in `.answer`. */
const FAQ_QUESTION_ID = /^faq\.([a-z0-9]+(?:-[a-z0-9]+)*)\.question$/;

function attempt<T>(read: () => T | undefined): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

function present(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

function copyText(resolve: CopyResolver, id: string): string | undefined {
  const text = attempt(() => resolve({ id })?.text);
  return present(text) ? text : undefined;
}

function strategySection(input: PackReviewSectionsInput): PackReviewViewStrategy | undefined {
  const { sections } = input.text;
  const contract = attempt(() => {
    const result = validateStrategyContract(input.loadStrategyContract());
    return result.ok ? result.value : undefined;
  });
  const context = attempt(() => {
    const raw = input.loadEngagementBrief();
    const read = readEngagementContextFromBriefData(raw);
    const carried = typeof raw === "object" && raw !== null && (raw as { context?: unknown }).context !== undefined;
    return read.note === undefined && carried ? read.context : undefined;
  });
  if (contract === undefined && context === undefined) return undefined;

  const openQuestions: string[] = [];
  let summary: string | undefined;
  if (contract !== undefined) {
    for (const record of contract.records) {
      if (record.kind === "product" && summary === undefined) summary = record.summary;
      if (record.kind === "claim" && record.status === "hypothesis") openQuestions.push(`${sections.hypothesis}: ${record.assertion}`);
    }
  }
  const known: PackReviewViewFact[] = [];
  for (const id of ENGAGEMENT_CONTEXT_FIELD_IDS) {
    if (context === undefined) break;
    const field = context.fields.find((entry) => entry.id === id);
    const words = sections.contextFields[id];
    if (field?.state === "known") known.push({ name: words.label, value: field.value });
    else openQuestions.push(words.question);
  }
  return {
    source: contract === undefined ? sections.strategySource.brief : sections.strategySource.contract,
    ...(present(summary) ? { summary } : {}),
    context: known,
    openQuestions,
  };
}

function brandKitSection(input: PackReviewSectionsInput): PackReviewViewBrandKit | undefined {
  const declarations = attempt(input.loadBrandDeclarations);
  if (declarations === undefined) return undefined;
  const { labels, sections } = input.text;
  const declared = Object.entries(declarations)
    .filter(([, value]) => present(value))
    .map(([name, value]) => ({ name, value: value.trim() }));
  const faces = SPECIMEN_FACES.flatMap((name) => declared.filter((entry) => entry.name === name));
  return {
    title: input.brand.label,
    usage: sections.brandUsage,
    assets: input.exports
      .filter((entry) => BRAND_ASSET_KINDS.has(entry.kind) && entry.href !== undefined)
      .map((entry) => ({ role: entry.id, href: entry.href as string, label: [labels.kinds[entry.kind], entry.path].join(", ") })),
    colors: declared.filter((entry) => entry.name.startsWith("--color-")),
    type: declared.filter((entry) => entry.name.startsWith("--font-")),
    facts: [
      { name: sections.brandFacts.brand, value: input.brand.label },
      { name: sections.brandFacts.entity, value: input.brand.entity },
      { name: sections.brandFacts.origin, value: input.brand.canonicalOrigin },
    ],
    ...(faces.length > 0 ? { specimen: { text: sections.specimen, faces } } : {}),
  };
}

function voiceSection(input: PackReviewSectionsInput): PackReviewViewVoice | undefined {
  const { sections } = input.text;
  const record = attempt(() => parseVoiceRecord(input.loadVoiceRecord()));
  const rules: PackReviewViewFact[] = [];
  if (record !== undefined) {
    const { person, tense, formality, tone } = record.rules;
    rules.push({ name: sections.voiceRules.person, value: person.description });
    rules.push({ name: sections.voiceRules.tense, value: tense.description });
    rules.push({ name: sections.voiceRules.formality, value: formality });
    if (tone.length > 0) rules.push({ name: sections.voiceRules.tone, value: tone.join(", ") });
  }
  const ladder = (rungs: ReadonlyArray<readonly [name: string, id: string]>): PackReviewViewFact[] =>
    rungs.flatMap(([name, id]) => {
      const value = copyText(input.resolveCopy, id);
      return value === undefined ? [] : [{ name, value }];
    });
  const tagline = copyText(input.resolveCopy, input.brand.taglineCopyId ?? SITE_TAGLINE_COPY_ID);
  const pitch = ladder([
    [sections.pitch.oneLiner, MESSAGING_PITCH_ONE_LINER_COPY_ID],
    [sections.pitch.elevator, MESSAGING_PITCH_ELEVATOR_COPY_ID],
    [sections.pitch.paragraph, MESSAGING_PITCH_PARAGRAPH_COPY_ID],
  ]);
  const boilerplate = ladder([
    [sections.boilerplate.short, MESSAGING_BOILERPLATE_SHORT_COPY_ID],
    [sections.boilerplate.medium, MESSAGING_BOILERPLATE_MEDIUM_COPY_ID],
    [sections.boilerplate.long, MESSAGING_BOILERPLATE_LONG_COPY_ID],
  ]);
  const faq: PackReviewViewFaqItem[] = input.copyIds.flatMap((id) => {
    const slug = FAQ_QUESTION_ID.exec(id)?.[1];
    if (slug === undefined) return [];
    const question = copyText(input.resolveCopy, id);
    const answer = copyText(input.resolveCopy, `faq.${slug}.answer`);
    return question === undefined || answer === undefined ? [] : [{ question, answer }];
  });
  if (record === undefined && tagline === undefined && pitch.length === 0 && boilerplate.length === 0 && faq.length === 0) return undefined;
  return { rules, ...(tagline === undefined ? {} : { tagline }), pitch, boilerplate, faq };
}

/**
 * The strategy brief, the brand kit and the voice and copy, each present only
 * when a record behind it is. The gate is checked first, and a closed gate
 * calls no loader and returns no section.
 *
 * - Strategy brief: the first product's summary and every hypothesis claim
 *   from the Strategist contract, and the engagement brief's context, with an
 *   unanswered field listed as an open question. Either record alone is
 *   enough; with neither, the section is absent.
 * - Brand kit: the brand file's color and type tokens, a type specimen over
 *   the display, body and mono faces it declares, the brand facts, and the
 *   review's logo, favicon and app-icon exports as assets, linked to the
 *   export route. Absent when the brand file cannot be read.
 * - Voice and copy: the voice record's rules; the tagline (the brand facts'
 *   first tagline, else `site.tagline`), the pitch and the boilerplate ladders
 *   (Writer's reserved messaging ids) and every `faq.<slug>.question` with its
 *   `faq.<slug>.answer`, each through the site's approved-copy resolver. An
 *   entry that does not resolve is left out; with nothing at all, the section
 *   is absent.
 */
export function resolvePackReviewSections(input: PackReviewSectionsInput): PackReviewSections {
  if (!packReviewGate(input.env)) return {};
  const strategy = strategySection(input);
  const brandKit = brandKitSection(input);
  const voice = voiceSection(input);
  return {
    ...(strategy === undefined ? {} : { strategy }),
    ...(brandKit === undefined ? {} : { brandKit }),
    ...(voice === undefined ? {} : { voice }),
  };
}

export type PackReviewExportModel =
  | { kind: "not-found" }
  | { kind: "file"; contentType: string; body: Uint8Array; inline: boolean };

export interface PackReviewExportInput {
  env: PackReviewEnv;
  /** The export's id as the request gave it; anything that is not an id of the index is `not-found`. */
  name: unknown;
  /** Reads the pack manifest. Called only when the gate is open. */
  loadManifest: () => unknown;
  /** Reads one output, by the path the index lists. Called only for a name the index lists. */
  loadOutput: (path: string) => Uint8Array;
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  ico: "image/x-icon",
  svg: "image/svg+xml",
  html: "text/html; charset=utf-8",
  txt: "text/plain; charset=utf-8",
};

function contentTypeOf(path: string): string | undefined {
  const name = path.split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  if (dot < 0) return undefined;
  const extension = name.slice(dot + 1).toLowerCase();
  return Object.hasOwn(CONTENT_TYPES, extension) ? CONTENT_TYPES[extension] : undefined;
}

/**
 * The bytes of one export, or `not-found`. The gate is checked first; then
 * the index is built from the manifest alone (no route, no state), and the
 * name must be one of its export ids. A manifest, index or file that cannot
 * be read is `not-found` with no reason. A type it does not list is served as
 * a download, never inline.
 */
export function resolvePackReviewExport(input: PackReviewExportInput): PackReviewExportModel {
  const notFound: PackReviewExportModel = { kind: "not-found" };
  if (!packReviewGate(input.env)) return notFound;
  if (typeof input.name !== "string" || input.name.length === 0 || input.name.length > 256) return notFound;

  try {
    const result = buildPackReviewIndex(input.loadManifest() as PackManifest, { routes: [], states: {} });
    if (!result.ok) return notFound;
    const entry = result.index.exports.find((candidate) => candidate.id === input.name);
    if (entry === undefined) return notFound;
    const contentType = contentTypeOf(entry.path);
    return { kind: "file", contentType: contentType ?? "application/octet-stream", body: input.loadOutput(entry.path), inline: contentType !== undefined };
  } catch {
    return notFound;
  }
}

/**
 * The route's `Response`. Both answers are `no-store` and `noindex`; a file
 * is `nosniff` and carries `Content-Security-Policy: sandbox`, so an HTML or
 * SVG export runs no script and has no origin of its own when it is opened.
 * A `not-found` has an empty body.
 */
export function packReviewExportResponse(model: PackReviewExportModel): Response {
  const headers: Record<string, string> = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };
  if (model.kind === "not-found") return new Response(null, { status: 404, headers });
  return new Response(model.body as BodyInit, {
    status: 200,
    headers: {
      ...headers,
      "Content-Type": model.contentType,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
      "Content-Disposition": model.inline ? "inline" : "attachment",
    },
  });
}
