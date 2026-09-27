import { spawn } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { LocksmithCliInputError, isDirectInvocation, main } from "./secret-environments-cli.js";

let root: string;
let binPath: string;

const OBSERVED_AT = "2026-09-27T00:00:00.000Z";

function declaration(): Record<string, unknown> {
  return {
    version: 2,
    environments: ["development", "preview", "production"],
    source: {
      id: "secret-manager",
      provider: "infisical",
      role: "secret-manager",
      environmentMap: { development: "dev", preview: "staging", production: "prod" },
    },
    deliveryTargets: [
      {
        id: "web-hosting",
        provider: "vercel",
        environmentMap: { development: "development", preview: "preview", production: "production" },
        sync: "provider-integration",
      },
    ],
    entries: [
      {
        key: "DATABASE_URL",
        required: true,
        class: "secret",
        purpose: "Connects the web app to its own database.",
        consumers: ["web"],
        deliveryTargets: ["web-hosting"],
      },
      {
        key: "NEXT_PUBLIC_SITE_URL",
        required: true,
        class: "public-config",
        purpose: "Canonical site origin rendered into pages.",
        consumers: ["web"],
        deliveryTargets: ["web-hosting"],
      },
    ],
  };
}

function sourceInventory(): Record<string, unknown> {
  return {
    version: 1,
    provider: "infisical",
    location: "secret-manager",
    observedAt: OBSERVED_AT,
    environments: ["dev", "staging", "prod"],
    entries: [
      { name: "DATABASE_URL", environments: ["dev"], storage: "managed" },
      { name: "DATABASE_URL", environments: ["staging"], storage: "managed" },
      { name: "DATABASE_URL", environments: ["prod"], storage: "managed" },
    ],
  };
}

function targetInventory(): Record<string, unknown> {
  return {
    version: 1,
    provider: "vercel",
    location: "web-hosting",
    observedAt: OBSERVED_AT,
    environments: ["development", "preview", "production"],
    entries: [
      { name: "DATABASE_URL", environments: ["development"], storage: "sensitive" },
      { name: "DATABASE_URL", environments: ["preview"], storage: "sensitive" },
      { name: "DATABASE_URL", environments: ["production"], storage: "sensitive" },
      { name: "NEXT_PUBLIC_SITE_URL", environments: ["development", "preview", "production"], storage: "readable" },
    ],
  };
}

function write(name: string, value: unknown): string {
  const path = join(root, name);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

/** Writes raw, deliberately-not-JSON text -- distinct from write() above, which always JSON.stringifies its value. */
function writeRaw(name: string, text: string): string {
  const path = join(root, name);
  writeFileSync(path, text);
  return path;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "locksmith-secret-environments-cli-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

beforeAll(() => {
  const packageRoot = fileURLToPath(new URL("..", import.meta.url));
  // dist/ was built once, before any test file started, by the package's
  // vitest globalSetup (scripts/lib/vitest-build-package.mjs). Never rebuild
  // it here: a sibling test file may be executing or packing it (#1385).

  const workDir = mkdtempSync(join(tmpdir(), "locksmith-secret-environments-bin-"));
  const dotBin = join(workDir, "node_modules", ".bin");
  mkdirSync(dotBin, { recursive: true });
  const installedDistDir = join(workDir, "dist");
  mkdirSync(installedDistDir, { recursive: true });
  for (const file of ["secret-environments-cli.js", "secret-environments.js", "credential.js", "generated/check-output-envelope.js"]) {
    const target = join(installedDistDir, file);
    mkdirSync(join(target, ".."), { recursive: true });
    cpSync(join(packageRoot, "dist", file), target);
  }
  const installedCliPath = join(installedDistDir, "secret-environments-cli.js");
  chmodSync(installedCliPath, 0o755);
  binPath = join(dotBin, "clossys-locksmith-secret-environments");
  symlinkSync(installedCliPath, binPath);
}, 60_000);

/**
 * Runs the installed CLI bin and resolves once its stdout/stderr have fully
 * ended AND the process has exited -- never before. See
 * provider-custody-cli.test.ts's identical helper for the full account of
 * why `spawn()` is used instead of `spawnSync` here (#1333/#1341).
 */
function spawnCapture(
  command: string,
  args: string[],
  options: { timeout: number },
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, options);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", rejectPromise);
    child.on("close", (status) => {
      resolvePromise({ status, stdout, stderr });
    });
  });
}

async function runBin(args: string[]) {
  const options = { timeout: 8_000 };
  try {
    return await spawnCapture(binPath, args, options);
  } catch {
    return await spawnCapture(process.execPath, [binPath, ...args], options);
  }
}

