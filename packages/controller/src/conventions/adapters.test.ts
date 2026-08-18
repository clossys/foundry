import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { adapterPath } from "./documents.js";

// Real subprocess behavioral coverage for the shell adapters under
// conventions/adapters/. These are executed with `bash`, exactly the way a
// product's hook runner invokes them: JSON on stdin, a decision (or nothing)
// on stdout. A test that only greps the script text cannot prove any of
// this -- grepping cannot observe what the process actually emits when it
// runs, and issue #307 exists precisely because two hooks' comments already
// asserted a safety property the executing code did not have. Every
// assertion below runs the real file at conventions/adapters/*.sh through a
// real bash subprocess and reads its real stdout.

interface HookInput {
  readonly command: string;
  readonly cwd?: string;
}

function runHook(
  scriptPath: string,
  input: HookInput,
  env: Record<string, string | undefined>,
): { stdout: string; status: number } {
  const payload = JSON.stringify({ tool_input: { command: input.command }, cwd: input.cwd ?? "" });
  // Start from a minimal, explicit environment rather than inheriting the
  // test runner's own -- otherwise a developer's real shell (which may well
  // export AGENT_BRANCH_PREFIX for this very repository's own hooks) would
  // silently make the "unset" tests stop testing the unset case.
  const childEnv: Record<string, string> = { PATH: process.env.PATH ?? "" };
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) childEnv[key] = value;
  }
  try {
    const stdout = execFileSync("bash", [scriptPath], {
      input: payload,
      env: childEnv,
      encoding: "utf8",
      timeout: 5_000,
    });
    return { stdout, status: 0 };
  } catch (error) {
    const err = error as { status?: number | null; stdout?: string };
    return { stdout: err.stdout ?? "", status: err.status ?? -1 };
  }
}

function decisionOf(stdout: string): { permissionDecision: string; permissionDecisionReason: string } | undefined {
  const trimmed = stdout.trim();
  if (trimmed === "") return undefined;
  const parsed = JSON.parse(trimmed) as {
    hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string };
  };
  return parsed.hookSpecificOutput;
}

describe("branch-provenance-hook.sh — unset AGENT_BRANCH_PREFIX (issue #307)", () => {
  const scriptPath = adapterPath("branch-provenance-hook");

  it("emits an ask decision naming the missing variable for a branch creation, instead of staying silent", () => {
    const result = runHook(scriptPath, { command: "git checkout -b feat/oops", cwd: "/tmp" }, {
      AGENT_BRANCH_PREFIX: undefined,
    });
    expect(result.status).toBe(0);
    const decision = decisionOf(result.stdout);
    expect(decision).toBeDefined();
    expect(decision?.permissionDecision).toBe("ask");
    expect(decision?.permissionDecisionReason).toContain("AGENT_BRANCH_PREFIX");
  });

  it("does NOT fall through to allow: stdout is never empty for a branch creation when unconfigured", () => {
    const result = runHook(scriptPath, { command: "git switch -c anything", cwd: "/tmp" }, {
      AGENT_BRANCH_PREFIX: undefined,
    });
    expect(result.stdout.trim()).not.toBe("");
  });

  it("still blocks a direct push to main when unconfigured -- default-branch protection never reads AGENT_BRANCH_PREFIX", () => {
    const result = runHook(scriptPath, { command: "git push origin main", cwd: "/tmp" }, {
      AGENT_BRANCH_PREFIX: undefined,
    });
    const decision = decisionOf(result.stdout);
    expect(decision?.permissionDecision).toBe("deny");
  });

  it("stays silent for a command this hook has no opinion about, even when unconfigured", () => {
    const result = runHook(scriptPath, { command: "ls -la", cwd: "/tmp" }, {
      AGENT_BRANCH_PREFIX: undefined,
    });
    expect(result.stdout.trim()).toBe("");
  });

  it("evaluates normally (no ask) once AGENT_BRANCH_PREFIX is configured", () => {
    const result = runHook(scriptPath, { command: "git checkout -b claude/thing", cwd: "/tmp" }, {
      AGENT_BRANCH_PREFIX: "claude",
    });
    expect(result.stdout.trim()).toBe("");
  });

  it("still denies a non-conforming branch once configured", () => {
    const result = runHook(scriptPath, { command: "git checkout -b feat/thing", cwd: "/tmp" }, {
      AGENT_BRANCH_PREFIX: "claude",
    });
    const decision = decisionOf(result.stdout);
    expect(decision?.permissionDecision).toBe("deny");
    expect(decision?.permissionDecisionReason).toContain("claude/");
  });
});

describe("scoped-main-push.sh — unset AGENT_BRANCH_PREFIX (issue #307)", () => {
  const scriptPath = adapterPath("scoped-main-push");
  let workspaceRoot: string;
  let canonicalRepoDir: string;

  const setUpWorkspace = () => {
    workspaceRoot = mkdtempSync(join(tmpdir(), "foundry-scoped-main-push-"));
    canonicalRepoDir = join(workspaceRoot, "projects", "example", "repos", "thing");
    execFileSync("mkdir", ["-p", canonicalRepoDir]);
  };

  afterEach(() => {
    if (workspaceRoot) rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("emits an ask decision naming the missing variable for a branch creation in the canonical workspace", () => {
    setUpWorkspace();
    const result = runHook(scriptPath, { command: "git checkout -b feat/oops", cwd: canonicalRepoDir }, {
      AGENT_BRANCH_PREFIX: undefined,
      CODE_WORKSPACE_ROOT: workspaceRoot,
    });
    expect(result.status).toBe(0);
    const decision = decisionOf(result.stdout);
    expect(decision).toBeDefined();
    expect(decision?.permissionDecision).toBe("ask");
    expect(decision?.permissionDecisionReason).toContain("AGENT_BRANCH_PREFIX");
  });

  it("still blocks a direct push to main in the canonical workspace when unconfigured", () => {
    setUpWorkspace();
    const result = runHook(scriptPath, { command: "git push origin main", cwd: canonicalRepoDir }, {
      AGENT_BRANCH_PREFIX: undefined,
      CODE_WORKSPACE_ROOT: workspaceRoot,
    });
    const decision = decisionOf(result.stdout);
    expect(decision?.permissionDecision).toBe("deny");
  });

  it("evaluates normally (no ask) once AGENT_BRANCH_PREFIX is configured", () => {
    setUpWorkspace();
    const result = runHook(scriptPath, { command: "git checkout -b claude/thing", cwd: canonicalRepoDir }, {
      AGENT_BRANCH_PREFIX: "claude",
      CODE_WORKSPACE_ROOT: workspaceRoot,
    });
    expect(result.stdout.trim()).toBe("");
  });
});

describe("heavy-cmd-hook.sh — advisory degrade-open stays unchanged (issue #307)", () => {
  const scriptPath = adapterPath("heavy-cmd-hook");

  it("still reports what it detected and warns, never a permission decision, when HEAVY_CMD_PREFLIGHT_COMMAND is unset", () => {
    const result = runHook(scriptPath, { command: "npm install" }, {
      HEAVY_CMD_PREFLIGHT_COMMAND: undefined,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("heavy command detected");
    expect(result.stdout).toContain("WARNING");
    expect(() => decisionOf(result.stdout)).toThrow();
  });
});
