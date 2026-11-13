import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "./instantiate-cli.js";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TEMPLATE_DIR = join(PACKAGE_ROOT, "templates", "site");

let work: string;
let root: string;
let logs: string[];
let errors: string[];

function pinsFile(overrides: Record<string, unknown> = {}): string {
  const manifest = JSON.parse(readFileSync(join(TEMPLATE_DIR, "package.json"), "utf8")) as Record<string, Record<string, string>>;
  const pins: Record<string, unknown> = {};
  for (const section of Object.values(manifest)) {
    if (typeof section !== "object") continue;
    for (const name of Object.keys(section)) if (name.startsWith("@clossys/")) pins[name] = "9.0.1";
  }
  const path = join(work, "pins.json");
  writeFileSync(path, JSON.stringify({ ...pins, ...overrides }));
  return path;
}

function writeRootManifest(text = `${JSON.stringify({ name: "example-project" }, null, 2)}\n`): string {
  const path = join(root, "package.json");
  writeFileSync(path, text);
  return path;
}

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "publisher-site-instantiate-cli-"));
  root = join(work, "consumer");
  mkdirSync(root);
  logs = [];
  errors = [];
  vi.spyOn(console, "log").mockImplementation((message?: unknown) => void logs.push(String(message)));
  vi.spyOn(console, "error").mockImplementation((message?: unknown) => void errors.push(String(message)));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(work, { recursive: true, force: true });
});

