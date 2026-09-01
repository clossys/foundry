import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { scanClassCandidates } from "../compiled-css/class-scan.js";
import { generateCompiledCss } from "../compiled-css/generate.js";

const packageRoot = resolve(import.meta.dirname, "..", "..");

describe("section-ground Tailwind output", () => {
  it("compiles every ground-specific surface, foreground, line, and status-boundary utility", async () => {
    const scan = scanClassCandidates(resolve(packageRoot, "src", "blocks"));
    const generated = await generateCompiledCss({
      stylesDir: resolve(packageRoot, "styles"),
      candidates: scan.candidates,
    });

    for (const selector of [
      ".bg-surface-base",
      ".bg-surface-sunken",
      ".bg-surface-inverse",
      ".text-ink-primary",
      ".text-ink-on-inverse",
      ".text-ink-on-inverse-muted",
      ".border-line-base",
      ".border-line-on-inverse",
      ".bg-line-base",
      ".bg-line-on-inverse",
      ".bg-status-success",
      ".bg-status-warning",
      ".bg-status-info",
      ".ring-ink-primary",
      ".ring-ink-on-inverse",
    ]) {
      expect(generated.css, `missing ${selector}`).toContain(selector);
    }
  });
});
