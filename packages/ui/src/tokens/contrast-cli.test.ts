import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliInputError, main } from "./contrast-cli.js";

// Hermetic: every test that supplies its own fixture operates on a
// `mkdtemp` directory, removed afterward, and calls the exported
// `main(argv)` directly rather than spawning the real CLI process. Tests
// that check the DEFAULT path deliberately exercise this package's own
// real, shipped `styles/tokens.css` — see "main — real, currently-shipping
// tokens.css" below.

let dir: string;

// Every property CONTRAST_PAIRS references, given clean values that clear
// every pair's threshold — the categorical-3/4/5 slots are deliberately
// NOT this package's real (WARN-band) hexes, so this fixture is a genuine
// clean run, distinct from the real package default (see the "PROVES IT
// FAILS" case in contrast-gate.test.ts and the real-tokens.css case below).
// Kept as the shared INNER lines (no `:root { ... }` wrapper) so a test
// can drop the same block into both a light and a dark selector without
// fragile string slicing.
const CLEAN_PROPERTY_LINES = `  --color-ink-primary: oklch(0.2178 0 0);
  --color-surface-base: oklch(0.9702 0 0);
  --color-surface-raised: oklch(1 0 0);
  --color-surface-sunken: oklch(0.9401 0 0);
  --color-ink-secondary: oklch(0.36 0 0);
  --color-ink-muted: oklch(0.54 0 0);
  --color-ink-link: oklch(0.36 0 0);
  --color-ink-on-accent: oklch(0.9702 0 0);
  --color-accent: oklch(0.4748 0 0);
  --color-ink-on-inverse: oklch(0.9702 0 0);
  --color-surface-inverse: oklch(0.2178 0 0);
  --color-status-success-text: oklch(0.4748 0 0);
  --color-status-success-tint: oklch(0.6268 0 0 / 0.1);
  --color-status-warning-text: oklch(0.36 0 0);
  --color-status-warning-tint: oklch(0.4495 0 0 / 0.12);
  --color-status-danger-text: oklch(0.2178 0 0);
  --color-status-danger-tint: oklch(0.285 0 0 / 0.12);
  --color-status-info-text: oklch(0.52 0 0);
  --color-status-info-tint: oklch(0.5658 0 0 / 0.08);
  --color-chart-axis-label: oklch(0.54 0 0);
  --color-chart-surface: oklch(1 0 0);
  --color-chart-categorical-1: #2a78d6;
  --color-chart-categorical-2: #eb6834;
  --color-chart-categorical-3: #1a1a1a;
  --color-chart-categorical-4: #1a1a1a;
  --color-chart-categorical-5: #1a1a1a;
  --color-chart-categorical-6: #008300;
  --color-chart-categorical-7: #4a3aa7;
  --color-chart-categorical-8: #e34948;`;

const CLEAN_LIGHT_ROOT = `:root {\n${CLEAN_PROPERTY_LINES}\n}\n`;

function writeCss(content: string): string {
  const path = join(dir, "tokens.css");
  writeFileSync(path, content);
  return path;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ui-contrast-check-cli-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("main — argument handling", () => {
  it("--help returns 0 without touching the filesystem", () => {
    expect(main(["--help"])).toBe(0);
  });

  it("throws CliInputError on an unknown flag", () => {
    const path = writeCss(CLEAN_LIGHT_ROOT);
    expect(() => main([path, "--bogus"])).toThrow(CliInputError);
  });

  it("throws CliInputError on an unexpected extra positional argument", () => {
    const path = writeCss(CLEAN_LIGHT_ROOT);
    expect(() => main([path, "extra"])).toThrow(CliInputError);
  });

  it("throws CliInputError when tokens-css-file does not exist", () => {
    expect(() => main([join(dir, "nope.css")])).toThrow(CliInputError);
  });

  it("throws CliInputError when tokens-css-file is a directory, not a file", () => {
    expect(() => main([dir])).toThrow(CliInputError);
  });
});

describe("main — the empty case must never exit 0", () => {
  it("an empty :root block (zero pairs resolvable) returns 2, never 0", () => {
    const path = writeCss(":root {\n}\n");
    expect(main([path])).toBe(2);
  });

  it("a file with no top-level :root block at all returns 2", () => {
    const path = writeCss("/* nothing here */\n");
    expect(main([path])).toBe(2);
  });
});

describe("main — the third state: could not run", () => {
  it("returns 2 when a real pair's token is missing from the registry (unresolvable-token)", () => {
    const withoutAccent = CLEAN_LIGHT_ROOT.replace("  --color-accent: oklch(0.4748 0 0);\n", "");
    const path = writeCss(withoutAccent);
    expect(main([path])).toBe(2);
  });

  it("returns 2 when a present dark block cannot be parsed (unterminated)", () => {
    const path = writeCss(`${CLEAN_LIGHT_ROOT}\n:root[data-theme="dark"] {\n  --color-ink-primary: oklch(0.97 0 0);\n`); // no closing brace
    expect(main([path])).toBe(2);
  });
});

describe("main — a light-only file (no dark block) is a valid, non-degraded input", () => {
  it("checks light theme and returns 0 for a genuinely clean fixture with no dark block at all", () => {
    const path = writeCss(CLEAN_LIGHT_ROOT);
    expect(main([path])).toBe(0);
  });
});

describe("main — real runs", () => {
  it("returns 1 for a real WCAG threshold miss (ink-primary too close to surface-base) — never a false clean pass", () => {
    const nearWhiteInk = CLEAN_LIGHT_ROOT.replace(
      "--color-ink-primary: oklch(0.2178 0 0);",
      "--color-ink-primary: oklch(0.92 0 0);", // far too light against a near-white ground
    );
    const path = writeCss(nearWhiteInk);
    expect(main([path])).toBe(1);
  });

  it("both a light and a dark block, both clean, returns 0", () => {
    const path = writeCss(`${CLEAN_LIGHT_ROOT}\n:root[data-theme="dark"] {\n${CLEAN_PROPERTY_LINES}\n}\n`);
    expect(main([path])).toBe(0);
  });
});

describe("main — real, currently-shipping tokens.css (no argument, this package's own default)", () => {
  it("returns 1 — the real light-mode categorical-3/4/5 WARN slots are a genuine, currently-shipping finding, never silently hidden as a clean pass", () => {
    expect(main([])).toBe(1);
  });
});
