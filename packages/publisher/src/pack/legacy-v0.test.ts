import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { importLegacyV0Pack, LEGACY_V0_PACK_ITEMS, writeLegacyV0PackImport } from "./legacy-v0.js";
import { validatePackManifest } from "./validate.js";

const TIMEOUT = { timeout: 10_000 };
const KEYS = ["brief", "brandKit", "voice", "shareCard", "email", "website"] as const;

type Item = Record<string, unknown>;

function pack(overrides: Partial<Record<(typeof KEYS)[number], Item>> = {}): Record<string, unknown> {
  const items: Record<string, Item> = {};
  for (const key of KEYS) items[key] = { status: "draft", iteration: "v0", ...overrides[key] };
  return { items };
}

function refusedPaths(value: unknown): string[] {
  const result = importLegacyV0Pack(value);
  if (result.ok) throw new Error("expected a refusal");
  return result.issues.map((issue) => issue.path);
}

function importOk(value: unknown) {
  const result = importLegacyV0Pack(value);
  if (!result.ok) throw new Error(`expected an import, got ${JSON.stringify(result.issues)}`);
  return result.manifest;
}

describe("importLegacyV0Pack", () => {
  it("maps each v0 status", TIMEOUT, () => {
    const manifest = importOk(
      pack({
        brief: { status: "approved", approvedAt: "2026-09-20", updated: "2026-09-20" },
        brandKit: { status: "delegated", updated: "2026-09-21" },
        voice: { status: "draft" },
      }),
    );
    const byId = new Map(manifest.items.map((item) => [item.id, item]));
    expect(byId.get("strategy-brief")?.status).toBe("kept");
    expect(byId.get("brand-kit")?.status).toBe("in-review");
    expect(byId.get("voice")?.status).toBe("draft");
    expect(manifest.items.some((item) => item.status === "published")).toBe(false);
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.items.map((item) => item.id)).toEqual(LEGACY_V0_PACK_ITEMS.map((entry) => entry.id));
    expect(validatePackManifest(manifest)).toEqual({ exitCode: 0, findings: [] });

    const brief = byId.get("strategy-brief");
    expect(brief).toMatchObject({
      condition: "current",
      version: "v0.1",
      createdAt: null,
      updatedAt: "2026-09-20T00:00:00Z",
      approvedAt: "2026-09-20T00:00:00Z",
      verifiedAt: null,
      sourcePins: [],
      outputPaths: [],
      publishedTo: [],
      nextAction: null,
    });
  });

  it("drops notes and ignores other top-level keys", TIMEOUT, () => {
    const value = { ...pack({ brief: { status: "draft", notes: "remember the launch copy" } }), title: "ignored" };
    const manifest = importOk(value);
    expect(JSON.stringify(manifest)).not.toContain("remember");
    expect(JSON.stringify(manifest)).not.toContain("ignored");
  });

  it("approval is never invented", TIMEOUT, () => {
    expect(refusedPaths(pack({ brief: { status: "approved", updated: "2026-09-20" } }))).toEqual(["items.brief.approvedAt"]);
    expect(refusedPaths(pack({ brief: { status: "draft", approvedAt: "2026-09-20" } }))).toEqual(["items.brief.approvedAt"]);
    expect(refusedPaths(pack({ voice: { status: "delegated", approvedAt: "2026-09-20" } }))).toEqual(["items.voice.approvedAt"]);
    expect(importOk(pack({ brief: { status: "approved", approvedAt: "2026-09-20" } })).items[0]?.approvedAt).toBe("2026-09-20T00:00:00Z");
  });

  it("timestamps normalize or refuse", TIMEOUT, () => {
    const manifest = importOk(pack({ brief: { status: "draft", updated: "2026-09-26" }, voice: { status: "draft", updated: "2026-09-26T08:30:00Z" }, email: { status: "draft", updated: "2026-09-26T08:30:00.250Z" } }));
    const updated = manifest.items.map((item) => item.updatedAt);
    expect(updated[0]).toBe("2026-09-26T00:00:00Z");
    expect(updated[2]).toBe("2026-09-26T08:30:00Z");
    expect(updated[4]).toBe("2026-09-26T08:30:00.250Z");
    expect(updated[1]).toBeNull();

    for (const bad of ["2026-02-30", "26/09/2026", "2026-09-26T08:30:00+02:00", "2026-09-26T25:00:00Z", "2026-13-01", "", "2026-9-26", 20260926]) {
      expect(refusedPaths(pack({ brief: { status: "draft", updated: bad } })), String(bad)).toEqual(["items.brief.updated"]);
    }
    expect(refusedPaths(pack({ brief: { status: "approved", approvedAt: "2026-09-26T08:30:00+02:00" } }))).toEqual(["items.brief.approvedAt"]);
  });

  it("item table is fixed", TIMEOUT, () => {
    expect(LEGACY_V0_PACK_ITEMS).toEqual([
      { key: "brief", id: "strategy-brief", layer: "foundation", owner: "strategist", visibility: "internal", needs: [] },
      { key: "brandKit", id: "brand-kit", layer: "identity", owner: "designer", visibility: "internal", needs: ["strategy-brief"] },
      { key: "voice", id: "voice", layer: "identity", owner: "writer", visibility: "internal", needs: ["strategy-brief"] },
      { key: "shareCard", id: "share-card", layer: "surface", owner: "publisher", visibility: "public", needs: ["brand-kit", "voice"] },
      { key: "email", id: "notification-email", layer: "surface", owner: "publisher", visibility: "internal", needs: ["brand-kit", "voice"] },
      { key: "website", id: "website", layer: "surface", owner: "publisher", visibility: "public", needs: ["brand-kit", "voice"] },
    ]);
    const manifest = importOk(pack());
    for (const entry of LEGACY_V0_PACK_ITEMS) {
      expect(manifest.items.find((item) => item.id === entry.id)).toMatchObject({ layer: entry.layer, owner: entry.owner, visibility: entry.visibility, needs: entry.needs });
    }
  });

  it("unknown shape refused by path", TIMEOUT, () => {
    const secretLooking = "zz-value-that-must-not-echo";

    const missing = pack() as { items: Record<string, unknown> };
    delete missing.items.website;
    expect(refusedPaths(missing)).toEqual(["items.website"]);

    const extra = pack() as { items: Record<string, unknown> };
    extra.items.newsletter = { status: "draft", iteration: "v0" };
    expect(refusedPaths(extra)).toEqual(["items.newsletter"]);

    expect(refusedPaths(pack({ email: { status: "draft", extra: secretLooking } }))).toEqual(["items.email.extra"]);
    expect(refusedPaths(pack({ email: { status: "live" } }))).toEqual(["items.email.status"]);
    expect(refusedPaths(pack({ email: { status: "published" } }))).toEqual(["items.email.status"]);
    expect(refusedPaths(pack({ email: { iteration: "v1" } }))).toEqual(["items.email.iteration"]);
    expect(refusedPaths(pack({ email: { iteration: undefined } }))).toEqual(["items.email.iteration"]);
    expect(refusedPaths(pack({ email: { notes: 7 } }))).toEqual(["items.email.notes"]);

    for (const bad of [null, undefined, 3, "text", [], { items: null }, { items: [] }, { items: "x" }]) {
      expect(refusedPaths(bad)).toHaveLength(1);
    }
    expect(refusedPaths({ items: { ...(pack().items as object), brief: "draft" } })).toEqual(["items.brief"]);

    for (const value of [
      { ...(pack() as object), items: { ...(pack().items as object), email: { status: secretLooking, iteration: "v0" } } },
      { ...(pack() as object), items: { ...(pack().items as object), email: { status: "draft", iteration: "v0", [secretLooking]: 1 } } },
      pack({ email: { status: "draft", updated: secretLooking } }),
      pack({ email: { status: "draft", iteration: secretLooking } }),
    ]) {
      const result = importLegacyV0Pack(value);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.length).toBeGreaterThan(0);
        for (const issue of result.issues) expect(issue.message).not.toContain(secretLooking);
        expect(JSON.stringify(result.issues.map((issue) => issue.message))).not.toContain(secretLooking);
      }
    }
  });

  it("refuses what validatePackManifest refuses", TIMEOUT, () => {
    const paths = refusedPaths(pack({ brief: { status: "approved", approvedAt: "2026-09-20", updated: "2026-09-25" } }));
    expect(paths).toEqual(["items.brief"]);
    const result = importLegacyV0Pack(pack({ brief: { status: "approved", approvedAt: "2026-09-20", updated: "2026-09-25" } }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.message).toContain("timestamp-order");
  });
});

