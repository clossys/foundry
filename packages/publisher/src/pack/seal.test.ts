import { describe, expect, it } from "vitest";
import type { PublicationMap } from "../core/publication-map.js";
import type { Ledger } from "../record/types.js";
import { validateLedger } from "../record/schema.js";
import { checkSealEvidence, sealWebsite, type SealFinding } from "./seal.js";
import { sealableItemIds } from "./readiness.js";
import type { PackItem, PackManifest } from "./types.js";
import { validatePackManifest } from "./validate.js";

const TIMEOUT = { timeout: 10_000 };

const NOW = "2026-09-30T12:00:00Z";
const COMMIT = "b".repeat(40);
const OTHER_COMMIT = "c".repeat(40);
const DIGEST = "a".repeat(64);
const PRODUCTION_URL = "https://www.example.test/";
const STRATEGY_REVISION = "strategy-rev-1";

const MAP: PublicationMap = {
  entries: [
    { id: "home", template: "landing", documentId: "doc-home", location: { kind: "path", path: "/" } },
    { id: "contact", template: "contact", documentId: "doc-contact", location: { kind: "path", path: "/contact" } },
  ],
};

function page(path: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { path, status: 200, servedCommit: COMMIT, desktopDigest: DIGEST, mobileDigest: DIGEST, ...overrides };
}

function evidence(overrides: Record<string, unknown> = {}): Record<string, any> {
  return {
    schemaVersion: 1,
    commit: COMMIT,
    observedAt: "2026-09-30T11:00:00Z",
    delivery: { state: "ready", deployedCommit: COMMIT, productionUrl: PRODUCTION_URL },
    pages: [page("/"), page("/contact")],
    contactIntake: { kind: "present", path: "/contact", submissionDigest: DIGEST },
    ...overrides,
  };
}

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

function manifest(): PackManifest {
  return {
    schemaVersion: 1,
    items: [
      item({ id: "strategy-brief", layer: "foundation", owner: "strategist", visibility: "internal", status: "published", verifiedAt: "2026-09-04T00:00:00Z", publishedTo: ["internal"] }),
      item({ id: "website", needs: ["strategy-brief"] }),
      item({ id: "materials-site", visibility: "internal", needs: ["strategy-brief"] }),
      item({ id: "email-kit", needs: ["website"] }),
    ],
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
    Object.freeze(value);
  }
  return value;
}

function rulesAt(findings: readonly SealFinding[]): string[] {
  return findings.map((finding) => `${finding.rule}@${finding.path}`);
}

function refusal(result: ReturnType<typeof sealWebsite>): SealFinding[] {
  if (result.ok) throw new Error("expected a refusal");
  return [...result.findings];
}

function seal(overrides: Partial<Parameters<typeof sealWebsite>[0]> = {}) {
  return sealWebsite({
    manifest: manifest(),
    ledger: [],
    itemId: "website",
    evidence: evidence(),
    map: MAP,
    now: NOW,
    strategyRevision: STRATEGY_REVISION,
    ...overrides,
  });
}

