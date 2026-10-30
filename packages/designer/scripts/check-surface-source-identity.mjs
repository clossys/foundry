import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkSurfaceSourceIdentity } from "./lib/surface-source-identity.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!["--source", "--report"].includes(args[i]) || !args[i + 1] || options[args[i]]) throw new Error("usage: check-surface-source-identity.mjs [--source <sha40>] [--report <json>]");
  options[args[i]] = args[i + 1];
}
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const head = git("rev-parse", "HEAD"), tree = git("rev-parse", "HEAD^{tree}");
let result;
try { result = checkSurfaceSourceIdentity(root); }
catch (error) { result = { status: "FAIL", counts: {}, findings: [{ code: "unresolved-source", detail: error.message }] }; }
const sourcePaths = ["package.json", "package-lock.json", "packages/designer/src", "packages/designer/scripts", "packages/designer/package.json", "packages/publisher/src", "packages/publisher/package.json"];
const changes = git("status", "--porcelain", "--untracked-files=all", "--", ...sourcePaths);
if (options["--source"] && (!/^[a-f0-9]{40}$/.test(options["--source"]) || options["--source"] !== head)) result.findings.push({ code: "source-head-mismatch", detail: "Requested source does not match current HEAD" });
if (options["--source"] && changes) result.findings.push({ code: "dirty-source", detail: "Requested commit has modified/untracked surface source inputs" });
result.status = result.findings.length ? "FAIL" : "PASS";
const report = { gate: "PROC-1", scope: "sections,frames", head, tree, argv: ["node", "packages/designer/scripts/check-surface-source-identity.mjs", ...args], sourceState: changes ? "worktree" : "committed", ...result };
if (options["--report"]) {
  const file = path.resolve(options["--report"]);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(report, null, 2) + "\n");
}
console.log(JSON.stringify({ gate: report.gate, scope: report.scope, head, tree, sourceState: report.sourceState, sourceHash: report.sourceHash, status: report.status, counts: report.counts, findings: report.findings, ...(options["--report"] ? { report: options["--report"] } : {}) }));
process.exitCode = report.status === "PASS" ? 0 : 1;
