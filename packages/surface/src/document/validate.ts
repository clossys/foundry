/**
 * Structural, heading-order, link, table, and anchor validation for a
 * candidate `StructuredDocument`, hand-rolled in the same plain-type-guard,
 * accumulate-and-keep-going style as `surface/core`'s own `validate.ts`
 * (see that file's own top comment for why: no schema library, so this
 * public package never forces a dependent onto one schema library's major
 * version for the sake of shape-checking a document).
 *
 * Two checks are worth calling out because they are easy to mistake for
 * pedantry:
 *
 *   - **Heading order** (`"section-level-must-be-two-at-top"` /
 *     `"section-level-skip"` / `"section-level-max-depth"`). A document
 *     whose headings skip a level (an `h2` followed directly by an `h4`)
 *     is invisible to a sighted reader scanning the page but breaks
 *     screen-reader heading navigation, which relies on level order to
 *     convey document structure. This is real validation, not style
 *     preference.
 *   - **Link scheme allowlist and fragment resolution**
 *     (`"link-scheme-not-allowed"` / `"link-fragment-unresolved"`). A
 *     rejected `href` is never silently dropped, replaced with a
 *     placeholder, or rendered inert — the finding makes the whole
 *     document invalid, and `renderStructuredDocument` refuses to render
 *     at all. This is the identical fail-closed shape
 *     `resolveSurfaceDocument` already uses for every other
 *     unresolved/invalid input in this package. The allowlist itself
 *     (`https:`, `http:`, `mailto:`) mirrors the
 *     `protocol !== "https:" && protocol !== "http:"` shape
 *     `packages/auth/src/redirect.ts`'s `parseHttpUrl` already uses
 *     elsewhere in this repository — reproduced locally rather than
 *     imported, since `surface` does not and should not depend on `auth`.
 *
 *     Two schemeless forms are also accepted, because a prose document
 *     overwhelmingly links inside its own site: an in-document
 *     `"#fragment"`, and a root-relative `"/path"`. A protocol-relative
 *     `"//host/path"` is rejected as `"link-protocol-relative"` — it reads
 *     as same-site and is not — and a path-relative `"docs/foo"` is
 *     rejected too, since it resolves against whichever route the document
 *     happens to be mounted at and this contract exists so one document
 *     can be rendered in more than one place.
 *
 * ANCHOR RESOLUTION IS A TWO-PASS WALK
 * -------------------------------------
 * `collectSectionIds` runs a best-effort, shape-tolerant first pass over
 * `value` purely to build the set of `DocumentSection.id`s a `"#fragment"`
 * link is allowed to resolve against — it never reports a finding of its
 * own, and it never throws on malformed input, so a document with some
 * broken sections still gets useful fragment-resolution answers for its
 * well-formed ones. The main validation walk then runs a second time,
 * checking everything else (including duplicate ids, which the first pass
 * deliberately does not police) against that already-collected set.
 */

import type { ComposeFinding } from "../core/index.js";

// --------------------------------------------------------------- helpers

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Same local convention `surface/core`'s own `validate.ts` uses for a `CopyRef` — reproduced here rather than imported, since `core`'s version is a private helper, not an export. */
function isCopyRef(value: unknown): value is { id: string; locale?: string; values?: Record<string, string | number | boolean> } {
  if (!isPlainObject(value)) return false;
  if (!isNonEmptyString(value.id)) return false;
  if (value.locale !== undefined && typeof value.locale !== "string") return false;
  if (value.values !== undefined && !isPlainObject(value.values)) return false;
  return true;
}

function validateCopyRef(value: unknown, path: string, findings: ComposeFinding[]): void {
  if (!isCopyRef(value)) {
    findings.push({ rule: "copy-ref-shape", severity: "error", message: `${path} must be a CopyRef with a non-empty id.`, path });
  }
}

const SECTION_LEVELS = [2, 3, 4, 5, 6] as const;
const LIST_STYLES = ["ordered", "unordered"] as const;
const CALLOUT_TONES = ["info", "warning", "success", "danger"] as const;
const BLOCK_KINDS = ["section", "paragraph", "list", "definition-list", "table", "callout"] as const;
const ALLOWED_LINK_SCHEMES = ["https:", "http:", "mailto:"] as const;

