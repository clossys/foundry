import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateLedger } from "../record/schema.js";
import { main } from "./seal-cli.js";
import type { PackItem, PackManifest } from "./types.js";
import { validatePackManifest } from "./validate.js";

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

function run(paths: ReturnType<typeof files>, extra: string[] = ["--item", "website", "--strategy-revision", "strategy-rev-1", "--now", NOW]): number {
  return main([paths.manifest, paths.ledger, paths.evidence, paths.map, ...extra]);
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

  it("defaults --now to the current time", TIMEOUT, () => {
    const observedAt = new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
    const paths = files({ ...goodEvidence(), observedAt });
    expect(run(paths, ["--item", "website", "--strategy-revision", "strategy-rev-1"])).toBe(0);
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

  it("exit 2 for arguments that cannot run: missing or repeated flags, unknown flag, bad --now, extra positional", TIMEOUT, () => {
    const paths = files();
    const before = snapshot(paths);
    const cases: string[][] = [
      ["--strategy-revision", "r"],
      ["--item", "website"],
      ["--item", "website", "--strategy-revision"],
      ["--item", "website", "--item", "website", "--strategy-revision", "r"],
      ["--item", "website", "--strategy-revision", "r", "--now", "later"],
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

  it("--help exits 0 and writes nothing", TIMEOUT, () => {
    expect(main(["--help"])).toBe(0);
    expect(out.join("\n")).toContain("publisher-seal");
  });
});
