// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOKENS, checkBrandFileCoverage } from "@clossys/designer/tokens";
import { readBrandCss } from "@clossys/designer/tokens/server";
import { main as media } from "./media/cli.js";
import { main as record } from "./record/cli.js";
import { main as preview } from "./preview/cli.js";
import { main as rate } from "./verified-publication-rate-cli.js";

const adapter = JSON.parse(readFileSync(new URL("../../../governance/release-qualification-adapters/publisher/current-direct.json", import.meta.url), "utf8")) as {
  cases: { id: string; bin: string; fixtureArgs?: string[]; args?: { fixture?: string; literal?: string }[]; exitCode: number }[];
};
const fixtures = new URL("../../../governance/release-qualification-fixtures/publisher/current-direct/", import.meta.url);
const bins: Record<string, (argv: string[]) => number> = {
  "publisher-media-check": media,
  "publisher-record-check": record,
  "publisher-preview": preview,
  "publisher-rate-check": rate,
};
let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "publisher-qualification-fixture-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});

describe("qualification adapter fixture controls", () => {
  for (const item of adapter.cases) {
    it(item.id, async () => {
      const args = item.fixtureArgs
        ? item.fixtureArgs.map(value => fileURLToPath(new URL(value, fixtures)))
        : item.args!.map(value => value.fixture
          ? fileURLToPath(new URL(value.fixture, fixtures))
          : value.literal === "preview-output" ? join(directory, value.literal) : value.literal!);
      let exit: number;
      if (item.bin === "publisher-web-route-check") {
        // This CLI executes on import. Isolate its module cache and restore
        // process state so both adapter cases exercise the actual entrypoint.
        const argv = process.argv;
        const exitCode = process.exitCode;
        try {
          process.argv = [argv[0]!, "publisher-web-route-check", ...args];
          vi.resetModules();
          await import("./web/checkWebRoutesCli.js");
          exit = Number(process.exitCode);
        } finally {
          process.argv = argv;
          process.exitCode = exitCode;
        }
      } else {
        exit = bins[item.bin]!(args);
      }
      const stderr = vi.mocked(console.error).mock.calls.map(call => call.join(" ")).join("\n");
      expect(exit, stderr).toBe(item.exitCode);
      if (item.bin === "publisher-preview") {
        const parsed = readBrandCss(args[0]!);
        expect(parsed.complete).toBe(true);
        expect(parsed.issues).toEqual([]);
        expect(parsed.unchecked).toEqual([]);
        const coverage = checkBrandFileCoverage(parsed.declarations);
        expect(coverage.unchecked).toEqual([]);
        if (item.exitCode === 0) {
          expect(coverage.findings).toEqual([]);
          for (const file of ["gallery.html", "index.html", "content-catalog.html"]) {
            expect(existsSync(join(args[1]!, file)), file).toBe(true);
          }
        } else {
          expect(coverage.findings.map(finding => finding.rule)).toEqual(Object.values(TOKENS).filter(token => token.brandable).map(() => "uncovered-brandable-slot"));
          expect(coverage.findings.map(finding => finding.slot).sort()).toEqual(Object.entries(TOKENS).filter(([, token]) => token.brandable).map(([slot]) => slot).sort());
          expect(stderr).toContain(`Brand CSS failed coverage (${coverage.findings.length} finding(s)).`);
          expect(existsSync(args[1]!)).toBe(false);
        }
      }
    });
  }
});

it.each([
  "--color-control-tonal",
  "--color-control-tonal-hover",
  "--color-control-tonal-inverse",
  "--color-control-tonal-inverse-hover",
  "--color-control-quiet",
  "--radius-panel",
  "--ui-border-panel",
  "--color-line-panel",
  "--ui-elevation-panel",
  "--color-surface-glass",
  "--color-surface-glass-inverse",
  "--blur-glass",
])("refuses covered preview after removing %s", slot => {
  const original = readFileSync(new URL("preview-brand-covered.css", fixtures), "utf8");
  const declaration = new RegExp(`^  ${slot}: [^\\n]*\\n`, "gm");
  expect(original.match(declaration)).toHaveLength(1);
  const path = join(directory, "brand.css");
  const output = join(directory, "preview-output");
  writeFileSync(path, original.replace(declaration, ""));
  const parsed = readBrandCss(path);
  expect(parsed.complete).toBe(true);
  expect(parsed.issues).toEqual([]);
  expect(parsed.unchecked).toEqual([]);
  const coverage = checkBrandFileCoverage(parsed.declarations);
  expect(coverage.unchecked).toEqual([]);
  expect(coverage.findings.map(({ rule, slot }) => ({ rule, slot }))).toEqual([{ rule: "uncovered-brandable-slot", slot }]);
  expect(preview([path, output])).toBe(1);
  expect(console.error).toHaveBeenCalledWith("publisher-preview: Brand CSS failed coverage (1 finding(s)).");
  expect(existsSync(output)).toBe(false);
});
