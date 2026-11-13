/**
 * The one href policy shared by every server-rendered publisher surface.
 *
 * `CollectionView` carried this predicate privately first; the SectionedView
 * document contract needs the identical rule for the hero actions it now
 * carries, and two copies of a security predicate is exactly the drift a
 * later reader cannot see. Both call this one.
 */

function isNonWhitespaceString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Only anchors, one-origin paths, HTTP(S), and explicit mail links are safe route targets for a server-rendered view. */
export function isSanctionedHref(value: unknown): value is string {
  if (!isNonWhitespaceString(value) || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) return false;
  if (value.includes("\\")) return false;
  if (value.startsWith("#")) return true;
  if (value.startsWith("/")) return !value.startsWith("//") && !value.startsWith("/\\");
  if (value.toLowerCase().startsWith("mailto:")) return value.slice("mailto:".length).trim().length > 0;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.username === "" && parsed.password === "";
  } catch {
    return false;
  }
}
