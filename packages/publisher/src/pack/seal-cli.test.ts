import { chmodSync, linkSync, lstatSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateLedger } from "../record/schema.js";
import { main } from "./seal-cli.js";
import type { PackItem, PackManifest } from "./types.js";
import { validatePackManifest } from "./validate.js";

// Hooks into the real fs and crypto calls the command makes, so a write that fails halfway can be injected and a temp name can be predicted.
const hooks = vi.hoisted(() => ({
  rename: undefined as undefined | ((from: string, to: string) => void),
  open: undefined as undefined | ((path: string, flags: unknown) => void),
  random: undefined as undefined | (() => string),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    renameSync: (from: string, to: string) => {
      hooks.rename?.(String(from), String(to));
      actual.renameSync(from, to);
    },
    openSync: (path: string, flags: string, mode?: number) => {
      hooks.open?.(String(path), flags);
      return actual.openSync(path, flags, mode);
    },
  };
});

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, randomBytes: (size: number) => (hooks.random === undefined ? actual.randomBytes(size) : Buffer.from(hooks.random(), "hex")) };
});

const TIMEOUT = { timeout: 10_000 };

const NOW = "2026-09-30T12:00:00Z";
const COMMIT = "b".repeat(40);
const DIGEST = "a".repeat(64);
const MARKER_URL = "https://marker-url.example.test/leak";

function item(overrides: Partial<PackItem> & Pick<PackItem, "id">): PackItem {
  return {
    layer: "surface",
    owner: "publisher",
    visibility: "public",
    needs: [],
    status: "kept",
    condition: "current",
    version: "v0.1",
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-02T00:00:00Z",
    approvedAt: "2026-09-03T00:00:00Z",
    verifiedAt: null,
    sourcePins: [],
    outputPaths: [],
    publishedTo: [],
    nextAction: null,
    ...overrides,
  };
}

const MANIFEST: PackManifest = {
  schemaVersion: 1,
  items: [
    item({ id: "strategy-brief", layer: "foundation", owner: "strategist", visibility: "internal", status: "published", verifiedAt: "2026-09-04T00:00:00Z", publishedTo: ["internal"] }),
    item({ id: "website", needs: ["strategy-brief"] }),
  ],
};

const MAP = {
  entries: [
    { id: "home", template: "landing", documentId: "doc-home", location: { kind: "path", path: "/" } },
    { id: "contact", template: "contact", documentId: "doc-contact", location: { kind: "path", path: "/contact" } },
  ],
};

function page(path: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { path, status: 200, servedCommit: COMMIT, desktopDigest: DIGEST, mobileDigest: DIGEST, ...overrides };
}

function goodEvidence(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    itemId: "website",
    commit: COMMIT,
    observedAt: "2026-09-30T11:00:00Z",
    delivery: { state: "ready", deployedCommit: COMMIT, productionUrl: "https://www.example.test/" },
    pages: [page("/"), page("/contact")],
    contactIntake: { kind: "present", path: "/contact", submissionDigest: DIGEST },
  };
}

function badEvidence(): Record<string, unknown> {
  return {
    ...goodEvidence(),
    delivery: { state: "ready", deployedCommit: "c".repeat(40), productionUrl: MARKER_URL },
    pages: [page("/"), page("/contact", { status: 500 })],
  };
}

let dir: string;
let out: string[];
let err: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "publisher-seal-"));
  out = [];
  err = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => void out.push(args.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void err.push(args.join(" ")));
});

