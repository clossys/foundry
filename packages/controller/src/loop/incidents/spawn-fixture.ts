/**
 * The fixture spawner: a test fixture or a heal re-run starts its child in a process group of its
 * own, and its teardown ends the whole group, never only the parent. A child that outlives a killed
 * test run held a build slot for two hours (cause `orphan-test-child`); the guard rule
 * R-FIXTURE-NO-ORPHAN runs check:heal's spawner probe (guards.ts probeSpawner) against this module.
 */
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

export interface SpawnedFixture {
  readonly child: ChildProcess;
  readonly pid: number;
  /** Ends the child's whole process group: SIGTERM, then SIGKILL after `graceMs`; resolves once no member is alive. */
  teardown(graceMs?: number): Promise<void>;
}

/** Whether a process is alive. A zombie (exited, not yet reaped) is not alive. */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const state = stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3);
    return state !== "Z" && state !== "X";
  } catch {
    return true;
  }
}

/** The live members of a process group (Linux /proc); undefined where the platform cannot list them. */
export function groupMembers(pgid: number): number[] | undefined {
  let entries: string[];
  try {
    entries = readdirSync("/proc").filter(name => /^\d+$/.test(name));
  } catch {
    return undefined;
  }
  if (entries.length === 0) return undefined;
  const members: number[] = [];
  for (const name of entries) {
    try {
      const stat = readFileSync(`/proc/${name}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      if (Number(fields[2]) === pgid && fields[0] !== "Z" && fields[0] !== "X") members.push(Number(name));
    } catch {
      // The process ended while the list was read.
    }
  }
  return members;
}

/** Whether any member of a process group is alive. */
export function groupAlive(pgid: number): boolean {
  const members = groupMembers(pgid);
  if (members !== undefined) return members.length > 0;
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

const pause = (ms: number) => new Promise<void>(accept => setTimeout(accept, ms));

/** Sends `signal` to a whole group; a group that is already gone is not an error. */
export function signalGroup(pgid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pgid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

/** Waits until no member of the group is alive, or `ms` passes; returns whether the group is gone. */
export async function waitGroupGone(pgid: number, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (!groupAlive(pgid)) return true;
    await pause(20);
  }
  return !groupAlive(pgid);
}

/** Spawns `command` as the leader of a new process group; `teardown()` ends every process in it. */
export function spawnFixture(command: string, args: readonly string[] = [], options: SpawnOptions = {}): SpawnedFixture {
  const child = spawn(command, [...args], { stdio: ["ignore", "pipe", "pipe"], ...options, detached: true });
  if (child.pid === undefined) throw new Error(`spawnFixture: ${command} did not start`);
  const pid = child.pid;
  let done: Promise<void> | undefined;
  const teardown = (graceMs = 1_000): Promise<void> => {
    done ??= (async () => {
      signalGroup(pid, "SIGTERM");
      if (!(await waitGroupGone(pid, graceMs))) {
        signalGroup(pid, "SIGKILL");
        await waitGroupGone(pid, graceMs);
      }
      child.stdout?.destroy();
      child.stderr?.destroy();
    })();
    return done;
  };
  return { child, pid, teardown };
}

/** Runs a shell command in its own group, collects its output, and ends the group when it exits. */
export function runInGroup(command: string, options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): Promise<{ exit: number; output: string }> {
  return new Promise(accept => {
    const fixture = spawnFixture("/bin/sh", ["-c", command], { cwd: options.cwd, env: options.env });
    let output = "";
    const collect = (chunk: Buffer) => { output += chunk.toString("utf8"); if (output.length > 4_000_000) output = output.slice(-2_000_000); };
    fixture.child.stdout?.on("data", collect);
    fixture.child.stderr?.on("data", collect);
    fixture.child.on("close", code => {
      // The command is done; whatever it started in its group goes with it.
      void fixture.teardown(500).then(() => accept({ exit: code ?? 1, output }));
    });
  });
}
