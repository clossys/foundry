import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { COPY_FINGERPRINT_ALGORITHM, computeCopyFingerprint, createCopyResolver } from "@clossys/writer";
import { createRouteStudioLabels, readRouteStudioLabel, ROUTE_STUDIO_COPY_REFS } from "./route-labels.js";
import type { RouteStudioCopyKey } from "./route-labels.js";
import type { StudioCopyBinding } from "./copy-binding.js";

const packetPath = "packages/writer/src/catalog/records/admin-voice.r1.en.json";
const root = [process.cwd(), resolve(process.cwd(), "../..")].find(path => existsSync(resolve(path, packetPath)))!;
const bytes = readFileSync(resolve(root, packetPath), "utf8");
const packet = JSON.parse(bytes) as {
  state: string; activation: string; locale: string;
  records: { id: string; text: string; status: "draft"; args?: { name: string; type: string }[] }[];
  reviews: { recordId: string; source: { path: string; key?: string } }[];
  externalRecords: { recordId: string; source: string }[];
};
// Shared labels moved to the common-labels packet; its usage rows map each admin-voice
// review's legacy record id to the canonical record the runtime refs bind.
const commonPath = "packages/writer/src/catalog/records/common-labels.r1.en.json";
const common = JSON.parse(readFileSync(resolve(root, commonPath), "utf8")) as {
  usages: { recordId: string; legacyRecordId: string; source: string }[];
};
const canonicalId = new Map(common.usages.filter(row => row.source === "records/admin-voice.r1.en.json").map(row => [row.legacyRecordId, row.recordId]));
// Review rows pin the source key at their reviewed commit; the themes layer rename (736153e72)
// renamed this usage key after its review, keeping the reviewed record.
const renamedKey: Readonly<Record<string, string>> = { "usage.layer.tokens": "usage.layer.themes" };
const terminology = JSON.parse(readFileSync(resolve(root, "packages/writer/src/catalog/admin-terminology.json"), "utf8")) as { terms: { avoid: string[] }[] };
const expected = Object.fromEntries(packet.reviews.flatMap(row => {
  const { path, key } = row.source;
  if (path.endsWith("/route-labels.ts")) return [[key!.slice("routeStudioLabels.".length), row.recordId]];
  if (key?.startsWith("DEFAULT_USAGE_LABELS.")) return [[`usage.${key.slice("DEFAULT_USAGE_LABELS.".length)}`, row.recordId]];
  if (path.endsWith("/DesignerRoutePage.tsx")) return [[`route.${key}`, row.recordId]];
  return [];
}).map(([key, id]) => [renamedKey[key!] ?? key, canonicalId.get(id!) ?? id]));
type VoiceRecord = (typeof packet.records)[number];
// The packet names each record it reuses from another Writer packet in externalRecords.
const external = packet.externalRecords.map(row => {
  const source = JSON.parse(readFileSync(resolve(root, "packages/writer/src/catalog/records", row.source), "utf8")) as { records?: VoiceRecord[]; locales?: Record<string, { records: VoiceRecord[] }> };
  const record = (source.records ?? source.locales?.[packet.locale]?.records ?? []).find(candidate => candidate.id === row.recordId);
  if (!record) throw new Error(`external record ${row.recordId} is missing from ${row.source}`);
  return record;
});
const records = new Map([...external, ...packet.records].map(record => [record.id, record]));
const valuesFor = (id: string) => Object.fromEntries((records.get(id)!.args ?? []).map(arg => [arg.name, ["number", "plural", "selectordinal"].includes(arg.type) ? 2 : "Example"]));
const fixtureAt = "2026-10-01T00:00:00.000Z";
// Test-only owner-approved snapshots exercise Writer's actual formatter. Authored drafts remain untouched.
const registry = {
  id: "voice-binding-fixture", locale: "en", revision: "r1",
  source: { kind: "consumer" as const, reference: "voice binding fixture" },
  // Shared common labels bind several keys to one record; a registry lists each record once.
  entries: [...new Set(Object.values(expected))].map(id => {
    const record = records.get(id)!;
    return { id, text: record.text, context: "Voice binding fixture", placeholders: (record.args ?? []).map(arg => arg.name), status: "approved" as const,
      approval: { approvedBy: "owner" as const, approvedAt: fixtureAt, textFingerprint: computeCopyFingerprint(record.text), fingerprintAlgorithm: COPY_FINGERPRINT_ALGORITHM } };
  }),
};
const copy: StudioCopyBinding = { locale: "en", resolver: createCopyResolver(registry, { now: new Date(fixtureAt) }) };
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function assertVoiceMap(map: Readonly<Record<string, unknown>>) {
  expect(Object.keys(map).sort()).toEqual(Object.keys(expected).sort());
  for (const [key, ref] of Object.entries(map)) {
    expect(ref, `${key} must be a CopyRef, never literal copy`).toEqual({ id: expected[key] });
    expect(ref).toHaveProperty("id", expect.stringMatching(/^st\.[0123456789abcdefghjkmnpqrstvwxyz]{10}$/));
    expect(records.has((ref as { id: string }).id), key).toBe(true);
  }
}

describe("exported Studio admin-voice bindings", () => {
  it("binds every Studio/console label to a valid admin-voice CopyRef", () => {
    assertVoiceMap(ROUTE_STUDIO_COPY_REFS);
    expect(Object.keys(expected)).toHaveLength(149);
    expect(createRouteStudioLabels.refs).toBe(ROUTE_STUDIO_COPY_REFS);
    expect(Object.isFrozen(ROUTE_STUDIO_COPY_REFS)).toBe(true);
    for (const ref of Object.values(ROUTE_STUDIO_COPY_REFS)) expect(Object.isFrozen(ref)).toBe(true);
  });

  it("resolves every binding through Writer with zero avoid-terms and leaves drafts unchanged", () => {
    for (const [key, ref] of Object.entries(ROUTE_STUDIO_COPY_REFS)) {
      const text = readRouteStudioLabel(copy, key as RouteStudioCopyKey, valuesFor(ref.id));
      expect(text.trim(), key).not.toBe("");
      for (const term of terminology.terms.flatMap(row => row.avoid)) expect(text, `${key}: ${term}`).not.toMatch(new RegExp(`\\b${escape(term)}\\b`, "i"));
    }
    const labels = createRouteStudioLabels(copy);
    expect(labels.system.identity).toBe("Details");
    expect(labels.memberCount(2)).toBe("2 options");
    expect(labels.canvas.zoom(125)).toBe("125%");
    expect(labels.usage.count(2)).toBe("2");
    expect(packet.state).toBe("draft"); expect(packet.activation).toBe("none");
    expect(packet.records.every(record => record.status === "draft")).toBe(true);
    expect(readFileSync(resolve(root, packetPath), "utf8")).toBe(bytes);
  });

  it("exposes the same map through the existing public factory export", async () => {
    const publicApi = await import("@clossys/designer/studio");
    expect(publicApi.createRouteStudioLabels.refs).toEqual(ROUTE_STUDIO_COPY_REFS);
  });

  it("rejects a literal substituted for one binding", () => {
    expect(() => assertVoiceMap({ ...ROUTE_STUDIO_COPY_REFS, "system.identity": "Details" })).toThrow();
  });
});
