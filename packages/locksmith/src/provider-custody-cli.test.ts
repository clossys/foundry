import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { LocksmithCliInputError, isDirectInvocation, main } from "./provider-custody-cli.js";

let root: string;
let binPath: string;

function satisfiedDeclaration(): Record<string, unknown> {
  return {
    key: "CLOUDFLARE_API_TOKEN",
    provider: "cloudflare",
    rung: "scoped-environment-secret",
    owner: "team-platform",
    store: "github-environment:deploy-cloudflare",
    scope: ["zone:edit:example.com"],
    leastPrivilegeNote: "One zone only, Workers deploy, no account-wide access.",
    usedBy: [".github/workflows/deploy.yml#deploy-cloudflare"],
    rotationPolicy: { maxAgeDays: 90 },
  };
}

function violatedDeclaration(): Record<string, unknown> {
  return { ...satisfiedDeclaration(), store: "repository" };
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
  root = mkdtempSync(join(tmpdir(), "locksmith-provider-custody-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

beforeAll(() => {
  const packageRoot = fileURLToPath(new URL("..", import.meta.url));
  const compiler = fileURLToPath(new URL("../../../node_modules/typescript/bin/tsc", import.meta.url));
  const built = spawnSync(process.execPath, [compiler, "-p", "tsconfig.json"], { cwd: packageRoot, encoding: "utf8" });
  if (built.status !== 0) throw new Error(`Locksmith build failed: ${built.stderr || built.stdout}`);

  const workDir = mkdtempSync(join(tmpdir(), "locksmith-provider-custody-bin-"));
  const dotBin = join(workDir, "node_modules", ".bin");
  mkdirSync(dotBin, { recursive: true });
  const installedDistDir = join(workDir, "dist");
  mkdirSync(installedDistDir, { recursive: true });
  for (const file of ["provider-custody-cli.js", "provider-custody.js"]) {
    cpSync(join(packageRoot, "dist", file), join(installedDistDir, file));
  }
  const installedCliPath = join(installedDistDir, "provider-custody-cli.js");
  chmodSync(installedCliPath, 0o755);
  binPath = join(dotBin, "clossys-locksmith-provider-custody");
  symlinkSync(installedCliPath, binPath);
}, 60_000);

function runBin(args: string[]) {
  const options = { encoding: "utf8" as const, timeout: 8_000 };
  let spawned = spawnSync(binPath, args, options);
  if (spawned.error) spawned = spawnSync(process.execPath, [binPath, ...args], options);
  return spawned;
}

describe("clossys-locksmith-provider-custody", () => {
  it("maps satisfied and violated declarations to 0 and 1", () => {
    expect(main([write("satisfied.json", satisfiedDeclaration())])).toBe(0);
    expect(main([write("violated.json", violatedDeclaration())])).toBe(1);
  });

  it("maps an indeterminate declaration (valid JSON, not a plain object) to 2 via evaluateProviderCustody, not a thrown input error", () => {
    expect(main([write("garbage.json", "just a string, not an object")])).toBe(2);
  });

  it("uses exit-2 input semantics and documents the tri-state contract", () => {
    expect(() => main([])).toThrow(LocksmithCliInputError);
    expect(() => main([join(root, "missing.json")])).toThrow(LocksmithCliInputError);
    expect(() => main([writeRaw("unreadable.json", "{ not valid json")])).toThrow(LocksmithCliInputError);
    expect(main(["--help"])).toBe(0);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("0 = satisfied, 1 = violated, 2 = indeterminate"));
  });

  it("never echoes an injected value-shaped field", () => {
    const decoy = "sk_live_should_never_appear_in_a_locksmith_record";
    const path = write("smuggled.json", { ...satisfiedDeclaration(), token: decoy });
    let output = "";
    (console.log as ReturnType<typeof vi.fn>).mockImplementation((text: string) => {
      output += text;
    });
    expect(main([path])).toBe(2);
    expect(output).not.toContain(decoy);
  });

  it("recognizes invocation through an installed-style POSIX bin symlink", () => {
    const sourceUrl = new URL("./provider-custody-cli.ts", import.meta.url);
    const linked = join(root, "clossys-locksmith-provider-custody");
    symlinkSync(fileURLToPath(sourceUrl), linked);
    expect(isDirectInvocation(sourceUrl.href, linked)).toBe(true);
  });
});

describe("clossys-locksmith-provider-custody, invoked through a node_modules/.bin-shaped symlink", () => {
  it("exits 0 with a satisfied report naming key, provider, and rung", () => {
    const result = runBin([write("satisfied.json", satisfiedDeclaration())]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("key: CLOUDFLARE_API_TOKEN");
    expect(result.stdout).toContain("provider: cloudflare");
    expect(result.stdout).toContain("rung: scoped-environment-secret");
    expect(result.stdout).toContain("SATISFIED");
  });

  it("exits 1 with the store-is-repository reason for a repository-store declaration", () => {
    const result = runBin([write("violated.json", violatedDeclaration())]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("VIOLATED");
    expect(result.stdout).toContain("store-is-repository");
  });

  it("exits 2 for a missing file without ever claiming SATISFIED", () => {
    const result = runBin([join(root, "missing.json")]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("does not exist");
    expect(result.stdout).not.toContain("SATISFIED");
  });
});
