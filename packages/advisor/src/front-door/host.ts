/**
 * The front door's only side doors: running a program and the clock. Verbs take a Host so tests can
 * record every command and refuse to touch the machine. No environment file is ever read here; the child
 * inherits the caller's environment as the shell gave it.
 */
import { spawnSync } from "node:child_process";

export interface CommandResult { readonly status: number | null; readonly stdout: string; readonly stderr: string }
export interface Host {
  run(command: string, args: readonly string[], options: { readonly cwd: string }): CommandResult;
  today(): string;
  now(): string;
}

export interface VerbResult { readonly exitCode: 0 | 1 | 2; readonly lines: readonly string[]; readonly json?: unknown }

export const realHost: Host = {
  run(command, args, options) {
    const result = spawnSync(command, [...args], { cwd: options.cwd, encoding: "utf8", shell: false, timeout: 600_000 });
    if (result.error) return { status: null, stdout: "", stderr: result.error.message };
    return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  },
  today: () => new Date().toISOString().slice(0, 10),
  now: () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
};

export function ok(lines: readonly string[], json?: unknown): VerbResult { return { exitCode: 0, lines, ...(json === undefined ? {} : { json }) }; }
export function refused(lines: readonly string[], json?: unknown): VerbResult { return { exitCode: 1, lines, ...(json === undefined ? {} : { json }) }; }
export function tail(text: string, count = 5): string { return text.trim().split(/\r?\n/).slice(-count).join(" | "); }