describe("checkSealEvidence", () => {
  it("accepts complete, current evidence", TIMEOUT, () => {
    expect(checkSealEvidence(evidence(), { map: MAP, now: NOW })).toEqual([]);
  });

  it("stale or missing pages refused", TIMEOUT, () => {
    const stalePage = evidence({ pages: [page("/"), page("/contact", { servedCommit: OTHER_COMMIT })] });
    expect(rulesAt(checkSealEvidence(stalePage, { map: MAP, now: NOW }))).toEqual(["page-commit-mismatch@pages[1].servedCommit"]);

    const staleDeploy = evidence({ delivery: { state: "ready", deployedCommit: OTHER_COMMIT, productionUrl: PRODUCTION_URL } });
    expect(rulesAt(checkSealEvidence(staleDeploy, { map: MAP, now: NOW }))).toEqual(["delivery-commit-mismatch@delivery.deployedCommit"]);

    const missingPage = evidence({ pages: [page("/")] });
    expect(rulesAt(checkSealEvidence(missingPage, { map: MAP, now: NOW }))).toEqual(["page-missing@map.paths[1]"]);

    const failingPage = evidence({ pages: [page("/"), page("/contact", { status: 500 })] });
    expect(rulesAt(checkSealEvidence(failingPage, { map: MAP, now: NOW }))).toEqual(["page-status@pages[1].status"]);

    const notReady = evidence({ delivery: { state: "building", deployedCommit: COMMIT, productionUrl: PRODUCTION_URL } });
    expect(rulesAt(checkSealEvidence(notReady, { map: MAP, now: NOW }))).toEqual(["delivery-not-ready@delivery.state"]);
  });

  it("refuses a page that is not exactly status 200", TIMEOUT, () => {
    for (const status of [204, 301, 404, "200", null]) {
      const found = checkSealEvidence(evidence({ pages: [page("/"), page("/contact", { status })] }), { map: MAP, now: NOW });
      expect(rulesAt(found), `status ${String(status)}`).toEqual(["page-status@pages[1].status"]);
    }
  });

  it("refuses a commit that is not 40 lowercase hex, and any digest that is not sha256 hex", TIMEOUT, () => {
    expect(rulesAt(checkSealEvidence(evidence({ commit: "abc123" }), { map: MAP, now: NOW }))).toContain("commit-shape@commit");
    for (const field of ["desktopDigest", "mobileDigest"]) {
      for (const bad of ["a".repeat(63), "A".repeat(64), "g".repeat(64), 7, null]) {
        const found = checkSealEvidence(evidence({ pages: [page("/"), page("/contact", { [field]: bad })] }), { map: MAP, now: NOW });
        expect(rulesAt(found), `${field} ${String(bad)}`).toEqual([`page-digest-shape@pages[1].${field}`]);
      }
    }
  });

  it("refuses observedAt in the future or more than 24 hours old, and accepts exactly 24 hours", TIMEOUT, () => {
    expect(rulesAt(checkSealEvidence(evidence({ observedAt: "2026-09-30T12:00:01Z" }), { map: MAP, now: NOW }))).toEqual(["observed-at-future@observedAt"]);
    expect(rulesAt(checkSealEvidence(evidence({ observedAt: "2026-09-29T11:59:59Z" }), { map: MAP, now: NOW }))).toEqual(["observed-at-stale@observedAt"]);
    expect(checkSealEvidence(evidence({ observedAt: "2026-09-29T12:00:00Z" }), { map: MAP, now: NOW })).toEqual([]);
    expect(checkSealEvidence(evidence({ observedAt: NOW }), { map: MAP, now: NOW })).toEqual([]);
    expect(rulesAt(checkSealEvidence(evidence({ observedAt: "yesterday" }), { map: MAP, now: NOW }))).toEqual(["observed-at-shape@observedAt"]);
  });

  it("refuses a production URL that is not https", TIMEOUT, () => {
    for (const productionUrl of ["http://www.example.test/", "not a url", "", 7]) {
      const found = checkSealEvidence(evidence({ delivery: { state: "ready", deployedCommit: COMMIT, productionUrl } }), { map: MAP, now: NOW });
      expect(rulesAt(found), `url ${String(productionUrl)}`).toEqual(["production-url-shape@delivery.productionUrl"]);
    }
  });

  it("fails closed on an empty publication map and never throws on malformed input", TIMEOUT, () => {
    expect(rulesAt(checkSealEvidence(evidence(), { map: { entries: [] }, now: NOW }))).toEqual(["map-empty@map.paths"]);
    const slideOnly: PublicationMap = { entries: [{ id: "s", template: "deck", documentId: "d", location: { kind: "slide", index: 0 } }] };
    expect(rulesAt(checkSealEvidence(evidence(), { map: slideOnly, now: NOW }))).toEqual(["map-empty@map.paths"]);

    for (const bad of [null, undefined, "evidence", 7, [], {}, { schemaVersion: 2 }]) {
      const found = checkSealEvidence(bad, { map: MAP, now: NOW });
      expect(found.length, String(bad)).toBeGreaterThan(0);
    }
    expect(() => checkSealEvidence(evidence({ pages: "nope", delivery: null }), { map: MAP, now: NOW })).not.toThrow();
    expect(() => checkSealEvidence(evidence(), { map: null as never, now: NOW })).not.toThrow();
    expect(rulesAt(checkSealEvidence(evidence(), { map: null as never, now: NOW }))).toContain("map-shape@map");
    expect(rulesAt(checkSealEvidence(evidence(), { map: MAP, now: "later" }))).toContain("now-invalid@now");
  });

  it("intake explicit", TIMEOUT, () => {
    const withoutIntake = evidence();
    delete withoutIntake.contactIntake;
    expect(rulesAt(checkSealEvidence(withoutIntake, { map: MAP, now: NOW }))).toEqual(["contact-intake-missing@contactIntake"]);
    expect(rulesAt(checkSealEvidence(evidence({ contactIntake: null }), { map: MAP, now: NOW }))).toEqual(["contact-intake-missing@contactIntake"]);

    for (const reason of ["", "   "]) {
      const found = checkSealEvidence(evidence({ contactIntake: { kind: "none", reason } }), { map: MAP, now: NOW });
      expect(rulesAt(found), `reason ${JSON.stringify(reason)}`).toEqual(["contact-intake-reason-empty@contactIntake.reason"]);
    }
    expect(rulesAt(checkSealEvidence(evidence({ contactIntake: { kind: "none" } }), { map: MAP, now: NOW }))).toEqual(["contact-intake-reason-empty@contactIntake.reason"]);

    expect(checkSealEvidence(evidence({ contactIntake: { kind: "none", reason: "the site has no contact form" } }), { map: MAP, now: NOW })).toEqual([]);
    expect(checkSealEvidence(evidence({ contactIntake: { kind: "present", path: "/contact", submissionDigest: DIGEST } }), { map: MAP, now: NOW })).toEqual([]);

    expect(rulesAt(checkSealEvidence(evidence({ contactIntake: { kind: "present", path: "/contact", submissionDigest: "nope" } }), { map: MAP, now: NOW }))).toEqual([
      "contact-intake-digest-shape@contactIntake.submissionDigest",
    ]);
    expect(rulesAt(checkSealEvidence(evidence({ contactIntake: { kind: "present", path: "", submissionDigest: DIGEST } }), { map: MAP, now: NOW }))).toEqual([
      "contact-intake-path-shape@contactIntake.path",
    ]);
    expect(rulesAt(checkSealEvidence(evidence({ contactIntake: { kind: "maybe" } }), { map: MAP, now: NOW }))).toEqual(["contact-intake-shape@contactIntake.kind"]);
  });

  it("offers no waiver: an extra flag in the evidence or the options changes nothing", TIMEOUT, () => {
    const stale = evidence({ waive: true, force: true, pages: [page("/"), page("/contact", { servedCommit: OTHER_COMMIT, waive: true })] });
    expect(checkSealEvidence(stale, { map: MAP, now: NOW, waive: true, force: true } as never).length).toBeGreaterThan(0);
  });
});

