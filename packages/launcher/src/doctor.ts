// launcher doctor (#1220) -- read-only. Names each missing prerequisite in
// plain language, one at a time, in the order a non-technical client
// should fix them: git -> the GitHub command-line tool -> being signed in
// -> Node.js -> npm. A missing coding agent is advisory only -- Launcher
// cannot detect every host, and it is a one-time choice the client makes,
// not a step to fix in sequence.

import type { CommandResult } from "./types.js";

export interface DoctorCheckHost {
  run(command: string, args: readonly string[]): CommandResult;
}

export type DoctorStepId = "git" | "gh-cli" | "gh-auth" | "node" | "npm" | "coding-agent";

export interface DoctorStepResult {
  readonly id: DoctorStepId;
  readonly label: string;
  readonly satisfied: boolean;
  /** Plain-language description of what is missing, present only when satisfied is false. */
  readonly problem?: string;
  /** The single next action, present only when satisfied is false. */
  readonly nextAction?: string;
  /** True for steps that inform but never block (e.g. coding-agent discovery). */
  readonly advisory: boolean;
}

export interface DoctorReport {
  readonly schemaVersion: 1;
  readonly steps: readonly DoctorStepResult[];
  /** The first unsatisfied non-advisory step, in order -- what the client should fix right now. */
  readonly nextToFix?: DoctorStepResult;
  readonly allSatisfied: boolean;
}

function ok(id: DoctorStepId, label: string, advisory = false): DoctorStepResult {
  return { id, label, satisfied: true, advisory };
}

function missing(id: DoctorStepId, label: string, problem: string, nextAction: string, advisory = false): DoctorStepResult {
  return { id, label, satisfied: false, problem, nextAction, advisory };
}

function commandSucceeds(host: DoctorCheckHost, command: string, args: readonly string[]): boolean {
  try {
    return host.run(command, args).status === 0;
  } catch {
    return false;
  }
}

/** Runs every doctor check in the fix-in-this-order sequence. Never mutates anything. */
export function runDoctorChecks(host: DoctorCheckHost): DoctorReport {
  const steps: DoctorStepResult[] = [];

  const hasGit = commandSucceeds(host, "git", ["--version"]);
  steps.push(
    hasGit
      ? ok("git", "Git is installed")
      : missing(
          "git",
          "Git is installed",
          "Git is not installed on this computer. Launcher and your coding agent both need it to save and share work.",
          "Install Git from https://git-scm.com/downloads, then run this command again.",
        ),
  );

  const hasGh = commandSucceeds(host, "gh", ["--version"]);
  steps.push(
    hasGh
      ? ok("gh-cli", "The GitHub command-line tool (gh) is installed")
      : missing(
          "gh-cli",
          "The GitHub command-line tool (gh) is installed",
          "The GitHub command-line tool is not installed. Launcher uses it to create and find your GitHub repositories.",
          "Install it from https://cli.github.com, then run this command again.",
        ),
  );

  const ghAuthed = hasGh && commandSucceeds(host, "gh", ["auth", "status"]);
  steps.push(
    !hasGh
      ? missing(
          "gh-auth",
          "You are signed in to GitHub",
          "This cannot be checked yet because the GitHub command-line tool is not installed.",
          "Install the GitHub command-line tool first (see above), then run this command again.",
        )
      : ghAuthed
        ? ok("gh-auth", "You are signed in to GitHub")
        : missing(
            "gh-auth",
            "You are signed in to GitHub",
            "You are not signed in to GitHub yet.",
            "Run `gh auth login` and follow the prompts, then run this command again.",
          ),
  );

  const hasNode = commandSucceeds(host, "node", ["--version"]);
  steps.push(
    hasNode
      ? ok("node", "Node.js is installed")
      : missing(
          "node",
          "Node.js is installed",
          "Node.js is not installed. It is what runs the team's tools on this computer.",
          "Install the current LTS release from https://nodejs.org, then run this command again.",
        ),
  );

  const hasNpm = commandSucceeds(host, "npm", ["--version"]);
  steps.push(
    hasNpm
      ? ok("npm", "npm is installed")
      : missing(
          "npm",
          "npm is installed",
          "npm is not installed. It comes with Node.js, so this is usually fixed by installing or reinstalling Node.js.",
          "Install Node.js from https://nodejs.org (npm is included), then run this command again.",
        ),
  );

  // Advisory only: never blocks doctor's overall verdict. A missing coding
  // agent is not a step to fix in a particular order -- it is a one-time
  // choice the client makes, and Launcher cannot detect every host.
  steps.push(ok("coding-agent", "A coding agent is available to open this hub", true));

  const firstUnsatisfied = steps.find((step) => !step.satisfied && !step.advisory);
  return {
    schemaVersion: 1,
    steps,
    ...(firstUnsatisfied === undefined ? {} : { nextToFix: firstUnsatisfied }),
    allSatisfied: firstUnsatisfied === undefined,
  };
}

/** Renders one step at a time, plain language, the way a non-technical client reads it. */
export function renderDoctorReport(report: DoctorReport): string {
  if (report.allSatisfied) {
    return "Everything doctor checks is ready. Open this folder in your coding agent and talk to @clossys-advisor to get started.";
  }
  const step = report.nextToFix;
  if (step === undefined) return "Everything doctor checks is ready.";
  return `${step.label}: not yet.\n${step.problem}\n\nNext: ${step.nextAction}`;
}
