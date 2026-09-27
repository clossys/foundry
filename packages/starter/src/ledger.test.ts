import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertImplementedContract } from "./generated/contract-schema.generated.js";
import { LEDGER_CONTRACT } from "./generated/ledger-contract.generated.js";
import { installedLedgerViolations, ledgerSuccession, serializeInstalledLedger } from "./ledger.js";
import type { InstalledLedger, LedgerViolation } from "./ledger.js";

/*
 * Issue #1178. Starter's own reader of the installed-state ledger, held to
 * the shared corpus docs/contracts/installed-ledger.fixture.json, whose valid
 * ledgers were rendered and hashed independently of any package. Reading
 * repository files here is test-only.
 */
const REPO = new URL("../../../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, REPO), "utf8");
const sha = (text: string) => `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;

interface Corpus {
  ledgers: { name: string; valid: boolean; rules?: string[]; ledger: InstalledLedger; sha256?: string }[];
  successions: { name: string; base: string | null; head: string; change: "none" | "next-generation"; admission: "admitted" | "approval-claimed" | null; rules: string[] }[];
}
const CORPUS = JSON.parse(read("docs/contracts/installed-ledger.fixture.json")) as Corpus;
const ledger = (name: string) => CORPUS.ledgers.find((entry) => entry.name === name)!.ledger;
/** The corpus stores members in the contract's order, so this is a valid ledger's RENDER bytes. */
const text = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const utf8 = (value: string): Buffer => Buffer.from(value, "utf8");
const bytesOf = (name: string): Buffer => utf8(text(ledger(name)));
const ruleIds = (value: unknown) => [...new Set(installedLedgerViolations(value).map((violation) => violation.rule))].sort();
const label = (violation: LedgerViolation) => (violation.side === undefined ? violation.rule : `${violation.side}.${violation.rule}`);
type Loose = Record<string, any>;
const loose = (value: unknown): Loose => structuredClone(value) as Loose;
const OWNED = ((LEDGER_CONTRACT.definitions as Loose).ownedPattern.enum as string[]);

afterEach(() => {
  vi.doUnmock("./generated/ledger-contract.generated.js");
  vi.resetModules();
});

describe("installed-state ledger", () => {
  it("agrees with the corpus on every ledger", () => {
    for (const entry of CORPUS.ledgers) {
      if (entry.valid) expect(installedLedgerViolations(entry.ledger), entry.name).toEqual([]);
      else expect(ruleIds(entry.ledger), entry.name).toEqual([...entry.rules!].sort());
    }
    const covered = new Set(CORPUS.ledgers.flatMap((entry) => entry.rules ?? []));
    for (const rule of ["schema", "L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8", "L9", "L10"]) expect(covered.has(rule), rule).toBe(true);
  });

  it("renders the corpus bytes for every valid ledger", () => {
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
    expect(() => serializeInstalledLedger(ledger("admitted-other-plan"))).toThrow(/refused ledger has no bytes/);
  });

  it("names positions, never values", () => {
    const forged = loose(ledger("setup-with-root-entries"));
    forged.entries[forged.entries.length - 1].value = "zz-secret-root";
    forged.files.push({ path: "zz-secret-dir/secret-file", mode: "100644", after: forged.files[0].after, changeSet: forged.files[0].changeSet });
    forged.packages[0].planItem = "a secret prose item";
    const ruled = installedLedgerViolations(forged);
    expect(ruled.map((violation) => violation.rule).sort()).toEqual(expect.arrayContaining(["L5", "L9", "L10"]));
    const schema = loose(ledger("setup-generation-1"));
    schema.repository.id = "a secret value";
    schema.secretKey = "secret";
    const shaped = installedLedgerViolations(schema);
    expect(shaped.map((violation) => violation.rule)).toContain("schema");
    const succession = ledgerSuccession(utf8(text(schema)), utf8(text(forged)));
    expect(succession.violations.length).toBeGreaterThan(0);
    for (const violation of [...ruled, ...shaped, ...succession.violations]) {
      expect(violation.message, violation.message).not.toMatch(/secret/i);
      expect(violation.path, violation.path).not.toMatch(/secret/i);
    }
  });

  it("reads owned patterns from the packed contract", async () => {
    // Every owned pattern, and every root name it introduces, is accepted: a concrete path for each (package.json and the lockfiles are refused by name first).
    const base = loose(ledger("setup-with-root-entries"));
    const changeSet = base.history[0].changeSet;
    const after = base.files[0].after;
    const concrete = (pattern: string) => pattern.split("/").map((segment) => (segment === "**" ? "a/b" : segment.replace(/\*/g, "x"))).join("/");
    const refusedByName = new Set(["package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"]);
    const paths = OWNED.filter((pattern) => !refusedByName.has(pattern)).map(concrete).filter((path) => path !== "clossys/.state/installed.json").sort();
    base.files = paths.map((path) => ({ path, mode: /^\.(?:claude|cursor)\/skills\/clossys-[^/]+$/.test(path) ? "120000" : "100644", after, changeSet }));
    const profile = base.entries[0].file;
    const roots = [...new Set(OWNED.map((pattern) => pattern.split("/")[0]!).filter((root) => root !== "**"))].sort();
    base.entries = roots.map((value) => ({ file: profile, key: "rootEntries", value, changeSet }));
    expect(installedLedgerViolations(base)).toEqual([]);

    // A pattern and root only the packed contract names are accepted once it names them, and refused before: nothing is restated in the reader.
    const extended = loose(base);
    extended.files.push({ path: "zz-extra/y", mode: "100644", after, changeSet });
    extended.entries.push({ file: profile, key: "rootEntries", value: "zz-extra", changeSet });
    expect(ruleIds(extended)).toEqual(["L5", "L9"]);
    vi.resetModules();
    vi.doMock("./generated/ledger-contract.generated.js", async (importOriginal) => {
      const actual = await importOriginal<{ LEDGER_CONTRACT: Loose }>();
      const contract = loose(actual.LEDGER_CONTRACT);
      contract.definitions.ownedPattern.enum.push("zz-extra/**");
      return { LEDGER_CONTRACT: contract };
    });
    const reloaded = await import("./ledger.js");
    expect(reloaded.installedLedgerViolations(extended)).toEqual([]);
  });

  it("the packed contract uses only keywords the checker implements", () => {
    expect(() => assertImplementedContract(LEDGER_CONTRACT)).not.toThrow();
    expect(LEDGER_CONTRACT).toEqual(JSON.parse(read("docs/contracts/installed-ledger.json")));
  });
});

describe("ledger succession", () => {
  it("gives every corpus succession pair its change, admission and rules", () => {
    for (const pair of CORPUS.successions) {
      const result = ledgerSuccession(pair.base === null ? null : bytesOf(pair.base), bytesOf(pair.head));
      expect(result.change, pair.name).toBe(pair.change);
      expect(result.admission, pair.name).toBe(pair.admission);
      expect([...new Set(result.violations.map(label))].sort(), pair.name).toEqual([...pair.rules].sort());
    }
  });

  it("never reports an approved head generation as an admission", () => {
    const names = [...CORPUS.successions.filter((pair) => pair.name.startsWith("relabelled-")).map((pair) => pair.name), "approved-apply", "first-generation"];
    expect(names.length).toBeGreaterThanOrEqual(6);
    for (const name of names) {
      const pair = CORPUS.successions.find((entry) => entry.name === name)!;
      expect(ledgerSuccession(pair.base === null ? null : bytesOf(pair.base), bytesOf(pair.head)), name).toEqual({ change: "next-generation", admission: "approval-claimed", violations: [] });
    }
    for (const pair of CORPUS.successions) {
      if (ledger(pair.head).history.at(-1)!.binding.kind !== "approved") continue;
      expect(ledgerSuccession(pair.base === null ? null : bytesOf(pair.base), bytesOf(pair.head)).admission, pair.name).not.toBe("admitted");
    }
    // Relabelling the one admitted corpus head approved, whatever else it holds, proves only a claim.
    const relabelled = loose(ledger("admitted-generation-2"));
    const last = relabelled.history.at(-1);
    last.binding = { kind: "approved", subjectDigest: last.binding.subjectDigest };
    expect(ledgerSuccession(bytesOf("setup-generation-1"), utf8(text(relabelled))).admission).toBe("approval-claimed");
  });

  it("refuses non-canonical bytes and never reads them as unchanged", () => {
    const canonicalText = text(ledger("setup-generation-1"));
    const canonical = utf8(canonicalText);
    const variants: [string, string][] = [
      ["spaced", canonicalText.replace('"schemaVersion": 1', '"schemaVersion":  1')],
      ["repeated key", canonicalText.replace('"schemaVersion": 1,', '"schemaVersion": 1,\n  "schemaVersion": 1,')],
      ["repeated key, other value first", canonicalText.replace('"schemaVersion": 1,', '"schemaVersion": 2,\n  "schemaVersion": 1,')],
      ["no final line feed", canonicalText.slice(0, -1)],
      ["two final line feeds", `${canonicalText}\n`],
      ["CRLF", canonicalText.replace(/\n/g, "\r\n")],
      ["compact", `${JSON.stringify(ledger("setup-generation-1"))}\n`],
      ["members reordered", text(Object.fromEntries(Object.entries(ledger("setup-generation-1")).reverse()))],
      ["escaped spelling", canonicalText.replace('"clossys.installed-ledger"', '"clossys.installed-\\u006cedger"')],
    ];
    for (const [name, variantText] of variants) {
      const bytes = utf8(variantText);
      expect(bytes.equals(canonical), name).toBe(false);
      for (const result of [ledgerSuccession(canonical, bytes), ledgerSuccession(bytes, bytes), ledgerSuccession(null, bytes)]) {
        expect(result.change, name).toBe("next-generation");
        expect(result.admission, name).toBeNull();
        expect(result.violations.map(label), name).toContain("head.bytes");
      }
      expect(ledgerSuccession(bytes, canonical).violations.map(label), name).toEqual(["base.bytes"]);
    }
    expect(ledgerSuccession(canonical, utf8("not json")).violations.map(label)).toEqual(["head.bytes"]);
    expect(ledgerSuccession(canonical, canonical)).toEqual({ change: "none", admission: null, violations: [] });
  });

  it("reads each side's raw bytes, never a prior decode: a byte order mark, invalid UTF-8, and same-position invalid bytes are all refused, never unchanged", () => {
    const canonical = bytesOf("setup-generation-1");

    // A leading byte order mark reaches readContractDocument() as bytes, unstripped by any prior TextDecoder.
    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), canonical]);
    expect(bom.equals(canonical)).toBe(false);
    const bomResult = ledgerSuccession(canonical, bom);
    expect(bomResult.change).toBe("next-generation");
    expect(bomResult.admission).toBeNull();
    expect(bomResult.violations.map(label)).toEqual(["head.bytes"]);

    // A lone 0xFF byte is never valid UTF-8 at any position; it must be refused as bytes, not silently replaced.
    const invalidHead = Buffer.from(canonical); invalidHead[40] = 0xff;
    expect(invalidHead[40]).not.toBe(canonical[40]);
    const invalidResult = ledgerSuccession(canonical, invalidHead);
    expect(invalidResult.change).toBe("next-generation");
    expect(invalidResult.admission).toBeNull();
    expect(invalidResult.violations.map(label)).toEqual(["head.bytes"]);

    // 0xFF and 0xFE at the same position both decode (lossily) to U+FFFD; the raw bytes differ and must never compare as unchanged.
    const invalidBase = Buffer.from(canonical); invalidBase[40] = 0xff;
    const invalidHead2 = Buffer.from(canonical); invalidHead2[40] = 0xfe;
    const bothResult = ledgerSuccession(invalidBase, invalidHead2);
    expect(bothResult.change).toBe("next-generation");
    expect(bothResult.admission).toBeNull();
    expect([...new Set(bothResult.violations.map(label))].sort()).toEqual(["base.bytes", "head.bytes"]);
  });

  it("reports only a refused side's own reasons", () => {
    const refusedBase = ledgerSuccession(bytesOf("row-foreign-change-set"), bytesOf("admitted-generation-2"));
    expect(refusedBase.change).toBe("next-generation");
    expect(refusedBase.admission).toBeNull();
    expect([...new Set(refusedBase.violations.map(label))]).toEqual(["base.L4"]);
    for (const violation of refusedBase.violations) expect(violation.message).toMatch(/^base\./);
    const refusedHead = ledgerSuccession(bytesOf("setup-generation-1"), bytesOf("row-foreign-change-set"));
    expect([...new Set(refusedHead.violations.map(label))]).toEqual(["head.L4"]);
    for (const violation of refusedHead.violations) expect(violation.message).toMatch(/^head\./);
  });
});
