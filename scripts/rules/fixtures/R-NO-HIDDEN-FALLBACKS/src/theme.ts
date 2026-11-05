// A broken consumer theme silently becomes the Foundry theme.
declare function compileConsumerTheme(): string;
const FOUNDRY_THEME = ":root{}";

export function studioTheme(): string {
  try { return compileConsumerTheme(); }
  catch { return FOUNDRY_THEME; }
}