// --------------------------------------------------------------- anchor collection (pass 1)

/** Best-effort, never-throwing walk that collects every `DocumentSection.id` reachable anywhere in `value.sections`, at any nesting depth — used only to answer "does this fragment resolve," never to report a finding itself. */
function collectSectionIds(value: unknown): Set<string> {
  const ids = new Set<string>();
  if (!isPlainObject(value) || !Array.isArray(value.sections)) return ids;
  for (const section of value.sections) collectFromSectionNode(section, ids);
  return ids;
}

function collectFromSectionNode(value: unknown, ids: Set<string>): void {
  if (!isPlainObject(value)) return;
  if (isNonEmptyString(value.id)) ids.add(value.id);
  if (!Array.isArray(value.blocks)) return;
  for (const block of value.blocks) {
    if (isPlainObject(block) && block.kind === "section") collectFromSectionNode(block, ids);
  }
}

// --------------------------------------------------------------- inline / href

function validateHref(href: string, path: string, knownSectionIds: ReadonlySet<string>, findings: ComposeFinding[]): void {
  if (href.startsWith("#")) {
    const fragment = href.slice(1);
    if (fragment.length === 0 || !knownSectionIds.has(fragment)) {
      findings.push({
        rule: "link-fragment-unresolved",
        severity: "error",
        message: `${path} references fragment "${href}", which does not match any DocumentSection.id present in this document.`,
        path,
      });
    }
    return;
  }

  // A protocol-relative href (`//host/path`) LOOKS same-site and is not: it
  // inherits only the scheme and points at whatever host follows, so it is
  // an off-origin link wearing a relative link's syntax. It has to be
  // rejected before the root-relative check below, which would otherwise
  // accept it on the strength of its first character alone.
  if (href.startsWith("//")) {
    findings.push({
      rule: "link-protocol-relative",
      severity: "error",
      message: `${path} has href ${JSON.stringify(href)}, a protocol-relative URL. It reads as same-site but resolves to the host after "//"; write the absolute https: URL if that other origin is intended, or a root-relative "/path" if it is not.`,
      path,
    });
    return;
  }

  // A root-relative href (`/pricing`) is same-origin by construction, so it
  // needs no scheme allowlist — there is no scheme to allow. A document
  // whose body is prose almost always links within its own site, and the
  // alternative (forcing an absolute URL) would bake the deployment's
  // hostname into content the copy registry owns.
  //
  // A path-relative href (`docs/foo`, `../foo`) is deliberately NOT
  // accepted: it resolves against whatever route the document is being
  // rendered at, and the whole point of this contract is that one
  // `StructuredDocument` can be rendered in more than one place. A link
  // that means different things depending on where it is mounted is a
  // defect that would only surface on the second mount.
  if (href.startsWith("/")) return;

  let url: URL | undefined;
  try {
    url = new URL(href);
  } catch {
    url = undefined;
  }
  if (url === undefined || !(ALLOWED_LINK_SCHEMES as readonly string[]).includes(url.protocol)) {
    findings.push({
      rule: "link-scheme-not-allowed",
      severity: "error",
      message: `${path} has href ${JSON.stringify(href)}, whose scheme is not one of ${ALLOWED_LINK_SCHEMES.join(", ")}. It is also not an in-document "#fragment" link or a root-relative "/path" link, which are the two schemeless forms this contract accepts; a path-relative href such as "docs/foo" is not one of them.`,
      path,
    });
  }
}

// Rule: inline-shape, inline-kind-unknown, inline-link-href-shape (plus copy-ref-shape / link-scheme-not-allowed / link-fragment-unresolved, above)
function validateInline(value: unknown, path: string, knownSectionIds: ReadonlySet<string>, findings: ComposeFinding[]): void {
  if (!isPlainObject(value)) {
    findings.push({ rule: "inline-shape", severity: "error", message: `${path} must be an object.`, path });
    return;
  }
  if (value.kind === "text") {
    validateCopyRef(value.text, `${path}.text`, findings);
    return;
  }
  if (value.kind === "link") {
    validateCopyRef(value.text, `${path}.text`, findings);
    if (!isNonEmptyString(value.href)) {
      findings.push({ rule: "inline-link-href-shape", severity: "error", message: `${path}.href must be a non-empty string.`, path: `${path}.href` });
    } else {
      validateHref(value.href, `${path}.href`, knownSectionIds, findings);
    }
    return;
  }
  findings.push({ rule: "inline-kind-unknown", severity: "error", message: `${path}.kind must be "text" or "link", got ${JSON.stringify((value as { kind?: unknown }).kind)}.`, path: `${path}.kind` });
}

