/**
 * The site template's dev-only pack-review route (`app/pack/page.tsx`).
 *
 * The route is gated twice here. Source shape: the page asks
 * `resolvePackReviewPage` first and answers `notFound()` before it reads any
 * copy or record, it takes nothing from the request, and it is not in the
 * route manifest (so not in the sitemap). Behaviour: `resolvePackReviewPage`,
 * which holds the page's whole decision, is run with spy loaders, and on every
 * target but `development` and `test` it answers `not-found` without calling
 * them. The page's JSX is not run here: the template's own tsconfig preserves
 * JSX, so it is checked by shape, as the other template pages are.
 *
 * Every string below is a fictional fixture.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createCopyResolver, parseCopyRegistry } from "@clossys/writer";
import type { PackManifest } from "./pack/types.js";
import { PackReviewView } from "./web/views/PackReviewView.js";
import {
  DEV_PREVIEWS,
  createMapResolver,
} from "../templates/site/app/site-copy.js";
import { PACK_REVIEW_COPY, PACK_REVIEW_COPY_IDS, packReviewText } from "../templates/site/app/pack-review-copy.js";
import { resolvePackReviewPage } from "../templates/site/app/pack-review.js";
import { packReviewAvailable, packReviewHref, siteSitemap } from "../templates/site/app/site-wiring.js";
import type { SiteTarget } from "../templates/site/app/site-wiring.js";

const TEMPLATE_DIR = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "templates", "site");
const APP_DIR = join(TEMPLATE_DIR, "app");
const readTemplate = (path: string): string => readFileSync(join(TEMPLATE_DIR, path), "utf8");

const TIMEOUT = { timeout: 30_000 };

// ------------------------------------------------------------------- the gate

describe("packReviewAvailable", () => {
  it("allows development and test only", TIMEOUT, () => {
    expect(packReviewAvailable("development")).toBe(true);
    expect(packReviewAvailable("test")).toBe(true);
    expect(packReviewAvailable("production")).toBe(false);
    expect(packReviewAvailable("preview")).toBe(false);
  });

  it("fails closed on any value it does not list", TIMEOUT, () => {
    for (const value of ["Development", "development ", "", "prod", "staging", undefined, null, 1, {}, ["development"]]) {
      expect(packReviewAvailable(value as unknown as SiteTarget)).toBe(false);
    }
  });
});

describe("packReviewHref", () => {
  it("is the route, or the route pinned to one state", TIMEOUT, () => {
    expect(packReviewHref("/contact")).toBe("/contact");
    expect(packReviewHref("/contact", "rate-limited")).toBe("/contact?preview=rate-limited");
  });

  it("only ever pins the states the contact page accepts", TIMEOUT, () => {
    expect([...DEV_PREVIEWS]).toEqual(["idle", "submitting", "accepted", "invalid", "rate-limited", "unavailable"]);
  });
});

// ---------------------------------------------------------------------- copy

describe("the pack-review copy catalog", () => {
  const ID_GRAMMAR = /^front-door\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.(?:title|description|label|primary|secondary|notice|alt)$/;

  it("is a registry Writer's own parser accepts", TIMEOUT, () => {
    expect(() => parseCopyRegistry(PACK_REVIEW_COPY)).not.toThrow();
  });

  it("uses only ids in the front-door grammar, each once", TIMEOUT, () => {
    expect(PACK_REVIEW_COPY_IDS.every((id) => ID_GRAMMAR.test(id))).toBe(true);
    expect(new Set(PACK_REVIEW_COPY_IDS).size).toBe(PACK_REVIEW_COPY_IDS.length);
    expect(PACK_REVIEW_COPY.entries.map((entry) => entry.id)).toEqual([...PACK_REVIEW_COPY_IDS]);
  });

  it("declares every {token} an entry's text uses, and only those", TIMEOUT, () => {
    for (const entry of PACK_REVIEW_COPY.entries) {
      const used = [...new Set([...entry.text.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]))].sort();
      expect([...(entry.placeholders ?? [])].sort()).toEqual(used);
    }
  });

  it("resolves every label the page uses, filling the tokens", TIMEOUT, () => {
    const text = packReviewText(createCopyResolver(PACK_REVIEW_COPY, { target: "preview" }));
    expect(text.heading).toBe("Pack review");
    expect(text.surfaceLabel).toBe("Review");
    expect(text.labels.statuses).toEqual({ draft: "Draft", delegated: "Delegated", approved: "Approved" });
    expect(Object.keys(text.labels.kinds).sort()).toEqual(["app-icon", "email-html", "email-text", "favicon", "logo", "og-image", "other"]);
    expect(text.labels.exportWidth(600)).toBe("600 px wide");
    expect(text.labels.frameTitle({ page: "/contact", width: 390 })).toBe("/contact at 390 px");
    expect(text.labels.frameTitle({ page: "/contact", state: "idle", width: 390 })).toBe("/contact, state idle, at 390 px");
    expect(text.unavailable.action).toBe("Back to the site");
  });

  it("throws, naming only the copy id, when a label does not resolve", TIMEOUT, () => {
    const without = createMapResolver({});
    expect(() => packReviewText(without)).toThrow("The pack review copy front-door.pack-review.title does not resolve.");
    const blank = createMapResolver(Object.fromEntries(PACK_REVIEW_COPY_IDS.map((id) => [id, "  "])));
    expect(() => packReviewText(blank)).toThrow(/does not resolve\.$/);
  });
});

// -------------------------------------------------------------- source shape

/** The source with `//` and block comments removed, so a rule is judged on code and not on prose. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("app/pack/page.tsx source shape", () => {
  const raw = readTemplate("app/pack/page.tsx");
  const page = code(raw);
  const body = page.slice(page.indexOf("export default function PackReviewPage"));

  it("is a server page that renders per request", TIMEOUT, () => {
    expect(page.trimStart().startsWith('"use client"')).toBe(false);
    expect(page).toMatch(/export const dynamic = "force-dynamic";/);
  });

  it("asks the model first and answers the 404 before it reads any copy or record", TIMEOUT, () => {
    expect(body).toMatch(/^export default function PackReviewPage\(\) \{\s*const model = resolvePackReviewPage\(\{\s*target: siteTarget\(\),/);
    const gate = body.indexOf('if (model.kind === "not-found") notFound();');
    expect(gate).toBeGreaterThan(-1);
    for (const read of ["loadText()", "loadBrandFacts()", "<BoundaryView", "<PackReviewView"]) {
      expect(body.indexOf(read), read).toBeGreaterThan(gate);
    }
    expect(body.slice(0, gate)).not.toMatch(/loadText|loadBrandFacts/);
  });

  it("gates its metadata on the same check", TIMEOUT, () => {
    expect(page).toMatch(/export function generateMetadata\(\): Metadata \{\s*if \(!packReviewAvailable\(siteTarget\(\)\)\) return \{\};/);
  });

  it("takes no request input", TIMEOUT, () => {
    expect(page).not.toMatch(/searchParams|headers\(|cookies\(|\bparams\b|process\.env|window\.|location|\bprops\b/);
    expect(body).toMatch(/^export default function PackReviewPage\(\) \{/);
  });

  it("reads the manifest only through site-records, and the pack path nowhere else", TIMEOUT, () => {
    expect(page).toMatch(/loadManifest: loadPackManifest/);
    expect(page).not.toMatch(/pack\.json|node:fs/);
    const files = ["site-records.ts", "site-copy.ts", "site-wiring.ts", "pack-review.ts", "pack-review-copy.ts", "pack/page.tsx"];
    const readers = files.filter((file) => code(readFileSync(join(APP_DIR, file), "utf8")).includes('"publisher", "pack.json"'));
    expect(readers).toEqual(["site-records.ts"]);
  });

  it("carries no wording of its own: no JSX text, no string passed as a visible prop", TIMEOUT, () => {
    expect(page).not.toMatch(/>[^<>{}]*[A-Za-z][^<>{}]*</);
    for (const prop of ["title", "description", "heading", "surfaceLabel", "label"]) {
      expect(page).not.toMatch(new RegExp(`\\b${prop}=["'\`]`));
    }
  });

  it("is not a route the manifest or the sitemap knows", TIMEOUT, () => {
    const manifest = JSON.parse(readTemplate("web-route-manifest.json")) as { routes: Array<{ id: string; template?: string }> };
    expect(manifest.routes.some((route) => route.id.startsWith("/pack"))).toBe(false);
    const entries = siteSitemap({ target: "production", origin: "https://example.test", routes: manifest.routes, legal: {} });
    expect(entries.some((entry) => entry.url.includes("/pack"))).toBe(false);
  });

  it("keeps the model module free of next, records and the environment", TIMEOUT, () => {
    const model = code(readTemplate("app/pack-review.ts"));
    expect(model).not.toMatch(/from\s+["']next(\/|["'])|node:fs|process\.env|site-records|\.json/);
  });
});

// ------------------------------------------------------------- the model, run

function item(id: string, over: Partial<PackManifest["items"][number]> = {}): PackManifest["items"][number] {
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

const MANIFEST: PackManifest = {
  schemaVersion: 1,
  items: [
    item("share-card", { status: "kept", approvedAt: "2026-09-20T00:00:00Z", outputPaths: ["out/share/og-image.png"] }),
    item("notification-email", { outputPaths: ["out/email/contact.html", "out/email/contact.txt"] }),
    item("website", { status: "in-review" }),
  ],
};

const ROUTES = [{ id: "/" }, { id: "/about" }, { id: "/contact" }];
const STATES = { "/contact": [...DEV_PREVIEWS] };

function resolveModel(target: SiteTarget | string, loadManifest: () => unknown) {
  return resolvePackReviewPage({ target: target as SiteTarget, routes: ROUTES, states: STATES, loadManifest });
}

describe("resolvePackReviewPage", () => {
  it.each(["production", "preview", "Production", "", "staging"])("answers %j with not-found and never calls the loader", TIMEOUT, (target) => {
    const load = vi.fn(() => MANIFEST);
    expect(resolveModel(target, load)).toEqual({ kind: "not-found" });
    expect(load).not.toHaveBeenCalled();
  });

  it.each(["development", "test"])("lists pages, states and exports on %s", TIMEOUT, (target) => {
    const model = resolveModel(target, () => MANIFEST);
    if (model.kind !== "review") throw new Error("expected a review");
    expect(model.pages.map((page) => [page.id, page.href, page.status, page.states.length])).toEqual([
      ["/", "/", "delegated", 0],
      ["/about", "/about", "delegated", 0],
      ["/contact", "/contact", "delegated", DEV_PREVIEWS.length],
    ]);
    expect(model.pages[2]!.states.map((entry) => entry.href)).toEqual(DEV_PREVIEWS.map((preview) => `/contact?preview=${preview}`));
    expect(model.exports.map((entry) => [entry.kind, entry.path, entry.width, entry.status])).toEqual([
      ["og-image", "out/share/og-image.png", undefined, "approved"],
      ["email-html", "out/email/contact.html", 600, "draft"],
      ["email-html", "out/email/contact.html", 375, "draft"],
      ["email-text", "out/email/contact.txt", undefined, "draft"],
    ]);
  });

  it("builds a model the real view accepts and renders with the catalog's words", TIMEOUT, () => {
    const model = resolveModel("development", () => MANIFEST);
    if (model.kind !== "review") throw new Error("expected a review");
    const text = packReviewText(createCopyResolver(PACK_REVIEW_COPY, { target: "preview" }));
    const html = renderToStaticMarkup(
      createElement(PackReviewView, {
        brand: "Example Studio",
        surfaceLabel: text.surfaceLabel,
        heading: text.heading,
        description: text.description,
        pages: model.pages,
        exports: model.exports,
        labels: text.labels,
      }),
    );
    expect(html).toContain("Pack review");
    for (const preview of DEV_PREVIEWS) expect(html).toContain(`href="/contact?preview=${preview}"`);
    expect(html).toContain("600 px wide");
    expect(html).toContain("375 px wide");
    expect(html).toContain("Notification email, plain text");
    expect(html.match(/<iframe /g)).toHaveLength((ROUTES.length + DEV_PREVIEWS.length) * 3);
    expect(html.match(/loading="lazy"/g)).toHaveLength((ROUTES.length + DEV_PREVIEWS.length) * 3);
  });

  it("answers an unreadable manifest with unavailable, and carries no reason", TIMEOUT, () => {
    const model = resolveModel("development", () => {
      throw new Error("ENOENT /srv/private/clossys/publisher/pack.json");
    });
    expect(model).toEqual({ kind: "unavailable" });
    expect(JSON.stringify(model)).not.toContain("private");
  });

  it("answers an invalid manifest with unavailable, and carries no value from it", TIMEOUT, () => {
    for (const manifest of [
      { schemaVersion: 1, items: [item("share-card", { outputPaths: ["../hostile-marker.png"] })] },
      { items: "hostile-marker" },
      null,
      "hostile-marker",
    ]) {
      const model = resolveModel("development", () => manifest);
      expect(model).toEqual({ kind: "unavailable" });
    }
  });
});
