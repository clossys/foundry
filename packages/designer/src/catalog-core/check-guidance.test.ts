// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CHECK_CODES, CHECK_GUIDANCE, type CheckGuidance } from "./check-guidance.js";
import type { Finding } from "./types.js";

// Removing a row or extending Finding.code without guidance is a compiler error.
const exhaustive: Record<Finding["code"], CheckGuidance> = CHECK_GUIDANCE;
const root = fileURLToPath(new URL("../../../../", import.meta.url));

describe("consumer check guidance", () => {
  it("gives every runtime code a concrete explanation and only supported proposed operations", () => {
    expect(CHECK_CODES.length).toBeGreaterThan(0);
    expect(new Set(CHECK_CODES).size).toBe(CHECK_CODES.length);
    for (const code of CHECK_CODES) {
      const row = exhaustive[code];
      expect(row.meaning.length).toBeGreaterThan(15);
      expect(row.typicalCause.length).toBeGreaterThan(15);
      expect(row.fix.length).toBeGreaterThan(15);
      for (const op of row.fixOps) expect(["adopt", "author", "derive", "remove"]).toContain(op);
      for (const severity of row.severities) expect(["error", "notice", "warning"]).toContain(severity);
    }
    expect(CHECK_GUIDANCE.R.severities).toEqual([]);
    expect(CHECK_GUIDANCE.C8.fixOps).toEqual([]);
    expect(CHECK_GUIDANCE.C10.severities).toContain("notice");
    expect(CHECK_GUIDANCE.A10.fix).toContain("does not supply image records");
  });

  it("keeps the read-only check procedure honest about unsupported layers and human writes", () => {
    const guide = readFileSync(new URL("../../skill/library-check.md", import.meta.url), "utf8");
    expect(guide).toContain("--layer themes --json");
    expect(guide).toContain("--layer assets --json");
    expect(guide).toContain("requesting those layers exits 2");
    expect(guide).toContain("Scale and role are leaf metadata only");
    expect(guide).toContain("without an explicit human instruction");
    expect(guide).toContain("chooser never authors values");
  });

  it("generates the checked-in reference deterministically from the exhaustive record", async () => {
    // Repository-only JS tooling is intentionally outside the package's TS build.
    const script = new URL("scripts/generate-check-docs.mjs", `file://${root}`);
    const { generateCheckDocs } = await import(/* @vite-ignore */ script.href);
    const expected = readFileSync(new URL("../../skill/check-codes.md", import.meta.url), "utf8");
    expect(await generateCheckDocs()).toBe(expected);
    expect(await generateCheckDocs()).toBe(expected);
    for (const code of CHECK_CODES) expect(expected).toContain(`## ${code}\n`);
  });
});
