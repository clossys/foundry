/**
 * The exit-code contract, exercised end to end through `main(argv)` against
 * real temp directories, and then again through the REAL compiled
 * `dist/cli.js` — the only shape this gate actually ships in.
 *
 * Every gate gets all three states proven here — `0`, `1`, and `2` — and
 * `2` is proven by more than one genuinely different route per gate: an
 * unreadable record store, a store that parses but does not validate, an
 * empty record set, a set in which nothing has come due yet, and — for
 * `obligation-discharge` — an outcome that could not be established. A gate
 * whose `2` has never been observed is indistinguishable from a gate that
 * cannot reach it.
 *
 * The four dispatch cases at the top are pinned individually because this
 * is where the contract is easiest to get wrong: a bare invocation is `2`
 * with usage on STDERR and stdout untouched, an unknown subcommand is `2`,
 * an explicitly requested `--help` is `0`, and a real gate with missing
 * input is `2`. The last block re-measures those same four cases against
 * the compiled CLIs of this repository's other gate packages, so the claim
 * "this package follows the house contract" is a comparison rather than an
 * assertion about itself.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliInputError, main } from "./cli.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "giver-cli-"));
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function write(name: string, value: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value), "utf8");
  return path;
}

const AT = "2026-08-22T12:00:00.000Z";

const handoff = {
  handoffId: "handoff-1",
  subjectId: "subject-1",
  actorId: "actor-1",
  raisedAt: "2026-08-22T10:00:00.000Z",
  sla: { minutes: 60 },
  reason: "standing-indeterminate",
};
const placement = { handoffId: "handoff-1", placedWithActorId: "human-1", placedAt: "2026-08-22T10:30:00.000Z" };

const groundCitation = { groundId: "ground-1", citedAt: AT };
const retainedGround = { groundId: "ground-1", subjectId: "subject-1", retainedAt: "2026-08-22T09:00:00.000Z" };
const deliveredAnswer = {
  requestId: "req-1",
  subjectId: "subject-1",
  actorId: "actor-1",
  receivedAt: "2026-08-22T11:00:00.000Z",
  outcome: { kind: "delivered", at: AT, cites: [groundCitation] },
};

const obligation = {
  obligationId: "obl-1",
  subjectId: "subject-1",
  register: "statements",
  firedAt: "2026-08-22T10:00:00.000Z",
  window: { minutes: 60 },
};
const deliveredProof = { obligationId: "obl-1", actorId: "sender-1", state: "delivered", observedAt: "2026-08-22T10:30:00.000Z", transportRef: "ref-1" };

describe("dispatch", () => {
  it("exits 2 with no gate selected — a bare invocation is a run that never happened", () => {
    // The fail-open shape this package exists to repay, guarded in its own
    // CLI: a CI step with a dropped argument, a wrapper that loses `$1`, or
    // a gate renamed out from under its caller all land here, and none of
    // them may report clean on the strength of having checked nothing.
    expect(main([])).toBe(2);
  });

  it("prints its usage to stderr when no gate was selected, never to stdout as if it were output", () => {
    main([]);
    expect(console.error).toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
  });

  it("exits 0 for an explicitly requested --help, which is a run that did what was asked", () => {
    expect(main(["--help"])).toBe(0);
    expect(main(["-h"])).toBe(0);
  });

  it("refuses an unknown gate rather than falling through to one", () => {
    expect(() => main(["consent-check"])).toThrow(CliInputError);
  });

  it("dispatches on argv[0] exactly, so a path argument is never mistaken for a gate name", () => {
    expect(() => main(["Grounding", "a", "b"])).toThrow(CliInputError);
    expect(() => main([join(dir, "grounding"), "a"])).toThrow(CliInputError);
  });

  it("prints each gate's own usage and exits 0", () => {
    expect(main(["handoff-placement", "--help"])).toBe(0);
    expect(main(["grounding", "--help"])).toBe(0);
    expect(main(["obligation-discharge", "--help"])).toBe(0);
  });

  it("refuses an unknown flag rather than ignoring it", () => {
    const handoffs = write("handoffs.json", [handoff]);
    const placements = write("placements.json", [placement]);
    expect(() => main(["handoff-placement", handoffs, placements, "--when", AT])).toThrow(CliInputError);
  });
});

describe("handoff-placement", () => {
  it("exits 0 when every hand-off that came due was picked up in time", () => {
    const handoffs = write("handoffs.json", [handoff]);
    const placements = write("placements.json", [placement]);
    expect(main(["handoff-placement", handoffs, placements, "--at", AT])).toBe(0);
  });

  it("exits 1 on a hand-off nobody picked up — silence is the finding", () => {
    const handoffs = write("handoffs.json", [handoff]);
    const placements = write("placements.json", []);
    expect(main(["handoff-placement", handoffs, placements, "--at", AT])).toBe(1);
  });

  it("exits 1 on a hand-off picked up after its declared service level elapsed", () => {
    const handoffs = write("handoffs.json", [handoff]);
    const placements = write("placements.json", [{ ...placement, placedAt: "2026-08-22T11:30:00.000Z" }]);
    expect(main(["handoff-placement", handoffs, placements, "--at", AT])).toBe(1);
  });

  it("exits 2 when the record store cannot be read", () => {
    const placements = write("placements.json", []);
    expect(main(["handoff-placement", join(dir, "missing.json"), placements, "--at", AT])).toBe(2);
  });

  it("exits 2 when the record store is a directory rather than a file", () => {
    const asDirectory = join(dir, "handoffs-dir");
    mkdirSync(asDirectory);
    const placements = write("placements.json", []);
    expect(main(["handoff-placement", asDirectory, placements, "--at", AT])).toBe(2);
  });

  it("exits 2 on unparseable JSON and on JSON that does not validate", () => {
    const placements = write("placements.json", []);
    const broken = write("broken.json", "{ not json");
    expect(main(["handoff-placement", broken, placements, "--at", AT])).toBe(2);
    const invalid = write("invalid.json", [{ ...handoff, sla: { minutes: "soon" } }]);
    expect(main(["handoff-placement", invalid, placements, "--at", AT])).toBe(2);
  });

  it("exits 2 when there is nothing to scan", () => {
    const handoffs = write("handoffs.json", []);
    const placements = write("placements.json", []);
    expect(main(["handoff-placement", handoffs, placements, "--at", AT])).toBe(2);
  });

  it("exits 2 when nothing has come due yet, rather than passing a set it never compared", () => {
    const handoffs = write("handoffs.json", [{ ...handoff, raisedAt: "2026-08-22T11:45:00.000Z" }]);
    const placements = write("placements.json", []);
    expect(main(["handoff-placement", handoffs, placements, "--at", AT])).toBe(2);
  });

  it("refuses to run without --at, and refuses to invent one", () => {
    const handoffs = write("handoffs.json", [handoff]);
    const placements = write("placements.json", []);
    expect(() => main(["handoff-placement", handoffs, placements])).toThrow(/--at is required/);
    expect(() => main(["handoff-placement", handoffs, placements, "--at", "soon"])).toThrow(CliInputError);
  });

  it("accepts --at=value as well as --at value", () => {
    const handoffs = write("handoffs.json", [handoff]);
    const placements = write("placements.json", [placement]);
    expect(main(["handoff-placement", handoffs, placements, `--at=${AT}`])).toBe(0);
  });

  it("requires both files", () => {
    const handoffs = write("handoffs.json", [handoff]);
    expect(() => main(["handoff-placement"])).toThrow(/handoffs-file is required/);
    expect(() => main(["handoff-placement", handoffs, "--at", AT])).toThrow(/placements-file is required/);
  });
});

describe("grounding", () => {
  it("exits 0 when every delivery cites retained material", () => {
    const answers = write("answers.json", [deliveredAnswer]);
    const retained = write("retained.json", [retainedGround]);
    expect(main(["grounding", answers, retained])).toBe(0);
  });

  it("exits 1 on a delivered answer citing nothing at all", () => {
    const answers = write("answers.json", [{ ...deliveredAnswer, outcome: { kind: "delivered", at: AT, cites: [] } }]);
    const retained = write("retained.json", [retainedGround]);
    expect(main(["grounding", answers, retained])).toBe(1);
  });

  it("exits 1 on a refusal that retained no grounds", () => {
    const answers = write("answers.json", [{ ...deliveredAnswer, outcome: { kind: "refused", at: AT, namedReason: "policy", grounds: [] } }]);
    const retained = write("retained.json", [retainedGround]);
    expect(main(["grounding", answers, retained])).toBe(1);
  });

  it("exits 2 when the record store cannot be read", () => {
    const retained = write("retained.json", []);
    expect(main(["grounding", join(dir, "missing.json"), retained])).toBe(2);
  });

  it("exits 2 when the answers file parses but does not validate", () => {
    const answers = write("answers.json", [{ ...deliveredAnswer, outcome: { kind: "ignored", at: AT } }]);
    const retained = write("retained.json", []);
    expect(main(["grounding", answers, retained])).toBe(2);
  });

  it("exits 2 when there is nothing to scan", () => {
    const answers = write("answers.json", []);
    const retained = write("retained.json", [retainedGround]);
    expect(main(["grounding", answers, retained])).toBe(2);
  });

  it("requires both files", () => {
    const answers = write("answers.json", [deliveredAnswer]);
    expect(() => main(["grounding"])).toThrow(/answers-file is required/);
    expect(() => main(["grounding", answers])).toThrow(/retained-grounds-file is required/);
  });
});

describe("obligation-discharge", () => {
  it("exits 0 when every obligation that came due was proven delivered in time", () => {
    const obligations = write("obligations.json", [obligation]);
    const proofs = write("proofs.json", [deliveredProof]);
    expect(main(["obligation-discharge", obligations, proofs, "--at", AT])).toBe(0);
  });

  it("exits 1 when every recorded send failed — the case a tool that counts attempts passes", () => {
    // The adversarial case, at the exit code. The send path this package
    // repays resolves its promise on failure, so three recorded attempts
    // look like three successful calls to anything that only checks the
    // call returned. Here they are three proofs and zero deliveries.
    const obligations = write("obligations.json", [obligation]);
    const proofs = write("proofs.json", [
      { ...deliveredProof, state: "failed", transportRef: "a" },
      { ...deliveredProof, state: "failed", observedAt: "2026-08-22T10:40:00.000Z", transportRef: "b" },
      { ...deliveredProof, state: "failed", observedAt: "2026-08-22T10:50:00.000Z", transportRef: "c" },
    ]);
    expect(main(["obligation-discharge", obligations, proofs, "--at", AT])).toBe(1);
  });

  it("exits 1 when the window closed with nothing recorded at all", () => {
    const obligations = write("obligations.json", [obligation]);
    const proofs = write("proofs.json", []);
    expect(main(["obligation-discharge", obligations, proofs, "--at", AT])).toBe(1);
  });

  it("exits 1 on a delivery observed outside the declared window", () => {
    const obligations = write("obligations.json", [obligation]);
    const proofs = write("proofs.json", [{ ...deliveredProof, observedAt: "2026-08-22T11:30:00.000Z" }]);
    expect(main(["obligation-discharge", obligations, proofs, "--at", AT])).toBe(1);
  });

  it("exits 2 — never 0 — when a send's outcome was never observed", () => {
    const obligations = write("obligations.json", [obligation]);
    const proofs = write("proofs.json", [{ ...deliveredProof, state: "unknown" }]);
    expect(main(["obligation-discharge", obligations, proofs, "--at", AT])).toBe(2);
  });

  it("exits 2 — not 1 — when one obligation breached and another was never observed, and still prints the breach", () => {
    // The mixed case. Refusing to call the list complete must not mean
    // refusing to show it: a reader has to be able to act on the breach that
    // WAS found while going back for the send nobody observed.
    const obligations = write("obligations.json", [obligation, { ...obligation, obligationId: "obl-2" }]);
    const proofs = write("proofs.json", [
      { ...deliveredProof, state: "failed" },
      { ...deliveredProof, obligationId: "obl-2", state: "unknown" },
    ]);
    expect(main(["obligation-discharge", obligations, proofs, "--at", AT])).toBe(2);

    const printed = vi.mocked(console.log).mock.calls.map((call) => String(call[0])).join("\n");
    expect(printed).toContain("[delivery-failed] obl-1");
    expect(printed).toContain("Obligation discharge: indeterminate (discharge-unprovable)");
  });

  it("exits 2 when the record store cannot be read, and when it does not validate", () => {
    const proofs = write("proofs.json", []);
    expect(main(["obligation-discharge", join(dir, "missing.json"), proofs, "--at", AT])).toBe(2);
    const invalid = write("invalid.json", [{ ...obligation, window: { minutes: "an hour" } }]);
    expect(main(["obligation-discharge", invalid, proofs, "--at", AT])).toBe(2);
  });

  it("exits 2 on a proof whose state is outside the closed list, rather than reading it as a success", () => {
    const obligations = write("obligations.json", [obligation]);
    const proofs = write("proofs.json", [{ ...deliveredProof, state: "sent" }]);
    expect(main(["obligation-discharge", obligations, proofs, "--at", AT])).toBe(2);
  });

  it("exits 2 when there is nothing to scan, and when nothing has come due yet", () => {
    const none = write("none.json", []);
    const proofs = write("proofs.json", []);
    expect(main(["obligation-discharge", none, proofs, "--at", AT])).toBe(2);

    const notYetDue = write("not-yet.json", [{ ...obligation, firedAt: "2026-08-22T11:45:00.000Z" }]);
    expect(main(["obligation-discharge", notYetDue, proofs, "--at", AT])).toBe(2);
  });

  it("refuses to run without --at", () => {
    const obligations = write("obligations.json", [obligation]);
    const proofs = write("proofs.json", []);
    expect(() => main(["obligation-discharge", obligations, proofs])).toThrow(/--at is required/);
  });

  it("requires both files", () => {
    const obligations = write("obligations.json", [obligation]);
    expect(() => main(["obligation-discharge"])).toThrow(/obligations-file is required/);
    expect(() => main(["obligation-discharge", obligations, "--at", AT])).toThrow(/proofs-file is required/);
  });
});

// -----------------------------------------------------------------------
// The real compiled CLI, and the four controls.
//
// Calling the exported `main(argv)` proves the argv-to-exit-code contract
// but NEVER proves the CLI is reachable the only way it actually ships: as
// `node dist/cli.js ...`. That gap is what a `basename(process.argv[1])`
// dispatch hides — it makes every subcommand unreachable through the real
// invocation shape while every direct-call test in the same file passes.
//
// `execFileSync` and real exit codes throughout — never "did not throw",
// because Node's uncaught-exception default also exits 1 and is
// indistinguishable from a real finding.
// -----------------------------------------------------------------------

const packagesDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cliPath = join(packagesDir, "giver", "dist", "cli.js");

function runCli(path: string, args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("node", [path, ...args], { encoding: "utf8" });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const err = error as { status?: number | null; stdout?: string; stderr?: string };
    return { status: err.status ?? Number.NaN, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

describe("direct-path reachability — the real compiled dist/cli.js", () => {
  it("node dist/cli.js obligation-discharge exits 0 on a discharged obligation", () => {
    const obligations = write("obligations.json", [obligation]);
    const proofs = write("proofs.json", [deliveredProof]);
    const result = runCli(cliPath, ["obligation-discharge", obligations, proofs, "--at", AT]);
    expect(result.stdout).toContain("Obligation discharge: satisfied.");
    expect(result.status).toBe(0);
  });

  it("node dist/cli.js obligation-discharge exits 1 when every recorded send failed", () => {
    const obligations = write("obligations.json", [obligation]);
    const proofs = write("proofs.json", [{ ...deliveredProof, state: "failed" }]);
    const result = runCli(cliPath, ["obligation-discharge", obligations, proofs, "--at", AT]);
    expect(result.stdout).toContain("Obligation discharge: violated.");
    expect(result.status).toBe(1);
  });

  it("node dist/cli.js handoff-placement exits 1 on a hand-off nobody picked up", () => {
    const handoffs = write("handoffs.json", [handoff]);
    const placements = write("placements.json", []);
    const result = runCli(cliPath, ["handoff-placement", handoffs, placements, "--at", AT]);
    expect(result.stdout).toContain("[never-placed] handoff-1");
    expect(result.status).toBe(1);
  });

  it("node dist/cli.js grounding exits 1 on a refusal with no retained grounds", () => {
    const answers = write("answers.json", [{ ...deliveredAnswer, outcome: { kind: "refused", at: AT, namedReason: "policy", grounds: [] } }]);
    const retained = write("retained.json", []);
    const result = runCli(cliPath, ["grounding", answers, retained]);
    expect(result.stdout).toContain("Grounding: violated.");
    expect(result.status).toBe(1);
  });
});

/**
 * The four exit-code cases, measured against this package's compiled CLI
 * and against every other gate package in this repository that ships one.
 *
 * The control roster is PINNED by name below. It is not derived from a
 * directory listing, because a listing that silently came back empty would
 * turn this block into a test that measures nothing and still passes —
 * which is the exact failure the `2` exit code exists to prevent, relocated
 * into a test file. Instead the four names are written down, each one's
 * presence is asserted explicitly, and a name whose package is not in this
 * tree is reported as absent rather than skipped in silence.
 */
