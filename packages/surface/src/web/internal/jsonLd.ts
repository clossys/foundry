/**
 * Escaping for JSON-LD dropped into a `<script type="application/ld+json">`
 * tag — the one piece of `WebMeta` a prior 40-package attempt at this
 * ecosystem shipped with zero handling at all (grepping that codebase for
 * `ld+json`/`schema.org` returned nothing). For an AI-native pipeline this
 * is the conspicuous gap: JSON-LD is how a machine reads a page, and a
 * consumer who has to hand-roll their own serialization is exactly the
 * kind of gap this package exists to close.
 *
 * THE XSS THIS GUARDS AGAINST
 * ---------------------------
 * `<script>` content is terminated by the literal byte sequence
 * "</script" (case-insensitively, per the HTML spec — the parser does not
 * care that it is inside a JSON string, or that the tag is unclosed, or
 * that it is followed by garbage). A JSON-LD payload built from *any*
 * untrusted string field (a `WebMeta.title`, a product description
 * sourced from user content, anything a `copyId` resolves to) can legally
 * contain that substring as ordinary text. `JSON.stringify` alone does
 * nothing to prevent this — JSON escaping only concerns itself with
 * making the STRING valid JSON, not with making it safe to embed inside
 * HTML. A JSON-LD block whose `description` field is the literal text
 * "</script><script>alert(1)</script>" is perfectly valid JSON and,
 * embedded unescaped, closes the real `<script>` tag early and runs
 * whatever text follows as a fresh script — a stored XSS, not a
 * hypothetical one; this is a documented technique.
 *
 * THE FIX
 * -------
 * Escape every less-than sign in the serialized JSON to its Unicode
 * escape sequence. The three-character sequence "</s" cannot appear once
 * every "<" byte has been escaped away — a JSON unicode escape is not a
 * literal "<" to an HTML parser, only to the JSON one that later decodes
 * it back — so the string can never be misread as a tag boundary, no
 * matter what text it contains. Greater-than and ampersand are escaped
 * the same way as cheap, defense-in-depth insurance against any other
 * HTML-significant character reaching the page unescaped (an unescaped
 * ampersand inside a `<script>` block is otherwise inert here, since
 * script content is not HTML-entity-decoded, but escaping it costs
 * nothing and removes the question). The Unicode LINE SEPARATOR and
 * PARAGRAPH SEPARATOR code points are escaped too: both are legal inside
 * a JSON string but are treated as line terminators by some JavaScript
 * parsers reading a `<script>` block's *raw* text — irrelevant to a
 * `type="application/ld+json"` tag specifically (nothing ever parses that
 * content as JS), but escaping them is the same one-line insurance and
 * keeps this helper safe to reuse verbatim if a later channel ever needs
 * to embed JSON inside a real executable `<script>` instead.
 *
 * This is the same escaping strategy widely used for embedding JSON in
 * HTML (Rails' `json_escape`, `serialize-javascript`'s default behavior) —
 * not a bespoke invention.
 */

// The LINE SEPARATOR / PARAGRAPH SEPARATOR regexes below are built from
// \u-escape sequences rather than the raw code points: both are
// ECMAScript LineTerminators, and a raw (unescaped) LineTerminator inside
// a regex literal is a syntax error — the escape form is not stylistic,
// it is the only form that parses at all.
const LINE_SEPARATOR = new RegExp(" ", "g");
const PARAGRAPH_SEPARATOR = new RegExp(" ", "g");

export function escapeJsonForScriptTag(json: string): string {
  return json
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(LINE_SEPARATOR, "\\u2028")
    .replace(PARAGRAPH_SEPARATOR, "\\u2029");
}

/**
 * Serializes one JSON-LD object into `<script type="application/ld+json">`-
 * ready text: `JSON.stringify`, then {@link escapeJsonForScriptTag}. The
 * returned string is safe to place directly as a `<script>` element's text
 * content — it is not, and must not be treated as, an HTML fragment (do not
 * wrap it in `<script>...</script>` yourself and inject the result via an
 * HTML-string API; hand it to your framework's "raw script content" API,
 * the same way `dangerouslySetInnerHTML`'s `__html` expects exactly this
 * kind of pre-escaped string and nothing more).
 */
export function serializeJsonLd(entry: Record<string, unknown>): string {
  return escapeJsonForScriptTag(JSON.stringify(entry));
}
