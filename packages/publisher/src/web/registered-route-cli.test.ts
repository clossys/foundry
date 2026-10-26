import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const usage = "Usage: publisher-registered-route-check --root DIR --contract FILE --context FILE\n";

function run(args: string[], cwd: string): Promise<{ status: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, timeout: 20_000 });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", reject);
    // Capture after streams have closed, matching the package's other bin tests.
    child.once("close", (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
}

it("runs the built CLI through canonical and installed-bin aliases while keeping ordinary imports quiet", async () => {
  // The package's native build happens before this test; never rebuild shared dist here.
  const cli = realpathSync(join(packageRoot, "dist", "web", "registered-route-cli.js"));
  const work = mkdtempSync(join(tmpdir(), "publisher-registered-route-bin-"));
  try {
    writeFileSync(join(work, "package.json"), JSON.stringify({ private: true, type: "module" }));
    const dotBin = join(work, "node_modules", ".bin");
    mkdirSync(dotBin, { recursive: true });
    const bin = join(dotBin, "publisher-registered-route-check");
    symlinkSync(cli, bin);
    const aliasedDirectory = join(work, "aliased-web");
    symlinkSync(dirname(cli), aliasedDirectory, "dir");
    const aliasedCli = join(aliasedDirectory, "registered-route-cli.js");
    const invocations = [
      { label: "canonical direct", args: [cli] },
      { label: "noncanonical directory alias", args: [aliasedCli] },
      { label: "installed bin symlink", args: [bin] },
      // Keep relative imports valid while making import.meta.url itself an alias.
      { label: "preserved main alias", args: ["--preserve-symlinks-main", aliasedCli] },
    ];
    for (const invocation of invocations) {
      for (const args of [[], ["--help"]]) {
        const result = await run([...invocation.args, ...args], work);
        const label = `${invocation.label} ${args.join(" ")}`;
        expect(result.signal, label).toBeNull();
        expect(result.status, label).toBe(2);
        expect(result.stdout, label).toBe("");
        expect(result.stderr, label).toBe(usage);
      }
    }

    const unrelated = join(work, "unrelated.js");
    writeFileSync(unrelated, "export {};\n");
    for (const argvPath of [undefined, "", join(work, "missing-entry.js"), unrelated]) {
      const code = `process.argv[1] = ${JSON.stringify(argvPath)}; await import(${JSON.stringify(pathToFileURL(cli).href)});`;
      const result = await run(["--input-type=module", "--eval", code], work);
      expect(result.signal, String(argvPath)).toBeNull();
      expect(result.status, String(argvPath)).toBe(0);
      expect(result.stdout, String(argvPath)).toBe("");
      expect(result.stderr, String(argvPath)).toBe("");
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}, 120_000);
