import { parseComposition } from "../content/composition.js";
import { isContentJson } from "../content/json.js";
import { outputPathFor } from "../content/metadata.js";
import { isContentLocale, isRevisionId } from "../content/vocabulary.js";
import type { ContentRouteRegistration } from "./content-route-types.js";

const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const record = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
  && isContentJson(value) && Object.keys(value).every(key => keys.includes(key));

/** Source identities stay relative to the consumer, before relative imports are derived. */
function sourcePath(value: unknown): value is string {
  return text(value) && value === value.trim() && !/[\\\u0000-\u001f\u007f?#:]/.test(value)
    && !value.startsWith("/") && !value.split("/").some(segment => !segment || segment === "." || segment === "..");
}

const RESERVED_NAMES = new Set([
  "arguments", "await", "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do", "else", "enum", "eval",
  "export", "extends", "false", "finally", "for", "function", "if", "implements", "import", "in", "instanceof", "interface",
  "let", "new", "null", "package", "private", "protected", "public", "return", "static", "super", "switch", "this", "throw",
  "true", "try", "typeof", "var", "void", "while", "with", "yield",
]);
const NEXT_SPECIAL_FILE = /(?:^|\/)(?:page|layout|template|route|default|loading|error|global-error|not-found|middleware|instrumentation)\.[cm]?[jt]sx?$/;

/** Internal shared guard; a loader is a separate named data export, never a route entry. */
export function assertContentRouteLoader(value: unknown, sourceFile?: string): asserts value is ContentRouteRegistration["loader"] {
  if (!record(value, ["file", "export"]) || !sourcePath(value.file)
    || value.file.includes("%") || !/[^/]\.[cm]?[jt]sx?$/.test(value.file) || /\.d\.[cm]?ts$/.test(value.file)
    || NEXT_SPECIAL_FILE.test(value.file) || value.file === sourceFile
    || typeof value.export !== "string" || !/^[A-Za-z_$][\w$]*$/.test(value.export) || RESERVED_NAMES.has(value.export)) {
    throw new TypeError("A separate consumer-relative named JavaScript or TypeScript content loader is required");
  }
}

/** A finite v2 registration is independent of the retiring plan/layout contract. */
export function assertContentRouteRegistration(value: unknown): asserts value is ContentRouteRegistration {
  if (!record(value, ["kind", "slotId", "candidateId", "revision", "digest", "locale", "path", "outputPath", "composition", "source", "loader"])
    || value.kind !== "content" || !text(value.slotId) || !text(value.candidateId)
    || !isRevisionId(value.revision) || typeof value.digest !== "string" || !/^[a-f0-9]{64}$/.test(value.digest)
    || !isContentLocale(value.locale) || !text(value.path) || !sourcePath(value.outputPath)
    || !record(value.source, ["file", "export"]) || value.source.export !== "default" || value.source.file !== value.outputPath) {
    throw new TypeError("A finite content route registration with an exact default source is required");
  }
  parseComposition(value.composition);
  const target = value.outputPath.split("/")[0]!;
  let deployTarget: string;
  try { deployTarget = decodeURIComponent(target); }
  catch { throw new TypeError("The content output path must use canonical segment encoding"); }
  let expectedOutput: string;
  try { expectedOutput = outputPathFor({ route: value.path, deployTarget }); }
  catch { throw new TypeError("The content output requires a canonical route and deploy target"); }
  if (expectedOutput !== value.outputPath) {
    throw new TypeError("The content source must equal the authoritative route output path");
  }
  assertContentRouteLoader(value.loader, value.outputPath);
}