function validateInlineList(value: unknown, path: string, knownSectionIds: ReadonlySet<string>, findings: ComposeFinding[]): void {
  if (!Array.isArray(value)) {
    findings.push({ rule: "inline-list-shape", severity: "error", message: `${path} must be an array of inline content.`, path });
    return;
  }
  value.forEach((inline, index) => validateInline(inline, `${path}.${index}`, knownSectionIds, findings));
}

// --------------------------------------------------------------- blocks

// Rule: paragraph-content-shape
function validateParagraph(value: Record<string, unknown>, path: string, knownSectionIds: ReadonlySet<string>, findings: ComposeFinding[]): void {
  if (!Array.isArray(value.content)) {
    findings.push({ rule: "paragraph-content-shape", severity: "error", message: `${path}.content must be an array of inline content.`, path: `${path}.content` });
    return;
  }
  validateInlineList(value.content, `${path}.content`, knownSectionIds, findings);
}

// Rule: list-style-shape, list-items-shape, list-item-shape
function validateList(value: Record<string, unknown>, path: string, knownSectionIds: ReadonlySet<string>, findings: ComposeFinding[]): void {
  if (!(LIST_STYLES as readonly unknown[]).includes(value.style)) {
    findings.push({ rule: "list-style-shape", severity: "error", message: `${path}.style must be one of ${LIST_STYLES.join(", ")}, got ${JSON.stringify(value.style)}.`, path: `${path}.style` });
  }
  if (!Array.isArray(value.items)) {
    findings.push({ rule: "list-items-shape", severity: "error", message: `${path}.items must be an array.`, path: `${path}.items` });
    return;
  }
  value.items.forEach((item, index) => {
    const itemPath = `${path}.items.${index}`;
    if (!Array.isArray(item)) {
      findings.push({ rule: "list-item-shape", severity: "error", message: `${itemPath} must be an array of inline content (one list item's inline run).`, path: itemPath });
      return;
    }
    validateInlineList(item, itemPath, knownSectionIds, findings);
  });
}

// Rule: definition-list-items-shape, definition-list-item-shape
function validateDefinitionList(value: Record<string, unknown>, path: string, findings: ComposeFinding[]): void {
  if (!Array.isArray(value.items)) {
    findings.push({ rule: "definition-list-items-shape", severity: "error", message: `${path}.items must be an array.`, path: `${path}.items` });
    return;
  }
  value.items.forEach((item, index) => {
    const itemPath = `${path}.items.${index}`;
    if (!isPlainObject(item)) {
      findings.push({ rule: "definition-list-item-shape", severity: "error", message: `${itemPath} must be an object with "term" and "description".`, path: itemPath });
      return;
    }
    validateCopyRef(item.term, `${itemPath}.term`, findings);
    validateCopyRef(item.description, `${itemPath}.description`, findings);
  });
}

