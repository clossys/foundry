import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mainApproveCommand } from "./approve-cli.js";
import { COPY_FINGERPRINT_ALGORITHM, computeCopyFingerprint } from "./fingerprint.js";

// Hermetic: every test writes its own registry fixture into a fresh
// mkdtemp directory and cleans it up afterward — nothing here touches this
// repository's own files, and no test's registry is shared with another's.

let dir: string;

function registryPath(): string {
  return join(dir, "registry.json");
}

/**
 * A fresh, valid `CopyRegistry` JSON object — generic ids only
 * (`site.home.title`, `site.home.body`, `site.pricing.title`), never real
 * product copy, per this repository's public-safety contract.
 * `unrelatedTopLevelField`/`note` exist purely so tests can assert they
 * survive a write untouched.
 */
function baseRegistry(): Record<string, unknown> {
  return {
    id: "fixture-app",
    locale: "en",
    revision: "rev-1",
    source: { kind: "consumer", reference: "editorial/revisions/1" },
    unrelatedTopLevelField: "keep-me",
    entries: [
      {
        id: "site.home.title",
        text: "Home title copy.",
        context: "home hero",
        status: "draft",
        note: "keep-me-too",
      },
      { id: "site.home.body", text: "Home body copy.", context: "home hero", status: "draft" },
      { id: "site.pricing.title", text: "Pricing title copy.", context: "pricing hero", status: "draft" },
      { id: "site.retired.title", text: "Retired copy.", context: "retired section", status: "retired" },
    ],
  };
}

function writeRegistry(registry: Record<string, unknown>): void {
  writeFileSync(registryPath(), `${JSON.stringify(registry, null, 2)}\n`, "utf8");
}

function readRaw(): string {
  return readFileSync(registryPath(), "utf8");
}

function readParsed(): Record<string, unknown> {
  return JSON.parse(readRaw()) as Record<string, unknown>;
}

function entryById(registry: Record<string, unknown>, id: string): Record<string, unknown> {
  const entries = registry.entries as Array<Record<string, unknown>>;
  const found = entries.find((e) => e.id === id);
  if (!found) throw new Error(`fixture bug: no entry "${id}"`);
  return found;
}