afterEach(() => {
  hooks.rename = undefined;
  hooks.open = undefined;
  hooks.random = undefined;
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

function put(name: string, value: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

function files(evidence: unknown = goodEvidence()) {
  return {
    manifest: put("pack.json", MANIFEST),
    ledger: put("record.json", []),
    evidence: put("evidence.json", evidence),
    map: put("map.json", MAP),
  };
}

/** Runs the command with the clock pinned to NOW. The command itself has no flag for the time. */
function run(paths: ReturnType<typeof files>, extra: string[] = ["--item", "website", "--strategy-revision", "strategy-rev-1"]): number {
  return main([paths.manifest, paths.ledger, paths.evidence, paths.map, ...extra], { now: () => new Date(NOW) });
}

function snapshot(paths: ReturnType<typeof files>): { manifest: string; ledger: string; listing: string[] } {
  return { manifest: readFileSync(paths.manifest, "utf8"), ledger: readFileSync(paths.ledger, "utf8"), listing: readdirSync(dir).sort() };
}

describe("publisher-seal", () => {
  it("exit codes and files: a refusal exits 1 and leaves both files byte-identical", TIMEOUT, () => {
    const paths = files(badEvidence());
    const before = snapshot(paths);
    expect(run(paths)).toBe(1);
    expect(snapshot(paths)).toEqual(before);

    const text = [...out, ...err].join("\n");
    expect(text).toContain("page-status");
    expect(text).toContain("delivery-commit-mismatch");
    expect(text).not.toContain(MARKER_URL);
    expect(text).not.toContain("marker-url");
    expect(text).not.toContain("c".repeat(40));
  });

  it("exit codes and files: good evidence exits 0 and rewrites both files", TIMEOUT, () => {
    const paths = files();
    const before = snapshot(paths);
    expect(run(paths)).toBe(0);

    const manifest = JSON.parse(readFileSync(paths.manifest, "utf8")) as PackManifest;
    const ledger = JSON.parse(readFileSync(paths.ledger, "utf8")) as Array<Record<string, unknown>>;
    expect(readFileSync(paths.manifest, "utf8")).not.toBe(before.manifest);
    expect(readFileSync(paths.ledger, "utf8")).not.toBe(before.ledger);
    expect(manifest.items.find((entry) => entry.id === "website")).toMatchObject({ status: "published", verifiedAt: NOW, publishedTo: ["https://www.example.test/"] });
    expect(validatePackManifest(manifest)).toEqual({ exitCode: 0, findings: [] });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ id: `website-website-${COMMIT.slice(0, 12)}`, channel: "web", publishedAt: NOW, factCitations: [] });
    expect(validateLedger(ledger).filter((finding) => finding.severity === "error")).toEqual([]);
    // No temp file is left behind.
    expect(readdirSync(dir).sort()).toEqual(before.listing);
    expect(err).toEqual([]);
  });

  it("sealing the same commit twice exits 1 and the second run changes nothing", TIMEOUT, () => {
    const paths = files();
    expect(run(paths)).toBe(0);
    const afterFirst = snapshot(paths);
    expect(run(paths)).toBe(1);
    expect(snapshot(paths)).toEqual(afterFirst);
  });

  it("seals at the current time", TIMEOUT, () => {
    const observedAt = new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
    const paths = files({ ...goodEvidence(), observedAt });
    expect(main([paths.manifest, paths.ledger, paths.evidence, paths.map, "--item", "website", "--strategy-revision", "strategy-rev-1"])).toBe(0);
    const sealed = JSON.parse(readFileSync(paths.manifest, "utf8")) as PackManifest;
    const verifiedAt = sealed.items.find((entry) => entry.id === "website")?.verifiedAt ?? "";
    expect(Date.parse(verifiedAt)).toBeGreaterThanOrEqual(Date.parse(observedAt));
    expect(Date.now() - Date.parse(verifiedAt)).toBeLessThan(60_000);
  });

  it("exit codes and files: bad JSON or a missing file exits 2 and writes nothing", TIMEOUT, () => {
    for (const name of ["manifest", "ledger", "evidence", "map"] as const) {
      const badJson = files();
      writeFileSync(badJson[name], "{ not json marker-json-leak");
      const before = snapshot(badJson);
      expect(run(badJson), `${name} bad JSON`).toBe(2);
      expect(snapshot(badJson)).toEqual(before);
      expect([...out, ...err].join("\n")).not.toContain("marker-json-leak");

      const missing = files();
      const missingPaths = { ...missing, [name]: join(dir, `${name}-missing.json`) };
      const beforeMissing = snapshot(missing);
      expect(run(missingPaths), `${name} missing`).toBe(2);
      expect(snapshot(missing)).toEqual(beforeMissing);
    }
  });

  it("exit 2 for arguments that cannot run: missing or repeated flags, unknown flag, extra positional", TIMEOUT, () => {
    const paths = files();
    const before = snapshot(paths);
    const cases: string[][] = [
      ["--strategy-revision", "r"],
      ["--item", "website"],
      ["--item", "website", "--strategy-revision"],
      ["--item", "website", "--item", "website", "--strategy-revision", "r"],
      ["--item", "website", "--strategy-revision", "r", "--waive"],
      ["--item", "website", "--strategy-revision", "r", "extra-positional"],
    ];
    for (const extra of cases) {
      expect(run(paths, extra), extra.join(" ")).toBe(2);
    }
    expect(main([paths.manifest, "--item", "website", "--strategy-revision", "r"])).toBe(2);
    expect(snapshot(paths)).toEqual(before);
  });

  it("exit 2 when the manifest, ledger or map is not usable, rather than a refusal", TIMEOUT, () => {
    const cases: Array<[string, (paths: ReturnType<typeof files>) => void]> = [
      ["manifest", (paths) => writeFileSync(paths.manifest, JSON.stringify({ schemaVersion: 1, items: "nope" }))],
      ["ledger", (paths) => writeFileSync(paths.ledger, JSON.stringify({ not: "an array" }))],
      ["map", (paths) => writeFileSync(paths.map, JSON.stringify({ entries: "nope" }))],
    ];
    for (const [label, corrupt] of cases) {
      const paths = files();
      corrupt(paths);
      const before = snapshot(paths);
      expect(run(paths), label).toBe(2);
      expect(snapshot(paths)).toEqual(before);
    }
  });

  it("an evidence file that is valid JSON but the wrong shape is a refusal (1), not a crash", TIMEOUT, () => {
    for (const wrong of [null, [], "text", { schemaVersion: 1 }]) {
      const paths = files(typeof wrong === "string" ? JSON.stringify(wrong) : wrong);
      const before = snapshot(paths);
      expect(run(paths), JSON.stringify(wrong)).toBe(1);
      expect(snapshot(paths)).toEqual(before);
    }
  });

  it("--now is not accepted: the seal time is the clock, so the 24 hour window cannot be backdated", TIMEOUT, () => {
    const stale = files({ ...goodEvidence(), observedAt: "2020-01-01T00:00:00Z" });
    const before = snapshot(stale);
    for (const flagged of [["--now", "2020-01-01T12:00:00Z"], ["--now"]]) {
      expect(main([stale.manifest, stale.ledger, stale.evidence, stale.map, "--item", "website", "--strategy-revision", "r", ...flagged])).toBe(2);
      expect(err.join("\n")).toContain('unknown flag "--now"');
      expect(snapshot(stale)).toEqual(before);
    }
    // Without the flag the real clock applies, and 2020 evidence is stale.
    expect(main([stale.manifest, stale.ledger, stale.evidence, stale.map, "--item", "website", "--strategy-revision", "r"])).toBe(1);
    expect(out.join("\n")).toContain("observed-at-stale");
    expect(snapshot(stale)).toEqual(before);
  });

  it("evidence taken for another item is refused (1) and nothing is written", TIMEOUT, () => {
    const paths = files({ ...goodEvidence(), itemId: "marker-other-item" });
    const before = snapshot(paths);
    expect(run(paths)).toBe(1);
    expect(out.join("\n")).toContain("evidence-item-mismatch");
    expect([...out, ...err].join("\n")).not.toContain("marker-other-item");
    expect(snapshot(paths)).toEqual(before);
  });

  it("a symlinked manifest or ledger is refused (2): the link and the real file are both left alone", TIMEOUT, () => {
    for (const which of ["manifest", "ledger"] as const) {
      const paths = files();
      const real = join(dir, `real-${which}.json`);
      renameSync(paths[which], real);
      symlinkSync(real, paths[which]);
      const realBefore = readFileSync(real, "utf8");
      const listing = readdirSync(dir).sort();
      expect(run(paths), which).toBe(2);
      expect(lstatSync(paths[which]).isSymbolicLink(), which).toBe(true);
      expect(readFileSync(real, "utf8"), which).toBe(realBefore);
      expect(readdirSync(dir).sort(), which).toEqual(listing);
      expect(err.join("\n")).toContain("symbolic link");
    }
  });

  it("a read-only input may still be a symlink", TIMEOUT, () => {
    const paths = files();
    const real = join(dir, "real-evidence.json");
    renameSync(paths.evidence, real);
    symlinkSync(real, paths.evidence);
    expect(run(paths)).toBe(0);
  });

  it("a manifest or ledger with a second hard link, or both names for one file, is refused (2)", TIMEOUT, () => {
    const aliased = files();
    linkSync(aliased.manifest, join(dir, "manifest-alias.json"));
    const before = snapshot(aliased);
    expect(run(aliased)).toBe(2);
    expect(snapshot(aliased)).toEqual(before);

    const same = files();
    rmSync(same.ledger);
    linkSync(same.manifest, same.ledger);
    const beforeSame = snapshot(same);
    expect(run(same)).toBe(2);
    expect(snapshot(same)).toEqual(beforeSame);
  });

  it("a seal keeps each file's permissions", TIMEOUT, () => {
    const paths = files();
    chmodSync(paths.ledger, 0o600);
    chmodSync(paths.manifest, 0o640);
    expect(run(paths)).toBe(0);
    expect(statSync(paths.ledger).mode & 0o777).toBe(0o600);
    expect(statSync(paths.manifest).mode & 0o777).toBe(0o640);
  });

  it("writes the ledger first and the manifest second", TIMEOUT, () => {
    const paths = files();
    const renamedTo: string[] = [];
    hooks.rename = (_from, to) => void renamedTo.push(to);
    expect(run(paths)).toBe(0);
    expect(renamedTo).toEqual([paths.ledger, paths.manifest]);
  });

  it("a failure before anything is renamed changes nothing and says so", TIMEOUT, () => {
    const paths = files();
    const before = snapshot(paths);
    hooks.rename = (_from, to) => {
      if (to === paths.ledger) throw new Error("injected");
    };
    expect(run(paths)).toBe(2);
    expect(snapshot(paths)).toEqual(before);
    expect(err.join("\n")).toContain("nothing was changed");
    expect(err.join("\n")).not.toContain("injected");
  });

  it("a manifest write that fails after the ledger was written restores the ledger, says so, and a rerun succeeds", TIMEOUT, () => {
    const paths = files();
    const before = snapshot(paths);
    hooks.rename = (_from, to) => {
      if (to === paths.manifest) throw new Error("injected");
    };
    expect(run(paths)).toBe(2);
    expect(snapshot(paths)).toEqual(before);
    expect(err.join("\n")).toContain("the ledger was restored");
    expect(err.join("\n")).not.toContain("injected");

    hooks.rename = undefined;
    expect(run(paths)).toBe(0);
    expect(JSON.parse(readFileSync(paths.ledger, "utf8"))).toHaveLength(1);
  });

  it("when the ledger cannot be restored either, the error says the ledger was written and keeps the previous ledger", TIMEOUT, () => {
    const paths = files();
    const before = snapshot(paths);
    let ledgerRenames = 0;
    hooks.rename = (_from, to) => {
      if (to === paths.manifest) throw new Error("injected");
      if (to === paths.ledger && (ledgerRenames += 1) > 1) throw new Error("injected restore");
    };
    expect(run(paths)).toBe(2);
    const text = err.join("\n");
    expect(text).toContain("the ledger was written");
    expect(text).toContain("could not be restored");
    expect(readFileSync(paths.manifest, "utf8")).toBe(before.manifest);
    expect(JSON.parse(readFileSync(paths.ledger, "utf8"))).toHaveLength(1);
    const kept = readdirSync(dir).filter((name) => !before.listing.includes(name));
    expect(kept).toHaveLength(1);
    expect(text).toContain(kept[0] as string);
    expect(readFileSync(join(dir, kept[0] as string), "utf8")).toBe(before.ledger);
  });

  it("cleanup removes only the temp files this run created", TIMEOUT, () => {
    const paths = files();
    hooks.random = () => "0123456789ab";
    // The manifest's temp name is already taken by something this run did not create; the ledger's is free.
    const victim = `${paths.manifest}.0123456789ab.manifest.seal.tmp`;
    writeFileSync(victim, "not created by this run");
    const before = snapshot(paths);
    expect(run(paths)).toBe(2);
    expect(readFileSync(victim, "utf8")).toBe("not created by this run");
    expect(readFileSync(paths.manifest, "utf8")).toBe(before.manifest);
    expect(readFileSync(paths.ledger, "utf8")).toBe(before.ledger);
    // Only the pre-existing file remains: the ledger temp this run did create is gone.
    expect(readdirSync(dir).sort()).toEqual(before.listing);
  });

  it("a lock held by another run refuses (2) and leaves the lock, the files and the directory as they were", TIMEOUT, () => {
    for (const which of ["ledger", "manifest"] as const) {
      const paths = files();
      const lock = `${paths[which]}.seal.lock`;
      writeFileSync(lock, "held by another run");
      const before = snapshot(paths);
      expect(run(paths), which).toBe(2);
      expect(snapshot(paths), which).toEqual(before);
      expect(readFileSync(lock, "utf8"), which).toBe("held by another run");
      expect(err.join("\n")).toContain("another publisher-seal run");
      rmSync(lock);
      err.length = 0;
    }
  });

  it("a file that changed after the gate accepted is not overwritten", TIMEOUT, () => {
    const paths = files();
    const manifestBefore = readFileSync(paths.manifest, "utf8");
    const concurrent = "[ ]\n";
    let raced = false;
    // A second run lands its ledger write between this run's read and its lock.
    hooks.open = (path, flags) => {
      if (!raced && flags === "wx" && path.endsWith(".seal.lock")) {
        raced = true;
        writeFileSync(paths.ledger, concurrent);
      }
    };
    const listing = readdirSync(dir).sort();
    expect(run(paths)).toBe(2);
    expect(raced).toBe(true);
    expect(readFileSync(paths.ledger, "utf8")).toBe(concurrent);
    expect(readFileSync(paths.manifest, "utf8")).toBe(manifestBefore);
    expect(readdirSync(dir).sort()).toEqual(listing);
    expect(err.join("\n")).toContain("changed while");
  });

  it("--help exits 0 and writes nothing", TIMEOUT, () => {
    expect(main(["--help"])).toBe(0);
    expect(out.join("\n")).toContain("publisher-seal");
  });
});
