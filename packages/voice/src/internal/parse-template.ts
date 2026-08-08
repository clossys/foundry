/**
 * A minimal, test-only JSONC reader for `templates/voice-record.template.jsonc`
 * — NOT part of this package's public API (nothing under `src/internal/` is
 * reachable from `src/index.ts`, and `package.json#exports` never points
 * here). It exists solely so `src/field-coverage.test.ts` can parse the
 * template as data and check it against `src/fields.ts`'s `VOICE_FIELDS`,
 * without pulling in a real JSONC parser as a dependency this package would
 * otherwise have zero reason to carry — the same call `@vespeneventures/tokens`
 * makes for `src/internal/parse-css.ts`.
 */

/**
 * Strips `//` line comments and `/* *\/` block comments from `text`,
 * WITHOUT touching either kind of sequence when it appears inside a JSON
 * string literal (`"a // not a comment"`, `"a /* not one either *\/"`) —
 * the one thing a naive regex-replace over the whole file gets wrong. Walks
 * the text one character at a time, tracking exactly one piece of state
 * (whether the cursor is inside a string, honoring `\"` escapes) so a `//`
 * or `/*` that is really just part of a quoted value is copied through
 * unchanged rather than eaten.
 */
function stripJsonComments(text: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const next = text[i + 1];

    if (inString) {
      out += ch;
      if (ch === "\\") {
        // Copy the escaped character too, unexamined — this is what keeps
        // `\"` from prematurely ending the string and `\\` from being
        // mistaken for the start of a second escape.
        if (i + 1 < text.length) {
          out += text[i + 1];
          i++;
        }
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n"; // preserve line numbering for anyone debugging a parse error
      continue;
    }

    if (ch === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++; // land on the trailing '/'
      continue;
    }

    out += ch;
  }
  return out;
}

/** Parses `text` as JSONC (JSON plus `//` and `/* *\/` comments). Throws the underlying `JSON.parse` error, with position information, if the stripped result still isn't valid JSON. */
export function parseTemplate(text: string): unknown {
  return JSON.parse(stripJsonComments(text));
}

/**
 * Flattens `value` into the set of dot-paths `src/fields.ts`'s `VOICE_FIELDS`
 * uses, matching its own "a leaf, not a tree" rule: a plain object's keys
 * are walked recursively, but an ARRAY is recorded as a single path (its
 * own) and never descended into — `glossary` and `claims` are each one
 * path, not `glossary.0.term`, `glossary.1.term`, ..., because an array's
 * LENGTH and CONTENTS are exactly the bindable data a consumer supplies, not
 * more structure for this function to enumerate. See `fields.ts`'s header
 * comment, "A leaf, not a tree", for the full reasoning — this function is
 * that rule's mechanical mirror image, the same relationship
 * `findAllCustomPropertyNames` in `@vespeneventures/tokens`' own
 * `internal/parse-css.ts` has to that package's `brand-template.css`.
 */
export function extractFieldPaths(value: unknown, prefix = ""): Set<string> {
  const paths = new Set<string>();

  if (Array.isArray(value)) {
    if (prefix) paths.add(prefix);
    return paths;
  }

  if (value !== null && typeof value === "object") {
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${key}` : key;
      const nestedPaths = extractFieldPaths(nestedValue, path);
      if (nestedPaths.size === 0) {
        // A leaf with no nested paths of its own (a string, number, boolean,
        // null, or an empty object) is still a real field — record it directly.
        paths.add(path);
      } else {
        for (const nestedPath of nestedPaths) paths.add(nestedPath);
      }
    }
    return paths;
  }

  // A scalar reached with no prefix (extractFieldPaths called on a bare
  // string/number/etc. at the root) has nothing to name — nothing to add.
  if (prefix) paths.add(prefix);
  return paths;
}
