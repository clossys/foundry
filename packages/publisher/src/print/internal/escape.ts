/**
 * Minimal, hand-rolled HTML escaping. `./print` has no React (or any other
 * templating library) doing this for free the way `./web`'s
 * `renderToStaticMarkup` does — every string this channel embeds into
 * markup (a resolved slot's text, `doc.id`, a slot's `key`/`element`,
 * `doc.template`) is untrusted content until it has passed through one of
 * these two functions.
 */

/** Escapes text content for a plain (non-attribute) position in the HTML document. */
export function escapeHtmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Escapes a value for use inside a double-quoted HTML attribute — everything `escapeHtmlText` escapes, plus `"`. */
export function escapeHtmlAttr(value: string): string {
  return escapeHtmlText(value).replace(/"/g, "&quot;");
}
