#!/usr/bin/env node
// model-in-the-loop-eval — issue #1185's optional, human-run half. Runs a
// scripted, non-technical-founder transcript against a chosen role's real
// skill through whatever model-backed agent CLI the owner has installed,
// and prints the transcript so a human can grade it by eye against
// docs/contracts/conversation-contract.md (#1182): a recommendation listed
// first, exactly one question per turn, no ids/paths/versions/commands
// asked of the client, no unexplained jargon, the reply opens with status,
// and a hard-rule violation is refused with a reason (#1187's design
// comment on evals, and #1176's own scope addition).
//
// THIS SCRIPT NEVER RUNS IN CI. It is not wired into any check:* script,
// any npm script, or any .github/workflows/*.yml -- see this repository's
// own AGENTS.md and #1185's brief: "It never runs in CI, has zero CI cost."
// It costs a real model call every time an owner runs it by hand.
//
// Usage (run locally, never in CI):
//
//   node evals/manual/model-in-the-loop-eval.mjs <role> [--host claude-code|cursor]
//
// <role> is a packages/*/skill directory name, e.g. "strategist". This
// script does not itself hold an API key or invoke a provider SDK -- it
// prints the exact scripted transcript and the exact invocation instruction
// (`/clossys-<role> loop` for Claude Code, `@clossys-<role> loop` for
// Cursor, per #1194) for the owner to paste into their own already
// -authenticated agent session, then prints the grading checklist to score
// the reply against. Keeping the model call itself out of this script means
// it needs no credential of its own and can never be accidentally wired
// into an automated job -- there is nothing here that calls out on its own.
//
// This is deliberately NOT a graded pass/fail gate: model output is not
// reproducible run to run, so a scripted assertion over it would be
// exactly the flaky, non-deterministic gate #1185 says to keep out of CI.
// A human reads the transcript and the reply, and judges.

const ROLE = process.argv[2];
const hostArgIndex = process.argv.indexOf("--host");
const HOST = hostArgIndex === -1 ? "claude-code" : (process.argv[hostArgIndex + 1] ?? "claude-code");

if (!ROLE) {
  console.error("usage: node evals/manual/model-in-the-loop-eval.mjs <role> [--host claude-code|cursor]");
  console.error("example: node evals/manual/model-in-the-loop-eval.mjs strategist");
  process.exit(2);
}

const INVOCATION = HOST === "cursor" ? `@clossys-${ROLE} loop` : `/clossys-${ROLE} loop`;

// A generic, non-technical founder persona and a generic opening message --
// no real client, no real company (same rule evals/scenarios/*.json fixtures
// follow). This is the scripted transcript issue #1187's design comment
// asks for: "Scripted transcripts with a non-technical founder persona run
// against each skill."
const FOUNDER_PERSONA = [
  "You are a first-time, non-technical founder. You have never used a terminal,",
  "do not know what a repository, commit, or package is, and will not",
  "recognize an id, a file path, a version number, or a command if one is",
  "shown to you. You want plain answers and a clear recommendation.",
].join(" ");

const OPENING_MESSAGE = "Hi -- I'm not sure where things stand. What do you recommend we do next?";

console.log(`Manual model-in-the-loop eval for role: ${ROLE}`);
console.log("=".repeat(60));
console.log();
console.log("This script makes no model call itself. Copy the block below into");
console.log(`your own already-authenticated ${HOST === "cursor" ? "Cursor" : "Claude Code"} session, in a repository`);
console.log(`where @clossys/${ROLE} is installed, then read the reply against the`);
console.log("grading checklist further down.");
console.log();
console.log("--- Persona (paste first, as your own framing, or hold it in mind) ---");
console.log(FOUNDER_PERSONA);
console.log();
console.log("--- Invocation ---");
console.log(INVOCATION);
console.log();
console.log("--- Opening message ---");
console.log(OPENING_MESSAGE);
console.log();
console.log("--- Grading checklist (docs/contracts/conversation-contract.md, #1182) ---");
for (const item of [
  "Where we are: opens with one or two plain-language status sentences.",
  "My recommendation: a recommendation is stated, and stated first -- before any question.",
  "Your call: exactly one question, 2-4 options, the recommended option first and labelled.",
  "No ids, slugs, paths, versions, commands, or tool choices are asked of you.",
  "No unexplained jargon; any craft decision is stated, not asked.",
  "What happens next: says what happens if you take the recommendation.",
  `If you push back once, the role pushes back plainly once, then either follows your call or refuses a hard-rule violation with a stated reason.`,
  `The role never suggests a bare "loop" -- only "${INVOCATION}" (or the other host's own form).`,
]) {
  console.log(`  [ ] ${item}`);
}
console.log();
console.log("Score: count checked boxes / total. This is evidence for a human");
console.log("reviewer, never a CI gate and never a claim about client outcomes.");
