import { spawn } from "node:child_process";

/**
 * Runs a child process and resolves once its stdout/stderr have fully ended
 * AND the process has exited -- never before.
 *
 * #1333/#1341: the equivalent `spawnSync` calls this replaces flaked in CI
 * under load with `result.status` set (the child really did exit) but
 * `result.stdout` empty or truncated -- a report the exit code says exists
 * but the capture missed. `spawnSync`'s synchronous capture is implemented
 * as its own internal poll loop outside Node's normal stream machinery, and
 * that loop is what a heavily loaded CI runner's scheduling can starve.
 * `spawn()`'s stdout/stderr are ordinary `Readable` streams, whose own
 * contract (not a loop this helper has to get right) guarantees every byte
 * written is delivered via `data` events before `end` fires, and this
 * helper's `close` handler -- which Node fires only after the process has
 * exited AND both stdio streams have ended -- cannot observe an exit code
 * before the output that produced it has been fully read. That ordering
 * guarantee is the fix; it holds regardless of scheduler pressure.
 *
 * @param {string} command
 * @param {readonly string[]} args
 * @param {import("node:child_process").SpawnOptionsWithoutStdio} [options]
 * @returns {Promise<{ status: number | null, stdout: string, stderr: string }>}
 */
export function spawnCapture(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, options);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", rejectPromise);
    child.on("close", (status) => {
      resolvePromise({ status, stdout, stderr });
    });
  });
}