describe("sealWebsite", () => {
  it("accepted seal", TIMEOUT, () => {
    const inputManifest = deepFreeze(manifest());
    const inputLedger: Ledger = deepFreeze([]);
    const inputEvidence = deepFreeze(evidence());
    const inputMap = deepFreeze(structuredClone(MAP));
    const before = JSON.stringify([inputManifest, inputLedger, inputEvidence, inputMap]);

    const result = sealWebsite({ manifest: inputManifest, ledger: inputLedger, itemId: "website", evidence: inputEvidence, map: inputMap, now: NOW, strategyRevision: STRATEGY_REVISION });
    if (!result.ok) throw new Error(`expected a seal, got ${JSON.stringify(result.findings)}`);

    const sealed = result.manifest.items.find((candidate) => candidate.id === "website");
    expect(sealed).toMatchObject({ status: "published", verifiedAt: NOW, publishedTo: [PRODUCTION_URL] });
    expect(result.manifest.items.filter((candidate) => candidate.id !== "website")).toEqual(inputManifest.items.filter((candidate) => candidate.id !== "website"));
    expect(validatePackManifest(result.manifest)).toEqual({ exitCode: 0, findings: [] });

    expect(result.ledger).toHaveLength(1);
    expect(result.ledger[0]).toEqual({
      id: `website-website-${COMMIT.slice(0, 12)}`,
      publishedAt: NOW,
      channel: "web",
      url: PRODUCTION_URL,
      strategyRevision: STRATEGY_REVISION,
      factCitations: [],
    });
    expect(validateLedger(result.ledger).filter((finding) => finding.severity === "error")).toEqual([]);

    expect(JSON.stringify([inputManifest, inputLedger, inputEvidence, inputMap])).toBe(before);
    expect(inputLedger).toHaveLength(0);
    expect(result.manifest).not.toBe(inputManifest);
  });

  it("seals on top of an existing ledger without touching earlier entries", TIMEOUT, () => {
    const first = seal();
    if (!first.ok) throw new Error("expected a seal");
    const secondManifest = manifest();
    secondManifest.items[1] = item({ id: "website", needs: ["strategy-brief"] });
    const other = sealWebsite({
      manifest: secondManifest,
      ledger: first.ledger,
      itemId: "website",
      evidence: evidence({ commit: OTHER_COMMIT, delivery: { state: "ready", deployedCommit: OTHER_COMMIT, productionUrl: PRODUCTION_URL }, pages: [page("/", { servedCommit: OTHER_COMMIT }), page("/contact", { servedCommit: OTHER_COMMIT })] }),
      map: MAP,
      now: NOW,
      strategyRevision: STRATEGY_REVISION,
    });
    if (!other.ok) throw new Error(`expected a seal, got ${JSON.stringify(other.findings)}`);
    expect(other.ledger).toHaveLength(2);
    expect(other.ledger[0]).toBe(first.ledger[0]);
    expect(other.ledger[1]?.id).toBe(`website-website-${OTHER_COMMIT.slice(0, 12)}`);
  });

  it("the same commit sealed again is seal-already-recorded", TIMEOUT, () => {
    const first = seal();
    if (!first.ok) throw new Error("expected a seal");
    const again = refusal(seal({ ledger: first.ledger }));
    expect(rulesAt(again)).toEqual(["seal-already-recorded@ledger"]);
    // Against the sealed manifest the item is no longer sealable either.
    const afterwards = refusal(seal({ manifest: first.manifest, ledger: first.ledger }));
    expect(rulesAt(afterwards)).toContain("seal-already-recorded@ledger");
    expect(rulesAt(afterwards)).toContain("item-not-sealable@itemId");
  });

  it("refuses without returning a partial manifest or ledger", TIMEOUT, () => {
    const result = seal({ evidence: evidence({ pages: [page("/")] }) });
    expect(result.ok).toBe(false);
    expect(Object.keys(result).sort()).toEqual(["findings", "ok"]);
  });

  it("refuses an item outside sealableItemIds, or one that is not public", TIMEOUT, () => {
    const all = manifest();
    expect(sealableItemIds(all)).toEqual(["website", "materials-site"]);

    // Kept and sealable, but internal: never sealed as a website.
    expect(rulesAt(refusal(seal({ itemId: "materials-site" })))).toEqual(["item-not-public@itemId"]);
    // Public and kept, but its need is not yet published.
    expect(rulesAt(refusal(seal({ itemId: "email-kit" })))).toEqual(["item-not-sealable@itemId"]);
    // Already published.
    expect(rulesAt(refusal(seal({ itemId: "strategy-brief" })))).toEqual(["item-not-sealable@itemId"]);
    // Not in the manifest at all.
    expect(rulesAt(refusal(seal({ itemId: "no-such-item" })))).toEqual(["item-not-sealable@itemId"]);

    const blocked = manifest();
    blocked.items[1] = item({ id: "website", needs: ["strategy-brief"], condition: "blocked" });
    expect(rulesAt(refusal(seal({ manifest: blocked })))).toEqual(["item-not-sealable@itemId"]);
  });

  it("no echo: a finding holds a rule and a path, never a value from the input", TIMEOUT, () => {
    const markerUrl = "http://marker-url.example.test/leak";
    const markerDigest = "marker-digest-leak";
    const markerCommit = "d".repeat(40);
    const markerPath = "/marker-path-leak";
    const markerRevision = "marker-revision-leak";
    const bad = evidence({
      commit: markerCommit,
      delivery: { state: "building", deployedCommit: "e".repeat(40), productionUrl: markerUrl },
      pages: [page("/", { desktopDigest: markerDigest, servedCommit: "f".repeat(40) }), page(markerPath, { status: 503, mobileDigest: markerDigest })],
      contactIntake: { kind: "none", reason: "" },
    });
    const refusedSeal = refusal(seal({ evidence: bad, itemId: "marker-item-leak", strategyRevision: markerRevision }));
    const refusedCheck = checkSealEvidence(bad, { map: MAP, now: NOW });
    expect(refusedSeal.length).toBeGreaterThan(5);

    const text = JSON.stringify([refusedSeal, refusedCheck]);
    for (const marker of [markerUrl, "marker-url", markerDigest, markerCommit, "e".repeat(40), "f".repeat(40), markerPath, "marker-item-leak", "building"]) {
      expect(text, marker).not.toContain(marker);
    }
    for (const finding of [...refusedSeal, ...refusedCheck]) {
      expect(Object.keys(finding).sort()).toEqual(["path", "rule"]);
    }

    // A reason that is present and valid is also never echoed, even when another check refuses.
    const validReason = evidence({ contactIntake: { kind: "none", reason: "marker-reason-leak" }, pages: [page("/")] });
    expect(JSON.stringify(checkSealEvidence(validReason, { map: MAP, now: NOW }))).not.toContain("marker-reason-leak");
  });

  it("refuses a bad now, an empty strategy revision, an invalid manifest or ledger, and a now before approval", TIMEOUT, () => {
    expect(rulesAt(refusal(seal({ now: "later" })))).toContain("now-invalid@now");
    expect(rulesAt(refusal(seal({ strategyRevision: "" })))).toEqual(["strategy-revision-invalid@strategyRevision"]);
    expect(rulesAt(refusal(seal({ manifest: { schemaVersion: 1, items: "nope" } as never })))).toContain("manifest-invalid@manifest");
    expect(rulesAt(refusal(seal({ manifest: null as never })))).toContain("manifest-invalid@manifest");
    expect(rulesAt(refusal(seal({ ledger: "nope" as never })))).toContain("ledger-invalid@ledger");
    expect(rulesAt(refusal(seal({ map: null as never })))).toContain("map-shape@map");
    // verifiedAt would land before approvedAt, which validatePackManifest rejects.
    expect(rulesAt(refusal(seal({ now: "2026-09-02T00:00:00Z", evidence: evidence({ observedAt: "2026-09-02T00:00:00Z" }) })))).toEqual(["manifest-invalid@manifest"]);
  });
});