describe("clossys-locksmith-secret-environments: main()", () => {
  it("prints help and exits 0", () => {
    expect(main(["--help"])).toBe(0);
    expect(main(["-h"])).toBe(0);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Usage: clossys-locksmith-secret-environments"));
  });

  it("requires --declaration", () => {
    expect(() => main([])).toThrow(LocksmithCliInputError);
    expect(() => main(["--inventory", write("i.json", sourceInventory())])).toThrow(LocksmithCliInputError);
  });

  it("rejects a repeated --declaration, a repeated --mode, an unknown option, a missing value, a positional argument, and a bad mode", () => {
    const decl = write("declaration.json", declaration());
    expect(() => main(["--declaration", decl, "--declaration", decl])).toThrow(/--declaration may be given only once/);
    expect(() => main(["--declaration", decl, "--mode", "report", "--mode", "enforce"])).toThrow(/--mode may be given only once/);
    expect(() => main(["--declaration", decl, "--bogus"])).toThrow(/unknown option/);
    expect(() => main(["--declaration"])).toThrow(/--declaration requires a value/);
    expect(() => main(["--declaration", decl, "extra"])).toThrow(/unexpected argument/);
    expect(() => main(["--declaration", decl, "--mode", "nightly"])).toThrow(/--mode must be "report" or "enforce"/);
  });

  it("names only the path and role for an unreadable file, never the parser's error text or the file's contents", () => {
    const decoy = "DATABASE_URL=fixture-decoy-not-a-real-value";
    const badDeclaration = writeRaw("bad-declaration.json", decoy);
    let error: unknown;
    try {
      main(["--declaration", badDeclaration]);
    } catch (cause) {
      error = cause;
    }
    expect(error).toBeInstanceOf(LocksmithCliInputError);
    expect((error as Error).message).toBe(`declaration file "${badDeclaration}" could not be read as JSON`);
    expect((error as Error).message).not.toContain(decoy);
    expect((error as Error).message).not.toContain("JSON.parse");
    expect((error as Error).message).not.toContain("Unexpected token");

    const goodDeclaration = write("declaration.json", declaration());
    const badInventory = writeRaw("bad-inventory.json", decoy);
    let inventoryError: unknown;
    try {
      main(["--declaration", goodDeclaration, "--inventory", badInventory]);
    } catch (cause) {
      inventoryError = cause;
    }
    expect(inventoryError).toBeInstanceOf(LocksmithCliInputError);
    expect((inventoryError as Error).message).toBe(`inventory file "${badInventory}" could not be read as JSON`);
    expect((inventoryError as Error).message).not.toContain(decoy);

    // A missing file, and a file that is not a plain file, use the same message shape.
    expect(() => main(["--declaration", join(root, "missing.json")])).toThrow(/declaration file ".*" could not be read as JSON/);
  });

  it("maps the exit matrix {satisfied, violated, indeterminate} x {report, enforce}", () => {
    const decl = write("declaration.json", declaration());
    const source = write("source.json", sourceInventory());
    const target = write("target.json", targetInventory());

    const driftTarget = targetInventory();
    (driftTarget.entries as Record<string, unknown>[])[1] = {
      name: "DATABASE_URL",
      environments: ["preview", "production"],
      storage: "sensitive",
    };
    const violatedTarget = write("violated-target.json", driftTarget);

    let output = "";
    (console.log as ReturnType<typeof vi.fn>).mockImplementation((text: string) => {
      output += text;
    });

    // satisfied: report 0, enforce 0.
    output = "";
    expect(main(["--declaration", decl, "--inventory", source, "--inventory", target])).toBe(0);
    expect(JSON.parse(output).verdict).toBe("satisfied");
    output = "";
    expect(main(["--declaration", decl, "--inventory", source, "--inventory", target, "--mode", "enforce"])).toBe(0);
    expect(JSON.parse(output).verdict).toBe("satisfied");

    // violated: report 2, enforce 1.
    output = "";
    expect(main(["--declaration", decl, "--inventory", source, "--inventory", violatedTarget])).toBe(2);
    expect(JSON.parse(output).verdict).toBe("violated");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("report mode"));
    output = "";
    expect(main(["--declaration", decl, "--inventory", source, "--inventory", violatedTarget, "--mode", "enforce"])).toBe(1);
    expect(JSON.parse(output).verdict).toBe("violated");

    // indeterminate (zero --inventory flags is allowed at the argument level;
    // the evaluator reports inventories-empty): report 2, enforce 2.
    output = "";
    expect(main(["--declaration", decl])).toBe(2);
    expect(JSON.parse(output).verdict).toBe("indeterminate");
    output = "";
    expect(main(["--declaration", decl, "--mode", "enforce"])).toBe(2);
    expect(JSON.parse(output).verdict).toBe("indeterminate");
  });

  it("takes every repeated --inventory flag into account: satisfied only once both the source and target snapshots are given", () => {
    const decl = write("declaration.json", declaration());
    const source = write("source.json", sourceInventory());
    const target = write("target.json", targetInventory());

    let output = "";
    (console.log as ReturnType<typeof vi.fn>).mockImplementation((text: string) => {
      output += text;
    });

    // Only the target: the source's environments are never observed, and the
    // source-only required key is missing there too.
    output = "";
    expect(main(["--declaration", decl, "--inventory", target])).toBe(2);
    expect(JSON.parse(output).verdict).toBe("indeterminate");

    // Only the source: the target is never observed.
    output = "";
    expect(main(["--declaration", decl, "--inventory", source])).toBe(2);
    expect(JSON.parse(output).verdict).toBe("indeterminate");

    // Both, in either order: satisfied.
    output = "";
    expect(main(["--declaration", decl, "--inventory", source, "--inventory", target])).toBe(0);
    expect(JSON.parse(output).verdict).toBe("satisfied");
    output = "";
    expect(main(["--declaration", decl, "--inventory", target, "--inventory", source])).toBe(0);
    expect(JSON.parse(output).verdict).toBe("satisfied");
  });

  it("recognizes invocation through an installed-style POSIX bin symlink", () => {
    const sourceUrl = new URL("./secret-environments-cli.ts", import.meta.url);
    const linked = join(root, "clossys-locksmith-secret-environments");
    symlinkSync(fileURLToPath(sourceUrl), linked);
    expect(isDirectInvocation(sourceUrl.href, linked)).toBe(true);
  });
});

