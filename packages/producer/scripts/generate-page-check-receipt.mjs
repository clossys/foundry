import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(packageRoot, "../..");
const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const sourceHead = git("rev-parse", "--verify", "HEAD");
if (!/^[a-f0-9]{40}$/.test(sourceHead)) throw new Error("PROC-5 cannot establish the native build source head.");
const sourceDirty = git("status", "--porcelain=v1", "--untracked-files=normal").length > 0;
const output = resolve(packageRoot, "dist/check");
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, "source-receipt.json"), JSON.stringify({ schemaVersion: 1, sourceHead, sourceDirty }, null, 2) + "\n");
console.log(`PROC-5 source receipt: ${sourceHead}${sourceDirty ? " (dirty; page check will refuse)" : ""}`);
