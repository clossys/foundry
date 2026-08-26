/** Reject explicit inline sensitive-payload syntax in otherwise opaque references. */
import { TextDecoder } from "node:util";

const invisible = /[\0\u200b\u200c\u200d\u2060\ufeff]/gu;
const sensitiveLabel = "(?:credentials?(?:[-_. ]?value)?|secrets?(?:[-_. ]?value)?|access[-_. ]?token|auth[-_. ]?token|bearer[-_. ]?token|refresh[-_. ]?token|id[-_. ]?token|tokens?|api[-_. ]?keys?|client[-_. ]?secret|passwords?|passcode|authorization|private[-_. ]?key|connection[-_. ]?string|database[-_. ]?url|provider[-_. ]?value|central[-_. ]?adoption[-_. ]?decision|approve[-_. ]?all[-_. ]?consumers)";
const formSensitiveLabel = "(?:credentials?(?:[-_. +]?value)?|secrets?(?:[-_. +]?value)?|access[-_. +]?token|auth[-_. +]?token|bearer[-_. +]?token|refresh[-_. +]?token|id[-_. +]?token|tokens?|api[-_. +]?keys?|client[-_. +]?secret|passwords?|passcode|authorization|private[-_. +]?key|connection[-_. +]?string|database[-_. +]?url|provider[-_. +]?value|central[-_. +]?adoption[-_. +]?decision|approve[-_. +]?all[-_. +]?consumers)";
const nonemptyValue = "(?:[\"']\\s*)?[^\\s\"'&#,}\\]]";
const equalsAssignment = new RegExp(`(?:^|[^a-z0-9])${sensitiveLabel}\\b[\"']?\\s*=\\s*${nonemptyValue}`, "iu");
const segmentColonAssignment = new RegExp(`(?:^|[?&#])${sensitiveLabel}\\b\\s*:\\s*${nonemptyValue}`, "iu");
const spacedColonAssignment = new RegExp(`(?:^|[^a-z0-9])${sensitiveLabel}\\b\\s*:\\s+${nonemptyValue}`, "iu");
const quotedColonAssignment = new RegExp(`(?:^|[^a-z0-9])[\"']${sensitiveLabel}[\"']\\s*:\\s*${nonemptyValue}`, "iu");
const formEqualsAssignment = new RegExp(`(?:^|[?&#])${formSensitiveLabel}\\b[\"']?\\s*=\\s*${nonemptyValue}`, "iu");
const formColonAssignment = new RegExp(`(?:^|[?&#])${formSensitiveLabel}\\b\\s*:\\s*${nonemptyValue}`, "iu");
const decoder = new TextDecoder("utf-8", { fatal: false });

function decodePercentPass(value: string): string {
  return value.replace(/(?:%[0-9a-f]{2})+/giu, (encoded) => decoder.decode(Uint8Array.from(encoded.match(/%[0-9a-f]{2}/giu)!.map((part) => Number.parseInt(part.slice(1), 16)))));
}

function normalizedForDetection(value: string): string {
  let normalized = value;
  for (let pass = 0; pass < 2; pass += 1) normalized = decodePercentPass(normalized);
  return normalized.normalize("NFKC").replace(invisible, "").toLowerCase();
}

export function isValueSafeReference(value: string): boolean {
  const normalized = normalizedForDetection(value);
  return !equalsAssignment.test(normalized) && !segmentColonAssignment.test(normalized) && !spacedColonAssignment.test(normalized) && !quotedColonAssignment.test(normalized) && !formEqualsAssignment.test(normalized) && !formColonAssignment.test(normalized);
}
