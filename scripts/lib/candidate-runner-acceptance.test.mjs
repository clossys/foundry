import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { runCandidateQualification } from "./candidate-runner.mjs";

const execFile = promisify(execFileCallback);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("the production runner qualifies Bouncer's four framework exports in one isolated Next build", { timeout: 600_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "foundry-bouncer-candidate-acceptance-"));
  const packed = join(root, "packed");
  await mkdir(packed);
  t.after(() => rm(root, { recursive: true, force: true }));
  const packageRoot = join(repoRoot, "packages/bouncer");
  const packedResult = await execFile("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", packed], { cwd: packageRoot });
  const tarball = join(packed, JSON.parse(packedResult.stdout)[0].filename);
  const policy = JSON.parse(await readFile(join(repoRoot, "governance/release-qualification-policy.json"), "utf8"));
  const adapter = JSON.parse(await readFile(join(repoRoot, "governance/release-qualification-adapters/bouncer/current-direct.json"), "utf8"));
  const fixtureRoot = join(repoRoot, "governance/release-qualification-fixtures/bouncer/current-direct");
  const fixtures = Object.fromEntries(await Promise.all(adapter.fixtures.map(async (name) => {
    const path = join(fixtureRoot, name);
    return [name, { path, type: "file", symlink: false, tracked: true, size: (await readFile(path)).length }];
  })));
  const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  const transcript = await runCandidateQualification({
    tarball,
    policy,
    adapter,
    fixtures,
    manifestBins: manifest.bin,
    registry: { scope: "@clossys", registry: "https://registry.npmjs.org/" },
  });
  assert.equal(transcript.ok, true, JSON.stringify({ mismatches: transcript.mismatches, framework: transcript.observations.filter((item) => item.kind === "framework") }, null, 2));
  assert.deepEqual(transcript.coverage, {
    declaredExportKeys: 7,
    concreteTargets: 14,
    runtimeImports: 3,
    reactServerImports: 0,
    staticTargets: 7,
    frameworkExports: 4,
    frameworkBuilds: 1,
    failed: 0,
    installedManifestSha256: transcript.coverage.installedManifestSha256,
    bins: 1,
    lifecycleScriptsDisabled: true,
  });
  const framework = transcript.observations.filter((item) => item.kind === "framework");
  assert.deepEqual(framework.map((item) => item.id), [
    "framework:next:client:@clossys/bouncer/providers/clerk/web",
    "framework:next:client:@clossys/bouncer/providers/clerk/web/client",
    "framework:next:server:@clossys/bouncer/providers/clerk/web/server",
    "framework:next:proxy:@clossys/bouncer/providers/clerk/web/proxy",
  ]);
  assert.ok(framework.every((item) => item.launch === "next-build" && item.expectedExitCode === 0 && item.observedExitCode === 0));
  assert.equal(new Set(framework.map((item) => JSON.stringify([item.stdoutSha256, item.stderrSha256, item.observedExitCode, item.signal, item.launchError]))).size, 1);
});
