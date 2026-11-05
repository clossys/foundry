import { execFileSync, spawnSync } from "node:child_process";

/** Resolve immutable inputs before scanning; unrelated refs are not scan inputs. */
export function scannerHistoryScope(root, base = "origin/main", head = "HEAD") {
  const resolve = ref => {
    const value = execFileSync("git", ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (!/^[a-f0-9]{40}$/.test(value)) throw new Error("Immutable history input required");
    return value;
  };
  const baseCommit = resolve(base), headCommit = resolve(head);
  const ancestor = spawnSync("git", ["merge-base", "--is-ancestor", baseCommit, headCommit], { cwd: root, stdio: "ignore" });
  if (ancestor.status !== 0) throw new Error("Scan head must descend from the declared base");
  return { base: baseCommit, head: headCommit, kind: "head-ancestry", logOptions: headCommit };
}

export function gitleaksHistoryArgs(root, scope, template, report) {
  if (scope.kind !== "head-ancestry" || !/^[a-f0-9]{40}$/.test(scope.head) || scope.logOptions !== scope.head) throw new Error("Invalid immutable history scope");
  return ["git", root, `--log-opts=${scope.head}`, "--redact=100", "--no-banner", "--log-level", "error", "--report-format", "template", "--report-template", template, "--report-path", report, "--gitleaks-ignore-path", root];
}
