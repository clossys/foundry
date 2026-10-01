import { describe, expect, it } from "vitest";
import { FRONT_DOOR_NOUNS } from "@clossys/writer";
import { PACK_REVIEW_COPY } from "../../templates/site/app/pack-review-copy.js";
import { buildPackReviewIndex, PACK_REVIEW_WIDTHS, packReviewStatus } from "./review-index.js";
import type { PackItem, PackManifest } from "./types.js";
import { validatePackManifest } from "./validate.js";

const TIMEOUT = { timeout: 10_000 };

function item(id: string, over: Partial<PackItem> = {}): PackItem {
  return {
    id,
    layer: "surface",
    owner: "publisher",
    visibility: "public",
    needs: [],
    status: "draft",
    condition: "current",
    version: "v0.1",
    createdAt: null,
    updatedAt: null,
    approvedAt: null,
    verifiedAt: null,
    sourcePins: [],
    outputPaths: [],
    publishedTo: [],
    nextAction: null,
    ...over,
  };
}

function manifest(items: readonly PackItem[]): PackManifest {
  return { schemaVersion: 1, items };
}

const OUT = "clossys/publisher/out";

function fullManifest(): PackManifest {
  return manifest([
    item("brand-kit", {
      layer: "identity",
      status: "kept",
      approvedAt: "2026-09-20T00:00:00Z",
      outputPaths: [`${OUT}/brand/favicon.svg`, `${OUT}/brand/apple-touch-icon.png`, `${OUT}/brand/logo-lockup.svg`, `${OUT}/brand/palette.json`],
    }),
    item("share-card", { status: "in-review", outputPaths: [`${OUT}/share/og-image.png`] }),
    item("notification-email", { outputPaths: [`${OUT}/email/contact.html`, `${OUT}/email/contact.txt`] }),
    item("website", { status: "in-review", outputPaths: [`${OUT}/website/v0.1/`] }),
  ]);
}

const INPUT = {
  routes: [{ id: "/" }, { id: "/about" }, { id: "/contact" }],
  states: { "/contact": ["idle", "accepted"] },
};

function indexOf(value: PackManifest = fullManifest(), input: Parameters<typeof buildPackReviewIndex>[1] = INPUT) {
  const result = buildPackReviewIndex(value, input);
  if (!result.ok) throw new Error(`expected an index, got ${JSON.stringify(result.issues)}`);
  return result.index;
}

describe("packReviewStatus", () => {
  it("maps every pack status onto draft, delegated or approved", TIMEOUT, () => {
    expect(packReviewStatus("absent")).toBe("draft");
    expect(packReviewStatus("found")).toBe("draft");
    expect(packReviewStatus("draft")).toBe("draft");
    expect(packReviewStatus("in-review")).toBe("delegated");
    expect(packReviewStatus("kept")).toBe("approved");
    expect(packReviewStatus("published")).toBe("approved");
  });
});

