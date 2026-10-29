#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { transform } from "esbuild";

const producerRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(producerRoot, "../..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const help = `Usage: node packages/producer/scripts/pack-five.mjs --out-dir <directory>

Clean-build and npm pack the four mapped agents and Producer from this checkout.
The output directory must be outside the checkout. Existing artifacts are never
overwritten. Package versions and private flags are preserved; nothing publishes.
Builds Studio when studio/package.json exists. Otherwise the summary explicitly
reports studio.status=missing-source and complete=false (scaffold tarballs only).
Build output goes to stderr; the final JSON summary goes to stdout and summary.json.
`;

function run(command, args, cwd = repoRoot) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (result.stdout) process.stderr.write(result.stdout);
    throw new Error(`${command} ${args.join(" ")} failed (${result.status ?? result.signal}).`);
  }
  return result.stdout;
}

function snapshot() {
  const head = run("git", ["rev-parse", "HEAD"]).trim();
  const status = run("git", ["status", "--porcelain=v1", "--untracked-files=all"]);
  const digest = createHash("sha256").update(head).update(status)
    .update(run("git", ["diff", "--binary", "HEAD"]));
  for (const file of run("git", ["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean)) {
    digest.update(file).update(readFileSync(join(repoRoot, file)));
  }
  return { head, dirty: status.length > 0, digest: digest.digest("hex") };
}

function inside(parent, path) {
  const rel = relative(parent, path);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

function canonicalTarget(path) {
  if (existsSync(path)) return realpathSync(path);
  return join(canonicalTarget(dirname(path)), basename(path));
}

// npm lifecycle scripts may write text before their JSON result.
function packResult(stdout) {
  for (let index = stdout.indexOf("["); index !== -1; index = stdout.indexOf("[", index + 1)) {
    try {
      const result = JSON.parse(stdout.slice(index));
      if (Array.isArray(result) && result.length === 1 && typeof result[0]?.filename === "string") return result[0];
    } catch { /* Continue to the actual npm result array. */ }
  }
  throw new Error("npm pack did not return one valid JSON package result.");
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
    process.stdout.write(help);
    return;
  }
  if (args.length !== 2 || args[0] !== "--out-dir" || !args[1] || args[1].startsWith("--")) throw new Error(help);
  const outDir = canonicalTarget(resolve(args[1]));
  if (inside(realpathSync(repoRoot), outDir)) throw new Error("Choose --out-dir outside the checkout.");
  if (existsSync(outDir) && !statSync(outDir).isDirectory()) throw new Error("--out-dir must be a directory.");
  if (existsSync(outDir) && readdirSync(outDir).length > 0) throw new Error("--out-dir must be empty; choose a fresh directory for these five tarballs.");

  // Transform the single authority in memory, preserving its Node lookup base.
  const agentsPath = join(producerRoot, "src/agents.ts");
  const transformed = await transform(readFileSync(agentsPath, "utf8"), {
    loader: "ts", format: "esm", target: "node20",
    define: { "import.meta.url": JSON.stringify(pathToFileURL(agentsPath).href) },
  });
  const { AGENT_PACKAGES, resolveAgent } = await import(`data:text/javascript;base64,${Buffer.from(transformed.code).toString("base64")}`);
  const targets = Object.keys(AGENT_PACKAGES).map((kind) => ({ role: kind, root: resolveAgent(kind).packageRoot }));
  targets.push({ role: "producer", root: producerRoot });

  const workspaces = new Map();
  for (const entry of readdirSync(join(repoRoot, "packages"), { withFileTypes: true })) {
    const root = join(repoRoot, "packages", entry.name);
    if (!entry.isDirectory() || !existsSync(join(root, "package.json"))) continue;
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    workspaces.set(manifest.name, { root, manifest });
  }
  for (const target of targets) {
    target.manifest = JSON.parse(readFileSync(join(target.root, "package.json"), "utf8"));
    const local = workspaces.get(target.manifest.name);
    if (!local || realpathSync(local.root) !== realpathSync(target.root)) throw new Error(`${target.manifest.name} must resolve to this checkout's workspace, not an installed release.`);
    target.filename = `${target.manifest.name.replace(/^@/, "").replaceAll("/", "-")}-${target.manifest.version}.tgz`;
  }
  for (const filename of ["summary.json", ...targets.map((target) => target.filename)]) {
    if (existsSync(join(outDir, filename))) throw new Error(`Output already exists: ${filename}. Choose a fresh --out-dir.`);
  }

  const source = snapshot();
  const buildOrder = [];
  const visited = new Set();
  const visiting = new Set();
  function visit(workspace) {
    if (visited.has(workspace.manifest.name)) return;
    if (visiting.has(workspace.manifest.name)) throw new Error(`Workspace build dependency cycle: ${workspace.manifest.name}`);
    visiting.add(workspace.manifest.name);
    for (const name of Object.keys({ ...workspace.manifest.dependencies, ...workspace.manifest.optionalDependencies })) {
      if (workspaces.has(name)) visit(workspaces.get(name));
    }
    visiting.delete(workspace.manifest.name);
    visited.add(workspace.manifest.name);
    if (!workspace.manifest.scripts?.build) throw new Error(`Missing build script: ${workspace.manifest.name}`);
    buildOrder.push(workspace);
  }
  for (const target of targets) visit(workspaces.get(target.manifest.name));
  const reports = mkdtempSync(join(tmpdir(), "pack-five-reports-"));
  try {
    for (const workspace of buildOrder) {
      process.stderr.write(`Building ${workspace.manifest.name}\n`);
      rmSync(join(workspace.root, "dist"), { recursive: true, force: true });
      const args = ["run", "build", "--workspaces=false"];
      // Writer's final build step supports --report; keep its generated report
      // outside the checkout rather than overwriting the tracked baseline.
      if (workspace.root === targets.find((target) => target.role === "writer")?.root) {
        args.push("--", "--report", join(reports, "writer-record-drift.json"));
      }
      process.stderr.write(run(npm, args, workspace.root));
    }
  } finally {
    rmSync(reports, { recursive: true, force: true });
  }

  let studio = { status: "missing-source", reason: "Producer Studio source is absent; these tarballs contain the CLI scaffold only." };
  if (existsSync(join(producerRoot, "studio/package.json"))) {
    const script = join(producerRoot, "scripts/build-studio.mjs");
    if (!existsSync(script)) throw new Error("Studio source exists but scripts/build-studio.mjs is missing.");
    process.stderr.write(run(process.execPath, [script]));
    const studioRoot = join(producerRoot, "dist/studio");
    const manifest = JSON.parse(readFileSync(join(studioRoot, "manifest.json"), "utf8"));
    const entry = resolve(studioRoot, manifest.serverEntry ?? "");
    if (!manifest.serverEntry || !inside(studioRoot, entry) || !statSync(entry).isFile()) throw new Error("Studio manifest must name an existing standalone serverEntry inside dist/studio.");
    studio = { status: "built", serverEntry: manifest.serverEntry };
  }

  mkdirSync(outDir, { recursive: true });
  const staging = mkdtempSync(join(outDir, ".pack-five-"));
  try {
    const packages = [];
    for (const target of targets) {
      const packed = packResult(run(npm, ["pack", "--json", "--workspaces=false", "--pack-destination", staging], target.root));
      if (packed.name !== target.manifest.name || packed.version !== target.manifest.version || packed.filename !== target.filename) throw new Error(`npm pack identity mismatch for ${target.manifest.name}.`);
      for (const entry of [target.manifest.main, target.manifest.types, ...Object.values(target.manifest.bin ?? {})].filter(Boolean)) {
        if (!packed.files?.some((file) => file.path === entry.replace(/^\.\//, ""))) throw new Error(`Tarball is missing ${target.manifest.name} entry: ${entry}`);
      }
      if (target.role === "producer" && studio.status === "built" && !packed.files?.some((file) => file.path === `dist/studio/${studio.serverEntry}`)) throw new Error("Producer tarball is missing the standalone Studio server.");
      if (statSync(join(staging, packed.filename)).size !== packed.size) throw new Error(`npm pack size mismatch: ${packed.filename}`);
      packages.push({ role: target.role, name: packed.name, version: packed.version, filename: packed.filename, integrity: packed.integrity });
    }
    if (snapshot().digest !== source.digest) throw new Error("Checkout source changed during packaging; rerun at a stable sprint head.");
    const summary = { schemaVersion: 1, source, complete: studio.status === "built", studio, packages };
    writeFileSync(join(staging, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
    for (const filename of [...packages.map((pkg) => pkg.filename), "summary.json"]) renameSync(join(staging, filename), join(outDir, filename));
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`pack-five: ${error.message}\n`);
  process.exitCode = 1;
});
