/**
 * Built-in fold wallpaper phrases — generic competitor copy, not consumer-specific.
 */

export const FOLD_WALLPAPER_PHRASES: readonly string[] = [
  "for founders and operators",
  "ai intelligence",
  "ai-native",
  "for founders",
];

function isAlphanumeric(ch: string): boolean {
  return /[a-z0-9]/i.test(ch);
}

/** Case-insensitive, whole-phrase-ish match inside a string literal value. */
export function findFoldWallpaperPhrase(value: string): string | undefined {
  const haystack = value.toLowerCase();
  const ordered = [...FOLD_WALLPAPER_PHRASES].sort((a, b) => b.length - a.length);
  for (const phrase of ordered) {
    const idx = haystack.indexOf(phrase);
    if (idx === -1) continue;
    const beforeOk = idx === 0 || !isAlphanumeric(haystack[idx - 1] ?? "");
    const afterIdx = idx + phrase.length;
    const afterOk = afterIdx >= haystack.length || !isAlphanumeric(haystack[afterIdx] ?? "");
    if (beforeOk && afterOk) return phrase;
  }
  return undefined;
}
