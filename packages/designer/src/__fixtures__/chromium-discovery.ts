/** Test-harness discovery only; no runtime component or browser connection. */

/**
 * Where Playwright's `chrome` channel finds the machine's installed Chrome: the
 * browser the rendered checks launch (packages/producer/studio/checks/chrome-launch.cjs),
 * never a downloaded one. Probed only after the PATH names, so a host with
 * Chromium on PATH keeps its browser.
 */
export function chromeChannelExecutables(platform: string = process.platform, env: Record<string, string | undefined> = process.env): string[] {
  if (platform === "darwin") return ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  if (platform === "win32") {
    return [env.LOCALAPPDATA, env.PROGRAMFILES, env["PROGRAMFILES(X86)"]]
      .filter((root): root is string => Boolean(root))
      .map(root => `${root}\\Google\\Chrome\\Application\\chrome.exe`);
  }
  return ["/opt/google/chrome/chrome"];
}

export function selectChromium(
  explicit: string | undefined,
  probe: (executable: string, args: string[]) => { status: number | null; error?: unknown },
  installed: readonly string[] = chromeChannelExecutables(),
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
  const browser = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", ...installed].find(available);
  if (!browser) throw new Error("Measured tests require Chromium or Google Chrome on PATH or at the installed Chrome channel location.");
  return browser;
}
