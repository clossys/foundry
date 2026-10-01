import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PLAN_CONTRACTS } from "./generated/plan-contracts.generated.js";
import type { ApprovalBinding, RepositoryChangeSet } from "./change-set-contract.js";
import { LEDGER_MEMBER_ORDER, installedLedgerViolations, ledgerSuccession, readInstalledLedger, serializeInstalledLedger, validateInstalledLedger } from "./ledger-contract.js";
import { trustInstalledLedger } from "./ledger-trust.js";
import type { InstalledLedger } from "./ledger-contract.js";

/*
 * Issue #1178. The installed-state ledger contract, packed into this
 * package: its code rules L1-L10, its byte serialization and its SUCCESSION
 * rules, checked against the shared corpus
 * docs/contracts/installed-ledger.fixture.json, whose valid ledgers were
 * rendered and hashed independently of this package. Reading repository files
 * here is test-only.
 */
const REPO = new URL("../../../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, REPO), "utf8");
const sha = (text: string) => `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;

interface Corpus {
  ledgers: { name: string; note: string; valid: boolean; rules?: string[]; ledger: InstalledLedger; sha256?: string }[];
  renders: {
    name: string;
    previous: string | null;
    changeSet: string;
    binding: ApprovalBinding;
    planPackages: { planItem: string; act: string; name: string; version: string; integrity: string; placement: string }[];
    ledger: string;
  }[];
  successions: { name: string; base: string | null; head: string; change: "none" | "next-generation"; admission: "admitted" | "approval-claimed" | null; rules: string[] }[];
}
const CORPUS = JSON.parse(read("docs/contracts/installed-ledger.fixture.json")) as Corpus;
const SETS = (JSON.parse(read("docs/contracts/apply-change-set-digest.fixture.json")) as { changeSets: { name: string; changeSet: RepositoryChangeSet }[] }).changeSets;
const ledger = (name: string) => CORPUS.ledgers.find((entry) => entry.name === name)!.ledger;
/** A ledger's text as a pull request would carry it: the corpus stores members in the contract's order, so this is its RENDER bytes when it is valid. */
const text = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
/** UTF-8 bytes of `value`, as every reader in this module now takes them. */
const toBytes = (value: string) => Buffer.from(value, "utf8");
const bytesOf = (name: string) => toBytes(text(ledger(name)));
const setNamed = (name: string) => SETS.find((entry) => entry.name === name)!.changeSet;
const ruleIds = (value: unknown) => [...new Set(installedLedgerViolations(value).map((violation) => violation.rule))].sort();
type Loose = Record<string, any>;
const loose = (value: unknown): Loose => structuredClone(value) as Loose;

type Definitions = Record<string, Loose>;
const LEDGER = PLAN_CONTRACTS["installed-ledger.json"]! as Loose;
const DEFINITIONS = LEDGER.definitions as Definitions;
const PLAN_DEFINITIONS = (PLAN_CONTRACTS["advisor-plan.json"]! as Loose).definitions as Definitions;
const SET_CONTRACT = PLAN_CONTRACTS["repository-change-set.json"]! as Loose;
const withoutDescription = ({ description: _description, ...rest }: Loose) => rest;

describe("installed-ledger contract", () => {
  it("keeps every definition it copies equal to its source, so it can be packed alone", () => {
    for (const name of ["sha256Digest", "sha512Integrity", "exactVersion", "packageName", "repositoryId", "nonBlankString"]) expect(DEFINITIONS[name], name).toEqual(PLAN_DEFINITIONS[name]);
    const setDefinitions = SET_CONTRACT.definitions as Definitions;
    expect(DEFINITIONS.safePath).toEqual(setDefinitions.safePath);
    expect(DEFINITIONS.nodeId).toEqual(withoutDescription(setDefinitions.repository!.properties.nodeId));
    expect(DEFINITIONS.commit).toEqual(withoutDescription(setDefinitions.repository!.properties.baseCommit));
    expect(DEFINITIONS.keyRow!.properties.pointer).toEqual(setDefinitions.key!.properties.pointer);
    expect(DEFINITIONS.ownedPattern!.enum).toEqual(setDefinitions.ownedPattern!.allOf[1].enum);
    expect(DEFINITIONS.placement!.enum).toEqual(setDefinitions.packageItem!.properties.placement.enum);
    expect(DEFINITIONS.rootEntryName).toEqual(setDefinitions.rootEntryName);
    expect(DEFINITIONS.profileName).toEqual(setDefinitions.profileName);
    expect(JSON.stringify(LEDGER)).not.toContain("advisor-plan.json#");
    expect(JSON.stringify(LEDGER)).not.toContain("repository-change-set.json#");
  });

  it("declares every object's members in the order the serializer writes them", () => {
    const keys = (node: Loose) => Object.keys(node.properties);
    expect(LEDGER_MEMBER_ORDER.ledger).toEqual(keys(LEDGER));
    expect(LEDGER_MEMBER_ORDER.repository).toEqual(keys(LEDGER.properties.repository));
    expect(LEDGER_MEMBER_ORDER.history).toEqual(keys(DEFINITIONS.historyEntry!));
    expect(LEDGER_MEMBER_ORDER.approvedBinding).toEqual(keys(DEFINITIONS.approvedBinding!));
    expect(LEDGER_MEMBER_ORDER.admittedBinding).toEqual(keys(DEFINITIONS.admittedBinding!));
    expect(LEDGER_MEMBER_ORDER.file).toEqual(keys(DEFINITIONS.fileRow!));
    expect(LEDGER_MEMBER_ORDER.key).toEqual(keys(DEFINITIONS.keyRow!));
    for (const branch of DEFINITIONS.entryRow!.oneOf) expect(LEDGER_MEMBER_ORDER.entry).toEqual(keys(branch));
    expect(LEDGER_MEMBER_ORDER.package).toEqual(keys(DEFINITIONS.packageRow!));
    expect(LEDGER_MEMBER_ORDER.deferred).toEqual(keys(DEFINITIONS.deferredRow!));
  });

  it("agrees with the corpus on every ledger: valid ones pass, and each refused one breaks exactly the rules it names", () => {
    for (const entry of CORPUS.ledgers) {
      if (entry.valid) expect(installedLedgerViolations(entry.ledger), entry.name).toEqual([]);
      else expect(ruleIds(entry.ledger), entry.name).toEqual([...entry.rules!].sort());
    }
    const covered = new Set(CORPUS.ledgers.flatMap((entry) => entry.rules ?? []));
    for (const rule of ["schema", "L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8", "L9", "L10"]) expect(covered.has(rule), rule).toBe(true);
  });

  it("names positions, never values, in a refusal", () => {
    const forged = loose(ledger("setup-generation-1"));
    forged.files[0].changeSet = sha("a-secret-value");
    forged.repository.id = "a secret value";
    const validation = validateInstalledLedger(forged);
    expect(validation.valid).toBe(false);
    if (!validation.valid) expect(validation.reason).not.toMatch(/secret/);
  });

  it("is well formed, not trusted: a row naming a change set in its own history passes, whatever the hub holds", () => {
    // Trust needs the hub's change sets (TRUST in the contract); validation cannot see them.
    const claimed = loose(ledger("setup-generation-1"));
    claimed.files[0].after = sha("bytes no change set wrote");
    expect(validateInstalledLedger(claimed)).toEqual({ valid: true });
  });
});

describe("ledger bytes (RENDER)", () => {
  it("are the corpus's independently computed bytes for every valid ledger, whatever order its members were given in", () => {
    for (const entry of CORPUS.ledgers.filter((candidate) => candidate.valid)) {
      const bytes = serializeInstalledLedger(entry.ledger);
      expect(sha(bytes), entry.name).toBe(entry.sha256);
      expect(bytes.endsWith("}\n") && !bytes.endsWith("\n\n"), entry.name).toBe(true);
      const reversed = JSON.parse(JSON.stringify(entry.ledger), (_key, value) =>
        value !== null && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).reverse()) : value,
      ) as InstalledLedger;
      expect(Object.keys(reversed)[0]).toBe("deferred");
      expect(serializeInstalledLedger(reversed), entry.name).toBe(bytes);
    }
  });

  it("are never given to a refused ledger", () => {
    expect(() => serializeInstalledLedger(ledger("admitted-other-plan"))).toThrow(/refused ledger has no bytes/);
  });

  it("hold what each corpus render names: the set's generation, digest, phase, plan, bundle, base and binding, and the plan's identity for each deferral", () => {
    for (const render of CORPUS.renders) {
      const set = setNamed(render.changeSet);
      const previous = render.previous === null ? null : ledger(render.previous);
      const next = ledger(render.ledger);
      expect(validateInstalledLedger(next), render.name).toEqual({ valid: true });
      expect(set.ledger.generation, render.name).toBe(previous?.generation ?? 0);
      expect(next.history.at(-1), render.name).toEqual({
        generation: set.ledger.generation + 1,
        changeSet: set.changeSetDigest,
        phase: set.phase,
        planDigest: set.planDigest,
        bundle: set.bundle,
        baseCommit: set.repository.baseCommit,
        binding: render.binding,
      });
      expect(next.repository).toEqual({ id: set.repository.id, nodeId: set.repository.nodeId });
      expect(next.deferred.map((row) => row.planItem)).toEqual(set.deferred.map((deferral) => deferral.planItem));
      for (const row of next.deferred) {
        const { planItem: _planItem, ...identity } = render.planPackages.find((entry) => entry.planItem === row.planItem)!;
        expect(row).toMatchObject(identity);
      }
      expect(ledgerSuccession(previous === null ? null : toBytes(serializeInstalledLedger(previous)), toBytes(serializeInstalledLedger(next))), render.name).toEqual({
        change: "next-generation",
        admission: render.binding.kind === "admitted" ? "admitted" : "approval-claimed",
        violations: [],
      });
    }
  });

  it("record one entries row per root entry a set declares, in the profile it edits", () => {
    const set = setNamed("setup-site-root-entries");
    const item = set.items.find((entry) => entry.act === "declare-root-entry")!;
    expect(item.act === "declare-root-entry" ? item.entries.map((entry) => entry.name) : []).toEqual([".agents", ".claude", ".cursor", ".github", ".starter", "clossys"]);
    expect(ledger("setup-with-root-entries").entries).toEqual(
      [".agents", ".claude", ".cursor", ".github", ".starter", "clossys"].map((value) => ({ file: "governance/repository-profile.json", key: "rootEntries", value, changeSet: set.changeSetDigest })),
    );
  });

  it("record no row for the ledger or the lockfile, and every whole file the set writes at its after", () => {
    const set = setNamed("setup-site");
    const rows = ledger("setup-generation-1").files;
    expect(rows.map((row) => row.path)).not.toContain("clossys/.state/installed.json");
    expect(rows.map((row) => row.path)).not.toContain("package-lock.json");
    const whole = set.files.filter((file) => !("derived" in file));
    expect(rows.map((row) => [row.path, row.mode, row.after])).toEqual(whole.map((file) => [file.path, file.mode, "after" in file ? file.after : null]));
  });
});

describe("ledger succession (a pull request's head against its base)", () => {
  const label = (violation: { rule: string; side?: string }) => (violation.side === undefined ? violation.rule : `${violation.side}.${violation.rule}`);
  it("gives every corpus pair its change, what it proves, and exactly the rules it names", () => {
    for (const pair of CORPUS.successions) {
      const result = ledgerSuccession(pair.base === null ? null : bytesOf(pair.base), bytesOf(pair.head));
      expect(result.change, pair.name).toBe(pair.change);
      expect(result.admission, pair.name).toBe(pair.admission);
      expect([...new Set(result.violations.map(label))].sort(), pair.name).toEqual([...pair.rules].sort());
    }
  });

  it("never reports an approved head generation as an admission: relabelling an admitted head approved proves only a claim", () => {
    for (const name of ["relabelled-extra-act", "relabelled-other-version", "relabelled-other-change", "relabelled-other-plan"]) {
      const pair = CORPUS.successions.find((entry) => entry.name === name)!;
      const result = ledgerSuccession(bytesOf(pair.base!), bytesOf(pair.head));
      expect(result, name).toEqual({ change: "next-generation", admission: "approval-claimed", violations: [] });
    }
  });

  it("refuses bytes that are not the ledger's exact RENDER bytes, and never reads them as unchanged", () => {
    const canonicalText = text(ledger("setup-generation-1"));
    const canonical = toBytes(canonicalText);
    const spaced = canonicalText.replace('"schemaVersion": 1', '"schemaVersion":  1');
    const repeated = canonicalText.replace('"schemaVersion": 1,', '"schemaVersion": 1,\n  "schemaVersion": 1,');
    const bom = `\ufeff${canonicalText}`;
    const noNewline = canonicalText.slice(0, -1);
    for (const [name, variant] of [["spaced", spaced], ["repeated key", repeated], ["byte order mark", bom], ["no final newline", noNewline]] as const) {
      const bytes = toBytes(variant);
      for (const result of [ledgerSuccession(canonical, bytes), ledgerSuccession(bytes, bytes), ledgerSuccession(null, bytes)]) {
        expect(result.change, name).toBe("next-generation");
        expect(result.admission, name).toBeNull();
        expect(result.violations.map(label), name).toContain("head.bytes");
      }
    }
    expect(ledgerSuccession(canonical, toBytes("not json")).violations.map(label)).toEqual(["head.bytes"]);
    expect(ledgerSuccession(canonical, canonical)).toEqual({ change: "none", admission: null, violations: [] });
  });

  it("refuses a non-Uint8Array argument under rule bytes, on either side", () => {
    const canonical = bytesOf("setup-generation-1");
    for (const bad of [text(ledger("setup-generation-1")), 42, {}]) {
      expect(ledgerSuccession(bad as unknown as Uint8Array, canonical).violations.map(label)).toEqual(["base.bytes"]);
      expect(ledgerSuccession(canonical, bad as unknown as Uint8Array).violations.map(label)).toEqual(["head.bytes"]);
    }
    expect(readInstalledLedger("not a Uint8Array" as unknown as Uint8Array)).toBeNull();
  });

  it("never folds two byte sequences together merely because they decode to the same replacement text", () => {
    // 0xFF and 0xFE are each, alone, invalid UTF-8 continuation bytes: a lenient decode (Buffer#toString, or a non-fatal
    // TextDecoder) replaces both with U+FFFD, so a naive text-based compare would read them as identical and as "no change".
    // The strict reader here refuses each side outright, on its own bytes, and never as an unchanged ledger.
    const generation1 = ledger("setup-generation-1");
    const canonicalText = text(generation1);
    const firstPath = generation1.files[0]!.path;
    const marker = canonicalText.indexOf(firstPath) + 1; // inside the first files[].path string value
    const withInvalidByte = (byte: number) => {
      const prefix = Buffer.from(canonicalText.slice(0, marker), "utf8");
      const suffix = Buffer.from(canonicalText.slice(marker), "utf8");
      return Buffer.concat([prefix, Buffer.from([byte]), suffix]);
    };
    const ff = withInvalidByte(0xff);
    const fe = withInvalidByte(0xfe);
    expect(ff.equals(fe)).toBe(false);
    for (const [base, head] of [[null, ff], [ff, ff], [ff, fe], [fe, ff]] as const) {
      const result = ledgerSuccession(base, head);
      expect(result.change).toBe("next-generation");
      expect(result.admission).toBeNull();
      expect(result.violations.map(label)).toContain("head.bytes");
    }
    expect(readInstalledLedger(ff)).toBeNull();
    expect(readInstalledLedger(fe)).toBeNull();
    expect(trustInstalledLedger(ff, { id: "x", nodeId: "R_x" }, [])).toEqual({ state: "refused", rule: "ledger-unreadable" });
  });

  it("refuses a byte order mark as ledger-unreadable from trustInstalledLedger, and null from readInstalledLedger", () => {
    const canonicalText = text(ledger("setup-generation-1"));
    const bom = toBytes(`\ufeff${canonicalText}`);
    expect(readInstalledLedger(bom)).toBeNull();
    expect(trustInstalledLedger(bom, { id: "example-owner/site", nodeId: "R_exampleSite1" }, [])).toEqual({ state: "refused", rule: "ledger-unreadable" });
    expect(ledgerSuccession(null, bom).violations.map(label)).toContain("head.bytes");
  });

  it("admits a generation only when it installs exactly what the setup deferred and changes nothing else", () => {
    const base = ledger("setup-generation-1");
    const head = ledger("admitted-generation-2");
    expect(ledgerSuccession(toBytes(text(base)), toBytes(text(head)))).toEqual({ change: "next-generation", admission: "admitted", violations: [] });
    const deferred = base.deferred.map(({ reason: _reason, changeSet: _changeSet, ...identity }) => identity);
    const added = head.packages.filter((row) => !base.packages.some((other) => JSON.stringify(other) === JSON.stringify(row))).map(({ changeSet: _changeSet, ...identity }) => identity);
    expect(added).toEqual(deferred);
    expect(head.files).toEqual(base.files);
  });

  it("refuses an admitted generation that installs a deferred package at another placement", () => {
    const head = loose(ledger("admitted-generation-2"));
    const last = head.history.at(-1).changeSet;
    head.keys = head.keys.map((row: Loose) => (row.pointer === "/devDependencies/@example~1writer" ? { ...row, pointer: "/dependencies/@example~1writer" } : row));
    head.packages = head.packages.map((row: Loose) => (row.name === "@example/writer" ? { ...row, placement: "dependencies", changeSet: last } : row));
    head.keys.sort((a: Loose, b: Loose) => (a.pointer < b.pointer ? -1 : 1));
    const result = ledgerSuccession(bytesOf("setup-generation-1"), toBytes(text(head)));
    expect(result.violations.map(label)).toContain("S3");
    expect(result.admission).toBeNull();
  });

  describe("S3 and the Launcher guide", () => {
    const GUIDE = "clossys/AGENTS.md";
    const byPath = (a: Loose, b: Loose) => (a.path.toLowerCase() < b.path.toLowerCase() ? -1 : 1);
    /** The admitted generation over setup-generation-1, with `rows` added to its files. */
    const headWith = (rows: Loose[]) => {
      const head = loose(ledger("admitted-generation-2"));
      head.files = [...head.files, ...rows].sort(byPath);
      return head;
    };
    const lastChangeSet = () => ledger("admitted-generation-2").history.at(-1)!.changeSet;
    const guideRow = (patch: Loose = {}) => ({ path: GUIDE, mode: "100644", after: sha("the guide\n"), changeSet: lastChangeSet(), ...patch });
    const check = (head: Loose, base: InstalledLedger = ledger("setup-generation-1")) => ledgerSuccession(toBytes(text(base)), toBytes(text(head)));

    it("admits a generation that also adds the guide's files row, written by that generation, and nothing else", () => {
      expect(ledger("setup-generation-1").files.some((row) => row.path === GUIDE)).toBe(false);
      expect(check(headWith([guideRow()]))).toEqual({ change: "next-generation", admission: "admitted", violations: [] });
    });

    it("states the one apply-phase add in the contract's RENDER and S3 sections, and names no other path", () => {
      const description = LEDGER.description as string;
      const render = description.slice(description.indexOf("RENDER."), description.indexOf("CODE RULES"));
      const succession = description.slice(description.indexOf("SUCCESSION,"));
      expect(render).toContain("the only file with a before of null that RENDER writes a row for is the Launcher guide (path clossys/AGENTS.md, mode 100644)");
      expect(succession).toContain("head.files equal base's or add exactly one row and drop none, the row for clossys/AGENTS.md with mode 100644");
      expect(succession).toContain("changes no other row, apart from that one files row");
      expect(description.match(/clossys\/AGENTS\.md/g)).toHaveLength(2);
    });

    it("refuses an admitted generation that adds a files row at any other path", () => {
      for (const path of ["clossys/unowned-note.txt", "clossys/AGENTS.md.bak", ".agents/skills/clossys-advisor/SKILL.md"]) {
        const result = check(headWith([guideRow({ path })]));
        expect(result.violations.map(label), path).toContain("S3");
        expect(result.admission, path).toBeNull();
      }
    });

    it("refuses the guide row when it is not written by the admitted generation itself, or is a link, or comes with another added row", () => {
      const first = ledger("admitted-generation-2").history[0]!.changeSet;
      for (const head of [headWith([guideRow({ changeSet: first })]), headWith([guideRow({ mode: "120000" })]), headWith([guideRow(), guideRow({ path: "clossys/unowned-note.txt" })])]) {
        const result = check(head);
        expect(result.admission).toBeNull();
        expect(result.violations.length).toBeGreaterThan(0);
      }
      expect(check(headWith([guideRow({ changeSet: first })])).violations.map(label)).toContain("S3");
      expect(check(headWith([guideRow(), guideRow({ path: "clossys/unowned-note.txt" })])).violations.map(label)).toContain("S3");
    });

    it("refuses an admitted generation that changes or drops a guide row the base already has", () => {
      const base = loose(ledger("setup-generation-1"));
      base.files = [...base.files, guideRow({ changeSet: base.history[0].changeSet })].sort(byPath);
      for (const rows of [[guideRow({ after: sha("another guide\n") })], []]) {
        const head = loose(ledger("admitted-generation-2"));
        head.files = [...head.files, ...rows].sort(byPath);
        const result = check(head, base as InstalledLedger);
        expect(result.violations.map(label)).toContain("S3");
        expect(result.admission).toBeNull();
      }
    });
  });

  it("reports only the refused ledger's own reasons when either ledger breaks the contract", () => {
    const result = ledgerSuccession(bytesOf("row-foreign-change-set"), bytesOf("admitted-generation-2"));
    expect([...new Set(result.violations.map(label))]).toEqual(["base.L4"]);
    expect(result.violations[0]!.message).toMatch(/^base\./);
  });
});
