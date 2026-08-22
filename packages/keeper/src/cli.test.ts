/**
 * The exit-code contract, exercised end to end through `main(argv)` against
 * real temp directories, and then again through the REAL compiled
 * `dist/cli.js` — the only shape this gate actually ships in.
 *
 * Every gate gets all three states proven here — `0`, `1`, and `2` — and `2`
 * is proven by more than one genuinely different route per gate: an
 * unreadable record store, a store that parses but does not validate, an
 * empty holding set, and — the route that matters most in this package — an
 * answer that could not be established. A gate whose `2` has never been
 * observed is indistinguishable from a gate that cannot reach it.
 *
 * The four dispatch cases at the top are pinned individually because this is
 * where the contract is easiest to get wrong: a bare invocation is `2` with
 * usage on STDERR and stdout untouched, an unknown subcommand is `2`, an
 * explicitly requested `--help` is `0`, and a real gate with missing input is
 * `2`. The last block re-measures those same four cases against the compiled
 * CLIs of this repository's other gate packages, so the claim "this package
 * follows the house contract" is a comparison rather than an assertion about
 * itself.
 *
 * No fixture below is a real holding. Every id is synthetic and every file is
 * written into a per-test `mkdtemp` directory that is removed afterwards —
 * this package never writes a person-attributable record anywhere, least of
 * all into a repository.
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
  dir = mkdtempSync(join(tmpdir(), "keeper-cli-"));
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

const sourceEvent = { eventId: "evt_1", subjectId: "sub_1", actorId: "actor_1", occurredAt: "2026-07-01T00:00:00.000Z", kind: "note-written" };

const heldItem = {
  itemId: "item_1",
  subjectId: "sub_1",
  actorId: "actor_1",
  heldSince: "2026-08-01T00:00:00.000Z",
  holdingClass: "authored-notes",
  origin: "authored",
  provenance: { kind: "event", sourceEventId: "evt_1" },
  belief: null,
};

const constrainingBelief = {
  ...heldItem,
  itemId: "item_belief",
  holdingClass: "inferred-preferences",
  origin: "inferred",
  belief: {
    beliefClass: "scheduling-preference",
    inferredAt: "2026-08-01T00:00:00.000Z",
    use: { mode: "constrains", confirmation: null },
  },
};

const disclosure = {
  itemId: "item_1",
  subjectId: "sub_1",
  surface: "account-data-page",
  reach: "visible",
  correctable: true,
  observedAt: "2026-08-02T00:00:00.000Z",
};

const retentionRule = { holdingClass: "authored-notes", days: 90 };
const deletionRecord = { itemId: "item_1", subjectId: "sub_1", actorId: "actor_1", deletedAt: "2026-08-10T00:00:00.000Z", effect: "erased" };

describe("dispatch", () => {
  it("exits 2 with no gate selected — a bare invocation is a run that never happened", () => {
    // A CI step with a dropped argument, a wrapper that loses `$1`, or a gate
    // renamed out from under its caller all land here, and none of them may
    // report clean on the strength of having checked nothing.
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
    expect(() => main(["Visibility", "a", "b"])).toThrow(CliInputError);
    expect(() => main([join(dir, "visibility"), "a"])).toThrow(CliInputError);
  });

  it("prints each gate's own usage and exits 0", () => {
    expect(main(["attribution", "--help"])).toBe(0);
    expect(main(["visibility", "--help"])).toBe(0);
    expect(main(["disposal", "--help"])).toBe(0);
  });

  it("refuses an unknown flag rather than ignoring it", () => {
    const items = write("items.json", [heldItem]);
    const schedule = write("schedule.json", [retentionRule]);
    const deletions = write("deletions.json", []);
    expect(() => main(["disposal", items, schedule, deletions, "--when", AT])).toThrow(CliInputError);
  });
});

describe("attribution", () => {
  it("exits 0 when every held item traces to a retained event of the same person", () => {
    const items = write("items.json", [heldItem]);
    const events = write("events.json", [sourceEvent]);
    expect(main(["attribution", items, events])).toBe(0);
  });

  it("exits 1 on a holding that traces to nothing the person did", () => {
    const items = write("items.json", [{ ...heldItem, provenance: { kind: "none", namedReason: "imported from a spreadsheet" } }]);
    const events = write("events.json", [sourceEvent]);
    expect(main(["attribution", items, events])).toBe(1);
  });

  it("exits 1 on an inferred belief with no source event — the central finding", () => {
    const items = write("items.json", [
      { ...constrainingBelief, belief: { ...constrainingBelief.belief, use: { mode: "informs" } }, provenance: { kind: "none", namedReason: "the model produced no citation" } },
    ]);
    const events = write("events.json", [sourceEvent]);
    expect(main(["attribution", items, events])).toBe(1);
  });

  it("exits 1 on a belief used as a constraint with no confirmation — the boundary rule", () => {
    const items = write("items.json", [constrainingBelief]);
    const events = write("events.json", [sourceEvent]);
    expect(main(["attribution", items, events])).toBe(1);
  });

  it("exits 2 — never 0 — when the store could not say where an item came from", () => {
    const items = write("items.json", [{ ...heldItem, provenance: { kind: "indeterminate", namedReason: "the event ledger timed out" } }]);
    const events = write("events.json", [sourceEvent]);
    expect(main(["attribution", items, events])).toBe(2);
  });

  it("exits 2 — not 1 — on a mixed set, and still prints the violation it did find", () => {
    // Refusing to call the list complete must not mean refusing to show it: a
    // reader has to be able to act on the finding that WAS found while going
    // back for the item nobody could resolve.
    const items = write("items.json", [
      { ...heldItem, itemId: "item_bad", provenance: { kind: "none", namedReason: "imported" } },
      { ...heldItem, itemId: "item_unknown", provenance: { kind: "indeterminate", namedReason: "ledger timeout" } },
    ]);
    const events = write("events.json", [sourceEvent]);
    expect(main(["attribution", items, events])).toBe(2);

    const printed = vi.mocked(console.log).mock.calls.map((call) => String(call[0])).join("\n");
    expect(printed).toContain("[held-without-source-event] item_bad");
    expect(printed).toContain("Attribution: indeterminate (attribution-unverifiable)");
  });

  it("exits 2 when the record store cannot be read, is a directory, is unparseable, or does not validate", () => {
    const events = write("events.json", [sourceEvent]);
    expect(main(["attribution", join(dir, "missing.json"), events])).toBe(2);

    const asDirectory = join(dir, "items-dir");
    mkdirSync(asDirectory);
    expect(main(["attribution", asDirectory, events])).toBe(2);

    const broken = write("broken.json", "{ not json");
    expect(main(["attribution", broken, events])).toBe(2);

    const invalid = write("invalid.json", [{ ...heldItem, origin: "imported" }]);
    expect(main(["attribution", invalid, events])).toBe(2);
  });

  it("exits 2 when there is nothing to scan", () => {
    const items = write("items.json", []);
    const events = write("events.json", [sourceEvent]);
    expect(main(["attribution", items, events])).toBe(2);
  });

  it("requires both files", () => {
    const items = write("items.json", [heldItem]);
    expect(() => main(["attribution"])).toThrow(/items-file is required/);
    expect(() => main(["attribution", items])).toThrow(/source-events-file is required/);
  });
});

describe("visibility", () => {
  it("exits 0 when every item is reachable and correctable by the person it is about", () => {
    const items = write("items.json", [heldItem]);
    const disclosures = write("disclosures.json", [disclosure]);
    expect(main(["visibility", items, disclosures])).toBe(0);
  });

  it("exits 1 on an item with no disclosure route at all", () => {
    const items = write("items.json", [heldItem]);
    const disclosures = write("disclosures.json", []);
    expect(main(["visibility", items, disclosures])).toBe(1);
  });

  it("exits 1 on an item a person can read but not correct", () => {
    const items = write("items.json", [heldItem]);
    const disclosures = write("disclosures.json", [{ ...disclosure, correctable: false }]);
    expect(main(["visibility", items, disclosures])).toBe(1);
  });

  it("exits 1 when the only route belongs to a different person", () => {
    const items = write("items.json", [heldItem]);
    const disclosures = write("disclosures.json", [{ ...disclosure, subjectId: "sub_other" }]);
    expect(main(["visibility", items, disclosures])).toBe(1);
  });

  it("exits 2 — never 0 — on a route that could not say whether the person can see it", () => {
    const items = write("items.json", [heldItem]);
    const disclosures = write("disclosures.json", [{ ...disclosure, reach: "unknown" }]);
    expect(main(["visibility", items, disclosures])).toBe(2);
  });

  it("exits 2 on an unreadable store, a store that does not validate, and an empty holding set", () => {
    const disclosures = write("disclosures.json", [disclosure]);
    expect(main(["visibility", join(dir, "missing.json"), disclosures])).toBe(2);

    const invalidRoutes = write("bad-routes.json", [{ ...disclosure, reach: "shown" }]);
    const items = write("items.json", [heldItem]);
    expect(main(["visibility", items, invalidRoutes])).toBe(2);

    const none = write("none.json", []);
    expect(main(["visibility", none, disclosures])).toBe(2);
  });

  it("requires both files", () => {
    const items = write("items.json", [heldItem]);
    expect(() => main(["visibility"])).toThrow(/items-file is required/);
    expect(() => main(["visibility", items])).toThrow(/disclosures-file is required/);
  });
});

describe("disposal", () => {
  it("exits 0 when nothing has outlived the retention its own class declared", () => {
    const items = write("items.json", [heldItem]);
    const schedule = write("schedule.json", [retentionRule]);
    const deletions = write("deletions.json", []);
    expect(main(["disposal", items, schedule, deletions, "--at", AT])).toBe(0);
  });

  it("exits 1 on records sitting far past a policy that is itself perfectly well-formed — the adversarial case", () => {
    // A weaker tool reads the schedule, finds it valid, and passes. Nothing in
    // it ever compared the declaration against the data.
    const items = write(
      "items.json",
      ["item_a", "item_b", "item_c"].map((itemId) => ({ ...heldItem, itemId, heldSince: "2025-07-18T12:00:00.000Z" })),
    );
    const schedule = write("schedule.json", [retentionRule]);
    const deletions = write("deletions.json", []);
    expect(main(["disposal", items, schedule, deletions, "--at", AT])).toBe(1);

    const printed = vi.mocked(console.log).mock.calls.map((call) => String(call[0])).join("\n");
    expect(printed).toContain("400 day(s) against the 90-day retention");
    expect(printed).toContain("Disposal: violated (items-retained-past-schedule).");
  });

  it("exits 1 on an erasure that left the item still held, under its own reason", () => {
    // Two violation reasons, both `1`. Naming only one in the exit mapping
    // would have quietly sent this one to `2` and reported an erasure failure
    // as something the gate could not check.
    const items = write("items.json", [heldItem]);
    const schedule = write("schedule.json", [retentionRule]);
    const deletions = write("deletions.json", [deletionRecord]);
    expect(main(["disposal", items, schedule, deletions, "--at", AT])).toBe(1);

    const printed = vi.mocked(console.log).mock.calls.map((call) => String(call[0])).join("\n");
    expect(printed).toContain("Disposal: violated (deletions-left-residue).");
  });

  it("exits 2 — never 0 — on an item whose own heldSince cannot be read", () => {
    const items = write("items.json", [{ ...heldItem, heldSince: "a while ago" }]);
    const schedule = write("schedule.json", [retentionRule]);
    const deletions = write("deletions.json", []);
    // The JSON validator refuses this shape, which is itself a `2`. The gate
    // behind it refuses it too, for a caller that constructs items directly.
    expect(main(["disposal", items, schedule, deletions, "--at", AT])).toBe(2);
  });

  it("exits 1 on a deletion that failed while the item is still held", () => {
    const items = write("items.json", [heldItem]);
    const schedule = write("schedule.json", [retentionRule]);
    const deletions = write("deletions.json", [{ ...deletionRecord, effect: "failed" }]);
    expect(main(["disposal", items, schedule, deletions, "--at", AT])).toBe(1);
  });

  it("exits 2 — never 0 — on an item whose class the declared schedule never covered", () => {
    const items = write("items.json", [{ ...heldItem, holdingClass: "referrals" }]);
    const schedule = write("schedule.json", [retentionRule]);
    const deletions = write("deletions.json", []);
    expect(main(["disposal", items, schedule, deletions, "--at", AT])).toBe(2);
  });

  it("exits 2 — never 0 — on a deletion nobody observed the effect of", () => {
    const items = write("items.json", [heldItem]);
    const schedule = write("schedule.json", [retentionRule]);
    const deletions = write("deletions.json", [{ ...deletionRecord, effect: "unknown" }]);
    expect(main(["disposal", items, schedule, deletions, "--at", AT])).toBe(2);
  });

  it("exits 2 — not 1 — on a mixed set, and still prints the drift it did find", () => {
    const items = write("items.json", [
      { ...heldItem, itemId: "item_stale", heldSince: "2025-01-01T00:00:00.000Z" },
      { ...heldItem, itemId: "item_unknown_class", holdingClass: "referrals" },
    ]);
    const schedule = write("schedule.json", [retentionRule]);
    const deletions = write("deletions.json", []);
    expect(main(["disposal", items, schedule, deletions, "--at", AT])).toBe(2);

    const printed = vi.mocked(console.log).mock.calls.map((call) => String(call[0])).join("\n");
    expect(printed).toContain("[retained-past-schedule] item_stale");
    expect(printed).toContain("Disposal: indeterminate (disposal-unverifiable)");
  });

  it("exits 2 on an unreadable store, a schedule that does not validate, and an empty holding set", () => {
    const schedule = write("schedule.json", [retentionRule]);
    const deletions = write("deletions.json", []);
    expect(main(["disposal", join(dir, "missing.json"), schedule, deletions, "--at", AT])).toBe(2);

    const items = write("items.json", [heldItem]);
    const badSchedule = write("bad-schedule.json", [{ holdingClass: "authored-notes", days: "ninety" }]);
    expect(main(["disposal", items, badSchedule, deletions, "--at", AT])).toBe(2);

    const none = write("none.json", []);
    expect(main(["disposal", none, schedule, deletions, "--at", AT])).toBe(2);
  });

  it("refuses to run without --at, and refuses to invent one", () => {
    const items = write("items.json", [heldItem]);
    const schedule = write("schedule.json", [retentionRule]);
    const deletions = write("deletions.json", []);
    expect(() => main(["disposal", items, schedule, deletions])).toThrow(/--at is required/);
    expect(() => main(["disposal", items, schedule, deletions, "--at", "recently"])).toThrow(CliInputError);
  });

  it("accepts --at=value as well as --at value", () => {
    const items = write("items.json", [heldItem]);
    const schedule = write("schedule.json", [retentionRule]);
    const deletions = write("deletions.json", []);
    expect(main(["disposal", items, schedule, deletions, `--at=${AT}`])).toBe(0);
  });

  it("requires all three files", () => {
    const items = write("items.json", [heldItem]);
    const schedule = write("schedule.json", [retentionRule]);
    expect(() => main(["disposal"])).toThrow(/items-file is required/);
    expect(() => main(["disposal", items, "--at", AT])).toThrow(/schedule-file is required/);
    expect(() => main(["disposal", items, schedule, "--at", AT])).toThrow(/deletions-file is required/);
  });
});

// -----------------------------------------------------------------------
// The real compiled CLI, and the five controls.
//
// Calling the exported `main(argv)` proves the argv-to-exit-code contract but
// NEVER proves the CLI is reachable the only way it actually ships: as
// `node dist/cli.js ...`. That gap is what a `basename(process.argv[1])`
// dispatch hides — it makes every subcommand unreachable through the real
// invocation shape while every direct-call test in the same file passes.
//
// `execFileSync` and real exit codes throughout — never "did not throw",
// because Node's uncaught-exception default also exits 1 and is
// indistinguishable from a real finding.
// -----------------------------------------------------------------------

const packagesDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cliPath = join(packagesDir, "keeper", "dist", "cli.js");

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
  it("node dist/cli.js attribution exits 0 on a fully attributed holding set", () => {
    const items = write("items.json", [heldItem]);
    const events = write("events.json", [sourceEvent]);
    const result = runCli(cliPath, ["attribution", items, events]);
    expect(result.stdout).toContain("Attribution: satisfied.");
    expect(result.status).toBe(0);
  });

  it("node dist/cli.js attribution exits 1 on a belief used as a constraint with no confirmation", () => {
    const items = write("items.json", [constrainingBelief]);
    const events = write("events.json", [sourceEvent]);
    const result = runCli(cliPath, ["attribution", items, events]);
    expect(result.stdout).toContain("[belief-constrains-without-confirmation] item_belief");
    expect(result.status).toBe(1);
  });

  it("node dist/cli.js visibility exits 1 on an item nobody can reach", () => {
    const items = write("items.json", [heldItem]);
    const disclosures = write("disclosures.json", []);
    const result = runCli(cliPath, ["visibility", items, disclosures]);
    expect(result.stdout).toContain("[item-not-disclosed] item_1");
    expect(result.status).toBe(1);
  });

  it("node dist/cli.js disposal exits 1 on records past a well-formed schedule", () => {
    const items = write("items.json", [{ ...heldItem, heldSince: "2025-07-18T12:00:00.000Z" }]);
    const schedule = write("schedule.json", [retentionRule]);
    const deletions = write("deletions.json", []);
    const result = runCli(cliPath, ["disposal", items, schedule, deletions, "--at", AT]);
    expect(result.stdout).toContain("Disposal: violated (items-retained-past-schedule).");
    expect(result.status).toBe(1);
  });

  it("node dist/cli.js disposal exits 2 on a class the schedule never declared", () => {
    const items = write("items.json", [{ ...heldItem, holdingClass: "referrals" }]);
    const schedule = write("schedule.json", [retentionRule]);
    const deletions = write("deletions.json", []);
    const result = runCli(cliPath, ["disposal", items, schedule, deletions, "--at", AT]);
    expect(result.stdout).toContain("Disposal: indeterminate (disposal-unverifiable)");
    expect(result.status).toBe(2);
  });
});

/**
 * The four exit-code cases, measured against this package's compiled CLI and
 * against every other gate package in this repository that ships one.
 *
 * The control roster is PINNED by name below. It is not derived from a
 * directory listing, because a listing that silently came back empty would
 * turn this block into a test that measures nothing and still passes — which
 * is the exact failure the `2` exit code exists to prevent, relocated into a
 * test file. Instead the five names are written down, each one's presence is
 * asserted explicitly, and a name whose package is not in this tree is
 * reported as absent rather than skipped in silence.
 */
