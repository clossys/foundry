export interface StudioTheme { source: 'consumer' | 'foundry'; css: string; hash: string }

/** Producer supplies compiler output; Studio never reconstructs brand tokens. */
export function parseThemeResponse(value: unknown): StudioTheme {
  if (!value || typeof value !== 'object' || !('theme' in value)) throw new Error('Producer did not supply a Studio theme.');
  const theme = value.theme;
  if (!theme || typeof theme !== 'object' || !('source' in theme) || !['consumer', 'foundry'].includes(String(theme.source)) || !('css' in theme) || typeof theme.css !== 'string' || !theme.css.trim() || /[<>]/.test(theme.css) || !('hash' in theme) || typeof theme.hash !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(theme.hash)) throw new Error('Producer supplied an invalid Studio theme.');
  return { source: theme.source as StudioTheme['source'], css: theme.css, hash: theme.hash };
}

export async function loadTheme(signal: AbortSignal): Promise<StudioTheme> {
  const response = await fetch('/api/config', { signal, cache: 'no-store', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Producer could not load the Studio theme (${response.status}).`);
  return parseThemeResponse(await response.json());
}