const CONTROL_PACKAGES = ["strategist", "writer", "bouncer", "butler"] as const;

interface Control {
  name: string;
  cliPath: string;
  present: boolean;
}

const controls: Control[] = CONTROL_PACKAGES.map((name) => {
  const path = join(packagesDir, name, "dist", "cli.js");
  return { name, cliPath: path, present: existsSync(path) };
});

describe("the house exit-code contract, against the pinned controls", () => {
  it("names every control it intends to measure, and says which of them this tree actually holds", () => {
    // Absence is reported, never skipped. A control package that is not in
    // this checkout is a fact about the checkout; a control block that
    // quietly measured nothing would be a fact about nothing.
    expect(CONTROL_PACKAGES).toEqual(["strategist", "writer", "bouncer", "butler"]);
    const present = controls.filter((control) => control.present).map((control) => control.name);
    const absent = controls.filter((control) => !control.present).map((control) => control.name);
    expect(present.length + absent.length).toBe(CONTROL_PACKAGES.length);
    expect(present.length).toBeGreaterThan(0);
  });

  it("case 1 — a bare invocation exits 2, with usage on stderr and stdout untouched", () => {
    for (const control of [{ name: "giver", cliPath, present: true }, ...controls]) {
      if (!control.present) continue;
      const result = runCli(control.cliPath, []);
      expect({ name: control.name, status: result.status }).toEqual({ name: control.name, status: 2 });
      expect({ name: control.name, stdout: result.stdout }).toEqual({ name: control.name, stdout: "" });
      expect(result.stderr.length).toBeGreaterThan(0);
    }
  });

  it("case 2 — an unknown subcommand exits 2", () => {
    for (const control of [{ name: "giver", cliPath, present: true }, ...controls]) {
      if (!control.present) continue;
      const result = runCli(control.cliPath, ["__no_such_gate__"]);
      expect({ name: control.name, status: result.status }).toEqual({ name: control.name, status: 2 });
    }
  });

  it("case 3 — an explicitly requested --help exits 0, on both spellings", () => {
    for (const control of [{ name: "giver", cliPath, present: true }, ...controls]) {
      if (!control.present) continue;
      for (const flag of ["--help", "-h"]) {
        const result = runCli(control.cliPath, [flag]);
        expect({ name: control.name, flag, status: result.status }).toEqual({ name: control.name, flag, status: 0 });
        expect(result.stdout.length).toBeGreaterThan(0);
      }
    }
  });

  it("case 4 — a real gate with missing input exits 2", () => {
    const missing = join(dir, "does-not-exist.json");
    for (const control of [{ name: "giver", cliPath, present: true }, ...controls]) {
      if (!control.present) continue;
      const result = runCli(control.cliPath, [missing]);
      expect({ name: control.name, status: result.status }).toEqual({ name: control.name, status: 2 });
    }
  });

  it("case 4, for this package's own three gates specifically", () => {
    const missing = join(dir, "does-not-exist.json");
    const empty = write("empty.json", []);
    expect(runCli(cliPath, ["handoff-placement", missing, empty, "--at", AT]).status).toBe(2);
    expect(runCli(cliPath, ["grounding", missing, empty]).status).toBe(2);
    expect(runCli(cliPath, ["obligation-discharge", missing, empty, "--at", AT]).status).toBe(2);
  });
});
