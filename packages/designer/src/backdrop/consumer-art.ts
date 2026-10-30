import { TOKENS } from "../tokens/tokens.js";
import { BACKDROP_BUDGET_CEILING_BYTES, checkBackdropContract } from "./contract.js";
import type { BackdropCheckOptions, BackdropContract, BackdropReport } from "./contract.js";

/** Placement within the existing art seams; these are not catalog function axes. */
export type ConsumerArtPosition = "backdrop" | "media";
/** Fixed reserved geometry, independent of the consumer's brand. */
export type ConsumerArtAspect = "1:1" | "4:3" | "3:2" | "16:9";
/** Static raster formats for photographs; SVG uses token-painted path data. */
export type ConsumerArtFormat = "avif" | "webp" | "png" | "jpeg";
/** A consumer-authored SVG path. Paint names resolve through Designer's color registry. */
export interface ConsumerArtPath {
  d: string;
  fillToken: string;
  strokeToken?: string;
  strokeWidth?: number;
}
/** Inline vector geometry inherits live theme tokens; photos retain their source pixels. */
export type ConsumerArtSource =
  | { format: ConsumerArtFormat; src: string }
  | { format: "svg"; paths: readonly ConsumerArtPath[] };
interface ConsumerArtBase {
  /** Intrinsic pixels (or SVG viewBox units), integers from 1 through 8192. */
  width: number;
  height: number;
  aspect: ConsumerArtAspect;
  fit: "contain" | "cover";
  /** Transferred bytes declared by the consumer, at most the existing backdrop ceiling. */
  bytes: number;
  /** A registered --color-* name, not a CSS value. */
  backgroundToken: string;
  source: ConsumerArtSource;
}
/** Consumer repositories own the source and its rights; Clossys owns this slot contract. */
export type ConsumerArtContract = ConsumerArtBase & (
  | { slot: "media"; purpose: "meaningful"; alt: string; loading: "lazy" | "eager" }
  | { slot: "media"; purpose: "decorative"; alt: ""; loading: "lazy" | "eager" }
  | { slot: "backdrop"; purpose: "decorative"; alt: ""; loading: "lazy" | "eager" }
);
/** A declaration refused before rendering; paths refer to contract fields. */
export interface ConsumerArtFinding {
  path: string;
  message: string;
}
export interface ConsumerArtReport {
  ok: boolean;
  findings: ConsumerArtFinding[];
}

export type ImageBackdropContract = Extract<BackdropContract, { kind: "image" }>;
export type StillBackdropArt = Extract<ConsumerArtContract, { slot: "backdrop" }>;
export interface StillBackdropReport {
  ok: boolean;
  art: ConsumerArtReport;
  backdrop: BackdropReport;
  /** Mismatches between otherwise valid art and backdrop declarations. */
  findings: ConsumerArtFinding[];
}

const aspects: Record<ConsumerArtAspect, readonly [number, number]> = {
  "1:1": [1, 1], "4:3": [4, 3], "3:2": [3, 2], "16:9": [16, 9],
};
function dataRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return (proto === Object.prototype || proto === null) && Reflect.ownKeys(value).every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return typeof key === "string" && descriptor?.enumerable === true && "value" in descriptor;
  });
}
function positiveInteger(value: unknown, ceiling: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= ceiling;
}
function colorToken(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("--color-") && Object.hasOwn(TOKENS, value);
}
function sourceUrl(value: unknown): boolean {
  if (typeof value !== "string" || /[\s\\\u0000-\u001f\u007f]/.test(value)) return false;
  if (value.startsWith("/") && !value.startsWith("//")) return value.length > 1;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "";
  } catch { return false; }
}

const utf8 = new TextEncoder();

