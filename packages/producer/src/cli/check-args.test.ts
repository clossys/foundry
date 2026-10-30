import { describe, expect, it } from "vitest";
import { CliUsageError, parseArgs, USAGE } from "./args.js";

describe("page check arguments", () => {
  it("accepts the manifest, report and JSON interface", () => {
    expect(parseArgs(["check", "--pages", "generated-manifest.json", "--report", "report.json", "--json"]))
      .toMatchObject({ verb: "check", pages: "generated-manifest.json", report: "report.json", json: true });
  });

  it("accepts a path base and flags before the verb", () => {
    expect(parseArgs(["--root", "preview", "--pages", "pages.json", "check", "--report", "reports/pages.json"]))
      .toMatchObject({ verb: "check", root: "preview", pages: "pages.json", report: "reports/pages.json" });
  });

  it.each([
    ["check"],
    ["check", "--pages", "pages.json"],
    ["check", "--report", "report.json"],
    ["check", "--pages"],
    ["check", "--report"],
    ["check", "--pages", "--report", "report.json"],
    ["check", "--pages", "pages.json", "--report", "--json"],
  ])("requires both valued paths: %j", (...argv) => {
    expect(() => parseArgs(argv)).toThrow(CliUsageError);
  });

  it("allows help without manifest and report paths", () => {
    expect(parseArgs(["check", "--help"])).toMatchObject({ verb: "check", help: true });
    expect(USAGE).toContain("clossys check --pages <generated-manifest.json> --report <report.json>");
  });

  it.each(["direct", "design", "write", "publish", "produce"])("keeps page flags exclusive to check for %s", verb => {
    for (const flag of ["--pages", "--report"]) {
      expect(() => parseArgs([verb, flag, "file.json"])).toThrow("--pages and --report require check");
    }
  });

  it.each([
    ["--once"], ["--port", "4300"], ["--no-open"], ["--target", "preview"],
  ])("rejects unrelated flags for check: %j", (...flags) => {
    expect(() => parseArgs(["check", "--pages", "pages.json", "--report", "report.json", ...flags]))
      .toThrow(CliUsageError);
  });

  it("preserves existing verb flag behavior", () => {
    expect(parseArgs(["produce", "--check", "--once", "--port", "4300", "--no-open"]))
      .toMatchObject({ verb: "produce", check: true, once: true, port: 4300, noOpen: true });
    expect(parseArgs(["publish", "--target", "preview", "--json"]))
      .toMatchObject({ verb: "publish", target: "preview", json: true });
    expect(parseArgs(["write", "--check", "--root", "."]))
      .toMatchObject({ verb: "write", check: true, root: "." });
  });
});
