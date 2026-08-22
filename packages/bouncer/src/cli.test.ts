/**
 * The exit-code contract, exercised end to end through `main(argv)` against
 * real temp directories.
 *
 * Every gate gets all three states proven here — `0`, `1`, and `2` — and `2`
 * is proven by more than one genuinely different route per gate: an unreadable
 * record store, a store that parses but does not validate, an empty record
 * set, and — for `authority-reconciliation` — a provider that could not be
 * reached. A gate whose `2` has never been observed is indistinguishable from
 * a gate that cannot reach it.
 *
 * The four dispatch cases at the top are pinned individually because this is
 * where the contract is easiest to get wrong: a bare invocation is `2` with
 * usage on STDERR, an unknown gate is `2`, an explicitly requested `--help` is
 * `0`, and a real gate that cannot read its input is `2`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliInputError, main } from "./cli.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bouncer-cli-"));
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

const liveGrant = {
  grantId: "grant-1",
  actorId: "actor-1",
  subjectId: "subject-1",
  providerId: "provider-a",
  authority: "records.read",
  grantedAt: "2026-08-01T00:00:00.000Z",
  sessionId: "sess-still-valid",
};

const backing = { actorId: "actor-1", subjectId: "subject-1", authority: "records.read", confirmedAt: AT };
const providerBacks = { providerId: "provider-a", reachability: "reachable", observedAt: AT, backs: [{ ...backing, status: "active" }] };
const providerRevoked = { providerId: "provider-a", reachability: "reachable", observedAt: AT, backs: [{ ...backing, status: "revoked" }] };
const providerDown = {
  providerId: "provider-a",
  reachability: "unreachable",
  observedAt: AT,
  unreachableReason: "the provider's identity API did not respond",
};

const boundedActor = {
  agentIdentityId: "agent-1",
  agentKind: "automation",
  displayName: "Example automation",
  toolScope: ["records.read"],
  monetaryLimitAmount: 250,
  monetaryLimitCurrency: "USD",
  responsibleHumanId: "operator-1",
  validFrom: null,
  validTo: null,
  revokedAt: null,
};

const adapterMapping = {
  adapterId: "adapter-a",
  providerId: "provider-a",
  recognisedEvents: ["membership.created"],
  readsFields: [{ path: "data.id", required: true }],
};
const providerShape = {
  providerId: "provider-a",
  declaredAt: AT,
  emittedEvents: ["membership.created"],
  fields: [{ path: "data.id", presence: "always" }],
};

describe("dispatch", () => {
  it("exits 2 with no gate selected — a bare invocation is a run that never happened", () => {
    // The fail-open shape this package exists to repay, guarded in its own
    // CLI: a CI step with a dropped argument, a wrapper that loses `$1`, or a
    // gate renamed out from under its caller all land here, and none of them
    // may report clean on the strength of having checked nothing.
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
    expect(() => main(["auth-check"])).toThrow(CliInputError);
  });

  it("dispatches on argv[0] exactly, so a path argument is never mistaken for a gate name", () => {
    expect(() => main(["Delegation-Ceiling", "a"])).toThrow(CliInputError);
    expect(() => main([join(dir, "delegation-ceiling"), "a"])).toThrow(CliInputError);
  });

  it("prints each gate's own usage and exits 0", () => {
    expect(main(["authority-reconciliation", "--help"])).toBe(0);
    expect(main(["delegation-ceiling", "--help"])).toBe(0);
    expect(main(["provider-contract", "--help"])).toBe(0);
  });
});

describe("authority-reconciliation", () => {
  it("exits 0 when every live grant traces to a provider that still backs it", () => {
    const grants = write("grants.json", [liveGrant]);
    const providers = write("providers.json", [providerBacks]);
    expect(main(["authority-reconciliation", grants, providers, "--at", AT])).toBe(0);
  });

  it("exits 1 for a live grant whose role was revoked upstream, on a session a presence check would pass", () => {
    // The grant carries a valid session id throughout. This is the case in the
    // package's own README: the session exists, and the authority behind it
    // does not.
    const grants = write("grants.json", [liveGrant]);
    const providers = write("providers.json", [providerRevoked]);
    expect(main(["authority-reconciliation", grants, providers, "--at", AT])).toBe(1);
  });

  it("exits 1 for a grant the provider does not back at all, and for one past its own expiry", () => {
    const providers = write("providers.json", [{ ...providerBacks, backs: [] }]);
    expect(main(["authority-reconciliation", write("g1.json", [liveGrant]), providers, "--at", AT])).toBe(1);

    const expired = write("g2.json", [{ ...liveGrant, expiresAt: "2026-08-20T00:00:00.000Z" }]);
    expect(main(["authority-reconciliation", expired, write("p2.json", [providerBacks]), "--at", AT])).toBe(1);
  });

  it("exits 2 — never 0 — when the provider could not be reached", () => {
    const grants = write("grants.json", [liveGrant]);
    const providers = write("providers.json", [providerDown]);
    expect(main(["authority-reconciliation", grants, providers, "--at", AT])).toBe(2);
  });

  it("exits 2 when a grant names a provider nothing observed", () => {
    const grants = write("grants.json", [{ ...liveGrant, providerId: "provider-z" }]);
    const providers = write("providers.json", [providerBacks]);
    expect(main(["authority-reconciliation", grants, providers, "--at", AT])).toBe(2);
  });

  it("exits 2 when the record store cannot be read, and when it is a directory rather than a file", () => {
    const providers = write("providers.json", [providerBacks]);
    expect(main(["authority-reconciliation", join(dir, "missing.json"), providers, "--at", AT])).toBe(2);

    const asDirectory = join(dir, "grants-dir");
    mkdirSync(asDirectory);
    expect(main(["authority-reconciliation", asDirectory, providers, "--at", AT])).toBe(2);
  });

  it("exits 2 on unparseable JSON and on JSON that does not validate", () => {
    const providers = write("providers.json", [providerBacks]);
    expect(main(["authority-reconciliation", write("broken.json", "{ not json"), providers, "--at", AT])).toBe(2);
    const invalid = write("invalid.json", [{ ...liveGrant, grantedAt: "recently" }]);
    expect(main(["authority-reconciliation", invalid, providers, "--at", AT])).toBe(2);
  });

  it("exits 2 when there is nothing to reconcile, rather than reporting a pass for a run that checked nothing", () => {
    expect(main(["authority-reconciliation", write("g.json", []), write("p.json", [providerBacks]), "--at", AT])).toBe(2);
    expect(main(["authority-reconciliation", write("g2.json", [liveGrant]), write("p2.json", []), "--at", AT])).toBe(2);
  });

  it("refuses to run without a stated instant, and refuses to read the clock itself", () => {
    const grants = write("grants.json", [liveGrant]);
    const providers = write("providers.json", [providerBacks]);
    expect(() => main(["authority-reconciliation", grants, providers])).toThrow(/--at is required/);
    expect(() => main(["authority-reconciliation", grants, providers, "--at", "whenever"])).toThrow(CliInputError);
  });

  it("accepts --at=value as well as --at value, and refuses an unknown flag outright", () => {
    const grants = write("grants.json", [liveGrant]);
    const providers = write("providers.json", [providerBacks]);
    expect(main(["authority-reconciliation", grants, providers, `--at=${AT}`])).toBe(0);
    expect(() => main(["authority-reconciliation", grants, providers, "--now", AT])).toThrow(CliInputError);
  });

  it("refuses a missing positional and an unexpected extra one", () => {
    const grants = write("grants.json", [liveGrant]);
    expect(() => main(["authority-reconciliation", grants, "--at", AT])).toThrow(/provider-assertions-file is required/);
    const providers = write("providers.json", [providerBacks]);
    expect(() => main(["authority-reconciliation", grants, providers, "extra", "--at", AT])).toThrow(/unexpected extra argument/);
  });
});

describe("delegation-ceiling", () => {
  it("exits 0 for a bounded, attributable machine actor", () => {
    expect(main(["delegation-ceiling", write("actors.json", [boundedActor])])).toBe(0);
  });

  it("exits 1 for an actor with no declared ceiling — never 0 on an unlimited default", () => {
    const { monetaryLimitAmount: _amount, monetaryLimitCurrency: _currency, ...undecided } = boundedActor;
    expect(main(["delegation-ceiling", write("actors.json", [undecided])])).toBe(1);
  });

  it("exits 1 for an undeclared unlimited ceiling and 0 once it is declared deliberate", () => {
    const nulled = { ...boundedActor, monetaryLimitAmount: null, monetaryLimitCurrency: null };
    expect(main(["delegation-ceiling", write("a1.json", [nulled])])).toBe(1);
    expect(main(["delegation-ceiling", write("a2.json", [{ ...nulled, unlimitedSpendIsDeclared: true }])])).toBe(0);
  });

  it("exits 1 for an actor nobody answers for, and for one whose bounds were never stated", () => {
    // Under-declared, not malformed: an actor with no responsible human
    // validates cleanly and is REPORTED, rather than dying as a parse error
    // that could only say the file was bad. See `DelegatedActor` in schema.ts.
    const { responsibleHumanId: _responsible, ...unattributable } = boundedActor;
    expect(main(["delegation-ceiling", write("a1.json", [unattributable])])).toBe(1);
    const { toolScope: _scope, ...unscoped } = boundedActor;
    expect(main(["delegation-ceiling", write("a2.json", [unscoped])])).toBe(1);
  });

  it("exits 2 when the record store cannot be read, or does not validate", () => {
    expect(main(["delegation-ceiling", join(dir, "missing.json")])).toBe(2);
    expect(main(["delegation-ceiling", write("broken.json", "{ not json")])).toBe(2);
    expect(main(["delegation-ceiling", write("invalid.json", [{ ...boundedActor, monetaryLimitAmount: "unlimited" }])])).toBe(2);
  });

  it("exits 2 when there are no actors at all", () => {
    expect(main(["delegation-ceiling", write("actors.json", [])])).toBe(2);
  });

  it("refuses a missing positional and an unexpected extra one", () => {
    expect(() => main(["delegation-ceiling"])).toThrow(/delegated-actors-file is required/);
    expect(() => main(["delegation-ceiling", write("a.json", [boundedActor]), "extra"])).toThrow(/unexpected extra argument/);
  });
});

describe("provider-contract", () => {
  it("exits 0 when the mapping still matches the provider's declared shape", () => {
    const mappings = write("mappings.json", [adapterMapping]);
    const shapes = write("shapes.json", [providerShape]);
    expect(main(["provider-contract", mappings, shapes])).toBe(0);
  });

  it("exits 1 when the adapter reads a field the provider no longer declares", () => {
    const mappings = write("mappings.json", [{ ...adapterMapping, readsFields: [{ path: "data.legacy_id", required: true }] }]);
    const shapes = write("shapes.json", [providerShape]);
    expect(main(["provider-contract", mappings, shapes])).toBe(1);
  });

  it("exits 1 when the provider emits an event the adapter drops in silence", () => {
    const mappings = write("mappings.json", [adapterMapping]);
    const shapes = write("shapes.json", [{ ...providerShape, emittedEvents: ["membership.created", "membership.deleted"] }]);
    expect(main(["provider-contract", mappings, shapes])).toBe(1);
  });

  it("exits 2 for a mapping whose provider shape was never supplied", () => {
    const mappings = write("mappings.json", [adapterMapping, { ...adapterMapping, adapterId: "adapter-b", providerId: "provider-z" }]);
    const shapes = write("shapes.json", [providerShape]);
    expect(main(["provider-contract", mappings, shapes])).toBe(2);
  });

  it("exits 2 when either store cannot be read, or does not validate", () => {
    const shapes = write("shapes.json", [providerShape]);
    expect(main(["provider-contract", join(dir, "missing.json"), shapes])).toBe(2);
    expect(main(["provider-contract", write("broken.json", "{ not json"), shapes])).toBe(2);
    const invalid = write("invalid.json", [{ ...adapterMapping, readsFields: [{ path: "data.id" }] }]);
    expect(main(["provider-contract", invalid, shapes])).toBe(2);
  });

  it("exits 2 when either side is empty", () => {
    expect(main(["provider-contract", write("m.json", []), write("s.json", [providerShape])])).toBe(2);
    expect(main(["provider-contract", write("m2.json", [adapterMapping]), write("s2.json", [])])).toBe(2);
  });

  it("refuses a missing positional and an unexpected extra one", () => {
    const mappings = write("mappings.json", [adapterMapping]);
    expect(() => main(["provider-contract", mappings])).toThrow(/provider-shapes-file is required/);
    const shapes = write("shapes.json", [providerShape]);
    expect(() => main(["provider-contract", mappings, shapes, "extra"])).toThrow(/unexpected extra argument/);
  });
});
