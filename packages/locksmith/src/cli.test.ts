import { describe, expect, it } from "vitest";
import { CliInputError, USAGE, main, parseArgs } from "./cli.js";
import type { CliPort } from "./cli.js";

/**
 * A port that reads from an in-memory map. Nothing in this file touches a
 * real filesystem — the CLI's only outside contact is this object, which is
 * the whole reason it is injected.
 */
function testPort(files: Record<string, string> = {}): CliPort & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    readTextFile(path: string): string {
      const content = files[path];
      if (content === undefined) throw new Error(`no such file: ${path}`);
      return content;
    },
    writeOut: (text) => void out.push(text),
    writeErr: (text) => void err.push(text),
  };
}

const satisfiedEvidence = JSON.stringify({
  key: "GITHUB_TOKEN",
  credentialClass: "ephemeral-job",
  provider: "github-actions",
  scope: ["contents:read"],
  jobStartedAt: "2026-08-18T00:00:00.000Z",
  jobEndedAt: "2026-08-18T00:01:00.000Z",
  expiresAtJobEnd: true,
  scopedUseObserved: true,
});

// The exact shape this package's own header describes as violated: an
// ephemeral credential with no declared scope at all.
const violatedEvidence = JSON.stringify({
  key: "GITHUB_TOKEN",
  credentialClass: "ephemeral-job",
  provider: "github-actions",
  scope: [],
  jobStartedAt: "2026-08-18T00:00:00.000Z",
  jobEndedAt: "2026-08-18T00:01:00.000Z",
  expiresAtJobEnd: true,
  scopedUseObserved: true,
});

describe("parseArgs", () => {
  it("requires --evidence to have a value", () => {
    expect(() => parseArgs(["--evidence"])).toThrow(CliInputError);
  });

  it("rejects an unknown flag", () => {
    expect(() => parseArgs(["--evidence", "e.json", "--bogus"])).toThrow(CliInputError);
  });

  it("rejects a bad --format value", () => {
    expect(() => parseArgs(["--evidence", "e.json", "--format", "yaml"])).toThrow(CliInputError);
  });

  it("recognises --help without requiring --evidence", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
  });
});

describe("main", () => {
  it("prints usage and exits 0 for --help", () => {
    const port = testPort();
    expect(main(["--help"], port)).toBe(0);
    expect(port.out[0]).toBe(USAGE);
  });

  it("exits 2 when --evidence is missing", () => {
    const port = testPort();
    expect(main([], port)).toBe(2);
    expect(port.err.join("")).toContain("--evidence is required");
  });

  it("exits 2 for an unreadable evidence file", () => {
    const port = testPort();
    expect(main(["--evidence", "missing.json"], port)).toBe(2);
    expect(port.err.join("")).toContain("could not read the evidence document");
  });

  it("exits 2 for evidence that is not valid JSON", () => {
    const port = testPort({ "e.json": "{not json" });
    expect(main(["--evidence", "e.json"], port)).toBe(2);
  });

  it("exits 0 and reports SATISFIED for real, well-formed evidence", () => {
    const port = testPort({ "e.json": satisfiedEvidence });
    expect(main(["--evidence", "e.json"], port)).toBe(0);
    expect(port.out.join("")).toContain("verdict: SATISFIED (exit 0)");
  });

  // THE FAILURE PROOF: a deliberately violating evidence document must
  // produce a real, non-zero exit — not merely a dark judge that always
  // reports clean. See this repository's PR description for the same
  // command run directly against the compiled CLI.
  it("exits 1 and reports VIOLATED for evidence proving a real problem", () => {
    const port = testPort({ "e.json": violatedEvidence });
    expect(main(["--evidence", "e.json"], port)).toBe(1);
    expect(port.out.join("")).toContain("verdict: VIOLATED (exit 1)");
    expect(port.out.join("")).toContain("missing-scope");
  });

  it("renders JSON output when asked", () => {
    const port = testPort({ "e.json": satisfiedEvidence });
    expect(main(["--evidence", "e.json", "--format", "json"], port)).toBe(0);
    const parsed = JSON.parse(port.out.join(""));
    expect(parsed.verdict).toBe("satisfied");
    expect(parsed.exitCode).toBe(0);
  });

  it("never throws even for structurally hostile evidence", () => {
    const port = testPort({ "e.json": JSON.stringify({ __proto__: { polluted: true } }) });
    expect(() => main(["--evidence", "e.json"], port)).not.toThrow();
  });
});
