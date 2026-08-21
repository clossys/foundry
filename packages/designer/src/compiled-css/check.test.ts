import { mkdtempSync, readFileSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkCompiledCssFreshness } from "./check.js";

const packageRoot = resolve(import.meta.dirname, "..", "..");

describe("checkCompiledCssFreshness — real package (the actual CI gate)", () => {
  it("reports the real, committed styles/compiled.css as in sync with the real src/atoms/", async () => {
    // THE gate: if this ever fails, styles/compiled.css was hand-edited or
    // src/atoms/ changed without regenerating it. Run
    // `npm run generate:compiled-css` to fix.
    const result = await checkCompiledCssFreshness({ packageRoot });
    if (!result.inSync) {
      console.error(result.diffSummary);
    }
    expect(result.inSync).toBe(true);
    expect(result.classCount).toBeGreaterThan(0);
  });
});

describe("checkCompiledCssFreshness — drift detection (isolated fixture)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ui-compiled-css-check-"));
    cpSync(join(packageRoot, "styles"), join(dir, "styles"), { recursive: true });
    cpSync(join(packageRoot, "src", "atoms"), join(dir, "src", "atoms"), { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports drift when compiled.css is hand-edited after the fact", async () => {
    const compiledPath = join(dir, "styles", "compiled.css");
    writeFileSync(compiledPath, "/* hand-edited, no longer matches source */\n.bg-accent { background: red; }\n");
    const result = await checkCompiledCssFreshness({ packageRoot: dir });
    expect(result.inSync).toBe(false);
    expect(result.diffSummary).toBeDefined();
  });

  it("reports drift (as 'missing') when compiled.css does not exist yet", async () => {
    rmSync(join(dir, "styles", "compiled.css"));
    const result = await checkCompiledCssFreshness({ packageRoot: dir });
    expect(result.inSync).toBe(false);
    expect(result.diffSummary).toContain("does not exist");
  });

  it("reports drift when an atom gains a new real utility class without regenerating", async () => {
    const buttonPath = join(dir, "src", "atoms", "Button.tsx");
    const original = readFileSync(buttonPath, "utf8");
    // A real Tailwind utility not used anywhere else in this fixture's
    // atoms/ — guaranteed to change the generated output, unlike editing
    // an already-widely-used class (e.g. "bg-accent" appears in several
    // atoms; removing one occurrence wouldn't change the compiled OUTPUT
    // at all, since the candidate set — and so the generated CSS — would
    // stay identical).
    writeFileSync(buttonPath, original + `\nexport const __driftMarker = "opacity-37";\n`);
    const result = await checkCompiledCssFreshness({ packageRoot: dir });
    expect(result.inSync).toBe(false);
  });
});
