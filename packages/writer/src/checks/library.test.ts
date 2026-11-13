import { cpSync, mkdtempSync, rmSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mainWriterLibrary } from "../cli.js";
import { computeCopyFingerprint } from "../fingerprint.js";

let temporary: string;

function fixture(name: string): string {
  const root = join(temporary, name);
  cpSync(fileURLToPath(new URL(`../../fixtures/${name}`, import.meta.url)), root, { recursive: true });
  return root;
}

function output(): string {
  return [...vi.mocked(console.log).mock.calls, ...vi.mocked(console.error).mock.calls]
    .map(call => call.map(String).join(" "))
    .join("\n");
}

beforeEach(() => {
  temporary = mkdtempSync(join(tmpdir(), "writer-library-cli-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(temporary, { recursive: true, force: true });
});

describe("Writer library CLI rule fixtures", () => {
  it("accepts approved source and current translated copy with unsigned freeze proposals", () => {
    expect(mainWriterLibrary([fixture("library-clean")])).toBe(0);
  });

  it.each([
    ["library-wr2-freeze", "WR2"],
    ["library-wr3-closed-world", "WR3"],
    ["library-wr4-purity", "WR4"],
    ["library-wr7-length", "WR7"],
    ["library-wr8-icu", "WR8"],
    ["library-wr9-expansion", "WR9"],
    ["library-wr10-coverage", "WR10"],
    ["library-wr11-approval", "WR11"],
  ])("rejects %s and names %s", (name, code) => {
    expect(mainWriterLibrary([fixture(name)])).toBe(1);
    expect(output()).toMatch(new RegExp(`\\b${code}\\b`));
  });

  it("reports inline passage copy as WR4 while retaining its WR1 shape failure", () => {
    expect(mainWriterLibrary([fixture("library-wr4-purity")])).toBe(1);
    expect(output()).toMatch(/\bWR1\b/);
    expect(output()).toMatch(/\bWR4\b/);
  });

  it("distinguishes pseudo expansion overflow from actual length and stale approval", () => {
    expect(mainWriterLibrary([fixture("library-wr9-expansion")])).toBe(1);
    expect(output()).toMatch(/\bWR9\b/);
    expect(output()).not.toMatch(/\bWR7\b|\bWR11\b/);
    expect(output()).toContain("st.0000000001:text");
  });

  it("keeps translation provenance current when only owner approval is stale", () => {
    expect(mainWriterLibrary([fixture("library-wr11-approval")])).toBe(1);
    expect(output()).toMatch(/\bWR11\b/);
    expect(output()).not.toMatch(/\bWR10\b/);
  });

  it("returns 2 when Intl cannot validate a declared locale's plural rules", () => {
    const root = fixture("library-clean"), manifestPath = join(root, "writer.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.locales = manifest.locales.map((locale: { tag: string }) => locale.tag === "fr" ? { ...locale, tag: "zz" } : locale);
    writeFileSync(manifestPath, JSON.stringify(manifest));
    renameSync(join(root, "fr"), join(root, "zz"));
    const text = "{n, plural, other {#}}";
    for (const locale of ["en", "zz"]) {
      const file = join(root, locale, "strings/interface.json"), rows = JSON.parse(readFileSync(file, "utf8"));
      rows[0].text = text; rows[0].args = [{ name: "n", type: "plural" }];
      rows[0].approval.textFingerprint = computeCopyFingerprint(text);
      if (rows[0].translation) rows[0].translation.sourceFingerprint = computeCopyFingerprint(text);
      writeFileSync(file, JSON.stringify(rows));
    }
    expect(mainWriterLibrary([root])).toBe(2);
    expect(output()).toMatch(/\bWR8\b/);
    expect(output()).toContain("unsupported locale");
  });

  it("returns 2 when the library root is unavailable", () => {
    expect(mainWriterLibrary([join(temporary, "missing-library")])).toBe(2);
  });
});
