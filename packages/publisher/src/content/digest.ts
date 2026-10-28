import { createHash } from "node:crypto";
import { isContentJson } from "./json.js";
import type { CandidateContent } from "./model.js";

/** Workflow metadata and tags deliberately do not enter the revision content. */
export function candidateRevisionContent(value: CandidateContent): CandidateContent {
  return {
    name: value.name, brief: value.brief,
    ...(value.composition === undefined ? {} : { composition: value.composition }),
    ...(value.pageMeta === undefined ? {} : { pageMeta: value.pageMeta }),
    ...(value.pageMetaAssets === undefined ? {} : { pageMetaAssets: value.pageMetaAssets }),
    ...(value.redirectTarget === undefined ? {} : { redirectTarget: value.redirectTarget }),
    links: value.links, typeSettings: value.typeSettings, openQuestions: value.openQuestions,
  };
}

/** Stable object-key order; array order (including section order) remains significant. */
export function computeContentDigest(value: CandidateContent): string {
  const content = candidateRevisionContent(value);
  if (!isContentJson(content)) throw new TypeError("Revision content must be finite, acyclic JSON");
  function canonical(v: unknown): string {
    if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
    if (v && typeof v === "object") return `{${Object.keys(v).sort().map(key => `${JSON.stringify(key)}:${canonical((v as Record<string, unknown>)[key])}`).join(",")}}`;
    return JSON.stringify(v);
  }
  return createHash("sha256").update(canonical(content)).digest("hex");
}
