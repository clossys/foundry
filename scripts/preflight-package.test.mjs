import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const preflight = join(scriptDir, "preflight-package.mjs");
const packageDir = join(scriptDir, "..", "packages", "writer");

test("preflight forwards an explicitly selected denylist to every policy gate", () => {
  const work = mkdtempSync(join(tmpdir(), "preflight-package-test-"));
  try {
    const log = join(work, "invocations.log");
    const nodeShim = join(work, "node");
    const denylist = join(work, "selected-policy.json");
    writeFileSync(
      nodeShim,
      "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$PREFLIGHT_TEST_LOG\"\nexit 0\n",
      { mode: 0o700 },
    );
    chmodSync(nodeShim, 0o700);
    writeFileSync(denylist, "{}\n");

    execFileSync(process.execPath, [preflight, packageDir, "--require-denylist", "--denylist", denylist], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${work}:${process.env.PATH}`, PREFLIGHT_TEST_LOG: log },
    });

    const invocations = readFileSync(log, "utf8").trim().split("\n");
    const selectedGates = [
      "check-denylist-quality.mjs",
      "check-public-safety.mjs",
      "check-artifact-safety.mjs",
    ];
    for (const gate of selectedGates) {
      const invocation = invocations.find((line) => line.includes(gate));
      assert.ok(invocation, `preflight did not invoke ${gate}`);
      assert.ok(invocation.includes(`--denylist ${denylist}`), `${gate} did not receive the selected denylist`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("denylist quality fails closed when no policy is selected", () => {
  const quality = join(scriptDir, "check-denylist-quality.mjs");
  const env = { ...process.env };
  delete env.PUBLIC_SAFETY_DENYLIST;
  assert.throws(
    () => execFileSync(process.execPath, [quality], { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] }),
    (error) => error.status === 2 && `${error.stdout ?? ""}${error.stderr ?? ""}`.includes("no denylist selected"),
  );
});