describe("publisher-site-instantiate: exit codes", () => {
  it("exits 0 and writes the site when the run is accepted", () => {
    writeRootManifest();
    expect(main(["--root", root, "--pins", pinsFile()])).toBe(0);
    expect(existsSync(join(root, "apps", "site", "package.json"))).toBe(true);
    expect(logs.join("\n")).toContain("apps/site");
    expect(logs.join("\n")).not.toContain(root);
    expect(errors).toEqual([]);
  });

  it("copies a standalone site beside an isolated pnpm app without a root manifest", () => {
    mkdirSync(join(root, "apps", "admin"), { recursive: true });
    const kept = [
      [join(root, "apps", "admin", "package.json"), '{"name":"admin","packageManager":"pnpm@10.0.0"}\n'],
      [join(root, "apps", "admin", "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n"],
      [join(root, "pnpm-workspace.yaml"), "packages: []\n"],
    ] as const;
    for (const [path, text] of kept) writeFileSync(path, text);
    expect(main(["--standalone", "--root", root, "--pins", pinsFile(), "--site-dir", "apps/site"])).toBe(0);
    expect(existsSync(join(root, "apps", "site", "components.json"))).toBe(true);
    expect(existsSync(join(root, "package.json"))).toBe(false);
    for (const [path, text] of kept) expect(readFileSync(path, "utf8")).toBe(text);
    expect(logs.join("\n")).not.toContain("root workspaces updated");
    expect(errors).toEqual([]);
  });

  it("keeps a missing root manifest a refusal without --standalone", () => {
    expect(main(["--root", root, "--pins", pinsFile()])).toBe(1);
    expect(errors.join("\n")).toContain("root-manifest-missing");
    expect(existsSync(join(root, "apps"))).toBe(false);
  });

  it("exits 1 on a refusal and leaves no partial output", () => {
    const rootFile = writeRootManifest(`{"name":"example-project","workspaces":"packages/*"}`);
    const before = readFileSync(rootFile);
    expect(main(["--root", root, "--pins", pinsFile()])).toBe(1);
    expect(existsSync(join(root, "apps"))).toBe(false);
    expect(readFileSync(rootFile).equals(before)).toBe(true);
    expect(errors.join("\n")).toContain("workspaces-unsupported");
    expect(errors.join("\n")).not.toContain(root);
    expect(logs).toEqual([]);
  });

  it("exits 1 for a missing pin and for a non-exact pin without writing", () => {
    const rootFile = writeRootManifest();
    const before = readFileSync(rootFile);
    expect(main(["--root", root, "--pins", pinsFile({ "@clossys/writer": "^0.4.0" })])).toBe(1);
    expect(main(["--root", root, "--pins", pinsFile({ "@clossys/writer": undefined })])).toBe(1);
    expect(existsSync(join(root, "apps"))).toBe(false);
    expect(readFileSync(rootFile).equals(before)).toBe(true);
    expect(errors.join("\n")).not.toContain("9.0.1");
  });

  it("exits 1 for a non-empty target and for a --site-dir that leaves the repository", () => {
    writeRootManifest();
    mkdirSync(join(root, "apps", "site"), { recursive: true });
    writeFileSync(join(root, "apps", "site", "keep.txt"), "kept");
    expect(main(["--root", root, "--pins", pinsFile()])).toBe(1);
    expect(readFileSync(join(root, "apps", "site", "keep.txt"), "utf8")).toBe("kept");
    expect(main(["--root", root, "--pins", pinsFile(), "--site-dir", "../outside"])).toBe(1);
    expect(existsSync(join(work, "outside"))).toBe(false);
  });

  it("exits 2 when the run could not be made", () => {
    writeRootManifest();
    const cases: string[][] = [
      [],
      ["--root", root],
      ["--pins", pinsFile()],
      ["--root", root, "--pins", join(work, "missing.json")],
      ["--root", root, "--pins", pinsFile(), "--unknown", "x"],
      ["--root", root, "--pins", pinsFile(), "--site-dir"],
      ["--root", root, "--pins", pinsFile(), "--root", root],
      ["--root", root, "--pins", pinsFile(), "--standalone", "--standalone"],
      ["--root", root, "--pins", pinsFile(), "--standalone", "true"],
      ["--root", root, "--pins", pinsFile(), "--standalone=true"],
      ["--root", root, "--pins", "--standalone"],
    ];
    for (const argv of cases) expect(main(argv), JSON.stringify(argv)).toBe(2);
    const garbage = join(work, "garbage.json");
    writeFileSync(garbage, "{ not json");
    expect(main(["--root", root, "--pins", garbage])).toBe(2);
    expect(main(["--root", root, "--pins", pinsFile()], { templateDir: join(work, "no-template") })).toBe(2);
    expect(existsSync(join(root, "apps"))).toBe(false);
    for (const message of errors) {
      expect(message).not.toContain(work);
    }
  });

  it("prints usage and exits 0 for --help", () => {
    expect(main(["--help"])).toBe(0);
    expect(logs.join("\n")).toContain("publisher-site-instantiate --root");
    expect(logs.join("\n")).toContain("--standalone");
  });
});

describe("publisher-site-instantiate: the built bin", () => {
  function run(args: string[]): Promise<{ status: number | null; stdout: string; stderr: string }> {
    const bin = join(PACKAGE_ROOT, "dist", "site-template", "instantiate-cli.js");
    return new Promise((resolvePromise, rejectPromise) => {
      const child = spawn(process.execPath, [bin, ...args], { timeout: 20_000 });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => (stdout += chunk));
      child.stderr.on("data", (chunk: string) => (stderr += chunk));
      child.on("error", rejectPromise);
      child.on("close", (status) => resolvePromise({ status, stdout, stderr }));
    });
  }

  it.each([false, true])("resolves the installed template (standalone=%s)", async (standalone) => {
    if (!standalone) writeRootManifest();
    const result = await run(["--root", root, "--pins", pinsFile(), ...(standalone ? ["--standalone"] : [])]);
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(join(root, "apps", "site", "components.json"))).toBe(true);
    if (standalone) expect(existsSync(join(root, "package.json"))).toBe(false);
  });

  it("exits 1 on a refusal and 2 on a usage error", async () => {
    const rootFile = writeRootManifest(`[]\n`);
    const before = readFileSync(rootFile);
    expect((await run(["--root", root, "--pins", pinsFile()])).status).toBe(1);
    expect(readFileSync(rootFile).equals(before)).toBe(true);
    expect((await run(["--root"])).status).toBe(2);
  });
});