// Rule: table-caption-shape, table-headers-required, table-headers-shape, table-rows-shape, table-row-shape, table-row-length-mismatch
function validateTable(value: Record<string, unknown>, path: string, findings: ComposeFinding[]): void {
  if (value.caption !== undefined) {
    validateCopyRef(value.caption, `${path}.caption`, findings);
  }

  const headersPresent = Array.isArray(value.headers) && value.headers.length > 0;
  if (!headersPresent) {
    findings.push({ rule: "table-headers-required", severity: "error", message: `${path}.headers must be a non-empty CopyRef array.`, path: `${path}.headers` });
  } else {
    (value.headers as unknown[]).forEach((header, index) => validateCopyRef(header, `${path}.headers.${index}`, findings));
  }
  const headerLength = headersPresent ? (value.headers as unknown[]).length : undefined;

  if (!Array.isArray(value.rows)) {
    findings.push({ rule: "table-rows-shape", severity: "error", message: `${path}.rows must be an array.`, path: `${path}.rows` });
    return;
  }
  value.rows.forEach((row, index) => {
    const rowPath = `${path}.rows.${index}`;
    if (!Array.isArray(row)) {
      findings.push({ rule: "table-row-shape", severity: "error", message: `${rowPath} must be an array of CopyRef cells.`, path: rowPath });
      return;
    }
    if (headerLength !== undefined && row.length !== headerLength) {
      findings.push({
        rule: "table-row-length-mismatch",
        severity: "error",
        message: `${rowPath} has ${row.length} cell(s), but ${path}.headers declares ${headerLength}. Every row must have exactly one cell per header — never padded or truncated.`,
        path: rowPath,
      });
    }
    row.forEach((cell, cellIndex) => validateCopyRef(cell, `${rowPath}.${cellIndex}`, findings));
  });
}

// Rule: callout-tone-shape, callout-content-shape
function validateCallout(value: Record<string, unknown>, path: string, knownSectionIds: ReadonlySet<string>, findings: ComposeFinding[]): void {
  if (!(CALLOUT_TONES as readonly unknown[]).includes(value.tone)) {
    findings.push({ rule: "callout-tone-shape", severity: "error", message: `${path}.tone must be one of ${CALLOUT_TONES.join(", ")}, got ${JSON.stringify(value.tone)}.`, path: `${path}.tone` });
  }
  if (!Array.isArray(value.content)) {
    findings.push({ rule: "callout-content-shape", severity: "error", message: `${path}.content must be an array of inline content.`, path: `${path}.content` });
    return;
  }
  validateInlineList(value.content, `${path}.content`, knownSectionIds, findings);
}

// --------------------------------------------------------------- sections (recursive)

/** What level a `DocumentSection` at `path` is expected to satisfy, given where it sits in the document. */
type LevelExpectation =
  | { kind: "top" }
  | { kind: "nested"; parentLevel: number }
  | /** The parent's own `level` could not itself be determined (already reported as `section-level-shape`) — skip the relational check rather than compare against a meaningless value. */ { kind: "unknown" };

