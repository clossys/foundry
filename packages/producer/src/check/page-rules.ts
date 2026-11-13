import type { PageFinding, PageSnapshot, PageTarget } from "./page-types.js";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function arrayOf<T>(value: unknown, valid: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && Array.from(value).every(valid);
}

const string = (value: unknown): value is string => typeof value === "string";
const nonblank = (value: unknown): value is string => string(value) && readable(value).length > 0;
const readable = (value: string): string => value.replace(/\p{Cf}/gu, "").trim();

function validTarget(value: unknown): value is PageTarget {
  return record(value) && nonblank(value.url) && arrayOf(value.cellIds, nonblank);
}

function validSnapshot(value: unknown): value is PageSnapshot {
  return record(value)
    && nonblank(value.url)
    && typeof value.inspected === "boolean"
    && string(value.text)
    && arrayOf(value.headings, string)
    && arrayOf(value.images, (item): item is PageSnapshot["images"][number] => record(item)
      && string(item.src) && typeof item.complete === "boolean"
      && typeof item.naturalWidth === "number" && Number.isInteger(item.naturalWidth)
      && item.naturalWidth >= 0)
    && arrayOf(value.missingAssets, nonblank)
    && arrayOf(value.responses, (item): item is PageSnapshot["responses"][number] => record(item)
      && nonblank(item.url) && typeof item.status === "number"
      && Number.isInteger(item.status) && item.status >= 100 && item.status <= 599)
    && arrayOf(value.consoleErrors, string)
    && arrayOf(value.pageErrors, string)
    && arrayOf(value.failedRequests, (item): item is PageSnapshot["failedRequests"][number] => record(item)
      && nonblank(item.url) && string(item.error));
}

function literal(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A terminal period is punctuation; a period followed by another ID segment is not.
function idPattern(id: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}_.-])${literal(id)}(?![\\p{L}\\p{N}_-]|\\.[\\p{L}\\p{N}_-])`, "u");
}

/** Inspect observations only. Extra attributes and retained PASS claims cannot waive a defect. */
export function inspectPageSnapshot(snapshot: PageSnapshot, target: PageTarget): PageFinding[] {
  const findings: PageFinding[] = [];
  const url = record(target) && string(target.url) ? target.url : "";
  const add = (rule: string, message: string, evidence?: string): void => {
    findings.push({ rule, url, message, ...(evidence === undefined ? {} : { evidence: evidence.slice(0, 240) }) });
  };

  if (!validTarget(target) || !validSnapshot(snapshot) || snapshot.url !== target.url) {
    add("PAGE_SNAPSHOT_INVALID", "Page observations or target are missing, malformed, or mismatched.");
    return findings;
  }
  if (!snapshot.inspected) add("PAGE_SNAPSHOT_INCOMPLETE", "Page inspection did not complete.");
  if (!readable(snapshot.text)) add("PAGE_BLANK", "Page has no visible content.");

  // Headings contain accessible names, which need not occur in rendered text.
  const visible = readable([snapshot.text, ...snapshot.headings].join("\n"));
  const markers: [string, string, RegExp][] = [
    ["PAGE_NEED_MARKER", "Visible content contains an unresolved NEED marker.", /(?<![\p{L}\p{N}_])NEED(?![\p{L}\p{N}_])|(?<![\p{L}\p{N}_])[Nn][Ee][Ee][Dd]\s*:|\[\s*[Nn][Ee][Ee][Dd](?![\p{L}\p{N}_])/u],
    ["PAGE_FACT_MARKER", "Visible content contains an unresolved fact marker.", /\[\s*fact\s*:/iu],
    ["PAGE_TODO_OWNER", "Visible content contains an unresolved owner marker.", /(?<![\p{L}\p{N}_])TODO-OWNER(?![\p{L}\p{N}_-])/iu],
  ];
  for (const [rule, message, pattern] of markers) {
    const match = visible.match(pattern);
    if (match) add(rule, message, match[0]);
  }

  const canonical = target.cellIds.find(id => idPattern(id).test(visible));
  const technical = visible.match(/(?<![\p{L}\p{N}_.-])(?:pages?|sections?|components?|tokens?|cells?|layouts?|primitives?|patterns?|modules?|variants?|assets?)\.[a-z][a-z0-9_-]*(?:\.[a-z0-9_-]+)*(?![\p{L}\p{N}_-])/iu);
  if (canonical || technical) add("PAGE_TECHNICAL_ID", "Visible content exposes a technical identifier.", canonical ?? technical?.[0]);

  snapshot.headings.forEach((heading, index) => {
    if (!readable(heading)) add("PAGE_EMPTY_HEADING", "Page contains an empty heading.", `heading ${index + 1}`);
  });
  snapshot.images.forEach((image, index) => {
    if (!readable(image.src) || !image.complete || image.naturalWidth === 0) {
      add("PAGE_BROKEN_IMAGE", "An observed image is missing or did not load.", image.src || `image ${index + 1}`);
    }
  });
  snapshot.missingAssets.forEach(asset => add("PAGE_MISSING_ASSET", "An observed asset is missing.", asset));
  snapshot.responses.forEach(response => {
    if (response.status >= 400) add("PAGE_HTTP_ERROR", "An HTTP response failed.", `${response.status} ${response.url}`);
  });
  snapshot.consoleErrors.forEach(error => add("PAGE_CONSOLE_ERROR", "Browser console.error was observed.", error));
  snapshot.pageErrors.forEach(error => add("PAGE_RUNTIME_ERROR", "An uncaught page error was observed.", error));
  snapshot.failedRequests.forEach(request => add("PAGE_REQUEST_FAILED", "A browser request failed.", `${request.url}: ${request.error}`));
  return findings;
}