describe("clossys-locksmith-secret-environments, invoked through a node_modules/.bin-shaped symlink", () => {
  it("exits 0 with a satisfied envelope", async () => {
    const result = await runBin([
      "--declaration",
      write("declaration.json", declaration()),
      "--inventory",
      write("source.json", sourceInventory()),
      "--inventory",
      write("target.json", targetInventory()),
    ]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).verdict).toBe("satisfied");
  });

  it("exits 2 for a missing declaration file without ever claiming satisfied", async () => {
    const result = await runBin(["--declaration", join(root, "missing.json")]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("could not be read as JSON");
    expect(result.stdout).not.toContain("satisfied");
  });

  it("exits 2 for a malformed .env-shaped declaration and a malformed .env-shaped inventory, and never echoes the decoy value in stdout or stderr", async () => {
    const decoy = "fixture-decoy-not-a-real-value";

    const declarationResult = await runBin(["--declaration", writeRaw("bad-declaration.json", `DATABASE_URL=${decoy}`)]);
    expect(declarationResult.status).toBe(2);
    expect(declarationResult.stdout).not.toContain(decoy);
    expect(declarationResult.stderr).not.toContain(decoy);

    const goodDeclaration = write("declaration.json", declaration());
    const inventoryResult = await runBin([
      "--declaration",
      goodDeclaration,
      "--inventory",
      writeRaw("bad-inventory.json", `DATABASE_URL=${decoy}`),
    ]);
    expect(inventoryResult.status).toBe(2);
    expect(inventoryResult.stdout).not.toContain(decoy);
    expect(inventoryResult.stderr).not.toContain(decoy);
  });
});

// Verifies the release-qualification fixtures directly: the two satisfied
// fixtures report `satisfied`, and the drift fixture reports all four of the
// rules governance/release-qualification-adapters/locksmith/current-direct.json
// depends on for its "secret-environments-violated-*" cases.
const fixturesRoot = fileURLToPath(new URL("../../../governance/release-qualification-fixtures/locksmith/current-direct/", import.meta.url));

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixturesRoot, name), "utf8"));
}

describe("governance release-qualification fixtures", () => {
  it("secret-declaration.json with the source and target inventories reports satisfied", () => {
    let output = "";
    (console.log as ReturnType<typeof vi.fn>).mockImplementation((text: string) => {
      output += text;
    });
    const exitCode = main([
      "--declaration",
      join(fixturesRoot, "secret-declaration.json"),
      "--inventory",
      join(fixturesRoot, "secret-inventory-source.json"),
      "--inventory",
      join(fixturesRoot, "secret-inventory-target.json"),
    ]);
    expect(exitCode).toBe(0);
    expect(JSON.parse(output)).toEqual(expect.objectContaining({ verdict: "satisfied", findings: [] }));
  });

  it("secret-inventory-target-drift.json reports separate-shares-identity, declared-environment-missing, undeclared-name, and secret-stored-readable", () => {
    let output = "";
    (console.log as ReturnType<typeof vi.fn>).mockImplementation((text: string) => {
      output += text;
    });
    const exitCode = main([
      "--declaration",
      join(fixturesRoot, "secret-declaration.json"),
      "--inventory",
      join(fixturesRoot, "secret-inventory-source.json"),
      "--inventory",
      join(fixturesRoot, "secret-inventory-target-drift.json"),
      "--mode",
      "enforce",
    ]);
    expect(exitCode).toBe(1);
    const report = JSON.parse(output) as { verdict: string; findings: { rule: string }[] };
    expect(report.verdict).toBe("violated");
    const rules = new Set(report.findings.map((f) => f.rule));
    expect(rules).toEqual(
      new Set(["separate-shares-identity", "declared-environment-missing", "undeclared-name", "secret-stored-readable"]),
    );
  });

  it("secret-declaration-malformed.json is refused as an input error, mapped to exit 2 by the executable's run()", () => {
    expect(readFixture("secret-declaration.json")).toBeTruthy();
    expect(() => main(["--declaration", join(fixturesRoot, "secret-declaration-malformed.json")])).toThrow(LocksmithCliInputError);
  });
});
