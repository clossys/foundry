/** Test-harness discovery only; no runtime component or browser connection. */
export function selectChromium(
  explicit: string | undefined,
  probe: (executable: string, args: string[]) => { status: number | null; error?: unknown },
): string {
  const available = (executable: string): boolean => {
    try {
      const result = probe(executable, ["--version"]);
      return result.status === 0 && !result.error;
    } catch { return false; }
  };
  if (explicit) {
    if (!available(explicit)) throw new Error(`FOUNDRY_TEST_CHROME executable failed --version: ${explicit}`);
    return explicit;
  }
  const browser = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"].find(available);
  if (!browser) throw new Error("Measured tests require Chromium or Google Chrome on PATH.");
  return browser;
}