/** Every file in `dir` other than the registry itself — used to assert no temp file was left behind. */
function strayFiles(): string[] {
  return readdirSync(dir).filter((name) => name !== "registry.json");
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "writer-approve-cli-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe("mainApproveCommand", () => {
  it("writes a delegate record with fingerprint and pending review", () => {
    writeRegistry(baseRegistry());
    const before = readParsed();
    const now = new Date("2026-09-27T12:00:00.000Z");

    const code = mainApproveCommand(
      [registryPath(), "site.home.title", "--by", "delegate", "--delegate", "delegate-a", "--scope", "site.home"],
      { now },
    );

    expect(code).toBe(0);
    const after = readParsed();
    const entry = entryById(after, "site.home.title");
    expect(entry.status).toBe("approved");
    expect(entry.approval).toEqual({
      approvedBy: "delegate",
      approvedAt: "2026-09-27T12:00:00.000Z",
      textFingerprint: computeCopyFingerprint("Home title copy."),
      fingerprintAlgorithm: COPY_FINGERPRINT_ALGORITHM,
      delegate: { id: "delegate-a", scope: ["site.home"] },
      pendingOwnerReview: true,
    });
    expect(Object.keys(entry.approval as object)).toEqual([
      "approvedBy",
      "approvedAt",
      "textFingerprint",
      "fingerprintAlgorithm",
      "delegate",
      "pendingOwnerReview",
    ]);

    // Untouched entries, revision, and unrelated fields are preserved.
    expect(after.revision).toBe("rev-1");
    expect(after.unrelatedTopLevelField).toBe("keep-me");
    expect(entry.note).toBe("keep-me-too");
    expect(entryById(after, "site.home.body")).toEqual(entryById(before, "site.home.body"));
    expect(Object.keys(after)).toEqual(Object.keys(before));

    // "status" kept its position; "approval" was newly appended at the end.
    expect(Object.keys(entry)).toEqual(["id", "text", "context", "status", "note", "approval"]);

    expect(console.log).toHaveBeenCalledWith(
      "[approve] site.home.title: approved by delegate delegate-a (pending owner review)",
    );

    expect(readRaw().endsWith("\n")).toBe(true);
    expect(readRaw()).toBe(`${JSON.stringify(after, null, 2)}\n`);
    expect(strayFiles()).toEqual([]);
  });

  it("owner approval replaces a delegate record", () => {
    const registry = baseRegistry();
    const entry = entryById(registry, "site.home.title");
    entry.status = "approved";
    entry.approval = {
      approvedBy: "delegate",
      approvedAt: "2026-08-01T00:00:00.000Z",
      textFingerprint: computeCopyFingerprint("Home title copy."),
      fingerprintAlgorithm: COPY_FINGERPRINT_ALGORITHM,
      delegate: { id: "delegate-a", scope: ["site.home"] },
      pendingOwnerReview: true,
    };
    const keysBefore = Object.keys(entry);
    writeRegistry(registry);

    const now = new Date("2026-09-27T12:00:00.000Z");
    const code = mainApproveCommand([registryPath(), "site.home.title", "--by", "owner"], { now });

    expect(code).toBe(0);
    const after = readParsed();
    const updated = entryById(after, "site.home.title");
    expect(updated.status).toBe("approved");
    expect(updated.approval).toEqual({
      approvedBy: "owner",
      approvedAt: "2026-09-27T12:00:00.000Z",
      textFingerprint: computeCopyFingerprint("Home title copy."),
      fingerprintAlgorithm: COPY_FINGERPRINT_ALGORITHM,
    });
    // The replaced "approval" key kept its original position in the entry.
    expect(Object.keys(updated)).toEqual(keysBefore);

    expect(console.log).toHaveBeenCalledWith("[approve] site.home.title: approved by owner");
    expect(strayFiles()).toEqual([]);
  });

  it("revoke returns the entry to draft", () => {
    const registry = baseRegistry();
    const entry = entryById(registry, "site.home.title");
    entry.status = "approved";
    entry.approval = {
      approvedBy: "owner",
      approvedAt: "2026-08-01T00:00:00.000Z",
      textFingerprint: computeCopyFingerprint("Home title copy."),
      fingerprintAlgorithm: COPY_FINGERPRINT_ALGORITHM,
    };
    writeRegistry(registry);

    const code = mainApproveCommand([registryPath(), "site.home.title", "--revoke"]);

    expect(code).toBe(0);
    const after = readParsed();
    const updated = entryById(after, "site.home.title");
    expect(updated.status).toBe("draft");
    expect("approval" in updated).toBe(false);
    expect(console.log).toHaveBeenCalledWith("[approve] site.home.title: revoked (now draft)");
    expect(strayFiles()).toEqual([]);
  });

  it("refuses an out-of-scope id without writing", () => {
    writeRegistry(baseRegistry());
    const before = readRaw();

    const code = mainApproveCommand([
      registryPath(),
      "site.pricing.title",
      "--by",
      "delegate",
      "--delegate",
      "delegate-a",
      "--scope",
      "site.home",
    ]);

    expect(code).toBe(1);
    expect(readRaw()).toBe(before);
    expect(console.error).toHaveBeenCalled();
    expect(strayFiles()).toEqual([]);
  });

  it("refuses a retired or unknown id without writing", () => {
    writeRegistry(baseRegistry());
    const before = readRaw();

    const code = mainApproveCommand([
      registryPath(),
      "site.retired.title",
      "site.does-not-exist.title",
      "--by",
      "owner",
    ]);

    expect(code).toBe(1);
    expect(readRaw()).toBe(before);
    expect(strayFiles()).toEqual([]);
  });

  it("invalid registry exits 2 and leaves bytes unchanged", () => {
    // Missing required "locale" and "source" fields.
    writeFileSync(
      registryPath(),
      `${JSON.stringify({ id: "fixture-app", revision: "rev-1", entries: [] }, null, 2)}\n`,
      "utf8",
    );
    const before = readRaw();

    const code = mainApproveCommand([registryPath(), "site.home.title", "--by", "owner"]);

    expect(code).toBe(2);
    expect(readRaw()).toBe(before);
    expect(strayFiles()).toEqual([]);
  });

  it("past --expires exits 2", () => {
    writeRegistry(baseRegistry());
    const before = readRaw();
    const now = new Date("2026-09-27T12:00:00.000Z");

    const code = mainApproveCommand(
      [
        registryPath(),
        "site.home.title",
        "--by",
        "delegate",
        "--delegate",
        "delegate-a",
        "--scope",
        "site.home",
        "--expires",
        "2026-01-01T00:00:00.000Z",
      ],
      { now },
    );

    expect(code).toBe(2);
    expect(readRaw()).toBe(before);
    expect(strayFiles()).toEqual([]);
  });

  describe("further argument-error cases (exit 2, nothing written)", () => {
    it("missing registry-file argument", () => {
      expect(mainApproveCommand(["--by", "owner"])).toBe(2);
    });

    it("missing entry ids", () => {
      writeRegistry(baseRegistry());
      expect(mainApproveCommand([registryPath(), "--by", "owner"])).toBe(2);
    });

    it("neither --by nor --revoke", () => {
      writeRegistry(baseRegistry());
      expect(mainApproveCommand([registryPath(), "site.home.title"])).toBe(2);
    });

    it("both --by and --revoke", () => {
      writeRegistry(baseRegistry());
      expect(mainApproveCommand([registryPath(), "site.home.title", "--by", "owner", "--revoke"])).toBe(2);
    });

    it("--by neither owner nor delegate", () => {
      writeRegistry(baseRegistry());
      expect(mainApproveCommand([registryPath(), "site.home.title", "--by", "nobody"])).toBe(2);
    });

    it("--by owner combined with --delegate", () => {
      writeRegistry(baseRegistry());
      expect(
        mainApproveCommand([registryPath(), "site.home.title", "--by", "owner", "--delegate", "delegate-a"]),
      ).toBe(2);
    });

    it("--by delegate without --delegate", () => {
      writeRegistry(baseRegistry());
      expect(mainApproveCommand([registryPath(), "site.home.title", "--by", "delegate", "--scope", "site.home"])).toBe(
        2,
      );
    });

    it("--by delegate without --scope", () => {
      writeRegistry(baseRegistry());
      expect(
        mainApproveCommand([registryPath(), "site.home.title", "--by", "delegate", "--delegate", "delegate-a"]),
      ).toBe(2);
    });

    it("empty --delegate value", () => {
      writeRegistry(baseRegistry());
      expect(
        mainApproveCommand([
          registryPath(),
          "site.home.title",
          "--by",
          "delegate",
          "--delegate",
          "",
          "--scope",
          "site.home",
        ]),
      ).toBe(2);
    });

    it("whitespace-only --delegate value", () => {
      writeRegistry(baseRegistry());
      expect(
        mainApproveCommand([
          registryPath(),
          "site.home.title",
          "--by",
          "delegate",
          "--delegate",
          " ",
          "--scope",
          "site.home",
        ]),
      ).toBe(2);
    });

    it("malformed --scope item", () => {
      writeRegistry(baseRegistry());
      expect(
        mainApproveCommand([
          registryPath(),
          "site.home.title",
          "--by",
          "delegate",
          "--delegate",
          "delegate-a",
          "--scope",
          "Not Valid!",
        ]),
      ).toBe(2);
    });

    it("--revoke combined with --scope", () => {
      writeRegistry(baseRegistry());
      expect(mainApproveCommand([registryPath(), "site.home.title", "--revoke", "--scope", "site.home"])).toBe(2);
    });

    it("unknown flag", () => {
      writeRegistry(baseRegistry());
      expect(mainApproveCommand([registryPath(), "site.home.title", "--by", "owner", "--nonsense"])).toBe(2);
    });

    it("duplicate entry ids are deduplicated, not an error", () => {
      writeRegistry(baseRegistry());
      const code = mainApproveCommand([
        registryPath(),
        "site.home.title",
        "site.home.title",
        "--by",
        "owner",
      ]);
      expect(code).toBe(0);
      expect(console.log).toHaveBeenCalledTimes(1);
    });
  });

  it("--help prints usage and returns 0 without touching any file", () => {
    expect(mainApproveCommand(["--help"])).toBe(0);
    expect(existsSync(registryPath())).toBe(false);
  });
});
