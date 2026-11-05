import { store } from "../test/store.js";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliInputError, main, parseArgs, runDirectorCli } from "./cli.js";
import { stageFinding, stageWontClaimCells } from "./ground/fixtures.js";

// Hermetic: every test operates on its own pair of `mkdtemp` directories
// (strategy + scan), removed afterward, and calls the exported `main(argv, store)`
// directly rather than spawning the real CLI process.

let strategyDir: string;
let scanDir: string;
let factsDir: string;


beforeEach(() => {
  strategyDir = mkdtempSync(join(tmpdir(), "strategy-cli-strategy-"));
  scanDir = mkdtempSync(join(tmpdir(), "strategy-cli-scan-"));
  factsDir = mkdtempSync(join(tmpdir(), "strategy-cli-factsdir-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  rmSync(strategyDir, { recursive: true, force: true });
  rmSync(scanDir, { recursive: true, force: true });
  rmSync(factsDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("parseArgs", () => {
  it("collects repeatable --extensions values", () => {
    expect(parseArgs(["./clossys/director", "./docs", "--extensions", ".md", "--extensions", ".txt"]).extensions).toEqual([
      ".md",
      ".txt",
    ]);
  });

  it("collects repeatable --skip-dirs values", () => {
    expect(parseArgs(["./clossys/director", "--skip-dirs", "vendor", "--skip-dirs", ".cache"]).skipDirs).toEqual([
      "vendor",
      ".cache",
    ]);
  });

  it("collects repeatable --exclude globs", () => {
    expect(parseArgs(["./clossys/director", "--exclude", "**/*.test.ts", "--exclude", "**/fixtures/**"]).excludeGlobs).toEqual(
      ["**/*.test.ts", "**/fixtures/**"],
    );
  });

  it("throws CliInputError when --extensions is given without a value", () => {
    expect(() => parseArgs([strategyDir, "--extensions"])).toThrow(CliInputError);
  });

  it("throws CliInputError when --extensions omits the leading dot", () => {
    expect(() => parseArgs([strategyDir, "--extensions", "md"])).toThrow(CliInputError);
  });

  it("throws CliInputError when --skip-dirs is given without a value", () => {
    expect(() => parseArgs([strategyDir, "--skip-dirs"])).toThrow(CliInputError);
  });

  it("throws CliInputError on an unknown flag", () => {
    expect(() => parseArgs([strategyDir, "--bogus"])).toThrow(CliInputError);
  });
});

describe("main — argument handling", () => {
  it("--help returns 0 without touching either directory", () => {
    expect(main(["--help"], store)).toBe(0);
  });

  it("throws CliInputError when the default clossys/agents/director directory is missing", () => {
    const cwd = mkdtempSync(join(tmpdir(), "strategy-cli-cwd-"));
    const originalCwd = process.cwd();
    process.chdir(cwd);
    try {
      expect(() => main([], store)).toThrow(CliInputError);
    } finally {
      process.chdir(originalCwd);
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("throws CliInputError on an unknown flag", () => {
    expect(() => main([strategyDir, scanDir, "--bogus"], store)).toThrow(CliInputError);
  });

  it("throws CliInputError when strategy-dir does not exist", () => {
    expect(() => main([join(strategyDir, "does-not-exist"), scanDir], store)).toThrow(CliInputError);
  });
});

describe("main — default ground root", () => {
  it("uses clossys/agents/director and does not fall back to old strategy roots", () => {
    const cwd = mkdtempSync(join(tmpdir(), "strategy-cli-cwd-")); const original = process.cwd();
    process.chdir(cwd);
    try {
      writeFileSync(join(cwd, "page.md"), "4,200 customers");
      mkdirSync(join(cwd, "strategy")); stageFinding(join(cwd, "strategy"));
      mkdirSync(join(cwd, "clossys/director"), { recursive: true }); stageFinding(join(cwd, "clossys/director"));
      expect(() => main([], store)).toThrow(CliInputError);
      expect(existsSync(join(cwd, "clossys/agents/director"))).toBe(false);
      mkdirSync(join(cwd, "clossys/agents/director"), { recursive: true }); stageFinding(join(cwd, "clossys/agents/director"));
      // Old roots are ordinary scan content; limit the scan to the page.
      expect(main(["--exclude", "strategy/**", "--exclude", "clossys/director/**"], store)).toBe(0);
    } finally { process.chdir(original); rmSync(cwd, { recursive: true, force: true }); }
  });

  it.each(["directory", "worktree-file"])("finds the default from nested cwd with a .git %s", marker => {
    const repo = mkdtempSync(join(tmpdir(), "strategy-cli-repo-"));
    const original = process.cwd();
    const cwd = join(repo, "packages", "app");
    const root = join(repo, "clossys", "agents", "director");
    mkdirSync(cwd, { recursive: true });
    if (marker === "directory") mkdirSync(join(repo, ".git"));
    else writeFileSync(join(repo, ".git"), "gitdir: ../metadata/worktrees/app\n");
    stageFinding(root);
    writeFileSync(join(cwd, "page.md"), "We serve 4,200 customers.");
    process.chdir(cwd);
    try {
      expect(main(["ground", "."], store)).toBe(0);
      expect(loggedLines("log")).toContain(`Strategy directory: ${root}`);
      expect(loggedLines("log")).toContain(`Scan directory: ${cwd}`);
      expect(existsSync(join(cwd, "clossys"))).toBe(false);
    } finally { process.chdir(original); rmSync(repo, { recursive: true, force: true }); }
  });

  it("keeps explicit --root and positional roots relative to nested cwd", () => {
    const repo = mkdtempSync(join(tmpdir(), "strategy-cli-repo-"));
    const original = process.cwd();
    const cwd = join(repo, "packages", "app");
    const explicitRoot = join(cwd, "custom-root");
    mkdirSync(cwd, { recursive: true });
    mkdirSync(join(repo, ".git"));
    stageFinding(explicitRoot);
    writeFileSync(join(cwd, "page.md"), "We serve 4,200 customers.");
    process.chdir(cwd);
    try {
      expect(main(["ground", "--root", "custom-root", "."], store)).toBe(0);
      expect(main(["ground", "--root=custom-root", "."], store)).toBe(0);
      expect(main(["custom-root", "."], store)).toBe(0);
      expect(loggedLines("log").filter(line => line === `Strategy directory: ${explicitRoot}`)).toHaveLength(3);
    } finally { process.chdir(original); rmSync(repo, { recursive: true, force: true }); }
  });

  it("uses the repository default for wont-claim from nested cwd", () => {
    const repo = mkdtempSync(join(tmpdir(), "strategy-cli-repo-"));
    const original = process.cwd();
    const cwd = join(repo, "packages", "app");
    const root = join(repo, "clossys", "agents", "director");
    mkdirSync(cwd, { recursive: true });
    mkdirSync(join(repo, ".git"));
    mkdirSync(root, { recursive: true });
    stageWontClaimCells(root);
    writeFileSync(join(cwd, "page.md"), "A calm page.");
    process.chdir(cwd);
    try {
      expect(main(["wont-claim", "."], store)).toBe(0);
      expect(existsSync(join(root, "reports", "wont-claim.json"))).toBe(true);
      expect(existsSync(join(cwd, "clossys"))).toBe(false);
    } finally { process.chdir(original); rmSync(repo, { recursive: true, force: true }); }
  });
});

describe("main — the third state: could not run", () => {
  it("returns 2 when findings are missing (fail closed, never a silent pass)", () => {
    writeFileSync(join(scanDir, "about.md"), "Nothing claim-shaped here.");
    expect(main([strategyDir, scanDir], store)).toBe(2);
  });

  it("returns 2 when a finding is invalid", () => {
    mkdirSync(join(strategyDir, "findings"));
    writeFileSync(join(strategyDir, "findings/broken.md"), "not frontmatter");
    writeFileSync(join(scanDir, "about.md"), "Nothing claim-shaped here.");
    expect(main([strategyDir, scanDir], store)).toBe(2);
  });

  it("returns 2 when zero files match the scan (never reported as a clean pass)", () => {
    stageFinding(strategyDir);
    writeFileSync(join(scanDir, "data.json"), "{}"); // .json is not a scanned extension
    expect(main([strategyDir, scanDir], store)).toBe(2);
  });
});

describe("main — real runs", () => {
  it("returns 0 on a clean pass", () => {
    stageFinding(strategyDir);
    writeFileSync(join(scanDir, "about.md"), "We now serve 4,200 customers.");
    expect(main([strategyDir, scanDir], store)).toBe(0);
  });

  it("returns 1 when a finding is present", () => {
    stageFinding(strategyDir);
    writeFileSync(join(scanDir, "about.md"), "We now serve 9,999 customers.");
    expect(main([strategyDir, scanDir], store)).toBe(1);
  });

  it("an issue on an OPTIONAL strategy file does not block the facts gate", () => {
    stageFinding(strategyDir);
    writeFileSync(join(strategyDir, "roadmap.json"), JSON.stringify([{ id: "x" }])); // invalid, but not facts.json
    writeFileSync(join(scanDir, "about.md"), "We now serve 4,200 customers.");
    expect(main([strategyDir, scanDir], store)).toBe(0);
  });

  it("honors --extensions to limit scanned file types", () => {
    stageFinding(strategyDir);
    writeFileSync(join(scanDir, "about.md"), "We now serve 4,200 customers.");
    expect(main([strategyDir, scanDir, "--extensions", ".txt"], store)).toBe(2);
  });

  it("still skips node_modules when --skip-dirs adds extra names", () => {
    stageFinding(strategyDir);
    writeFileSync(join(scanDir, "about.md"), "We now serve 4,200 customers.");
    const nested = join(scanDir, "node_modules", "pkg");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, "readme.md"), "We now serve 9,999 customers.");
    expect(main([strategyDir, scanDir, "--skip-dirs", "vendor"], store)).toBe(0);
  });

  it("honors --exclude to omit test paths from the scan", () => {
    stageFinding(strategyDir);
    writeFileSync(join(scanDir, "about.md"), "We now serve 4,200 customers.");
    mkdirSync(join(scanDir, "src"), { recursive: true });
    writeFileSync(join(scanDir, "src", "widget.test.ts"), "We now serve 9,999 customers.");
    expect(main([strategyDir, scanDir, "--exclude", "**/*.test.ts"], store)).toBe(0);
    expect(main([strategyDir, scanDir], store)).toBe(1);
  });
});

describe("runDirectorCli — the error boundary clossys director check runs", () => {
  it("<strategy-dir> [scan-dir] with NO subcommand runs ground over findings", () => {
    stageFinding(strategyDir);
    writeFileSync(join(scanDir, "about.md"), "We now serve 4,200 customers.");
    expect(runDirectorCli([strategyDir, scanDir], store)).toBe(0);
    expect(loggedLines("log")).toContain("No findings.");

    writeFileSync(join(scanDir, "about.md"), "We now serve 9,999 customers.");
    expect(runDirectorCli([strategyDir, scanDir], store)).toBe(1);
    expect(loggedLines("log").some((line) => line.includes("finding(s)"))).toBe(true);
  });

  it("maps usage errors to exit 2 with the clossys director check prefix", () => {
    expect(runDirectorCli(["--no-such-flag"], store)).toBe(2);
    expect(loggedLines("error").some((line) => line.startsWith("clossys director check: "))).toBe(true);
  });
});

function loggedLines(stream: "log" | "error"): string[] {
  return vi.mocked(console[stream]).mock.calls.map((call) => String(call[0]));
}

function stageWontClaim(page: string): void {
  stageWontClaimCells(strategyDir);
  writeFileSync(join(scanDir, "page.md"), page);
}

describe("main — wont-claim", () => {
  it("the top-level usage names the wont-claim subcommand", { timeout: 8_000 }, () => {
    expect(main(["--help"], store)).toBe(0);
    const usage = loggedLines("log").join("\n");
    expect(usage).toContain("clossys director check wont-claim <strategy-dir> <scan-dir>");
    expect(usage).toContain('"clossys director check wont-claim --help"');
  });

  it("--help prints the subcommand usage and exits 0", { timeout: 8_000 }, () => {
    expect(main(["wont-claim", "--help"], store)).toBe(0);
    expect(loggedLines("log").some((line) => line.includes("Usage: clossys director check wont-claim"))).toBe(true);
  });

  it("wont-claim exit codes", { timeout: 8_000 }, () => {
    stageWontClaim("A calm page with no promises.");
    expect(main(["wont-claim", strategyDir, scanDir], store)).toBe(0);

    writeFileSync(join(scanDir, "page.md"), "Enjoy Guaranteed Results today.");
    expect(main(["wont-claim", strategyDir, scanDir], store)).toBe(1);
    expect(loggedLines("log").some((line) => line.includes("page.md:1"))).toBe(true);

    writeFileSync(join(scanDir, "page.md"), "Fine.");
    expect(main(["wont-claim", strategyDir, strategyDir], store)).toBe(2); // evidence is not a surface
    rmSync(join(strategyDir, "tree.json"));
    expect(main(["wont-claim", strategyDir, scanDir], store)).toBe(2);

    writeFileSync(join(strategyDir, "tree.json"), "invalid JSON");
    expect(main(["wont-claim", strategyDir, scanDir], store)).toBe(2);

    stageWontClaimCells(strategyDir);
    rmSync(join(scanDir, "page.md"));
    expect(main(["wont-claim", strategyDir, scanDir], store)).toBe(2);
  });

  it("honours --extensions and --exclude, and treats zero matching files as exit 2", { timeout: 8_000 }, () => {
    stageWontClaim("clean");
    writeFileSync(join(scanDir, "app.ts"), 'export const s = "guaranteed results";');
    expect(main(["wont-claim", strategyDir, scanDir], store)).toBe(0); // .ts is not a default extension
    expect(main(["wont-claim", strategyDir, scanDir, "--extensions", ".ts"], store)).toBe(1);
    expect(main(["wont-claim", strategyDir, scanDir, "--extensions", ".ts", "--exclude", "app.ts"], store)).toBe(2);
  });

  it("refuses bad arguments with a CliInputError", { timeout: 8_000 }, () => {
    expect(() => main(["wont-claim"], store)).toThrow(CliInputError);
    expect(() => main(["wont-claim", strategyDir, scanDir, "--bogus"], store)).toThrow(CliInputError);
    expect(() => main(["wont-claim", strategyDir, scanDir, "--facts-dir", factsDir], store)).toThrow(CliInputError);
  });
});
