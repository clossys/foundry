import { describe, expect, it } from "vitest";
import type { PublicationMap } from "../core/publication-map.js";
import { citeFact } from "../record/fact.js";
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
    itemId: "website",
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
    evidence: evidence({ itemId: overrides.itemId ?? "website" }),
    map: MAP,
    now: NOW,
    strategyRevision: STRATEGY_REVISION,
    ...overrides,
  });
}

describe("checkSealEvidence", () => {
  it("accepts complete, current evidence", TIMEOUT, () => {
    expect(checkSealEvidence(evidence(), { map: MAP, now: NOW, itemId: "website" })).toEqual([]);
  });

  it("stale or missing pages refused", TIMEOUT, () => {
    const stalePage = evidence({ pages: [page("/"), page("/contact", { servedCommit: OTHER_COMMIT })] });
    expect(rulesAt(checkSealEvidence(stalePage, { map: MAP, now: NOW, itemId: "website" }))).toEqual(["page-commit-mismatch@pages[1].servedCommit"]);

    const staleDeploy = evidence({ delivery: { state: "ready", deployedCommit: OTHER_COMMIT, productionUrl: PRODUCTION_URL } });
    expect(rulesAt(checkSealEvidence(staleDeploy, { map: MAP, now: NOW, itemId: "website" }))).toEqual(["delivery-commit-mismatch@delivery.deployedCommit"]);

    const missingPage = evidence({ pages: [page("/")] });
    expect(rulesAt(checkSealEvidence(missingPage, { map: MAP, now: NOW, itemId: "website" }))).toEqual(["page-missing@map.paths[1]"]);

    const failingPage = evidence({ pages: [page("/"), page("/contact", { status: 500 })] });
    expect(rulesAt(checkSealEvidence(failingPage, { map: MAP, now: NOW, itemId: "website" }))).toEqual(["page-status@pages[1].status"]);

    const notReady = evidence({ delivery: { state: "building", deployedCommit: COMMIT, productionUrl: PRODUCTION_URL } });
    expect(rulesAt(checkSealEvidence(notReady, { map: MAP, now: NOW, itemId: "website" }))).toEqual(["delivery-not-ready@delivery.state"]);
  });

  it("refuses a page that is not exactly status 200", TIMEOUT, () => {
    for (const status of [204, 301, 404, "200", null]) {
      const found = checkSealEvidence(evidence({ pages: [page("/"), page("/contact", { status })] }), { map: MAP, now: NOW, itemId: "website" });
      expect(rulesAt(found), `status ${String(status)}`).toEqual(["page-status@pages[1].status"]);
    }
  });

  it("refuses a commit that is not 40 lowercase hex, and any digest that is not sha256 hex", TIMEOUT, () => {
    expect(rulesAt(checkSealEvidence(evidence({ commit: "abc123" }), { map: MAP, now: NOW, itemId: "website" }))).toContain("commit-shape@commit");
    for (const field of ["desktopDigest", "mobileDigest"]) {
      for (const bad of ["a".repeat(63), "A".repeat(64), "g".repeat(64), 7, null]) {
        const found = checkSealEvidence(evidence({ pages: [page("/"), page("/contact", { [field]: bad })] }), { map: MAP, now: NOW, itemId: "website" });
        expect(rulesAt(found), `${field} ${String(bad)}`).toEqual([`page-digest-shape@pages[1].${field}`]);
      }
    }
  });

  it("refuses observedAt in the future or more than 24 hours old, and accepts exactly 24 hours", TIMEOUT, () => {
    expect(rulesAt(checkSealEvidence(evidence({ observedAt: "2026-09-30T12:00:01Z" }), { map: MAP, now: NOW, itemId: "website" }))).toEqual(["observed-at-future@observedAt"]);
    expect(rulesAt(checkSealEvidence(evidence({ observedAt: "2026-09-29T11:59:59Z" }), { map: MAP, now: NOW, itemId: "website" }))).toEqual(["observed-at-stale@observedAt"]);
    expect(checkSealEvidence(evidence({ observedAt: "2026-09-29T12:00:00Z" }), { map: MAP, now: NOW, itemId: "website" })).toEqual([]);
    expect(checkSealEvidence(evidence({ observedAt: NOW }), { map: MAP, now: NOW, itemId: "website" })).toEqual([]);
    expect(rulesAt(checkSealEvidence(evidence({ observedAt: "yesterday" }), { map: MAP, now: NOW, itemId: "website" }))).toEqual(["observed-at-shape@observedAt"]);
  });

  it("refuses a production URL that is not https", TIMEOUT, () => {
    for (const productionUrl of ["http://www.example.test/", "not a url", "", 7]) {
      const found = checkSealEvidence(evidence({ delivery: { state: "ready", deployedCommit: COMMIT, productionUrl } }), { map: MAP, now: NOW, itemId: "website" });
      expect(rulesAt(found), `url ${String(productionUrl)}`).toEqual(["production-url-shape@delivery.productionUrl"]);
    }
  });

  it("refuses a production URL that carries credentials: username only, password only, or both", TIMEOUT, () => {
    for (const productionUrl of ["https://marker-user@www.example.test/", "https://:marker-pass@www.example.test/", "https://marker-user:marker-pass@www.example.test/"]) {
      const found = checkSealEvidence(evidence({ delivery: { state: "ready", deployedCommit: COMMIT, productionUrl } }), { map: MAP, now: NOW, itemId: "website" });
      expect(rulesAt(found), "credentialed url").toEqual(["production-url-shape@delivery.productionUrl"]);
      expect(JSON.stringify(found)).not.toContain("marker");
    }
    // A credentialed URL never reaches the ledger or the manifest.
    const refused = refusal(seal({ evidence: evidence({ delivery: { state: "ready", deployedCommit: COMMIT, productionUrl: "https://marker-user:marker-pass@www.example.test/" } }) }));
    expect(rulesAt(refused)).toEqual(["production-url-shape@delivery.productionUrl"]);
    expect(JSON.stringify(refused)).not.toContain("marker");
    // A port, a path, a query and an at sign after the host are not credentials.
    for (const productionUrl of ["https://www.example.test:8443/", "https://www.example.test/a@b?c=d@e"]) {
      expect(checkSealEvidence(evidence({ delivery: { state: "ready", deployedCommit: COMMIT, productionUrl } }), { map: MAP, now: NOW, itemId: "website" }), productionUrl).toEqual([]);
    }
  });

  it("refuses a production URL that is not already in canonical form, even when the parser would read it as harmless", TIMEOUT, () => {
    const spellings: Array<[string, string]> = [
      // The WHATWG parser reads host www.example.test and no userinfo; an RFC 3986 reader sees host evil.test with a password.
      ["backslash before userinfo", "https://www.example.test\\@marker-user:marker-pass@marker-evil.test/"],
      ["empty userinfo", "https://@www.example.test/"],
      ["empty userinfo and password", "https://:@www.example.test/"],
      ["trailing newline", "https://www.example.test/\n"],
      ["trailing carriage return", "https://www.example.test/\r"],
      ["embedded tab", "https://www.example.test/a\tb"],
      ["leading space", " https://www.example.test/"],
      ["trailing space", "https://www.example.test/ "],
      ["uppercase scheme", "HTTPS://www.example.test/"],
      ["uppercase host", "https://WWW.EXAMPLE.TEST/"],
      ["no path", "https://www.example.test"],
      ["default port", "https://www.example.test:443/"],
      ["dot segments", "https://www.example.test/a/../b"],
      ["unencoded space in the path", "https://www.example.test/a b"],
    ];
    for (const [label, productionUrl] of spellings) {
      const delivery = { state: "ready", deployedCommit: COMMIT, productionUrl };
      const found = checkSealEvidence(evidence({ delivery }), { map: MAP, now: NOW, itemId: "website" });
      expect(rulesAt(found), label).toEqual(["production-url-shape@delivery.productionUrl"]);
      expect(JSON.stringify(found), label).not.toContain("marker");
      expect(Object.keys(found[0] as SealFinding).sort(), label).toEqual(["path", "rule"]);

      // Refused as written: nothing reaches a manifest or a ledger.
      const refused = refusal(seal({ evidence: evidence({ delivery }) }));
      expect(rulesAt(refused), label).toEqual(["production-url-shape@delivery.productionUrl"]);
      expect(JSON.stringify(refused), label).not.toContain("marker");
    }
    // The canonical form of each is accepted, and what is written is exactly what was supplied.
    for (const productionUrl of [PRODUCTION_URL, "https://www.example.test/a/b?c=d#e", "https://sub.www.example.test:8443/x/"]) {
      const sealed = seal({ evidence: evidence({ delivery: { state: "ready", deployedCommit: COMMIT, productionUrl } }) });
      if (!sealed.ok) throw new Error(`expected a seal for ${productionUrl}`);
      expect(sealed.ledger[0]?.url).toBe(productionUrl);
      expect(sealed.manifest.items.find((candidate) => candidate.id === "website")?.publishedTo).toEqual([productionUrl]);
    }
  });

  it("checkSealEvidence without an itemId is refused at run time (the option type requires it)", TIMEOUT, () => {
    const withoutItemId = checkSealEvidence(evidence(), { map: MAP, now: NOW } as never);
    expect(rulesAt(withoutItemId)).toContain("item-id-invalid@itemId");
    for (const bad of [undefined, "", "  ", 3, null]) {
      const found = checkSealEvidence(evidence(), { map: MAP, now: NOW, itemId: bad as never });
      expect(rulesAt(found), String(bad)).toContain("item-id-invalid@itemId");
    }
    // Evidence that names no item is still its own finding, and an itemId that is given and matches adds none.
    expect(rulesAt(checkSealEvidence(evidence({ itemId: undefined }), { map: MAP, now: NOW, itemId: "website" }))).toEqual(["evidence-item-shape@itemId"]);
    expect(checkSealEvidence(evidence(), { map: MAP, now: NOW, itemId: "website" })).toEqual([]);
  });

  it("fails closed on an empty publication map and never throws on malformed input", TIMEOUT, () => {
    expect(rulesAt(checkSealEvidence(evidence(), { map: { entries: [] }, now: NOW, itemId: "website" }))).toEqual(["map-empty@map.paths"]);
    const slideOnly: PublicationMap = { entries: [{ id: "s", template: "deck", documentId: "d", location: { kind: "slide", index: 0 } }] };
    expect(rulesAt(checkSealEvidence(evidence(), { map: slideOnly, now: NOW, itemId: "website" }))).toEqual(["map-empty@map.paths"]);

    for (const bad of [null, undefined, "evidence", 7, [], {}, { schemaVersion: 2 }]) {
      const found = checkSealEvidence(bad, { map: MAP, now: NOW, itemId: "website" });
      expect(found.length, String(bad)).toBeGreaterThan(0);
    }
    expect(() => checkSealEvidence(evidence({ pages: "nope", delivery: null }), { map: MAP, now: NOW, itemId: "website" })).not.toThrow();
    expect(() => checkSealEvidence(evidence(), { map: null as never, now: NOW, itemId: "website" })).not.toThrow();
    expect(rulesAt(checkSealEvidence(evidence(), { map: null as never, now: NOW, itemId: "website" }))).toContain("map-shape@map");
    expect(rulesAt(checkSealEvidence(evidence(), { map: MAP, now: "later", itemId: "website" }))).toContain("now-invalid@now");
  });

  it("intake explicit", TIMEOUT, () => {
    const withoutIntake = evidence();
    delete withoutIntake.contactIntake;
    expect(rulesAt(checkSealEvidence(withoutIntake, { map: MAP, now: NOW, itemId: "website" }))).toEqual(["contact-intake-missing@contactIntake"]);
    expect(rulesAt(checkSealEvidence(evidence({ contactIntake: null }), { map: MAP, now: NOW, itemId: "website" }))).toEqual(["contact-intake-missing@contactIntake"]);

    for (const reason of ["", "   "]) {
      const found = checkSealEvidence(evidence({ contactIntake: { kind: "none", reason } }), { map: MAP, now: NOW, itemId: "website" });
      expect(rulesAt(found), `reason ${JSON.stringify(reason)}`).toEqual(["contact-intake-reason-empty@contactIntake.reason"]);
    }
    expect(rulesAt(checkSealEvidence(evidence({ contactIntake: { kind: "none" } }), { map: MAP, now: NOW, itemId: "website" }))).toEqual(["contact-intake-reason-empty@contactIntake.reason"]);

    expect(checkSealEvidence(evidence({ contactIntake: { kind: "none", reason: "the site has no contact form" } }), { map: MAP, now: NOW, itemId: "website" })).toEqual([]);
    expect(checkSealEvidence(evidence({ contactIntake: { kind: "present", path: "/contact", submissionDigest: DIGEST } }), { map: MAP, now: NOW, itemId: "website" })).toEqual([]);

    expect(rulesAt(checkSealEvidence(evidence({ contactIntake: { kind: "present", path: "/contact", submissionDigest: "nope" } }), { map: MAP, now: NOW, itemId: "website" }))).toEqual([
      "contact-intake-digest-shape@contactIntake.submissionDigest",
    ]);
    expect(rulesAt(checkSealEvidence(evidence({ contactIntake: { kind: "present", path: "", submissionDigest: DIGEST } }), { map: MAP, now: NOW, itemId: "website" }))).toEqual([
      "contact-intake-path-shape@contactIntake.path",
    ]);
    expect(rulesAt(checkSealEvidence(evidence({ contactIntake: { kind: "maybe" } }), { map: MAP, now: NOW, itemId: "website" }))).toEqual(["contact-intake-shape@contactIntake.kind"]);
  });

  it("refuses an impossible calendar date or clock time, and accepts a real leap day", TIMEOUT, () => {
    const later = "2026-10-01T12:00:00Z";
    for (const observedAt of ["2026-09-31T00:00:00Z", "2026-02-29T00:00:00Z", "2026-04-31T23:00:00Z", "2026-09-30T24:00:00Z", "2026-13-01T00:00:00Z", "2026-00-10T00:00:00Z", "2026-09-00T00:00:00Z"]) {
      expect(rulesAt(checkSealEvidence(evidence({ observedAt }), { map: MAP, now: later, itemId: "website" })), observedAt).toEqual(["observed-at-shape@observedAt"]);
    }
    expect(rulesAt(checkSealEvidence(evidence(), { map: MAP, now: "2026-09-31T12:00:00Z", itemId: "website" }))).toEqual(["now-invalid@now"]);
    expect(rulesAt(checkSealEvidence(evidence(), { map: MAP, now: "2026-09-30T24:00:00Z", itemId: "website" }))).toEqual(["now-invalid@now"]);
    expect(checkSealEvidence(evidence({ observedAt: "2028-02-29T10:00:00Z" }), { map: MAP, now: "2028-02-29T12:00:00Z", itemId: "website" })).toEqual([]);
    expect(rulesAt(checkSealEvidence(evidence({ observedAt: "2027-02-29T10:00:00Z" }), { map: MAP, now: "2027-03-01T12:00:00Z", itemId: "website" }))).toEqual(["observed-at-shape@observedAt"]);
  });

  it("evidence names the item it was taken for, and a different item is refused", TIMEOUT, () => {
    expect(checkSealEvidence(evidence(), { map: MAP, now: NOW, itemId: "website" })).toEqual([]);
    expect(rulesAt(checkSealEvidence(evidence({ itemId: "email-kit" }), { map: MAP, now: NOW, itemId: "website" }))).toEqual(["evidence-item-mismatch@itemId"]);
    for (const missing of [undefined, "", "  ", 3, null]) {
      expect(rulesAt(checkSealEvidence(evidence({ itemId: missing }), { map: MAP, now: NOW, itemId: "website" })), String(missing)).toEqual(["evidence-item-shape@itemId"]);
    }
  });

  it("offers no waiver: an extra flag in the evidence or the options changes nothing", TIMEOUT, () => {
    const stale = evidence({ waive: true, force: true, pages: [page("/"), page("/contact", { servedCommit: OTHER_COMMIT, waive: true })] });
    expect(checkSealEvidence(stale, { map: MAP, now: NOW, itemId: "website", waive: true, force: true } as never).length).toBeGreaterThan(0);
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
    // Against the sealed manifest the item is no longer sealable either, so nothing is left to finish.
    const afterwards = refusal(seal({ manifest: first.manifest, ledger: first.ledger }));
    expect(rulesAt(afterwards)).toContain("seal-already-recorded@ledger");
    expect(rulesAt(afterwards)).toContain("item-not-sealable@itemId");
  });

  it("an interrupted seal, the ledger ahead of a kept manifest, is finished from the identical entry", TIMEOUT, () => {
    const first = seal();
    if (!first.ok) throw new Error("expected a seal");
    expect(first.resumed).toBe(false);

    const later = "2026-09-30T13:30:00Z";
    const frozenLedger = deepFreeze(structuredClone(first.ledger));
    const frozenManifest = deepFreeze(manifest());
    const finished = sealWebsite({ manifest: frozenManifest, ledger: frozenLedger, itemId: "website", evidence: evidence(), map: MAP, now: later, strategyRevision: STRATEGY_REVISION });
    if (!finished.ok) throw new Error(`expected the interrupted seal to finish, got ${JSON.stringify(finished.findings)}`);
    expect(finished.resumed).toBe(true);
    expect(finished.entryId).toBe(`website-website-${COMMIT.slice(0, 12)}`);
    // The ledger is not grown or rewritten, and the manifest carries the time the entry was recorded, not the rerun's time.
    expect(finished.ledger).toEqual(first.ledger);
    expect(finished.manifest.items.find((candidate) => candidate.id === "website")).toMatchObject({ status: "published", verifiedAt: NOW, publishedTo: [PRODUCTION_URL] });
    expect(finished.manifest).toEqual(first.manifest);
    expect(validatePackManifest(finished.manifest)).toEqual({ exitCode: 0, findings: [] });
  });

  it("an interrupted seal is finished only from an identical entry and only on evidence that still passes", TIMEOUT, () => {
    const first = seal();
    if (!first.ok) throw new Error("expected a seal");
    const entry = first.ledger[0] as Ledger[number];
    const differing: Array<[string, Ledger[number]]> = [
      ["url", { ...entry, url: "https://other.example.test/" }],
      ["strategyRevision", { ...entry, strategyRevision: "strategy-rev-2" }],
      ["publishedAt in the future", { ...entry, publishedAt: "2026-09-30T12:00:01Z" }],
      // A hand-added entry cannot backdate the verifiedAt a rerun copies into the manifest: evidence was observed at 11:00.
      ["publishedAt before the evidence was observed", { ...entry, publishedAt: "2026-09-30T10:59:59Z" }],
      ["channel", { ...entry, channel: "email" }],
      ["factCitations", { ...entry, factCitations: [citeFact("active-customers", 4200)] }],
      ["an extra key", { ...entry, note: "hand-added" } as Ledger[number]],
    ];
    for (const [label, changed] of differing) {
      const found = rulesAt(refusal(seal({ ledger: [changed] })));
      expect(found, label).toContain("seal-already-recorded@ledger");
    }
    // Stale evidence still refuses: the entry being there is not a waiver.
    const stale = seal({ ledger: first.ledger, evidence: evidence({ observedAt: "2026-09-28T00:00:00Z" }) });
    expect(rulesAt(refusal(stale))).toEqual(["observed-at-stale@observedAt"]);
    // Another commit's entry does not stand in for this one.
    const otherCommit = evidence({ commit: OTHER_COMMIT, delivery: { state: "ready", deployedCommit: OTHER_COMMIT, productionUrl: PRODUCTION_URL }, pages: [page("/", { servedCommit: OTHER_COMMIT }), page("/contact", { servedCommit: OTHER_COMMIT })] });
    const sealedOther = seal({ ledger: first.ledger, evidence: otherCommit });
    if (!sealedOther.ok) throw new Error("expected a normal seal for a new commit");
    expect(sealedOther.resumed).toBe(false);
    expect(sealedOther.ledger).toHaveLength(2);
  });

  it("a resumed seal accepts a recorded instant exactly at the evidence's observedAt and exactly at now, and refuses one second outside either", TIMEOUT, () => {
    const first = seal();
    if (!first.ok) throw new Error("expected a seal");
    const entry = first.ledger[0] as Ledger[number];
    // The bounds are inclusive: the evidence's observedAt is 11:00:00 and now is 12:00:00.
    for (const publishedAt of ["2026-09-30T11:00:00Z", NOW]) {
      const finished = seal({ ledger: [{ ...entry, publishedAt }] });
      if (!finished.ok) throw new Error(`expected ${publishedAt} to resume, got ${JSON.stringify(finished.findings)}`);
      expect(finished.resumed, publishedAt).toBe(true);
      expect(finished.manifest.items.find((candidate) => candidate.id === "website"), publishedAt).toMatchObject({ status: "published", verifiedAt: publishedAt });
    }
    for (const publishedAt of ["2026-09-30T10:59:59Z", "2026-09-30T12:00:01Z"]) {
      expect(rulesAt(refusal(seal({ ledger: [{ ...entry, publishedAt }] }))), publishedAt).toContain("seal-already-recorded@ledger");
    }
  });

  it("a resumed seal compares the entry without regard to key order", TIMEOUT, () => {
    const first = seal();
    if (!first.ok) throw new Error("expected a seal");
    const entry = first.ledger[0] as Ledger[number];
    const reordered = { factCitations: entry.factCitations, strategyRevision: entry.strategyRevision, url: entry.url, channel: entry.channel, publishedAt: entry.publishedAt, id: entry.id } as Ledger[number];
    expect(Object.keys(reordered)).not.toEqual(Object.keys(entry));
    const finished = seal({ ledger: [reordered] });
    if (!finished.ok) throw new Error(`expected the reordered entry to resume, got ${JSON.stringify(finished.findings)}`);
    expect(finished.resumed).toBe(true);
    expect(finished.ledger[0]).toBe(reordered);
    // A reordered entry that differs in a value is still not the same entry.
    expect(rulesAt(refusal(seal({ ledger: [{ ...reordered, url: "https://other.example.test/" }] })))).toContain("seal-already-recorded@ledger");
  });

  it("an interrupted seal never resumes on a non-canonical URL, whether the stored entry or the evidence carries it", TIMEOUT, () => {
    const first = seal();
    if (!first.ok) throw new Error("expected a seal");
    const entry = first.ledger[0] as Ledger[number];
    for (const url of ["https://@www.example.test/", "https://WWW.example.test/", "https://www.example.test/\n", "https://www.example.test\\@marker-user:marker-pass@marker-evil.test/"]) {
      // The stored entry holds the odd spelling while the evidence is canonical: not the same entry.
      expect(rulesAt(refusal(seal({ ledger: [{ ...entry, url }] }))), `entry ${JSON.stringify(url)}`).toContain("seal-already-recorded@ledger");
      // The evidence and the stored entry both hold it: the evidence is refused, so the entry is never finished.
      const both = refusal(seal({ ledger: [{ ...entry, url }], evidence: evidence({ delivery: { state: "ready", deployedCommit: COMMIT, productionUrl: url } }) }));
      expect(rulesAt(both), `both ${JSON.stringify(url)}`).toContain("production-url-shape@delivery.productionUrl");
      expect(JSON.stringify(both)).not.toContain("marker");
    }
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
    expect(rulesAt(refusal(seal({ itemId: "materials-site" })))).toEqual(["item-not-website@itemId", "item-not-public@itemId"]);
    // Public and kept, but its need is not yet published.
    expect(rulesAt(refusal(seal({ itemId: "email-kit" })))).toEqual(["item-not-website@itemId", "item-not-sealable@itemId"]);
    // Already published.
    expect(rulesAt(refusal(seal({ itemId: "strategy-brief" })))).toEqual(["item-not-website@itemId", "item-not-sealable@itemId"]);
    // Not in the manifest at all.
    expect(rulesAt(refusal(seal({ itemId: "no-such-item" })))).toEqual(["item-not-website@itemId", "item-not-sealable@itemId"]);

    const blocked = manifest();
    blocked.items[1] = item({ id: "website", needs: ["strategy-brief"], condition: "blocked" });
    expect(rulesAt(refusal(seal({ manifest: blocked })))).toEqual(["item-not-sealable@itemId"]);
  });

  it("seals only the website item, and only on evidence taken for that item", TIMEOUT, () => {
    // Evidence for another item cannot seal the website.
    expect(rulesAt(refusal(seal({ evidence: evidence({ itemId: "email-kit" }) })))).toEqual(["evidence-item-mismatch@itemId"]);
    expect(rulesAt(refusal(seal({ evidence: evidence({ itemId: undefined }) })))).toEqual(["evidence-item-shape@itemId"]);
    // A public, sealable item that is not the website cannot be sealed with otherwise clean evidence for itself.
    const other = manifest();
    other.items[3] = item({ id: "email-kit", needs: ["strategy-brief"] });
    expect(sealableItemIds(other)).toContain("email-kit");
    expect(rulesAt(refusal(seal({ manifest: other, itemId: "email-kit" })))).toEqual(["item-not-website@itemId"]);
    expect(seal({ manifest: other, itemId: "website" }).ok).toBe(true);
  });

  it("no echo: a finding holds a rule and a path, never a value from the input", TIMEOUT, () => {
    const markerUrl = "http://marker-url.example.test/leak";
    const markerDigest = "marker-digest-leak";
    const markerCommit = "d".repeat(40);
    const markerPath = "/marker-path-leak";
    const markerRevision = "marker-revision-leak";
    const bad = evidence({
      itemId: "marker-evidence-item-leak",
      commit: markerCommit,
      delivery: { state: "building", deployedCommit: "e".repeat(40), productionUrl: markerUrl },
      pages: [page("/", { desktopDigest: markerDigest, servedCommit: "f".repeat(40) }), page(markerPath, { status: 503, mobileDigest: markerDigest })],
      contactIntake: { kind: "none", reason: "" },
    });
    const refusedSeal = refusal(seal({ evidence: bad, itemId: "marker-item-leak", strategyRevision: markerRevision }));
    const refusedCheck = checkSealEvidence(bad, { map: MAP, now: NOW, itemId: "website" });
    expect(refusedSeal.length).toBeGreaterThan(5);

    const text = JSON.stringify([refusedSeal, refusedCheck]);
    for (const marker of [markerUrl, "marker-url", markerDigest, markerCommit, "e".repeat(40), "f".repeat(40), markerPath, "marker-item-leak", "marker-evidence-item-leak", "building"]) {
      expect(text, marker).not.toContain(marker);
    }
    for (const finding of [...refusedSeal, ...refusedCheck]) {
      expect(Object.keys(finding).sort()).toEqual(["path", "rule"]);
    }

    // A reason that is present and valid is also never echoed, even when another check refuses.
    const validReason = evidence({ contactIntake: { kind: "none", reason: "marker-reason-leak" }, pages: [page("/")] });
    expect(JSON.stringify(checkSealEvidence(validReason, { map: MAP, now: NOW, itemId: "website" }))).not.toContain("marker-reason-leak");
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
