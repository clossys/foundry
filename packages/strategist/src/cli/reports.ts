import { constants, closeSync, fstatSync, ftruncateSync, lstatSync, mkdirSync, openSync, realpathSync, writeFileSync } from "node:fs";
import { isRetiredStrategyRoot } from "../strategy-dir-default.js";
import { join } from "node:path";

export const REPORT_CAPABILITIES = ["cell-quality", "coherence", "completion", "wont-claim"] as const;
export type ReportCapability = typeof REPORT_CAPABILITIES[number];

/** CLI-only persistence. Pure checks return the same object saved here. */
export function persistReport(root: string, capability: ReportCapability, report: unknown): void {
  if (!REPORT_CAPABILITIES.includes(capability)) throw new Error("Unknown report capability");
  if (isRetiredStrategyRoot(root)) return;
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (lstatSync(root).isSymbolicLink()) throw new Error("Symlink strategy root is not allowed");
  const strategyRoot = realpathSync(root);
  if (!lstatSync(strategyRoot).isDirectory()) throw new Error("Strategy root must be a directory");
  const directory = join(strategyRoot, "reports");
  try { mkdirSync(directory); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  if (!lstatSync(directory).isDirectory() || realpathSync(directory) !== directory) throw new Error("Reports must be a real directory inside the strategy root");
  const path = join(directory, `${capability}.json`);
  // O_NOFOLLOW also protects an existing destination from symlink traversal.
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
  try {
    const destination = fstatSync(fd);
    if (!destination.isFile() || destination.nlink !== 1) throw new Error("Report destination must be a regular file");
    const current = lstatSync(path);
    if (current.isSymbolicLink() || current.dev !== destination.dev || current.ino !== destination.ino || realpathSync(directory) !== directory) throw new Error("Report destination changed while opening");
    // Truncate only after verifying the opened destination, including non-file paths.
    ftruncateSync(fd, 0);
    writeFileSync(fd, serialized, { encoding: "utf8" });
  } finally { closeSync(fd); }
}
