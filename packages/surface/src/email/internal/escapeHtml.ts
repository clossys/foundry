/**
 * HTML-escaping and preheader-padding for the `./email` channel.
 *
 * WHY THIS MODULE EXISTS, SEPARATELY FROM `./web`'s `internal/jsonLd.ts`
 * -------------------------------------------------------------------------
 * `./web` escapes exactly one thing — a JSON-LD payload destined for a
 * `<script type="application/ld+json">` element's raw text content, where
 * the only byte sequence that matters is `</script` (see that file's own
 * doc comment). Every other string `./web` emits is handed to React, which
 * escapes element text content itself.
 *
 * `./email` has no framework doing that for it: every string this channel
 * emits — a resolved slot's text, the subject repeated into `<title>`, the
 * preheader — is concatenated directly into a raw HTML string by this
 * package's own code. `escapeHtml` is therefore the one place ALL of that
 * text passes through before it becomes part of `EmailRenderResult.html`.
 * Skipping it for even one field is a real stored-HTML-injection bug: a
 * slot's resolved text is, in the general case, untrusted (copy-registry
 * content, or a literal `value` a caller supplied from elsewhere), and a
 * value like `<script>alert(1)</script>` must render as inert text, not as
 * markup.
 *
 * WHAT'S ESCAPED, AND WHY EACH ONE
 * -----------------------------------
 *   `&` -> `&amp;`   — must be first, or every other replacement's own `&`
 *                       would be escaped a second time.
 *   `<` -> `&lt;`    — the only byte that can open a new tag.
 *   `>` -> `&gt;`    — closes a tag; escaped for symmetry with `<` and
 *                       because some legacy mail-client HTML parsers are
 *                       looser than a browser's about where a tag can end.
 *   `"` -> `&quot;`  — every use site in this channel wraps escaped text in
 *                       a double-quoted `style="..."`/`href="..."` attribute
 *                       or plain element content; escaping `"` keeps this
 *                       one function safe to use for BOTH without a caller
 *                       needing to know which context they're in.
 *   `'` -> `&#39;`   — not HTML-significant in a double-quoted attribute or
 *                       in text content, but several major email clients
 *                       (Outlook's Word-based renderer among them) rewrite
 *                       raw apostrophes unpredictably; escaping it removes
 *                       the question rather than trusting every client to
 *                       leave it alone.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * How many `&zwnj;&nbsp;` pairs {@link buildHiddenPreheader} appends after
 * the real preheader text. Each pair is two zero-width/invisible
 * characters, so this is purely a byte-count knob for inbox preview panes,
 * not anything a recipient ever perceives visually.
 *
 * WHY THIS EXISTS AT ALL
 * ------------------------
 * Every major inbox preview (Gmail, Apple Mail, Outlook) shows the
 * preheader text immediately followed by however many characters of the
 * email BODY it takes to fill its preview-line character budget — there is
 * no client-side way to say "stop reading here." The universal workaround
 * (used by every serious ESP's template output) is to follow the intended
 * preheader with a long run of characters that are invisible when
 * rendered (`&zwnj;` — zero-width non-joiner — and `&nbsp;` — a non-
 * breaking space, both inside the same `display:none` element as the
 * preheader itself) but that still count against the preview pane's
 * character budget, pushing the client's own body-text scavenging past
 * where any real content starts.
 *
 * 20 repeats (40 filler characters) comfortably exceeds every mainstream
 * client's preview-line budget (Gmail's is the longest in common use, at
 * roughly 100–140 characters including the subject) once added to a
 * preheader already close to `EmailMeta`'s own 140-character cap enforced
 * by `@vespeneventures/surface/core`'s `validate.ts`.
 */
const PREHEADER_FILLER_REPEATS = 20;

/**
 * Builds the hidden preheader block's full inner HTML: the escaped,
 * real preheader text, followed by {@link PREHEADER_FILLER_REPEATS}
 * `&zwnj;&nbsp;` pairs. See that constant's own doc comment for why the
 * filler exists. The caller wraps this in the `display:none`-styled
 * element itself (see `renderEmailDocument.ts`) — this function only
 * builds the text content.
 */
export function buildHiddenPreheaderContent(preheader: string): string {
  const filler = "&zwnj;&nbsp;".repeat(PREHEADER_FILLER_REPEATS);
  return `${escapeHtml(preheader)}${filler}`;
}
