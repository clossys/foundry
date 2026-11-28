// Violation fixture for R-FIXTURE-NO-ORPHAN: a fixture spawner whose teardown ends only the parent
// process, so a child the parent started outlives the test that spawned it.
import { spawn } from "node:child_process";

export function spawnFixture(command, args = [], options = {}) {
  const child = spawn(command, [...args], { stdio: ["ignore", "pipe", "pipe"], ...options });
  const teardown = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise(accept => child.once("exit", accept));
    child.kill("SIGTERM");
    await exited;
  };
  return { child, pid: child.pid, teardown };
}