/** Checks plain declarations offline. It does not fetch bytes, measure rendered contrast, or certify rights. */
export function checkConsumerArtContract(value: unknown): ConsumerArtReport {
  const findings: ConsumerArtFinding[] = [];
  const fail = (path: string, message: string) => { findings.push({ path, message }); };
  const shape = (input: unknown, path: string, required: readonly string[], optional: readonly string[] = []): input is Record<string, unknown> => {
    if (!dataRecord(input)) { fail(path, "Expected a plain object of enumerable data fields."); return false; }
    for (const key of required) if (!Object.hasOwn(input, key)) fail(`${path}.${key}`, "Required field.");
    for (const key of Object.keys(input)) if (!required.includes(key) && !optional.includes(key)) fail(`${path}.${key}`, "Unsupported field.");
    return true;
  };
  try {
    if (shape(value, "art", ["slot", "purpose", "alt", "width", "height", "aspect", "fit", "loading", "bytes", "backgroundToken", "source"])) {
      const art = value;
      if (art.slot !== "backdrop" && art.slot !== "media") fail("art.slot", "Expected backdrop or media.");
      if (art.purpose !== "decorative" && art.purpose !== "meaningful") fail("art.purpose", "Declare decorative or meaningful.");
      if (art.slot !== "media" && art.purpose !== "decorative") fail("art.purpose", "Backdrops must be decorative.");
      if (typeof art.alt !== "string" || (art.purpose === "decorative" ? art.alt !== "" : art.alt.trim() === "")) fail("art.alt", "Decorative art needs empty alt; meaningful art needs descriptive alt.");
      if (!positiveInteger(art.width, 8192)) fail("art.width", "Expected an integer from 1 through 8192.");
      if (!positiveInteger(art.height, 8192)) fail("art.height", "Expected an integer from 1 through 8192.");
      const ratio = typeof art.aspect === "string" && Object.hasOwn(aspects, art.aspect) ? aspects[art.aspect as ConsumerArtAspect] : undefined;
      if (!ratio) fail("art.aspect", "Expected 1:1, 4:3, 3:2 or 16:9.");
      else if (typeof art.width === "number" && typeof art.height === "number" && art.width * ratio[1] !== art.height * ratio[0]) fail("art.aspect", "Intrinsic dimensions must match the declared aspect ratio.");
      if (art.fit !== "contain" && art.fit !== "cover") fail("art.fit", "Expected contain or cover.");
      if (art.slot !== "media" && art.fit !== "cover") fail("art.fit", "Backdrops must cover their layer.");
      if (art.loading !== "lazy" && art.loading !== "eager") fail("art.loading", "Declare lazy or eager loading for the art placement.");
      if (!positiveInteger(art.bytes, BACKDROP_BUDGET_CEILING_BYTES)) fail("art.bytes", "Declare transferred bytes from 1 through 2097152.");
      if (!colorToken(art.backgroundToken)) fail("art.backgroundToken", "Expected a registered color token name.");
      if (dataRecord(art.source) && art.source.format === "svg") {
        const source = art.source;
        shape(source, "art.source", ["format", "paths"]);
        const paths = source.paths;
        if (!Array.isArray(paths) || paths.length < 1 || paths.length > 256) fail("art.source.paths", "Expected 1 through 256 static paths.");
        else {
          for (let index = 0; index < paths.length; index++) {
            const field = `art.source.paths.${index}`;
            const descriptor = Object.getOwnPropertyDescriptor(paths, String(index));
            if (!descriptor || !("value" in descriptor)) { fail(field, "Expected a dense array of data paths."); continue; }
            const path: unknown = descriptor.value;
            if (!shape(path, field, ["d", "fillToken"], ["strokeToken", "strokeWidth"])) continue;
            if (typeof path.d !== "string" || path.d.length > 65536 || !/^[Mm][ \t\r\n\f\d.,+\-eEMmLlHhVvCcSsQqTtAaZz]*$/.test(path.d)) fail(`${field}.d`, "Expected bounded SVG path geometry starting with a move.");
            if (!colorToken(path.fillToken)) fail(`${field}.fillToken`, "Expected a registered color token name.");
            if (path.strokeToken !== undefined && !colorToken(path.strokeToken)) fail(`${field}.strokeToken`, "Expected a registered color token name.");
            if (path.strokeWidth !== undefined && (path.strokeToken === undefined || typeof path.strokeWidth !== "number" || !Number.isFinite(path.strokeWidth) || path.strokeWidth <= 0 || path.strokeWidth > 64)) fail(`${field}.strokeWidth`, "A stroke needs a token and a finite width greater than zero and at most 64.");
          }
          const content = paths.reduce((total: number, entry: unknown) => total + (dataRecord(entry) && typeof entry.d === "string" ? utf8.encode(entry.d).length : 0), 0);
          if (positiveInteger(art.bytes, BACKDROP_BUDGET_CEILING_BYTES) && art.bytes < content) fail("art.bytes", `Declared bytes understate the inline SVG: at least ${content} are needed for the path data.`);
          if (Reflect.ownKeys(paths).some(key => key !== "length" && (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= paths.length))) fail("art.source.paths", "Unsupported array fields.");
        }
      } else if (shape(art.source, "art.source", ["format", "src"])) {
        if (art.source.format !== "avif" && art.source.format !== "webp" && art.source.format !== "png" && art.source.format !== "jpeg") fail("art.source.format", "Expected a static avif, webp, png or jpeg photo, or inline token SVG.");
        if (!sourceUrl(art.source.src)) fail("art.source.src", "Expected a root-relative path or credential-free HTTPS URL.");
      }
    }
  } catch { fail("art", "The declaration could not be read."); }
  return { ok: findings.length === 0, findings };
}

/**
 * Binds static artwork to its image-backdrop declaration before rendering.
 * Byte counts remain consumer declarations; this check does not fetch a source
 * or inspect the rendered layer, which still needs `checkBackdropElement`.
 */
export function checkStillBackdrop(
  art: unknown,
  contract: ImageBackdropContract,
  options?: BackdropCheckOptions,
): StillBackdropReport {
  const artReport = checkConsumerArtContract(art);
  const backdropReport = checkBackdropContract(contract, options);
  const findings: ConsumerArtFinding[] = [];
  const fail = (path: string, message: string) => { findings.push({ path, message }); };
  if (artReport.ok && backdropReport.ok) {
    try {
      const still = art as ConsumerArtContract;
      if (still.slot !== "backdrop") fail("art.slot", "Still backdrops require the backdrop art placement.");
      if (still.loading !== "lazy") fail("art.loading", "Still backdrop art must load lazily.");
      if (!dataRecord(contract) || !dataRecord(contract.loading)) {
        fail("backdrop", "Expected plain backdrop and loading declarations.");
      } else {
        if (contract.kind !== "image") fail("backdrop.kind", "Still artwork requires an image backdrop declaration.");
        if (contract.loading.strategy !== "lazy") fail("backdrop.loading.strategy", "A static lazy image requires a lazy backdrop declaration.");
        if (still.bytes > contract.loading.budgetBytes) fail("art.bytes", "Declared art bytes exceed the backdrop loading budget.");
      }
    } catch {
      fail("backdrop", "The still backdrop binding could not be read.");
    }
  }
  return { ok: artReport.ok && backdropReport.ok && findings.length === 0, art: artReport, backdrop: backdropReport, findings };
}
