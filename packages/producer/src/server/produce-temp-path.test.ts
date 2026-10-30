import { spawn } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { applyLibraryChange, libraryHash, loadCatalog, type LibraryData } from "@clossys/designer/catalog";
import { agentModule, agentRoot } from "./cells.js";
import { studioSelection, type StudioSelection } from "./selection.js";
import { studioTheme, type StudioTheme } from "./theme.js";

const repository = fileURLToPath(new URL("../../../../", import.meta.url));
const timeout = 90_000;
interface Config { selection: StudioSelection; theme: StudioTheme; compilation: { agent: string; state: string }[] }

// Exercise the actual bin, startup compiler, process environment and HTTP API.
// Only the standalone UI child is the existing fixture; no server/read API is replaced.
describe("clossys produce temporary projection paths", () => {
  let directory: string, consumer: string, physicalTemp: string, aliasTemp: string, executable: string;
  let sequence = 0;

  beforeAll(async () => {
    directory = await mkdtemp(join(await realpath(tmpdir()), "producer-temp-path-"));
    consumer = join(directory, "consumer");
    physicalTemp = join(directory, "physical-temp");
    aliasTemp = join(directory, "temp-alias");
    await mkdir(physicalTemp);
    await symlink(physicalTemp, aliasTemp, "dir");
    await mkdir(join(consumer, "clossys"), { recursive: true });
    await writeFile(join(consumer, "clossys/clossys.config.ts"), "export default {};\n");
    const catalog = loadCatalog();
    const empty: LibraryData = { source: { id: "example", kind: "consumer", author: "consumer", license: "MIT" }, adoptedAt: "2026-10-30", fills: [] };
    const library = applyLibraryChange(catalog, empty, { baseHash: libraryHash(empty), changes: [{ op: "adopt", slot: "tokens.accent-color", source: "foundry" }] });
    const reader = await agentModule("designer", "library-cli/fs-library.js");
    const source = join(directory, "library");
    for (const [name, contents] of reader.libraryFiles(catalog, library, [])) {
      const path = join(source, name); await mkdir(dirname(path), { recursive: true }); await writeFile(path, contents);
    }
    const cells = await agentModule("designer", "library-cli/cells.js");
    await cells.libraryToCells(source, agentRoot(consumer, "designer"), { catalog, date: "2026-10-30" });

    const runtime = join(directory, "runtime");
    await cp(join(repository, "packages/producer/dist"), join(runtime, "dist"), { recursive: true });
    await writeFile(join(runtime, "package.json"), '{"type":"module"}\n');
    await symlink(join(repository, "node_modules"), join(runtime, "node_modules"), "dir");
    await mkdir(join(runtime, "dist/studio"), { recursive: true });
    await cp(join(repository, "packages/producer/studio/generated/studio-map.json"), join(runtime, "dist/studio/studio-map.json"));
    await cp(fileURLToPath(new URL("./__fixtures__/studio-child.mjs", import.meta.url)), join(runtime, "dist/studio/server.js"));
    await writeFile(join(runtime, "dist/studio/manifest.json"), JSON.stringify({ schemaVersion: 1, serverEntry: "server.js" }));
    const entry = join(runtime, "dist/cli/index.js");
    await chmod(entry, 0o755);
    executable = join(directory, "clossys");
    await symlink(entry, executable);
    // All fixtures, symlinks and process/API transcripts remain available after tests.
  }, timeout);

  async function produce(label: string, temp: string, root = consumer): Promise<Config> {
    const child = spawn(executable, ["produce", "--root", root, "--port", "0", "--no-open"], {
      cwd: consumer, env: { ...process.env, TMPDIR: temp }, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal }));
    });
    // Keep a rejection handled even when startup fails before the close is awaited.
    void exited.catch(() => undefined);
    let startupTimer: ReturnType<typeof setTimeout> | undefined;
    let config: Config | undefined;
    try {
      const url = await new Promise<string>((resolve, reject) => {
        startupTimer = setTimeout(() => reject(new Error(`CLI startup timed out: ${stderr}`)), 20_000);
        child.stdout.on("data", part => {
          stdout += part;
          const match = /Producer Studio: (http:\/\/127\.0\.0\.1:\d+)/.exec(stdout);
          if (match) resolve(match[1]!);
        });
        child.stderr.on("data", part => { stderr += part; });
        child.once("error", reject);
        child.once("exit", code => reject(new Error(`CLI exited before readiness: ${code}; ${stderr}`)));
      });
      clearTimeout(startupTimer);
      const response = await fetch(`${url}/api/config`, { signal: AbortSignal.timeout(45_000) });
      expect(response.status).toBe(200);
      config = await response.json() as Config;
      return config;
    } finally {
      clearTimeout(startupTimer);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      const force = setTimeout(() => child.kill("SIGKILL"), 2_000);
      let result;
      try { result = await exited; } finally { clearTimeout(force); }
      await writeFile(join(directory, `${++sequence}-${label}.json`), JSON.stringify({ temp, root, config: config ? { selection: config.selection, theme: config.theme, compilation: config.compilation } : undefined, ...result, stdout, stderr }, null, 2));
      expect(result.code, stderr).toBe(0);
      expect(result.signal, stderr).toBeNull();
    }
  }

  it("matches in-process and real server selection through an aliased TMPDIR", async () => {
    const [theme, selection] = await Promise.all([studioTheme(consumer), studioSelection(consumer)]);
    expect(theme.source).toBe("consumer");
    expect(selection.message ?? "").not.toContain("Symbolic links");
    expect(selection.leaves.length).toBeGreaterThan(0);
    await writeFile(join(directory, "in-process.json"), JSON.stringify({ theme, selection }, null, 2));
    const physical = await produce("physical-control", physicalTemp);
    expect(physical.theme).toEqual(theme);
    expect(physical.selection).toEqual(selection);
    const aliased = await produce("aliased-temp", aliasTemp);
    expect(aliased.compilation.find(row => row.agent === "designer")?.state).toBe("compiled");
    expect(aliased.selection.message).toBe(physical.selection.message);
    expect(aliased.theme).toEqual(physical.theme);
    expect(aliased.selection).toEqual(physical.selection);
    expect(aliased.selection.message ?? "").not.toContain("Symbolic links");
    // Any unrelated compiler failure, including missing S8 evidence, remains visible.
    if (selection.message !== undefined) expect(aliased.selection.message).toBe(selection.message);
  }, timeout);

  it.each(["consumer-root", "cell-tree"] as const)("continues rejecting a symlinked %s through the real server", async kind => {
    const target = join(directory, kind);
    if (kind === "consumer-root") await symlink(consumer, target, "dir");
    else {
      await mkdir(join(target, "clossys/agents/designer"), { recursive: true });
      await writeFile(join(target, "clossys/clossys.config.ts"), "export default {};\n");
      await symlink(join(agentRoot(consumer, "designer"), "tree.json"), join(agentRoot(target, "designer"), "tree.json"));
    }
    const treePath = join(agentRoot(consumer, "designer"), "tree.json");
    const before = await readFile(treePath, "utf8");
    const config = await produce(`rejected-${kind}`, aliasTemp, target);
    expect(config.selection).toMatchObject({ message: "Symbolic links are not followed", leaves: [] });
    expect(config.compilation.find(row => row.agent === "designer")?.state).toBe("error");
    expect(await readFile(treePath, "utf8")).toBe(before);
  }, timeout);
});