const CONTROL_PACKAGES = ["strategist", "writer", "butler", "bouncer", "giver"] as const;

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
    // this checkout is a fact about the checkout; a control block that quietly
    // measured nothing would be a fact about nothing.
    expect(CONTROL_PACKAGES).toEqual(["strategist", "writer", "butler", "bouncer", "giver"]);
    const present = controls.filter((control) => control.present).map((control) => control.name);
    const absent = controls.filter((control) => !control.present).map((control) => control.name);
    expect(present.length + absent.length).toBe(CONTROL_PACKAGES.length);
    expect(present.length).toBeGreaterThan(0);
  });

  it("case 1 — a bare invocation exits 2, with usage on stderr and stdout untouched", () => {
    for (const control of [{ name: "keeper", cliPath, present: true }, ...controls]) {
      if (!control.present) continue;
      const result = runCli(control.cliPath, []);
      expect({ name: control.name, status: result.status }).toEqual({ name: control.name, status: 2 });
      expect({ name: control.name, stdout: result.stdout }).toEqual({ name: control.name, stdout: "" });
      expect(result.stderr.length).toBeGreaterThan(0);
    }
  });

  it("case 2 — an unknown subcommand exits 2", () => {
    for (const control of [{ name: "keeper", cliPath, present: true }, ...controls]) {
      if (!control.present) continue;
      const result = runCli(control.cliPath, ["__no_such_gate__"]);
      expect({ name: control.name, status: result.status }).toEqual({ name: control.name, status: 2 });
    }
  });

  it("case 3 — an explicitly requested --help exits 0, on both spellings", () => {
    for (const control of [{ name: "keeper", cliPath, present: true }, ...controls]) {
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
    for (const control of [{ name: "keeper", cliPath, present: true }, ...controls]) {
      if (!control.present) continue;
      const result = runCli(control.cliPath, [missing]);
      expect({ name: control.name, status: result.status }).toEqual({ name: control.name, status: 2 });
    }
  });

  it("case 4, for this package's own three gates specifically", () => {
    const missing = join(dir, "does-not-exist.json");
    const empty = write("empty.json", []);
    expect(runCli(cliPath, ["attribution", missing, empty]).status).toBe(2);
    expect(runCli(cliPath, ["visibility", missing, empty]).status).toBe(2);
    expect(runCli(cliPath, ["disposal", missing, empty, empty, "--at", AT]).status).toBe(2);
  });
});