describe("buildPackReviewIndex", () => {
  it("fixes the contact-sheet widths", TIMEOUT, () => {
    expect([...PACK_REVIEW_WIDTHS]).toEqual([390, 1024, 1440]);
  });

  it("lists every route as a page, in route order, with the website item's badge", TIMEOUT, () => {
    const index = indexOf();
    expect(index.pages.map((page) => page.id)).toEqual(["/", "/about", "/contact"]);
    expect(index.pages.every((page) => page.status === "delegated")).toBe(true);
  });

  it("attaches the declared states to their page and none to the others", TIMEOUT, () => {
    const index = indexOf();
    expect(index.pages.map((page) => page.states)).toEqual([[], [], ["idle", "accepted"]]);
  });

  it("reports a page as draft when the manifest has no website item", TIMEOUT, () => {
    const index = indexOf(manifest([item("brand-kit", { layer: "identity" })]));
    expect(index.pages.map((page) => page.status)).toEqual(["draft", "draft", "draft"]);
  });

  it("lists exports in review order: share card, brand kit, then the email", TIMEOUT, () => {
    const index = indexOf();
    expect(index.exports.map((entry) => [entry.kind, entry.path.split("/").pop(), entry.width])).toEqual([
      ["og-image", "og-image.png", undefined],
      ["favicon", "favicon.svg", undefined],
      ["app-icon", "apple-touch-icon.png", undefined],
      ["logo", "logo-lockup.svg", undefined],
      ["other", "palette.json", undefined],
      ["email-html", "contact.html", 600],
      ["email-html", "contact.html", 375],
      ["email-text", "contact.txt", undefined],
    ]);
  });

  it("takes each export's badge from its own pack item", TIMEOUT, () => {
    const index = indexOf();
    const byKind = (kind: string) => index.exports.filter((entry) => entry.kind === kind).map((entry) => entry.status);
    expect(byKind("og-image")).toEqual(["delegated"]);
    expect(byKind("favicon")).toEqual(["approved"]);
    expect(byKind("email-html")).toEqual(["draft", "draft"]);
  });

  it("gives every entry a distinct id", TIMEOUT, () => {
    const index = indexOf();
    const ids = [...index.pages.map((page) => page.id), ...index.exports.map((entry) => entry.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("skips an item's directory outputs and lists nothing for items it does not index", TIMEOUT, () => {
    const index = indexOf(manifest([item("website", { outputPaths: [`${OUT}/website/v0.1/`] })]));
    expect(index.exports).toEqual([]);
  });

  it("lists no exports for an empty pack", TIMEOUT, () => {
    expect(indexOf(manifest([])).exports).toEqual([]);
  });

  it("is a pure function of its input", TIMEOUT, () => {
    const before = JSON.stringify(fullManifest());
    const value = fullManifest();
    expect(indexOf(value)).toEqual(indexOf(fullManifest()));
    expect(JSON.stringify(value)).toBe(before);
  });
});

describe("buildPackReviewIndex refusals", () => {
  function refused(value: unknown, input: unknown = INPUT) {
    const result = buildPackReviewIndex(value as PackManifest, input as Parameters<typeof buildPackReviewIndex>[1]);
    if (result.ok) throw new Error("expected a refusal");
    return result.issues;
  }

  it("refuses a manifest that does not validate", TIMEOUT, () => {
    const broken = manifest([item("website", { version: "1" })]);
    expect(validatePackManifest(broken).exitCode).not.toBe(0);
    expect(refused(broken).map((issue) => issue.rule)).toEqual(["invalid-manifest"]);
  });

  it("refuses a value that is not a manifest", TIMEOUT, () => {
    for (const value of [null, undefined, "x", 3, [], {}, { items: "x" }]) {
      expect(refused(value).map((issue) => issue.rule)).toEqual(["invalid-manifest"]);
    }
  });

  it.each([
    ["an absolute path", "/etc/passwd"],
    ["a parent segment", "clossys/../secret.png"],
    ["a backslash", "clossys\\publisher\\og.png"],
    ["a control character", "clossys/og\u0000.png"],
    ["a scheme", "https://example.test/og.png"],
    ["an empty segment", "clossys//og.png"],
    ["a query", "clossys/og.png?x=1"],
  ])("refuses an output path with %s, naming only its position", TIMEOUT, (_name, path) => {
    const issues = refused(manifest([item("share-card", { outputPaths: [path] })]));
    expect(issues).toEqual([{ rule: "unsafe-output-path", path: "items[0].outputPaths[0]" }]);
    expect(JSON.stringify(issues)).not.toContain("passwd");
    expect(JSON.stringify(issues)).not.toContain("secret");
  });

  it("refuses a route id or state that is not a plain path or slug, without echoing it", TIMEOUT, () => {
    const badRoute = refused(fullManifest(), { routes: [{ id: "/a b<script>" }], states: {} });
    expect(badRoute).toEqual([{ rule: "invalid-route", path: "routes[0].id" }]);
    expect(JSON.stringify(badRoute)).not.toContain("script");

    const badState = refused(fullManifest(), { routes: [{ id: "/" }], states: { "/": ["ok", "Bad State"] } });
    expect(badState).toEqual([{ rule: "invalid-state", path: "states[0][1]" }]);
  });

  it("refuses states declared for a route that is not listed", TIMEOUT, () => {
    expect(refused(fullManifest(), { routes: [{ id: "/" }], states: { "/missing": ["idle"] } })).toEqual([
      { rule: "unknown-state-route", path: "states[0]" },
    ]);
  });

  it("refuses a duplicate route id", TIMEOUT, () => {
    expect(refused(fullManifest(), { routes: [{ id: "/" }, { id: "/" }], states: {} })).toEqual([
      { rule: "duplicate-route", path: "routes[1].id" },
    ]);
  });

  it("refuses input that is not routes and states", TIMEOUT, () => {
    for (const input of [null, "x", [], {}, { routes: "x", states: {} }, { routes: [], states: [] }]) {
      expect(refused(fullManifest(), input).map((issue) => issue.rule)).toEqual(["invalid-input"]);
    }
  });
});

describe("the pack-review copy", () => {
  // Rule F2 of Writer's front door: a `{token}` in a text is one of its closed nouns. The
  // review's own words use none that are not, so they can move into that catalog as they are.
  it("uses no placeholder outside the front-door nouns", TIMEOUT, () => {
    const nouns: readonly string[] = FRONT_DOOR_NOUNS;
    const outside = PACK_REVIEW_COPY.entries.flatMap((entry) => [
      ...[...entry.text.matchAll(/\{([^{}]*)\}/g)].map((match) => match[1]!),
      ...(entry.placeholders ?? []),
    ]).filter((token) => !nouns.includes(token));
    expect(outside).toEqual([]);
  });
});
