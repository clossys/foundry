/**
 * The site template's dev-only pack-review route (`app/pack/page.tsx`).
 *
 * The route is gated twice here. Source shape: the page asks
 * `resolvePackReviewPage` first and answers `notFound()` before it reads any
 * copy or record, it takes nothing from the request, and it is not in the
 * route manifest (so not in the sitemap). Behaviour: `resolvePackReviewPage`
 * and `resolvePackReviewExport`, which hold the page's and the export route's
 * whole decisions, are run with spy loaders, and unless `SITE_TARGET` is
 * `development` or `test` and the hosting environment (`VERCEL_ENV`) is
 * neither `production` nor `preview` they answer `not-found` without calling
 * them. The JSX and the route handler are not run here: the template's own
 * tsconfig preserves JSX and the template's records are not in this
 * package, so both are checked by shape, as the other template pages are.
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
import { PACK_REVIEW_EMAIL_WIDTHS, PACK_REVIEW_WIDTHS } from "./pack/review-index.js";
import { PackReviewView } from "./web/views/PackReviewView.js";
import {
  DEV_PREVIEWS,
  createMapResolver,
} from "../templates/site/app/site-copy.js";
import { PACK_REVIEW_COPY, PACK_REVIEW_COPY_IDS, packReviewText } from "../templates/site/app/pack-review-copy.js";
import {
  packReviewExportHref,
  packReviewOpen,
  resolvePackReviewExport,
  resolvePackReviewPage,
} from "../templates/site/app/pack-review.js";
import type { PackReviewEnv } from "../templates/site/app/pack-review.js";
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

describe("packReviewOpen", () => {
  const open = (env: PackReviewEnv): boolean => packReviewOpen(env);

  it("opens on a development or test target with no hosting environment, or a development one", TIMEOUT, () => {
    for (const target of ["development", "test"]) {
      expect(open({ SITE_TARGET: target })).toBe(true);
      expect(open({ SITE_TARGET: target, VERCEL_ENV: "development" })).toBe(true);
    }
  });

  it("refuses when VERCEL_ENV is production or preview, whatever SITE_TARGET says", TIMEOUT, () => {
    for (const target of ["development", "test"]) {
      expect(open({ SITE_TARGET: target, VERCEL_ENV: "production" })).toBe(false);
      expect(open({ SITE_TARGET: target, VERCEL_ENV: "preview" })).toBe(false);
    }
  });

  it("fails closed on any other hosting value", TIMEOUT, () => {
    for (const value of ["Production", "staging", "", " development"]) {
      expect(open({ SITE_TARGET: "development", VERCEL_ENV: value })).toBe(false);
    }
  });

  it("refuses production, preview and an absent SITE_TARGET, which reads as production", TIMEOUT, () => {
    expect(open({ SITE_TARGET: "production" })).toBe(false);
    expect(open({ SITE_TARGET: "preview" })).toBe(false);
    expect(open({})).toBe(false);
  });

  it("refuses an unknown SITE_TARGET and does not throw", TIMEOUT, () => {
    for (const value of ["Development", "staging", "", "dev"]) {
      expect(() => open({ SITE_TARGET: value })).not.toThrow();
      expect(open({ SITE_TARGET: value })).toBe(false);
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

  it("needs no placeholder at all, so no noun has to be added to Writer's closed set", TIMEOUT, () => {
    for (const entry of PACK_REVIEW_COPY.entries) {
      expect(entry.text, entry.id).not.toMatch(/[{}]/);
      expect(entry.placeholders ?? [], entry.id).toEqual([]);
    }
  });

  it("resolves every label the page uses", TIMEOUT, () => {
    const text = packReviewText(createCopyResolver(PACK_REVIEW_COPY, { target: "preview" }));
    expect(text.heading).toBe("Pack review");
    expect(text.surfaceLabel).toBe("Review");
    expect(text.labels.statuses).toEqual({ draft: "Draft", delegated: "Delegated", approved: "Approved" });
    expect(Object.keys(text.labels.kinds).sort()).toEqual(["app-icon", "email-html", "email-text", "favicon", "logo", "og-image", "other"]);
    for (const width of [...PACK_REVIEW_WIDTHS, ...PACK_REVIEW_EMAIL_WIDTHS]) expect(text.labels.exportWidth(width)).toBe(`${width} px wide`);
    expect(text.labels.frameTitle({ page: "/contact", width: 390 })).toBe("Preview frame, /contact, 390 px wide");
    expect(text.labels.frameTitle({ page: "/contact", state: "idle", width: 390 })).toBe("Preview frame, /contact, idle, 390 px wide");
    expect(text.unavailable.action).toBe("Back to the site");
  });

  it("throws, naming no value, for a width the review does not list", TIMEOUT, () => {
    const text = packReviewText(createCopyResolver(PACK_REVIEW_COPY, { target: "preview" }));
    expect(() => text.labels.exportWidth(123)).toThrow("The pack review copy has no label for that width.");
    expect(() => text.labels.frameTitle({ page: "/", width: 123 })).toThrow("The pack review copy has no label for that width.");
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
    expect(body).toMatch(/^export default function PackReviewPage\(\) \{\s*const model = resolvePackReviewPage\(\{\s*env: process\.env,/);
    const gate = body.indexOf('if (model.kind === "not-found") notFound();');
    expect(gate).toBeGreaterThan(-1);
    for (const read of ["loadText()", "loadBrandFacts()", "<BoundaryView", "<PackReviewView"]) {
      expect(body.indexOf(read), read).toBeGreaterThan(gate);
    }
    expect(body.slice(0, gate)).not.toMatch(/loadText|loadBrandFacts/);
  });

  it("gates its metadata on the same check", TIMEOUT, () => {
    expect(page).toMatch(/export function generateMetadata\(\): Metadata \{\s*if \(!packReviewOpen\(process\.env\)\) return \{\};/);
    expect(page).not.toMatch(/siteTarget|packReviewAvailable/);
  });

  it("takes no request input", TIMEOUT, () => {
    expect(page).not.toMatch(/searchParams|headers\(|cookies\(|\bparams\b|window\.|location|\bprops\b/);
    // The only environment read is the hosting gate's, handed whole to the pure model.
    expect(code(raw).match(/process\.env/g)).toHaveLength(2);
    expect(code(raw).match(/(?:env: |packReviewOpen\()process\.env/g)).toHaveLength(2);
    expect(body).toMatch(/^export default function PackReviewPage\(\) \{/);
  });

  it("reads the manifest only through site-records, and the pack path nowhere else", TIMEOUT, () => {
    expect(page).toMatch(/loadManifest: loadPackManifest/);
    expect(page).not.toMatch(/pack\.json|node:fs/);
    const files = ["site-records.ts", "site-copy.ts", "site-wiring.ts", "pack-review.ts", "pack-review-copy.ts", "pack/page.tsx", "pack/export/route.ts"];
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

function resolveModel(env: PackReviewEnv | string, loadManifest: () => unknown) {
  const resolved: PackReviewEnv = typeof env === "string" ? { SITE_TARGET: env } : env;
  return resolvePackReviewPage({ env: resolved, routes: ROUTES, states: STATES, loadManifest });
}

describe("resolvePackReviewPage", () => {
  it.each(["production", "preview", "Production", "", "staging"])("answers %j with not-found and never calls the loader", TIMEOUT, (target) => {
    const load = vi.fn(() => MANIFEST);
    expect(resolveModel(target, load)).toEqual({ kind: "not-found" });
    expect(load).not.toHaveBeenCalled();
  });

  it("answers an absent SITE_TARGET with not-found", TIMEOUT, () => {
    const load = vi.fn(() => MANIFEST);
    expect(resolveModel({}, load)).toEqual({ kind: "not-found" });
    expect(load).not.toHaveBeenCalled();
  });

  it.each(["production", "preview"])("answers VERCEL_ENV %s with not-found even on a development target, and never calls the loader", TIMEOUT, (hosting) => {
    const load = vi.fn(() => MANIFEST);
    for (const target of ["development", "test"]) {
      expect(resolveModel({ SITE_TARGET: target, VERCEL_ENV: hosting }, load)).toEqual({ kind: "not-found" });
    }
    expect(load).not.toHaveBeenCalled();
  });

  it("answers an unknown SITE_TARGET with not-found, not a throw", TIMEOUT, () => {
    const load = vi.fn(() => MANIFEST);
    expect(() => resolveModel("devel", load)).not.toThrow();
    expect(resolveModel("devel", load)).toEqual({ kind: "not-found" });
    expect(load).not.toHaveBeenCalled();
  });

  it("lists a development target on a development hosting environment", TIMEOUT, () => {
    expect(resolveModel({ SITE_TARGET: "development", VERCEL_ENV: "development" }, () => MANIFEST).kind).toBe("review");
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
    expect(model.exports.map((entry) => [entry.id, entry.href])).toEqual([
      ["share-card:0", "/pack/export?name=share-card%3A0"],
      ["notification-email:0:600", "/pack/export?name=notification-email%3A0%3A600"],
      ["notification-email:0:375", "/pack/export?name=notification-email%3A0%3A375"],
      ["notification-email:1", "/pack/export?name=notification-email%3A1"],
    ]);
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
    for (const entry of model.exports) expect(html).toContain(`href="${entry.href}"`);
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

// ---------------------------------------------------------- the export route

const ENCODER = new TextEncoder();
const OUTPUT_BYTES: Readonly<Record<string, Uint8Array>> = {
  "out/share/og-image.png": Uint8Array.from([0x89, 0x50, 0x4e, 0x47]),
  "out/email/contact.html": ENCODER.encode("<p>Example notification</p>"),
  "out/email/contact.txt": ENCODER.encode("Example notification"),
};

function exportFor(env: PackReviewEnv, name: string | null, spies = { load: vi.fn(() => MANIFEST), read: vi.fn((path: string) => OUTPUT_BYTES[path]) }) {
  return { spies, model: resolvePackReviewExport({ env, name, loadManifest: spies.load, readOutput: spies.read }) };
}

const OPEN: PackReviewEnv = { SITE_TARGET: "development" };

describe("packReviewExportHref", () => {
  it("is the export route pinned to one export name", TIMEOUT, () => {
    expect(packReviewExportHref("share-card:0")).toBe("/pack/export?name=share-card%3A0");
  });
});

describe("resolvePackReviewExport", () => {
  const NAMES: ReadonlyArray<readonly [string, string, string]> = [
    ["share-card:0", "out/share/og-image.png", "image/png"],
    ["notification-email:0:600", "out/email/contact.html", "text/html; charset=utf-8"],
    ["notification-email:0:375", "out/email/contact.html", "text/html; charset=utf-8"],
    ["notification-email:1", "out/email/contact.txt", "text/plain; charset=utf-8"],
  ];

  it.each(NAMES)("returns the bytes of %s inside the gate", TIMEOUT, (name, path, contentType) => {
    for (const env of [{ SITE_TARGET: "development" }, { SITE_TARGET: "test" }, { SITE_TARGET: "development", VERCEL_ENV: "development" }]) {
      const { model, spies } = exportFor(env, name);
      if (model.kind !== "file") throw new Error("expected a file");
      expect(model.bytes).toEqual(OUTPUT_BYTES[path]);
      expect(model.headers["content-type"]).toBe(contentType);
      expect(spies.read).toHaveBeenCalledWith(path);
    }
  });

  it("covers every export the page lists, so none is listed that cannot be opened", TIMEOUT, () => {
    const page = resolveModel(OPEN, () => MANIFEST);
    if (page.kind !== "review") throw new Error("expected a review");
    for (const entry of page.exports) {
      const name = new URL(entry.href, "https://example.test").searchParams.get("name");
      expect(exportFor(OPEN, name).model.kind, entry.id).toBe("file");
    }
  });

  it("serves a file with a sealed response: no sniffing, no caching, no script, no sub-resource", TIMEOUT, () => {
    const { model } = exportFor(OPEN, "notification-email:0:600");
    if (model.kind !== "file") throw new Error("expected a file");
    expect(model.headers["x-content-type-options"]).toBe("nosniff");
    expect(model.headers["cache-control"]).toBe("no-store");
    expect(model.headers["content-security-policy"]).toMatch(/^sandbox; default-src 'none'/);
    expect(model.headers["content-security-policy"]).not.toMatch(/script-src|https?:/);
  });

  it("answers not-found outside the gate and reads nothing", TIMEOUT, () => {
    const outside: PackReviewEnv[] = [
      {},
      { SITE_TARGET: "production" },
      { SITE_TARGET: "preview" },
      { SITE_TARGET: "staging" },
      { SITE_TARGET: "development", VERCEL_ENV: "production" },
      { SITE_TARGET: "test", VERCEL_ENV: "preview" },
    ];
    for (const env of outside) {
      for (const [name] of NAMES) {
        const { model, spies } = exportFor(env, name);
        expect(model, JSON.stringify(env)).toEqual({ kind: "not-found" });
        expect(spies.load).not.toHaveBeenCalled();
        expect(spies.read).not.toHaveBeenCalled();
      }
    }
  });

  it("refuses an unknown export name with not-found, and reads no output", TIMEOUT, () => {
    for (const name of [null, "", "unknown", "share-card", "share-card:1", "share-card:0 ", "../share-card:0", "out/share/og-image.png", "SHARE-CARD:0", "website:0"]) {
      const { model, spies } = exportFor(OPEN, name);
      expect(model, String(name)).toEqual({ kind: "not-found" });
      expect(spies.read).not.toHaveBeenCalled();
    }
  });

  it("answers not-found when the manifest cannot be read or is invalid, naming nothing", TIMEOUT, () => {
    const throws = { load: vi.fn((): never => { throw new Error("ENOENT /srv/private/pack.json"); }), read: vi.fn(() => undefined) };
    expect(exportFor(OPEN, "share-card:0", throws).model).toEqual({ kind: "not-found" });
    const invalid = { load: vi.fn(() => ({ items: "hostile-marker" })), read: vi.fn(() => undefined) };
    expect(exportFor(OPEN, "share-card:0", invalid).model).toEqual({ kind: "not-found" });
    expect(invalid.read).not.toHaveBeenCalled();
  });

  it("answers not-found when the listed output is missing", TIMEOUT, () => {
    const missing = { load: vi.fn(() => MANIFEST), read: vi.fn(() => undefined) };
    expect(exportFor(OPEN, "share-card:0", missing).model).toEqual({ kind: "not-found" });
  });

  it("serves an unlisted file type as a download, never inline", TIMEOUT, () => {
    const manifest: PackManifest = { schemaVersion: 1, items: [item("brand-kit", { layer: "identity", outputPaths: ["out/brand/palette.json", "out/brand/logo.svg"] })] };
    const spies = { load: vi.fn(() => manifest), read: vi.fn(() => Uint8Array.from([1])) };
    const palette = exportFor(OPEN, "brand-kit:0", spies).model;
    if (palette.kind !== "file") throw new Error("expected a file");
    expect(palette.headers["content-type"]).toBe("application/octet-stream");
    expect(palette.headers["content-disposition"]).toBe("attachment");
    const logo = exportFor(OPEN, "brand-kit:1", spies).model;
    if (logo.kind !== "file") throw new Error("expected a file");
    expect(logo.headers["content-type"]).toBe("image/svg+xml");
  });
});

describe("app/pack/export/route.ts source shape", () => {
  const raw = readTemplate("app/pack/export/route.ts");
  const route = code(raw);
  const body = route.slice(route.indexOf("export function GET"));

  it("is a server route that renders per request and answers only GET", TIMEOUT, () => {
    expect(route.trimStart().startsWith('"use client"')).toBe(false);
    expect(route).toMatch(/export const dynamic = "force-dynamic";/);
    expect(route.match(/export (?:async )?function (\w+)/g)).toEqual(["export function GET"]);
    expect(route).not.toMatch(/export (?:const|let|var) (?!dynamic\b)/);
  });

  it("asks the model, with the process environment, before it reads any file or builds any response body", TIMEOUT, () => {
    expect(body).toMatch(/^export function GET\(request: Request\): Response \{\s*const model = resolvePackReviewExport\(\{\s*env: process\.env,/);
    const gate = body.indexOf('if (model.kind !== "file")');
    expect(gate).toBeGreaterThan(-1);
    expect(body.indexOf("new Response(model.bytes")).toBeGreaterThan(gate);
    expect(body.slice(0, gate)).not.toMatch(/readFileSync|new Response/);
    expect(body).toMatch(/loadManifest: loadPackManifest/);
  });

  it("takes the export name from the query string and nothing else from the request", TIMEOUT, () => {
    expect(body).toMatch(/searchParams\.get\("name"\)/);
    expect(route).not.toMatch(/headers\(|cookies\(|request\.headers|request\.body|\.json\(\)|\.formData\(\)|window\.|location/);
    expect(route.match(/process\.env/g)).toHaveLength(1);
  });

  it("reads an output only from inside the repository root, and the name never forms a path", TIMEOUT, () => {
    expect(route).toMatch(/relative\(root, file\)/);
    expect(route).toMatch(/startsWith\(".."\)/);
    expect(route.match(/readFileSync\(/g)).toHaveLength(1);
    expect(route).not.toMatch(/readFileSync\([^)]*name/);
  });

  it("answers an empty 404 for anything the model does not return as a file", TIMEOUT, () => {
    expect(body).toMatch(/new Response\(null, \{ status: 404/);
  });
});
