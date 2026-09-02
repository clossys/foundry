import { spawnSync } from "node:child_process";

/**
 * The runtime tuple whose bytes and package-manager behavior release evidence
 * is allowed to describe. Keep this in one place: workflow and release
 * commands must agree on the same exact toolchain.
 */
export const RELEASE_RUNTIME = Object.freeze({
  node: "v24.19.0",
  npm: "11.17.0",
  zlib: "1.3.2.1-motley-3246f1b",
});

function defaultRun(file, args, options) {
  return spawnSync(file, args, { ...options, stdio: options.stdio ?? "pipe", encoding: options.encoding ?? "utf8" });
}

function checkedVersion(run, file, args, env) {
  const result = run(file, args, { env, stdio: "pipe", encoding: "utf8" });
  if (result?.error || result?.signal || result?.status !== 0) throw new Error("release runtime version probe failed");
  return String(result.stdout ?? "").trim();
}

/** Read the exact runtime values from the executables that release work uses. */
export function readReleaseRuntime({ run = defaultRun, env = process.env, nodePath = process.execPath, npmPath = "npm" } = {}) {
  return {
    node: checkedVersion(run, nodePath, ["--version"], env),
    npm: checkedVersion(run, npmPath, ["--version"], env),
    zlib: checkedVersion(run, nodePath, ["-p", "process.versions.zlib"], env),
  };
}

/**
 * Refuse release qualification/retention unless every runtime component is an
 * exact match. `run` is a narrow deterministic test seam; production callers
 * use the default executable probes.
 */
export function assertReleaseRuntime(options = {}) {
  const actual = options.observed ?? readReleaseRuntime(options);
  const mismatches = Object.keys(RELEASE_RUNTIME).filter((key) => actual?.[key] !== RELEASE_RUNTIME[key]);
  if (mismatches.length > 0) {
    const values = mismatches.map((key) => `${key} ${actual?.[key] ?? "<unavailable>"}`).join(", ");
    throw new Error(`release qualification requires Node ${RELEASE_RUNTIME.node}, npm ${RELEASE_RUNTIME.npm}, and zlib ${RELEASE_RUNTIME.zlib}; observed ${values}`);
  }
  return actual;
}