// Rule: section-shape, section-kind-shape, section-id-shape, section-anchor-duplicate, section-level-shape,
//       section-level-must-be-two-at-top, section-level-skip, section-level-max-depth, section-blocks-shape,
//       block-shape, block-kind-unknown (plus every block-kind-specific rule above)
function validateSectionNode(
  value: unknown,
  path: string,
  levelExpectation: LevelExpectation,
  knownSectionIds: ReadonlySet<string>,
  seenIds: Map<string, string>,
  findings: ComposeFinding[],
): void {
  if (!isPlainObject(value)) {
    findings.push({ rule: "section-shape", severity: "error", message: `${path} must be an object.`, path });
    return;
  }

  if (value.kind !== "section") {
    findings.push({ rule: "section-kind-shape", severity: "error", message: `${path}.kind must be "section", got ${JSON.stringify(value.kind)}.`, path: `${path}.kind` });
  }

  if (!isNonEmptyString(value.id)) {
    findings.push({ rule: "section-id-shape", severity: "error", message: `${path}.id must be a non-empty string.`, path: `${path}.id` });
  } else {
    const firstPath = seenIds.get(value.id);
    if (firstPath !== undefined) {
      findings.push({
        rule: "section-anchor-duplicate",
        severity: "error",
        message: `${path}.id "${value.id}" duplicates the id already used at ${firstPath}.id — every DocumentSection.id must be unique across the whole document, not just among siblings.`,
        path: `${path}.id`,
      });
    } else {
      seenIds.set(value.id, path);
    }
  }

  validateCopyRef(value.heading, `${path}.heading`, findings);

  const levelValid = (SECTION_LEVELS as readonly unknown[]).includes(value.level);
  if (!levelValid) {
    findings.push({ rule: "section-level-shape", severity: "error", message: `${path}.level must be one of ${SECTION_LEVELS.join(", ")}, got ${JSON.stringify(value.level)}.`, path: `${path}.level` });
  } else {
    const level = value.level as number;
    if (levelExpectation.kind === "top") {
      if (level !== 2) {
        findings.push({
          rule: "section-level-must-be-two-at-top",
          severity: "error",
          message: `${path}.level must be 2 for a top-level StructuredDocument.sections entry, got ${level}.`,
          path: `${path}.level`,
        });
      }
    } else if (levelExpectation.kind === "nested") {
      if (levelExpectation.parentLevel === 6) {
        findings.push({
          rule: "section-level-max-depth",
          severity: "error",
          message: `${path} is nested inside a level-6 section, which may not contain a nested section — there is no level 7.`,
          path,
        });
      } else if (level !== levelExpectation.parentLevel + 1) {
        findings.push({
          rule: "section-level-skip",
          severity: "error",
          message: `${path}.level is ${level}, but its parent is level ${levelExpectation.parentLevel} — a nested section's level must equal its parent's level + 1, never equal, lower, or skipped ahead.`,
          path: `${path}.level`,
        });
      }
    }
    // levelExpectation.kind === "unknown": the parent's own level could not be determined; nothing more to check here.
  }

  if (!Array.isArray(value.blocks)) {
    findings.push({ rule: "section-blocks-shape", severity: "error", message: `${path}.blocks must be an array.`, path: `${path}.blocks` });
    return;
  }

  const childLevelExpectation: LevelExpectation = levelValid ? { kind: "nested", parentLevel: value.level as number } : { kind: "unknown" };

  value.blocks.forEach((block, index) => {
    const blockPath = `${path}.blocks.${index}`;
    if (!isPlainObject(block)) {
      findings.push({ rule: "block-shape", severity: "error", message: `${blockPath} must be an object.`, path: blockPath });
      return;
    }
    switch (block.kind) {
      case "section":
        validateSectionNode(block, blockPath, childLevelExpectation, knownSectionIds, seenIds, findings);
        return;
      case "paragraph":
        validateParagraph(block, blockPath, knownSectionIds, findings);
        return;
      case "list":
        validateList(block, blockPath, knownSectionIds, findings);
        return;
      case "definition-list":
        validateDefinitionList(block, blockPath, findings);
        return;
      case "table":
        validateTable(block, blockPath, findings);
        return;
      case "callout":
        validateCallout(block, blockPath, knownSectionIds, findings);
        return;
      default:
        findings.push({
          rule: "block-kind-unknown",
          severity: "error",
          message: `${blockPath}.kind must be one of ${BLOCK_KINDS.join(", ")}, got ${JSON.stringify(block.kind)}.`,
          path: `${blockPath}.kind`,
        });
    }
  });
}

// --------------------------------------------------------------- top level

/**
 * Validates a candidate `StructuredDocument`, returning every shape,
 * heading-order, link, table, and anchor finding — never throwing on
 * malformed input. `renderStructuredDocument` calls this first and refuses
 * to render at all if any finding is `severity: "error"` (in practice,
 * every finding this function ever produces is `"error"` — the same
 * discipline every shape validator in this package holds to; see
 * `ComposeFinding`'s own doc comment).
 *
 * `sections` may be an empty array — that is a valid, empty document, not
 * a finding. See `StructuredDocument`'s own doc comment.
 */
export function validateStructuredDocument(value: unknown): ComposeFinding[] {
  if (!isPlainObject(value)) {
    return [{ rule: "document-shape", severity: "error", message: "StructuredDocument must be an object.", path: "" }];
  }

  const findings: ComposeFinding[] = [];

  if (!isNonEmptyString(value.id)) {
    findings.push({ rule: "document-id-shape", severity: "error", message: "id must be a non-empty string.", path: "id" });
  }

  validateCopyRef(value.title, "title", findings);

  if (!Array.isArray(value.sections)) {
    findings.push({ rule: "document-sections-shape", severity: "error", message: "sections must be an array.", path: "sections" });
    return findings;
  }

  const knownSectionIds = collectSectionIds(value);
  const seenIds = new Map<string, string>();

  value.sections.forEach((section, index) => {
    validateSectionNode(section, `sections.${index}`, { kind: "top" }, knownSectionIds, seenIds, findings);
  });

  return findings;
}