describe("writeLegacyV0PackImport", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });
  function tempRoot(): string {
    const root = mkdtempSync(join(tmpdir(), "foundry-publisher-legacy-v0-"));
    roots.push(root);
    return root;
  }

  it("writes pack.json once", TIMEOUT, async () => {
    const root = tempRoot();
    const value = pack({ brief: { status: "approved", approvedAt: "2026-09-20", updated: "2026-09-20" } });
    const target = join(root, "clossys", "publisher", "pack.json");

    const first = await writeLegacyV0PackImport(root, value);
    expect(first.ok).toBe(true);
    const manifest = importOk(value);
    const expected = `${JSON.stringify(manifest, null, 2)}\n`;
    expect(readFileSync(target, "utf8")).toBe(expected);
    expect(expected.endsWith("}\n")).toBe(true);
    expect(validatePackManifest(JSON.parse(expected))).toEqual({ exitCode: 0, findings: [] });

    const second = await writeLegacyV0PackImport(root, pack());
    expect(second.ok).toBe(false);
    expect(readFileSync(target, "utf8")).toBe(expected);

    const other = tempRoot();
    const refused = await writeLegacyV0PackImport(other, pack({ brief: { status: "approved" } }));
    expect(refused.ok).toBe(false);
    expect(existsSync(join(other, "clossys"))).toBe(false);
  });

  it("leaves an existing file untouched, whatever it holds", TIMEOUT, async () => {
    const root = tempRoot();
    const dir = join(root, "clossys", "publisher");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "pack.json"), "hand-edited\n");
    const result = await writeLegacyV0PackImport(root, pack());
    expect(result.ok).toBe(false);
    expect(readFileSync(join(dir, "pack.json"), "utf8")).toBe("hand-edited\n");
  });
});
