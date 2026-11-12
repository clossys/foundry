// Vitest setup file: no Studio child fixture (studio-child.mjs) may outlive the test file that
// started it. Each file gets its own pid directory; the fixture records itself there (inherited
// through Producer's child environment). After the file's own hooks have run, any recorded child
// still alive is killed and the file fails, naming it.
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

const directory = mkdtempSync(join(tmpdir(), "studio-child-pids-"));
process.env.CLOSSYS_STUDIO_CHILD_PIDS = directory;

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** Studio child fixtures recorded in `dir` that are still running; each is killed before returning. */
export async function reapStudioChildren(dir: string, graceMs = 3_000): Promise<number[]> {
  let pids: number[] = [];
  try { pids = readdirSync(dir).map(Number).filter(Number.isInteger); } catch { return []; }
  const deadline = Date.now() + graceMs;
  // A child stopped a moment ago may still be exiting: give it the grace period first.
  while (pids.some(alive) && Date.now() < deadline) await new Promise(next => setTimeout(next, 50));
  const survivors = pids.filter(alive);
  for (const pid of survivors) { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } }
  return survivors;
}

afterAll(async () => {
  const survivors = await reapStudioChildren(directory);
  rmSync(directory, { recursive: true, force: true });
  if (survivors.length) throw new Error(`Studio child fixture outlived its test file (killed pid ${survivors.join(", ")})`);
});
