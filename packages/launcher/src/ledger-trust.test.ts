import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// A build-time tool from this repository, not shipped code; an untyped .mjs
// file that vitest transpiles without typechecking.
import { checkImportPurity } from "../../../scripts/lib/import-purity.mjs";
import { compareTuples, validateRepositoryChangeSet } from "./change-set-contract.js";
import type { RepositoryChangeSet } from "./change-set-contract.js";
import { changeSetDigest } from "./change-set-digest.js";
import { PACKAGE_SCOPE } from "./generated/package-scope.generated.js";
import { serializeInstalledLedger } from "./ledger-contract.js";
import type { InstalledLedger } from "./ledger-contract.js";
import { reconcileWholeFile, trustInstalledLedger } from "./ledger-trust.js";
import type { LedgerTrust, WholeFileState } from "./ledger-trust.js";

/*
 * Issue #1178. Whether the apply planner trusts a repository's installed
 * ledger (RFC §12.2), and the whole-file compare-and-swap table (§12.1),
 * checked against the shared corpora installed-ledger.fixture.json and
 * apply-change-set-digest.fixture.json. Reading repository files here is
 * test-only.
 */
const REPO = new URL("../../../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, REPO), "utf8");
type Loose = Record<string, any>;
const clone = <T>(value: T): T => structuredClone(value);

const LEDGERS = (JSON.parse(read("docs/contracts/installed-ledger.fixture.json")) as { ledgers: { name: string; ledger: InstalledLedger }[] }).ledgers;
const SETS = (JSON.parse(read("docs/contracts/apply-change-set-digest.fixture.json")) as { changeSets: { name: string; changeSet: RepositoryChangeSet }[] }).changeSets;
const ledgerNamed = (name: string): InstalledLedger => clone(LEDGERS.find((entry) => entry.name === name)!.ledger);
const setNamed = (name: string): RepositoryChangeSet => clone(SETS.find((entry) => entry.name === name)!.changeSet);

const SETUP = setNamed("setup-site");
const APPLY = setNamed("apply-after-setup");
const ROOTS = setNamed("setup-site-root-entries");
const OBSERVED = { id: "example-owner/site", nodeId: "R_exampleSite1" };
const TRUSTED: LedgerTrust = { state: "trusted", ledger: expect.anything() as unknown as InstalledLedger };
const refused = (rule: string) => ({ state: "refused", rule });

/** A ledger's exact bytes; throws for a ledger the contract refuses, so every forged ledger below is still readable. */
const bytes = (ledger: InstalledLedger | Loose) => serializeInstalledLedger(ledger as InstalledLedger);
const trust = (ledger: InstalledLedger | Loose, held: readonly RepositoryChangeSet[], observed = OBSERVED) => trustInstalledLedger(bytes(ledger), observed, held);
const OTHER = `sha256:${"0".repeat(64)}`;
const short = (digest: string) => digest.slice("sha256:".length, "sha256:".length + 12);

/** The set with its digest, branch and title recomputed, so it stays valid and self-verifying after an edit inside the digest. */
function rehash(set: Loose): RepositoryChangeSet {
  const old = short(set.changeSetDigest);
  const digest = changeSetDigest(set);
  set.changeSetDigest = digest;
  set.branch = `clossys/apply-${short(digest)}`;
  set.pullRequest = { ...set.pullRequest, title: String(set.pullRequest.title).replace(old, short(digest)) };
  expect(validateRepositoryChangeSet(set)).toEqual({ valid: true });
  return set as RepositoryChangeSet;
}

/** The ledger with every citation of one change set moved to another. */
const retarget = (ledger: InstalledLedger, from: string, to: string): Loose => JSON.parse(JSON.stringify(ledger).split(from).join(to)) as Loose;

describe("trustInstalledLedger", () => {
  it("trusts an absent ledger at generation 0", () => {
    expect(trustInstalledLedger(null, OBSERVED, [])).toEqual({ state: "trusted", ledger: null });
  });

  it("trusts the corpus setup-generation-1 ledger with the setup-site set held", () => {
    const ledger = ledgerNamed("setup-generation-1");
    expect(trust(ledger, [SETUP])).toEqual({ state: "trusted", ledger });
  });

  it("trusts a second generation whose kept rows still cite the setup set", () => {
    expect(trust(ledgerNamed("admitted-generation-2"), [SETUP, APPLY])).toEqual(TRUSTED);
    expect(trust(ledgerNamed("approved-generation-2"), [APPLY, SETUP])).toEqual(TRUSTED);
    expect(trust(ledgerNamed("admitted-generation-2"), [SETUP])).toEqual(refused("ledger-chain"));
  });

  it("trusts root-entry rows the held set declared", () => {
    expect(trust(ledgerNamed("setup-with-root-entries"), [ROOTS])).toEqual(TRUSTED);
  });

  it("trusts a release-age entry row the held set's exemption wrote", () => {
    const set = setNamed("kind-exemption-unchanged") as Loose;
    set.items.find((item: Loose) => item.act === "exempt-release-age").scope = PACKAGE_SCOPE.scope;
    const surface = set.files.find((file: Loose) => file.path === "pnpm-workspace.yaml");
    surface.before = null;
    const held = rehash(set);
    const ledger = retarget(ledgerNamed("setup-generation-1"), SETUP.changeSetDigest, held.changeSetDigest);
    ledger.files = [...ledger.files, { path: "pnpm-workspace.yaml", mode: "100644", after: surface.after, changeSet: held.changeSetDigest }].sort((a: Loose, b: Loose) =>
      compareTuples([a.path], [b.path]),
    );
    ledger.entries = [{ file: "pnpm-workspace.yaml", key: "minimumReleaseAgeExclude", value: `${PACKAGE_SCOPE.scope}/*`, changeSet: held.changeSetDigest }];
    expect(trust(ledger, [held])).toEqual(TRUSTED);
    ledger.entries[0].value = `${PACKAGE_SCOPE.scope}x/*`;
    expect(trust(ledger, [held])).toEqual(refused("ledger-foreign-row"));
  });

  describe("ledger-unreadable", () => {
    const text = bytes(ledgerNamed("setup-generation-1"));
    it.each([
      ["not JSON", "{"],
      ["schema-invalid", bytes(ledgerNamed("setup-generation-1")).replace('"generation": 1,', '"generation": "1",')],
      ["a repeated key", text.replace('  "kind": "clossys.installed-ledger",\n', '  "kind": "clossys.installed-ledger",\n  "kind": "clossys.installed-ledger",\n')],
      ["non-canonical spacing", `${JSON.stringify(ledgerNamed("setup-generation-1"))}\n`],
      ["a code-rule refusal", `${JSON.stringify(ledgerNamed("generation-not-history-length"), null, 2)}\n`],
    ])("%s", (_name, value) => {
      expect(value).not.toBe(text);
      expect(trustInstalledLedger(value, OBSERVED, [SETUP])).toEqual(refused("ledger-unreadable"));
    });
  });

  it("refuses another node id as identity, before anything else", () => {
    expect(trust(ledgerNamed("setup-generation-1"), [SETUP], { ...OBSERVED, nodeId: "R_other" })).toEqual(refused("identity"));
    expect(trust(ledgerNamed("setup-generation-1"), [], { id: "example-owner/other", nodeId: "R_other" })).toEqual(refused("identity"));
  });

  it("refuses another id as renamed, but trusts an id that differs only in letter case", () => {
    expect(trust(ledgerNamed("setup-generation-1"), [SETUP], { ...OBSERVED, id: "example-owner/other" })).toEqual(refused("renamed"));
    expect(trust(ledgerNamed("setup-generation-1"), [SETUP], { ...OBSERVED, id: "Example-Owner/Site" })).toEqual(TRUSTED);
  });

  describe("ledger-chain", () => {
    const ledger = ledgerNamed("setup-generation-1");

    it("when a history set is not held", () => {
      expect(trust(ledger, [])).toEqual(refused("ledger-chain"));
      expect(trust(ledger, [APPLY, ROOTS])).toEqual(refused("ledger-chain"));
    });

    it("when the held set no longer recomputes to its digest", () => {
      const tampered = clone(SETUP) as Loose;
      tampered.producer.version = "9.9.9";
      expect(trust(ledger, [tampered as RepositoryChangeSet])).toEqual(refused("ledger-chain"));
    });

    it("when the held set is refused by its contract", () => {
      const invalid = clone(SETUP) as Loose;
      invalid.branch = "clossys/other";
      expect(changeSetDigest(invalid)).toBe(SETUP.changeSetDigest);
      expect(trust(ledger, [invalid as RepositoryChangeSet])).toEqual(refused("ledger-chain"));
    });

    it.each([
      ["phase", (entry: Loose, forged: Loose) => {
        entry.phase = "apply";
        forged.deferred = [];
      }],
      ["planDigest", (entry: Loose) => (entry.planDigest = OTHER)],
      ["bundle", (entry: Loose) => (entry.bundle = OTHER)],
      ["baseCommit", (entry: Loose) => (entry.baseCommit = "0".repeat(40))],
    ] as const)("when the history entry's %s is not the held set's", (_name, edit) => {
      const forged = clone(ledger) as Loose;
      edit(forged.history[0], forged);
      expect(trust(forged, [SETUP])).toEqual(refused("ledger-chain"));
    });

    it("picks, among held sets sharing a digest, the one whose bundle matches", () => {
      const otherRun = { ...clone(SETUP), bundle: OTHER };
      expect(trust(ledger, [otherRun])).toEqual(refused("ledger-chain"));
      expect(trust(ledger, [otherRun, SETUP])).toEqual(TRUSTED);
    });

    it("when the held set is for another node id", () => {
      const moved = clone(SETUP) as Loose;
      moved.repository.nodeId = "R_other";
      const held = rehash(moved);
      expect(trust(retarget(ledger, SETUP.changeSetDigest, held.changeSetDigest), [held])).toEqual(refused("ledger-chain"));
    });

    it("when the held set was computed over another generation", () => {
      const control = rehash(clone(SETUP) as Loose);
      expect(control.changeSetDigest).toBe(SETUP.changeSetDigest);
      const later = clone(SETUP) as Loose;
      later.ledger.generation = 1;
      later.files.find((file: Loose) => file.derived === true && file.path === "clossys/.state/installed.json").invariants = [{ ledgerGeneration: 2 }];
      const held = rehash(later);
      expect(trust(retarget(ledger, SETUP.changeSetDigest, held.changeSetDigest), [held])).toEqual(refused("ledger-chain"));
    });
  });

  describe("ledger-foreign-row", () => {
    const base = () => ledgerNamed("setup-generation-1") as Loose;
    const second = () => ledgerNamed("admitted-generation-2") as Loose;
    const setup = SETUP.changeSetDigest;
    const sortFiles = (ledger: Loose) => ledger.files.sort((a: Loose, b: Loose) => compareTuples([a.path], [b.path]));

    it("a files row whose after the set never wrote", () => {
      const forged = base();
      forged.files.find((row: Loose) => row.path === "clossys/brief.json").after = OTHER;
      expect(trust(forged, [SETUP])).toEqual(refused("ledger-foreign-row"));
    });

    it("a files row at an owned path the set never wrote", () => {
      const forged = base();
      forged.files.push({ path: "AGENTS.md", mode: "100644", after: OTHER, changeSet: setup });
      sortFiles(forged);
      expect(trust(forged, [SETUP])).toEqual(refused("ledger-foreign-row"));
    });

    it("a files row citing a set that wrote a different file", () => {
      const forged = ledgerNamed("release-age-entry");
      expect(trust(forged, [SETUP])).toEqual(refused("ledger-foreign-row"));
    });

    it("a keys row citing a set that has no such key", () => {
      const forged = second();
      forged.keys.find((row: Loose) => row.pointer === "/devDependencies/@example~1writer").changeSet = setup;
      expect(trust(forged, [SETUP, APPLY])).toEqual(refused("ledger-foreign-row"));
    });

    it("a packages row citing a set that has no such act", () => {
      const forged = second();
      forged.packages.find((row: Loose) => row.name === "@example/writer").changeSet = setup;
      expect(trust(forged, [SETUP, APPLY])).toEqual(refused("ledger-foreign-row"));
    });

    it("a packages row whose identity the set's act does not have", () => {
      const forged = base();
      forged.packages[0].integrity = `sha512-${"A".repeat(86)}==`;
      expect(trust(forged, [SETUP])).toEqual(refused("ledger-foreign-row"));
    });

    it("an entries row for a release-age exemption the set never made", () => {
      const forged = base();
      forged.entries = [{ file: "pnpm-workspace.yaml", key: "minimumReleaseAgeExclude", value: "@example/*", changeSet: setup }];
      expect(trust(forged, [SETUP])).toEqual(refused("ledger-foreign-row"));
    });

    it("an entries row for a root entry the set never declared", () => {
      const forged = base();
      forged.entries = [{ file: "governance/repository-profile.json", key: "rootEntries", value: ".github", changeSet: setup }];
      expect(trust(forged, [SETUP])).toEqual(refused("ledger-foreign-row"));
      const extra = ledgerNamed("setup-with-root-entries") as Loose;
      extra.entries = extra.entries.filter((row: Loose) => row.value !== ".github");
      expect(trust(extra, [ROOTS])).toEqual(TRUSTED);
      for (const row of extra.entries) row.file = "other/repository-profile.json";
      expect(trust(extra, [ROOTS])).toEqual(refused("ledger-foreign-row"));
    });

    it("a deferred row the set never deferred", () => {
      const forged = base();
      const row = forged.deferred[1];
      row.name = "@example/zeta";
      row.planItem = "example-owner/site:@example/zeta";
      expect(trust(forged, [SETUP])).toEqual(refused("ledger-foreign-row"));
    });
  });

  it("is pure: imports no builtin but node:crypto and no package, across its whole import graph", () => {
    const root = fileURLToPath(REPO);
    const result = checkImportPurity({ entries: ["packages/launcher/src/ledger-trust.ts"], allowedBuiltins: ["node:crypto"], root }) as { findings: unknown[] };
    expect(result.findings).toEqual([]);
  });
});

describe("reconcileWholeFile", () => {
  const H = `sha256:${"1".repeat(64)}`;
  const D = `sha256:${"2".repeat(64)}`;
  const X = `sha256:${"3".repeat(64)}`;
  const state = (over: Partial<WholeFileState>): WholeFileState => ({
    path: "clossys/brief.json",
    desired: D,
    row: null,
    base: null,
    occupied: false,
    phase: "setup",
    skillsManifest: null,
    ...over,
  });

  it("adds a file where the ledger has nothing and nothing is there", () => {
    expect(reconcileWholeFile(state({}))).toEqual({ write: true, before: null });
    expect(reconcileWholeFile(state({ phase: "apply" }))).toEqual({ write: true, before: null });
  });

  it("refuses to take a file or directory it did not write as unowned-existing", () => {
    expect(reconcileWholeFile(state({ base: X, occupied: true }))).toEqual({ write: false, reason: "unowned-existing" });
    expect(reconcileWholeFile(state({ base: null, occupied: true }))).toEqual({ write: false, reason: "unowned-existing" });
    expect(reconcileWholeFile(state({ base: D, occupied: true, phase: "apply" }))).toEqual({ write: false, reason: "unowned-existing" });
  });

  it("keeps or updates a file whose bytes are still the ledger's", () => {
    expect(reconcileWholeFile(state({ row: D, base: D, occupied: true }))).toEqual({ write: true, before: D });
    expect(reconcileWholeFile(state({ row: H, base: H, occupied: true }))).toEqual({ write: true, before: H });
    expect(reconcileWholeFile(state({ row: H, base: H, occupied: true, phase: "apply" }))).toEqual({ write: true, before: H });
  });

  it("reports an owned file that is gone as deleted, never as an add", () => {
    expect(reconcileWholeFile(state({ row: H }))).toEqual({ write: false, reason: "deleted" });
    expect(reconcileWholeFile(state({ row: D, phase: "apply" }))).toEqual({ write: false, reason: "deleted" });
  });

  it("refuses an owned file the client edited", () => {
    expect(reconcileWholeFile(state({ row: H, base: X, occupied: true }))).toEqual({ write: false, reason: "client-edited" });
    expect(reconcileWholeFile(state({ row: H, base: D, occupied: true }))).toEqual({ write: false, reason: "client-edited" });
    expect(reconcileWholeFile(state({ row: H, base: null, occupied: true }))).toEqual({ write: false, reason: "client-edited" });
  });

  describe("the generation-0 adoption pass", () => {
    const skill = ".agents/skills/clossys-writer/SKILL.md";
    const manifest = [{ name: "writer", sha256: "3".repeat(64) }];

    it("(a) adopts a file already holding the desired bytes, in setup only", () => {
      expect(reconcileWholeFile(state({ base: D, occupied: true }))).toEqual({ write: true, before: D });
      expect(reconcileWholeFile(state({ base: D, occupied: true, phase: "apply" }))).toEqual({ write: false, reason: "unowned-existing" });
    });

    it("(b) adopts a composed skill whose bytes the skills manifest records, in setup only", () => {
      expect(reconcileWholeFile(state({ path: skill, base: X, occupied: true, skillsManifest: manifest }))).toEqual({ write: true, before: X });
      expect(reconcileWholeFile(state({ path: ".Agents/Skills/Clossys-Writer/skill.md", base: X, occupied: true, skillsManifest: manifest }))).toEqual({
        write: true,
        before: X,
      });
      expect(reconcileWholeFile(state({ path: skill, base: X, occupied: true, skillsManifest: manifest, phase: "apply" }))).toEqual({ write: false, reason: "unowned-existing" });
      expect(reconcileWholeFile(state({ path: skill, base: H, occupied: true, skillsManifest: manifest }))).toEqual({ write: false, reason: "unowned-existing" });
      expect(reconcileWholeFile(state({ path: ".agents/skills/clossys-strategist/SKILL.md", base: X, occupied: true, skillsManifest: manifest }))).toEqual({
        write: false,
        reason: "unowned-existing",
      });
      expect(reconcileWholeFile(state({ path: skill, base: X, occupied: true, skillsManifest: null }))).toEqual({ write: false, reason: "unowned-existing" });
      expect(reconcileWholeFile(state({ path: "clossys/brief.json", base: X, occupied: true, skillsManifest: manifest }))).toEqual({ write: false, reason: "unowned-existing" });
    });

    it("(c) adopts a readable skills manifest, in setup only", () => {
      const path = "clossys/.state/skills.json";
      expect(reconcileWholeFile(state({ path, base: X, occupied: true, skillsManifest: [] }))).toEqual({ write: true, before: X });
      expect(reconcileWholeFile(state({ path: path.toUpperCase(), base: X, occupied: true, skillsManifest: [] }))).toEqual({ write: true, before: X });
      expect(reconcileWholeFile(state({ path, base: X, occupied: true, skillsManifest: null }))).toEqual({ write: false, reason: "unowned-existing" });
      expect(reconcileWholeFile(state({ path, base: X, occupied: true, skillsManifest: [], phase: "apply" }))).toEqual({ write: false, reason: "unowned-existing" });
    });

    it("never adopts a directory, where there is no file to adopt", () => {
      expect(reconcileWholeFile(state({ path: "clossys/.state/skills.json", base: null, occupied: true, skillsManifest: [] }))).toEqual({ write: false, reason: "unowned-existing" });
    });
  });
});
