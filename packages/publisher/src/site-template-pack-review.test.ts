/**
 * The site template's dev-only pack-review route (`app/pack/page.tsx`).
 *
 * The route is gated twice here. Source shape: the page asks
 * `resolvePackReviewPage` first and answers `notFound()` before it reads any
 * copy or record, it takes nothing from the request, and it is not in the
 * route manifest (so not in the sitemap). Behaviour: `resolvePackReviewPage`
 * and `resolvePackReviewExport`, which hold the page's and the export route's
 * whole decisions, are run with spy loaders, and unless `SITE_TARGET` is
 * `development` or `test`, the hosting environment (`VERCEL_ENV`) is absent or
 * `development`, and `NODE_ENV` is absent, `development` or `test`, they answer
 * `not-found` without calling them. The export route's file read
 * (`pack-review-files.ts`) is run against a real temporary directory. The page's JSX is not run here: the template's own tsconfig preserves
 * JSX, so it is checked by shape, as the other template pages are.
 *
 * Every string below is a fictional fixture.
 */

import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
import {
  packReviewExportHref,
  packReviewExportResponse,
  packReviewGate,
  resolvePackReviewExport,
  resolvePackReviewPage,
  resolvePackReviewSections,
} from "../templates/site/app/pack-review.js";
import { readPackReviewFile } from "../templates/site/app/pack-review-files.js";
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

  it("uses no placeholder at all, so every entry can move into Writer's catalog as it is", TIMEOUT, () => {
    for (const entry of PACK_REVIEW_COPY.entries) {
      expect(entry.text, entry.id).not.toMatch(/[{}]/);
      expect(entry.placeholders ?? [], entry.id).toEqual([]);
    }
  });

  it("resolves every label the page uses, filling the tokens", TIMEOUT, () => {
    const text = packReviewText(createCopyResolver(PACK_REVIEW_COPY, { target: "preview" }));
    expect(text.heading).toBe("Pack review");
    expect(text.surfaceLabel).toBe("Review");
    expect(text.labels.statuses).toEqual({ draft: "Draft", delegated: "Delegated", approved: "Approved" });
    expect(Object.keys(text.labels.kinds).sort()).toEqual(["app-icon", "email-html", "email-text", "favicon", "logo", "og-image", "other"]);
    expect(text.labels.exportWidth(600)).toBe("600 px");
    expect(text.labels.frameTitle({ page: "/contact", width: 390 })).toBe("/contact, 390 px");
    expect(text.labels.frameTitle({ page: "/contact", state: "idle", width: 390 })).toBe("/contact, idle, 390 px");
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
    expect(body).toMatch(/^export default function PackReviewPage\(\) \{\s*const model = resolvePackReviewPage\(\{\s*env: process\.env,/);
    const gate = body.indexOf('if (model.kind === "not-found") notFound();');
    expect(gate).toBeGreaterThan(-1);
    for (const read of ["loadText()", "loadBrandFacts()", "resolvePackReviewSections(", "<BoundaryView", "<PackReviewView"]) {
      expect(body.indexOf(read), read).toBeGreaterThan(gate);
    }
    expect(body.slice(0, gate)).not.toMatch(/loadText|loadBrandFacts/);
  });

  it("gates its metadata on the same check", TIMEOUT, () => {
    expect(page).toMatch(/export function generateMetadata\(\): Metadata \{\s*if \(!packReviewGate\(process\.env\)\) return \{\};/);
    expect(page).not.toMatch(/siteTarget/);
  });

  it("takes no request input", TIMEOUT, () => {
    expect(page).not.toMatch(/searchParams|headers\(|cookies\(|\bparams\b|window\.|location|\bprops\b/);
    // The environment is read only to decide the gate, and only as the three named arguments.
    expect(page.match(/process\.env/g)).toHaveLength(3);
    expect(page.match(/(?:env: |packReviewGate\()process\.env/g)).toHaveLength(3);
    expect(body).toMatch(/^export default function PackReviewPage\(\) \{/);
  });

  it("reads the manifest only through site-records, and the pack path nowhere else", TIMEOUT, () => {
    expect(page).toMatch(/loadManifest: loadPackManifest/);
    expect(page).not.toMatch(/pack\.json|node:fs/);
    const files = ["site-records.ts", "site-copy.ts", "site-wiring.ts", "pack-review.ts", "pack-review-copy.ts", "pack-review-files.ts", "pack/page.tsx", "pack/export/route.ts"];
    const readers = files.filter((file) => code(readFileSync(join(APP_DIR, file), "utf8")).includes('"publisher", "pack.json"'));
    expect(readers).toEqual(["site-records.ts"]);
  });

  it("builds the record sections only for a listed review, after the unavailable page, and passes each to the view", TIMEOUT, () => {
    const unavailable = body.indexOf('if (model.kind === "unavailable")');
    const sections = body.indexOf("resolvePackReviewSections(");
    expect(unavailable).toBeGreaterThan(-1);
    expect(sections).toBeGreaterThan(unavailable);
    expect(body.slice(sections)).toMatch(/^resolvePackReviewSections\(\{\s*env: process\.env,/);
    for (const loader of ["loadStrategyContract", "loadEngagementBrief", "loadVoiceRecord", "loadBrandDeclarations"]) {
      expect(body.slice(sections), loader).toMatch(new RegExp(`\\b${loader},`));
    }
    expect(body).toMatch(/resolveCopy: createPackReviewCopyResolver\(\),/);
    expect(body).toMatch(/exports: model\.exports,/);
    for (const name of ["strategy", "brandKit", "voice"]) expect(body).toMatch(new RegExp(`${name}=\\{sections\\.${name}\\}`));
  });

  it("reads each pack-review record only through site-records", TIMEOUT, () => {
    expect(page).not.toMatch(/contract\.json|brief\.json|voice\.json|brand\.css|readBrandCss/);
    const files = ["site-copy.ts", "site-wiring.ts", "pack-review.ts", "pack-review-copy.ts", "pack-review-files.ts", "pack/page.tsx", "pack/export/route.ts"];
    for (const needle of ['"strategist", "contract.json"', '"brief.json"', '"writer", "voice.json"', '"designer", "brand.css"']) {
      expect(code(readFileSync(join(APP_DIR, "site-records.ts"), "utf8")), needle).toContain(needle);
      for (const file of files) expect(code(readFileSync(join(APP_DIR, file), "utf8")), `${file} ${needle}`).not.toContain(needle);
    }
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

function resolveModel(target: SiteTarget | string | undefined, loadManifest: () => unknown, extra: Record<string, string | undefined> = {}) {
  return resolvePackReviewPage({ env: { SITE_TARGET: target, ...extra }, routes: ROUTES, states: STATES, loadManifest });
}

describe("resolvePackReviewPage", () => {
  it.each(["production", "preview", "Production", "", "staging", undefined])("answers SITE_TARGET %j with not-found and never calls the loader", TIMEOUT, (target) => {
    const load = vi.fn(() => MANIFEST);
    expect(resolveModel(target, load)).toEqual({ kind: "not-found" });
    expect(load).not.toHaveBeenCalled();
  });

  it.each(["production", "preview"])("answers not-found on a development target when VERCEL_ENV is %s", TIMEOUT, (hosting) => {
    for (const target of ["development", "test"]) {
      const load = vi.fn(() => MANIFEST);
      expect(resolveModel(target, load, { VERCEL_ENV: hosting })).toEqual({ kind: "not-found" });
      expect(load).not.toHaveBeenCalled();
    }
  });

  it.each(["production", "Production", "prod", "", "staging"])("answers not-found on a development target when NODE_ENV is %j", TIMEOUT, (mode) => {
    for (const target of ["development", "test"]) {
      const load = vi.fn(() => MANIFEST);
      expect(resolveModel(target, load, { NODE_ENV: mode })).toEqual({ kind: "not-found" });
      expect(load).not.toHaveBeenCalled();
    }
  });

  it("answers an unknown SITE_TARGET with not-found and does not throw", TIMEOUT, () => {
    const load = vi.fn(() => MANIFEST);
    for (const target of ["devleopment", "Development", " development", "staging"]) {
      expect(() => resolveModel(target, load)).not.toThrow();
      expect(resolveModel(target, load)).toEqual({ kind: "not-found" });
    }
    expect(load).not.toHaveBeenCalled();
  });

  it("lists the review on a development target hosted locally or with no hosting variable", TIMEOUT, () => {
    for (const extra of [{}, { VERCEL_ENV: "development" }, { NODE_ENV: "development" }, { NODE_ENV: "test" }]) {
      expect(resolveModel("development", () => MANIFEST, extra).kind).toBe("review");
    }
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
    expect(html).toContain("600 px");
    expect(html).toContain("375 px");
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

// ------------------------------------------------------------ the export route

const BYTES = {
  png: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]),
  html: new TextEncoder().encode("<!doctype html><title>Example</title><p>Hello from example.test</p>"),
  txt: new TextEncoder().encode("Hello from example.test\n"),
} as const;

const OUTPUTS: Readonly<Record<string, Uint8Array>> = {
  "out/share/og-image.png": BYTES.png,
  "out/email/contact.html": BYTES.html,
  "out/email/contact.txt": BYTES.txt,
};

function loadOutputSpy() {
  return vi.fn((path: string): Uint8Array => {
    const found = Object.hasOwn(OUTPUTS, path) ? OUTPUTS[path] : undefined;
    if (found === undefined) throw new Error(`ENOENT ${path}`);
    return found;
  });
}

function exportFor(name: unknown, env: Record<string, string | undefined>, loadOutput = loadOutputSpy(), loadManifest: () => unknown = () => MANIFEST) {
  return resolvePackReviewExport({ env, name, loadManifest, loadOutput });
}

const INSIDE = { SITE_TARGET: "development" } as const;

describe("packReviewGate", () => {
  it("is open for development and test, with no hosting variable or a local one", TIMEOUT, () => {
    for (const target of ["development", "test"]) {
      expect(packReviewGate({ SITE_TARGET: target })).toBe(true);
      expect(packReviewGate({ SITE_TARGET: target, VERCEL_ENV: "development" })).toBe(true);
    }
  });

  it("is closed when VERCEL_ENV is production or preview, whatever SITE_TARGET says", TIMEOUT, () => {
    for (const target of ["development", "test"]) {
      for (const hosting of ["production", "preview"]) expect(packReviewGate({ SITE_TARGET: target, VERCEL_ENV: hosting })).toBe(false);
    }
  });

  it("is closed for any other VERCEL_ENV value", TIMEOUT, () => {
    for (const hosting of ["", "Production", "staging", " development"]) expect(packReviewGate({ SITE_TARGET: "development", VERCEL_ENV: hosting })).toBe(false);
  });

  it("is closed, and does not throw, for an absent, unlisted or unknown SITE_TARGET", TIMEOUT, () => {
    for (const target of [undefined, "production", "preview", "", "staging", "Development", "devleopment"]) {
      expect(() => packReviewGate({ SITE_TARGET: target })).not.toThrow();
      expect(packReviewGate({ SITE_TARGET: target })).toBe(false);
    }
  });

  it("is open only for an absent, development or test NODE_ENV", TIMEOUT, () => {
    for (const mode of [undefined, "development", "test"]) {
      expect(packReviewGate({ SITE_TARGET: "development", NODE_ENV: mode }), String(mode)).toBe(true);
      expect(packReviewGate({ SITE_TARGET: "test", NODE_ENV: mode }), String(mode)).toBe(true);
    }
  });

  it("is closed for every other NODE_ENV, an empty string and a different case included", TIMEOUT, () => {
    for (const mode of ["production", "Production", "PRODUCTION", "prod", "", "staging", "Development", "TEST", " development", "development ", "preview"]) {
      for (const target of ["development", "test"]) {
        expect(packReviewGate({ SITE_TARGET: target, NODE_ENV: mode }), `${target} ${JSON.stringify(mode)}`).toBe(false);
      }
    }
  });

  it("has no exception for the test target: a production NODE_ENV is closed there too", TIMEOUT, () => {
    expect(packReviewGate({ SITE_TARGET: "test", NODE_ENV: "production" })).toBe(false);
    expect(packReviewGate({ SITE_TARGET: "test", NODE_ENV: "production", VERCEL_ENV: "development" })).toBe(false);
  });

  it("is open on the local development path: next dev sets NODE_ENV to development, with no hosting variable", TIMEOUT, () => {
    expect(packReviewGate({ SITE_TARGET: "development", NODE_ENV: "development" })).toBe(true);
  });

  it("decides every NODE_ENV x SITE_TARGET x VERCEL_ENV combination as all three allowlists together", TIMEOUT, () => {
    const modes = [undefined, "development", "test", "production", "Production", "prod", "", "staging"];
    const targets = [undefined, "development", "test", "production", "preview", "staging", ""];
    const hostings = [undefined, "development", "production", "preview", "", "staging"];
    for (const mode of modes) {
      for (const target of targets) {
        for (const hosting of hostings) {
          const expected =
            (mode === undefined || mode === "development" || mode === "test") &&
            (target === "development" || target === "test") &&
            (hosting === undefined || hosting === "development");
          const env = { NODE_ENV: mode, SITE_TARGET: target, VERCEL_ENV: hosting };
          expect(() => packReviewGate(env)).not.toThrow();
          expect(packReviewGate(env), JSON.stringify(env)).toBe(expected);
        }
      }
    }
  });
});

describe("resolvePackReviewExport", () => {
  const NAMES = [
    ["og-image", "share-card:0", "image/png", BYTES.png],
    ["email at 600 px", "notification-email:0:600", "text/html; charset=utf-8", BYTES.html],
    ["email at 375 px", "notification-email:0:375", "text/html; charset=utf-8", BYTES.html],
    ["plain-text email", "notification-email:1", "text/plain; charset=utf-8", BYTES.txt],
  ] as const;

  it.each(NAMES)("returns the bytes of the %s export inside the gate", TIMEOUT, (_label, name, contentType, bytes) => {
    for (const env of [INSIDE, { SITE_TARGET: "test" }, { SITE_TARGET: "development", VERCEL_ENV: "development" }, { SITE_TARGET: "development", NODE_ENV: "development" }, { SITE_TARGET: "test", NODE_ENV: "test" }]) {
      const result = exportFor(name, env);
      if (result.kind !== "file") throw new Error(`expected a file for ${name}`);
      expect(result.contentType).toBe(contentType);
      expect([...result.body]).toEqual([...bytes]);
    }
  });

  it.each(NAMES)("answers not-found for the %s export outside the gate, and reads nothing", TIMEOUT, (_label, name) => {
    const outside: Array<Record<string, string | undefined>> = [
      {},
      { SITE_TARGET: "production" },
      { SITE_TARGET: "preview" },
      { SITE_TARGET: "staging" },
      { SITE_TARGET: "development", VERCEL_ENV: "production" },
      { SITE_TARGET: "development", VERCEL_ENV: "preview" },
      { SITE_TARGET: "test", VERCEL_ENV: "production" },
      { SITE_TARGET: "development", NODE_ENV: "production" },
      { SITE_TARGET: "test", NODE_ENV: "production" },
      { SITE_TARGET: "development", NODE_ENV: "Production" },
      { SITE_TARGET: "development", NODE_ENV: "prod" },
      { SITE_TARGET: "development", NODE_ENV: "" },
      { SITE_TARGET: "development", NODE_ENV: "staging" },
    ];
    for (const env of outside) {
      const load = loadOutputSpy();
      const manifest = vi.fn(() => MANIFEST);
      expect(exportFor(name, env, load, manifest)).toEqual({ kind: "not-found" });
      expect(manifest).not.toHaveBeenCalled();
      expect(load).not.toHaveBeenCalled();
    }
  });

  it("answers not-found for a name that is not an export of the index, and reads no output", TIMEOUT, () => {
    const hostile = ["", "share-card", "share-card:1", "share-card:0:", "notification-email:0", "out/share/og-image.png", "../secret", "/etc/hostile", "constructor", "__proto__", "share-card:0 ", "SHARE-CARD:0", "notification-email:0:601", 7, null, undefined, {}, ["share-card:0"]];
    for (const name of hostile) {
      const load = loadOutputSpy();
      expect(exportFor(name, INSIDE, load), String(name)).toEqual({ kind: "not-found" });
      expect(load).not.toHaveBeenCalled();
    }
  });

  it("reads only the path the index lists for the name, never a path from the request", TIMEOUT, () => {
    const load = loadOutputSpy();
    exportFor("share-card:0", INSIDE, load);
    expect(load.mock.calls).toEqual([["out/share/og-image.png"]]);
  });

  it("answers not-found, with no reason, when the manifest or the output cannot be read", TIMEOUT, () => {
    const broken = exportFor("share-card:0", INSIDE, loadOutputSpy(), () => {
      throw new Error("ENOENT /srv/private/clossys/publisher/pack.json");
    });
    expect(broken).toEqual({ kind: "not-found" });
    expect(exportFor("share-card:0", INSIDE, loadOutputSpy(), () => ({ items: "hostile-marker" }))).toEqual({ kind: "not-found" });
    const missing = vi.fn((): Uint8Array => {
      throw new Error("ENOENT /srv/private/out/share/og-image.png");
    });
    expect(exportFor("share-card:0", INSIDE, missing)).toEqual({ kind: "not-found" });
  });

  it("serves a type it does not know as a download, not inline", TIMEOUT, () => {
    const manifest: PackManifest = { schemaVersion: 1, items: [item("share-card", { outputPaths: ["out/share/card.bin"] })] };
    const result = exportFor("share-card:0", INSIDE, vi.fn(() => BYTES.png), () => manifest);
    if (result.kind !== "file") throw new Error("expected a file");
    expect(result.contentType).toBe("application/octet-stream");
    expect(packReviewExportResponse(result).headers.get("content-disposition")).toBe("attachment");
  });
});

describe("packReviewExportResponse", () => {
  it("is a 404 with an empty body, no-store and noindex for not-found", TIMEOUT, async () => {
    const response = packReviewExportResponse({ kind: "not-found" });
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect((await response.arrayBuffer()).byteLength).toBe(0);
  });

  it("is a 200 with the exact bytes, the type, and headers that keep the file inert", TIMEOUT, async () => {
    const result = exportFor("notification-email:0:600", INSIDE);
    const response = packReviewExportResponse(result);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("content-security-policy")).toBe("sandbox");
    expect(response.headers.get("content-disposition")).toBe("inline");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([...BYTES.html]);
  });

  it("marks an image export and a text export noindex, nofollow", TIMEOUT, () => {
    for (const [name, contentType] of [
      ["share-card:0", "image/png"],
      ["notification-email:1", "text/plain; charset=utf-8"],
    ] as const) {
      const response = packReviewExportResponse(exportFor(name, INSIDE));
      expect(response.status, name).toBe(200);
      expect(response.headers.get("content-type"), name).toBe(contentType);
      expect(response.headers.get("x-robots-tag"), name).toBe("noindex, nofollow");
    }
  });
});

describe("packReviewExportHref", () => {
  it("is the export route with the name encoded as one query value", TIMEOUT, () => {
    expect(packReviewExportHref("share-card:0")).toBe("/pack/export?name=share-card%3A0");
    expect(packReviewExportHref("notification-email:0:600")).toBe("/pack/export?name=notification-email%3A0%3A600");
  });
});

describe("the review lists a link to each export", () => {
  it("gives every export of the page model an address that resolves inside the gate", TIMEOUT, () => {
    const model = resolveModel("development", () => MANIFEST);
    if (model.kind !== "review") throw new Error("expected a review");
    expect(model.exports.length).toBeGreaterThan(0);
    for (const entry of model.exports) {
      expect(entry.href).toBe(packReviewExportHref(entry.id));
      const name = new URL(entry.href as string, "http://localhost").searchParams.get("name");
      expect(exportFor(name, INSIDE).kind).toBe("file");
      expect(exportFor(name, { SITE_TARGET: "production" }).kind).toBe("not-found");
    }
  });
});

describe("readPackReviewFile and the export response (run against a real directory)", () => {
  const SECRET = "outside-the-root-marker";
  const INSIDE_BYTES = "inside-the-root-bytes";

  interface Tree {
    base: string;
    root: string;
    outside: string;
    sibling: string;
  }

  /**
   * A repository root with listed outputs, a directory outside it, and a sibling
   * whose name starts with the root's own name (`repo-sibling` beside `repo`).
   */
  async function withTree(run: (tree: Tree) => void | Promise<void>): Promise<void> {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "pack-review-files-")));
    try {
      const root = join(base, "repo");
      const outside = join(base, "outside");
      const sibling = join(base, "repo-sibling");
      mkdirSync(join(root, "out", "share"), { recursive: true });
      mkdirSync(join(root, "out", "dir"), { recursive: true });
      mkdirSync(outside);
      mkdirSync(sibling);
      writeFileSync(join(root, "out", "share", "og.png"), INSIDE_BYTES);
      writeFileSync(join(root, "out", "..og.png"), INSIDE_BYTES);
      writeFileSync(join(root, "..og.png"), INSIDE_BYTES);
      writeFileSync(join(outside, "secret.txt"), SECRET);
      writeFileSync(join(sibling, "secret.txt"), SECRET);
      await run({ base, root, outside, sibling });
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  }

  const text = (bytes: Uint8Array): string => Buffer.from(bytes).toString();

  /** The route's whole decision for one listed output path, with the file read bound to `root`. */
  async function serve(root: string, outputPath: string): Promise<Response> {
    const manifest: PackManifest = { schemaVersion: 1, items: [item("share-card", { outputPaths: [outputPath] })] };
    return packReviewExportResponse(
      resolvePackReviewExport({
        env: INSIDE,
        name: "share-card:0",
        loadManifest: () => manifest,
        loadOutput: (path) => readPackReviewFile(root, path),
      }),
    );
  }

  async function expectRefused(root: string, outputPath: string, ...absolute: string[]): Promise<void> {
    const response = await serve(root, outputPath);
    expect(response.status, outputPath).toBe(404);
    const body = await response.text();
    expect(body, outputPath).toBe("");
    const seen = `${body}\n${[...response.headers].map(([key, value]) => `${key}: ${value}`).join("\n")}`;
    for (const path of [root, ...absolute]) expect(seen, outputPath).not.toContain(path);
    expect(seen).not.toContain(SECRET);
  }

  it("serves a file inside the root, with its bytes", TIMEOUT, async () => {
    await withTree(async ({ root }) => {
      const response = await serve(root, "out/share/og.png");
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(INSIDE_BYTES);
      expect(text(readPackReviewFile(root, "out/share/og.png"))).toBe(INSIDE_BYTES);
    });
  });

  it("serves a file whose name starts with two dots, in a directory and at the root", TIMEOUT, async () => {
    await withTree(async ({ root }) => {
      for (const path of ["out/..og.png", "..og.png"]) {
        const response = await serve(root, path);
        expect(response.status, path).toBe(200);
        expect(response.headers.get("content-type"), path).toBe("image/png");
        expect(await response.text(), path).toBe(INSIDE_BYTES);
      }
    });
  });

  it("refuses a .. traversal out of the root, to a directory and to a sibling that shares the root's name as a prefix", TIMEOUT, async () => {
    await withTree(({ root }) => {
      for (const path of ["../outside/secret.txt", "out/../../outside/secret.txt", "../repo-sibling/secret.txt", "../repo/../outside/secret.txt"]) {
        expect(() => readPackReviewFile(root, path), path).toThrow();
      }
    });
  });

  it("refuses an absolute path, even one that exists", TIMEOUT, async () => {
    await withTree(({ root, outside, sibling }) => {
      expect(() => readPackReviewFile(root, join(outside, "secret.txt"))).toThrow();
      expect(() => readPackReviewFile(root, join(sibling, "secret.txt"))).toThrow();
    });
  });

  it("answers an empty 404 for a symlinked file that points outside the root, and shows no path", TIMEOUT, async () => {
    await withTree(async ({ root, outside }) => {
      symlinkSync(join(outside, "secret.txt"), join(root, "out", "share", "link.png"));
      await expectRefused(root, "out/share/link.png", outside);
    });
  });

  it("answers an empty 404 for a path through a symlinked directory that points outside the root", TIMEOUT, async () => {
    await withTree(async ({ root, outside }) => {
      symlinkSync(outside, join(root, "out", "escape"), "dir");
      await expectRefused(root, "out/escape/secret.txt", outside);
    });
  });

  it("answers an empty 404 for a symlink to a sibling whose name starts with the root's name", TIMEOUT, async () => {
    await withTree(async ({ root, sibling }) => {
      symlinkSync(join(sibling, "secret.txt"), join(root, "out", "share", "sibling.png"));
      await expectRefused(root, "out/share/sibling.png", sibling);
    });
  });

  it("still serves a symlink that stays inside the root, and a root reached through a symlink", TIMEOUT, async () => {
    await withTree(async ({ base, root }) => {
      symlinkSync(join(root, "out", "share", "og.png"), join(root, "out", "inside-link.png"));
      expect(await (await serve(root, "out/inside-link.png")).text()).toBe(INSIDE_BYTES);
      const viaLink = join(base, "repo-link");
      symlinkSync(root, viaLink, "dir");
      expect(await (await serve(viaLink, "out/share/og.png")).text()).toBe(INSIDE_BYTES);
      symlinkSync(join(base, "outside"), join(root, "out", "escape-for-link"), "dir");
      await expectRefused(viaLink, "out/escape-for-link/secret.txt", join(base, "outside"), root);
    });
  });

  it("answers an empty 404 for a directory path, with and without a trailing slash", TIMEOUT, async () => {
    await withTree(async ({ root }) => {
      await expectRefused(root, "out/dir");
      await expectRefused(root, "out/dir/");
      await expectRefused(root, "out");
    });
  });

  it("refuses the root itself", TIMEOUT, async () => {
    await withTree(({ root }) => {
      for (const path of ["", ".", "./", "out/.."]) expect(() => readPackReviewFile(root, path), JSON.stringify(path)).toThrow();
    });
  });

  it("answers an empty 404 for a missing file, and names no path", TIMEOUT, async () => {
    await withTree(async ({ root }) => {
      await expectRefused(root, "out/share/missing.png");
    });
  });
});

describe("app/pack/export/route.ts source shape", () => {
  const raw = readTemplate("app/pack/export/route.ts");
  const route = code(raw);

  it("is a per-request GET and nothing else", TIMEOUT, () => {
    expect(route).toMatch(/export const dynamic = "force-dynamic";/);
    expect(route.match(/export (?:async )?function (\w+)/g)).toEqual(["export function GET"]);
    expect(route).not.toMatch(/\b(POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/);
  });

  it("hands the whole decision to the model, with the process environment as the gate's input", TIMEOUT, () => {
    expect(route).toMatch(/packReviewExportResponse\(\s*resolvePackReviewExport\(\{\s*env: process\.env,/);
    expect(route).toMatch(/loadManifest: loadPackManifest/);
    expect(route.match(/process\.env/g)).toHaveLength(1);
    expect(route).not.toMatch(/siteTarget|packReviewAvailable/);
  });

  it("reads a file only through the contained reader, with the repository root two levels above the app", TIMEOUT, () => {
    const loader = route.slice(route.indexOf("function loadOutput"), route.indexOf("export function GET"));
    expect(loader).toMatch(/readPackReviewFile\(resolve\(process\.cwd\(\), "\.\.", "\.\."\), path\)/);
    expect(route).not.toMatch(/readFileSync|realpathSync|node:fs/);
    expect(route).toMatch(/loadOutput,/);
    const reader = code(readTemplate("app/pack-review-files.ts"));
    expect(reader.match(/readFileSync\(/g)).toHaveLength(1);
    expect(reader).not.toMatch(/readFileSync\([^)]*name/);
    expect(reader).toMatch(/realpathSync\(resolve\(rootDir\)\)/);
    expect(reader).toMatch(/realpathSync\(resolve\(root, path\)\)/);
    expect(reader).toMatch(/startsWith\(root \+ sep\)/);
    expect(reader).not.toMatch(/startsWith\(["']\.\./);
  });

  it("takes only the name from the request, and uses it for nothing but a lookup in the model", TIMEOUT, () => {
    expect(route).toMatch(/searchParams\.get\("name"\)/);
    expect(route).not.toMatch(/headers\(|cookies\(|\bparams\b|pathname|\.body\b|json\(\)|formData/);
    expect(route.match(/searchParams/g)).toHaveLength(1);
  });

  it("is not a route the manifest or the sitemap knows", TIMEOUT, () => {
    const manifest = JSON.parse(readTemplate("web-route-manifest.json")) as { routes: Array<{ id: string }> };
    expect(manifest.routes.some((entry) => entry.id.startsWith("/pack"))).toBe(false);
  });
});

// ------------------------------------------------------- the record sections, run

const PROVENANCE = { source: "fictional-register", recordedAt: "2026-09-01" };

const CONTRACT = {
  id: "example-strategy",
  revision: "1.0.0",
  provenance: PROVENANCE,
  records: [
    { kind: "product", id: "example", revision: "1.0.0", provenance: PROVENANCE, name: "Example", summary: "A fictional product summary for the review." },
    { kind: "evidence", id: "pilot-notes", revision: "1.0.0", provenance: PROVENANCE, productId: "example", evidenceKind: "observed-fact", statement: "Fictional pilot readers finished the first step." },
    {
      kind: "claim",
      id: "approved-claim",
      revision: "1.0.0",
      provenance: PROVENANCE,
      productId: "example",
      claimKey: "approved-claim",
      assertion: "A fictional approved claim.",
      status: "approved",
      evidenceIds: ["pilot-notes"],
      approval: { approvedBy: "fictional-review", approvedAt: "2026-09-02" },
    },
    { kind: "claim", id: "open-claim", revision: "1.0.0", provenance: PROVENANCE, productId: "example", claimKey: "open-claim", assertion: "A fictional claim still to approve.", status: "hypothesis" },
  ],
};

const BRIEF = {
  schemaVersion: 1,
  problem: "A fictional problem.",
  roles: [{ role: "publisher", why: "A fictional reason.", goal: { metric: "verified publication rate", direction: "increase" }, inputsFrom: [], outputsTo: [] }],
  sequence: ["publisher"],
  deliverables: ["A fictional deliverable."],
  context: {
    schemaVersion: 1,
    fields: [
      { id: "business", state: "known", value: "product-or-service" },
      { id: "product", state: "known", value: "software" },
      { id: "audience", state: "known", value: "businesses" },
      { id: "stage", state: "unknown" },
      { id: "intent", state: "unknown" },
      { id: "constraints", state: "unknown" },
    ],
  },
};

const VOICE_RECORD = {
  id: "example-voice",
  rules: {
    person: { description: "Fictional person rule.", forbiddenPronouns: ["I"] },
    tense: { description: "Fictional tense rule.", forbiddenMarkers: ["will"] },
    formality: "neutral",
    tone: ["direct", "plain"],
  },
  glossary: [],
  claims: [],
};

const DECLARATIONS: Readonly<Record<string, string>> = {
  "--color-brand": "#123456",
  "--color-ink-primary": "#111111",
  "--font-display": "\"Example Sans\", sans-serif",
  "--font-body": "\"Example Serif\", serif",
  "--font-display-weight": "700",
  "--font-mono": "  ",
  "--space-md": "16px",
};

const COPY: Readonly<Record<string, string>> = {
  "site.tagline": "A fictional site tagline.",
  "brand.tagline.primary": "A fictional brand tagline.",
  "messaging.pitch.one-liner": "A fictional pitch.",
  "messaging.pitch.elevator": "A fictional elevator pitch, a little longer.",
  "messaging.boilerplate.short": "A fictional boilerplate.",
  "faq.pricing.question": "A fictional question?",
  "faq.pricing.answer": "A fictional answer.",
  "faq.unanswered.question": "A fictional question with no answer?",
};

const SECTION_MANIFEST: PackManifest = {
  schemaVersion: 1,
  items: [
    item("share-card", { outputPaths: ["out/share/og-image.png"] }),
    item("brand-kit", { outputPaths: ["out/brand/logo.svg", "out/brand/favicon.ico", "out/brand/notes.txt"] }),
  ],
};

const SECTION_TEXT = packReviewText(createCopyResolver(PACK_REVIEW_COPY, { target: "preview" }));

interface SectionLoaders {
  loadStrategyContract: () => unknown;
  loadEngagementBrief: () => unknown;
  loadVoiceRecord: () => unknown;
  loadBrandDeclarations: () => Readonly<Record<string, string>>;
}

const absent = (): never => {
  throw new Error("ENOENT /srv/private/clossys/record");
};

function presentLoaders(): SectionLoaders {
  return {
    loadStrategyContract: vi.fn(() => structuredClone(CONTRACT)),
    loadEngagementBrief: vi.fn(() => structuredClone(BRIEF)),
    loadVoiceRecord: vi.fn(() => structuredClone(VOICE_RECORD)),
    loadBrandDeclarations: vi.fn(() => DECLARATIONS),
  };
}

function absentLoaders(): SectionLoaders {
  return { loadStrategyContract: vi.fn(absent), loadEngagementBrief: vi.fn(absent), loadVoiceRecord: vi.fn(absent), loadBrandDeclarations: vi.fn(absent) };
}

function sectionsFor(loaders: SectionLoaders, over: { env?: Record<string, string | undefined>; copy?: Readonly<Record<string, string>>; taglineCopyId?: string } = {}) {
  const review = resolvePackReviewPage({ env: INSIDE, routes: ROUTES, states: STATES, loadManifest: () => SECTION_MANIFEST });
  if (review.kind !== "review") throw new Error("expected a review");
  const copy = over.copy ?? COPY;
  return resolvePackReviewSections({
    env: over.env ?? INSIDE,
    ...loaders,
    resolveCopy: createMapResolver(copy),
    copyIds: Object.keys(copy),
    brand: { label: "Example Studio", entity: "Example Studio Ltd", canonicalOrigin: "https://example.test", taglineCopyId: over.taglineCopyId },
    exports: review.exports,
    text: SECTION_TEXT,
  });
}

describe("resolvePackReviewSections", () => {
  it("calls no loader and returns no section when the gate is closed", TIMEOUT, () => {
    for (const env of [{}, { SITE_TARGET: "production" }, { SITE_TARGET: "development", VERCEL_ENV: "preview" }, { SITE_TARGET: "development", NODE_ENV: "production" }]) {
      const loaders = presentLoaders();
      expect(sectionsFor(loaders, { env })).toEqual({});
      for (const loader of Object.values(loaders)) expect(loader).not.toHaveBeenCalled();
    }
  });

  it("returns no section when every record is absent and no copy resolves, so a fresh repository still renders", TIMEOUT, () => {
    const sections = sectionsFor(absentLoaders(), { copy: {} });
    expect(sections).toEqual({});
    const html = renderToStaticMarkup(
      createElement(PackReviewView, {
        brand: "Example Studio",
        surfaceLabel: SECTION_TEXT.surfaceLabel,
        heading: SECTION_TEXT.heading,
        description: SECTION_TEXT.description,
        ...sections,
        pages: [],
        exports: [],
        labels: SECTION_TEXT.labels,
      }),
    );
    expect(html).toContain("No Strategist contract and no engagement brief context are recorded yet.");
    expect(html).toContain("No brand file is recorded yet.");
    expect(html).toContain("No voice record and no reusable copy are recorded yet.");
    expect(html).not.toContain("private");
  });

  it("treats a record its owner's check refuses as absent, and carries nothing from it", TIMEOUT, () => {
    const sections = sectionsFor(
      {
        loadStrategyContract: () => ({ ...CONTRACT, revision: "hostile-marker" }),
        loadEngagementBrief: () => ({ ...BRIEF, hostile: "hostile-marker" }),
        loadVoiceRecord: () => ({ ...VOICE_RECORD, rules: "hostile-marker" }),
        loadBrandDeclarations: absent,
      },
      { copy: {} },
    );
    expect(sections).toEqual({});
  });

  it("builds the strategy brief from the Strategist contract and the engagement brief's context", TIMEOUT, () => {
    const { strategy } = sectionsFor(presentLoaders());
    expect(strategy).toEqual({
      source: "Read from the Strategist contract.",
      summary: "A fictional product summary for the review.",
      context: [
        { name: "Business", value: "product-or-service" },
        { name: "Product", value: "software" },
        { name: "Audience", value: "businesses" },
      ],
      openQuestions: [
        "Claim to approve: A fictional claim still to approve.",
        "What stage is the business at?",
        "What should this engagement achieve first?",
        "What constraints should the team work within?",
      ],
    });
    expect(JSON.stringify(strategy)).not.toContain("A fictional approved claim.");
    expect(JSON.stringify(strategy)).not.toContain("A fictional problem.");
  });

  it("falls back to the engagement brief's context when there is no Strategist contract", TIMEOUT, () => {
    const { strategy } = sectionsFor({ ...presentLoaders(), loadStrategyContract: absent });
    expect(strategy?.source).toBe("Read from the engagement brief's context. There is no Strategist contract yet.");
    expect(strategy?.summary).toBeUndefined();
    expect(strategy?.context.map((fact) => fact.name)).toEqual(["Business", "Product", "Audience"]);
    expect(strategy?.openQuestions).toEqual(["What stage is the business at?", "What should this engagement achieve first?", "What constraints should the team work within?"]);
  });

  it("reads the contract alone when the brief is absent or carries no context", TIMEOUT, () => {
    const { context: _dropped, ...withoutContext } = BRIEF;
    for (const loadEngagementBrief of [absent, () => withoutContext]) {
      const { strategy } = sectionsFor({ ...presentLoaders(), loadEngagementBrief });
      expect(strategy?.source).toBe("Read from the Strategist contract.");
      expect(strategy?.context).toEqual([]);
      expect(strategy?.openQuestions).toEqual(["Claim to approve: A fictional claim still to approve."]);
    }
  });

  it("builds the brand kit from the brand file, the brand facts and the review's brand-asset exports", TIMEOUT, () => {
    const { brandKit } = sectionsFor(presentLoaders());
    expect(brandKit?.title).toBe("Example Studio");
    expect(brandKit?.usage).toBe("Brand assets from the pack manifest, and color and type tokens from the brand file.");
    expect(brandKit?.colors).toEqual([
      { name: "--color-brand", value: "#123456" },
      { name: "--color-ink-primary", value: "#111111" },
    ]);
    expect(brandKit?.type.map((entry) => entry.name)).toEqual(["--font-display", "--font-body", "--font-display-weight"]);
    expect(brandKit?.specimen).toEqual({
      text: "Sphinx of black quartz, judge my vow. 0123456789",
      faces: [
        { name: "--font-display", value: "\"Example Sans\", sans-serif" },
        { name: "--font-body", value: "\"Example Serif\", serif" },
      ],
    });
    expect(brandKit?.facts).toEqual([
      { name: "Brand", value: "Example Studio" },
      { name: "Legal entity", value: "Example Studio Ltd" },
      { name: "Canonical origin", value: "https://example.test" },
    ]);
    expect(brandKit?.assets).toEqual([
      { role: "brand-kit:0", href: packReviewExportHref("brand-kit:0"), label: "Logo, out/brand/logo.svg" },
      { role: "brand-kit:1", href: packReviewExportHref("brand-kit:1"), label: "Favicon, out/brand/favicon.ico" },
    ]);
  });

  it("links every brand-kit asset to an export the export route serves inside the gate", TIMEOUT, () => {
    const { brandKit } = sectionsFor(presentLoaders());
    expect(brandKit?.assets.length).toBeGreaterThan(0);
    for (const asset of brandKit?.assets ?? []) {
      const name = new URL(asset.href, "http://localhost").searchParams.get("name");
      const result = resolvePackReviewExport({ env: INSIDE, name, loadManifest: () => SECTION_MANIFEST, loadOutput: () => BYTES.png });
      expect(result.kind).toBe("file");
    }
  });

  it("builds the voice and copy from the voice record and the copy registry", TIMEOUT, () => {
    const { voice } = sectionsFor(presentLoaders());
    expect(voice).toEqual({
      rules: [
        { name: "Person", value: "Fictional person rule." },
        { name: "Tense", value: "Fictional tense rule." },
        { name: "Formality", value: "neutral" },
        { name: "Tone", value: "direct, plain" },
      ],
      tagline: "A fictional site tagline.",
      pitch: [
        { name: "One line", value: "A fictional pitch." },
        { name: "Elevator", value: "A fictional elevator pitch, a little longer." },
      ],
      boilerplate: [{ name: "Short", value: "A fictional boilerplate." }],
      faq: [{ question: "A fictional question?", answer: "A fictional answer." }],
    });
  });

  it("takes the tagline from the brand facts' first tagline when the record names one", TIMEOUT, () => {
    expect(sectionsFor(presentLoaders(), { taglineCopyId: "brand.tagline.primary" }).voice?.tagline).toBe("A fictional brand tagline.");
  });

  it("shows the copy without a voice record, and the voice rules without copy", TIMEOUT, () => {
    const copyOnly = sectionsFor({ ...presentLoaders(), loadVoiceRecord: absent }).voice;
    expect(copyOnly?.rules).toEqual([]);
    expect(copyOnly?.pitch).toHaveLength(2);
    const rulesOnly = sectionsFor(presentLoaders(), { copy: {} }).voice;
    expect(rulesOnly?.rules).toHaveLength(4);
    expect(rulesOnly?.tagline).toBeUndefined();
    expect([rulesOnly?.pitch, rulesOnly?.boilerplate, rulesOnly?.faq]).toEqual([[], [], []]);
  });

  it("renders every present section through the real view with the catalog's words", TIMEOUT, () => {
    const review = resolvePackReviewPage({ env: INSIDE, routes: ROUTES, states: STATES, loadManifest: () => SECTION_MANIFEST });
    if (review.kind !== "review") throw new Error("expected a review");
    const html = renderToStaticMarkup(
      createElement(PackReviewView, {
        brand: "Example Studio",
        surfaceLabel: SECTION_TEXT.surfaceLabel,
        heading: SECTION_TEXT.heading,
        description: SECTION_TEXT.description,
        ...sectionsFor(presentLoaders()),
        pages: review.pages,
        exports: review.exports,
        labels: SECTION_TEXT.labels,
      }),
    );
    for (const words of [
      "Strategy brief",
      "Open questions for the owner",
      "Brand kit",
      "Assets",
      "Color tokens",
      "Type tokens",
      "Type specimen",
      "Voice and copy",
      "Voice rules",
      "Tagline",
      "Pitch",
      "Boilerplate",
      "FAQ",
      "A fictional product summary for the review.",
      "A fictional answer.",
    ]) {
      expect(html, words).toContain(words);
    }
    expect(html).not.toContain("recorded yet");
    expect(html.match(/<main/g)).toHaveLength(1);
    expect(html.match(/<h1/g)).toHaveLength(1);
  });
});

describe("the record-section loaders in site-records", () => {
  const records = code(readTemplate("app/site-records.ts"));

  it("reads each record at request time from the repository's clossys directory, and imports none of them", TIMEOUT, () => {
    expect(records).toMatch(/resolve\(process\.cwd\(\), "\.\.", "\.\.", "clossys", \.\.\.segments\)/);
    for (const [name, path] of [
      ["loadStrategyContract", '"strategist", "contract.json"'],
      ["loadEngagementBrief", '"brief.json"'],
      ["loadVoiceRecord", '"writer", "voice.json"'],
    ]) {
      expect(records, name).toMatch(new RegExp(`export function ${name}\\(\\): unknown \\{\\s*return JSON\\.parse\\(readFileSync\\(packRecordPath\\(${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\), "utf8"\\)\\);`));
    }
    expect(records).toMatch(/readBrandCss\(packRecordPath\("designer", "brand\.css"\)\)/);
    expect(records).not.toMatch(/import [^;]*(contract|brief|voice)\.json/);
    expect(records).not.toMatch(/import [^;]*brand\.css/);
  });

  it("resolves the review's copy with the preview policy, without reading SITE_TARGET", TIMEOUT, () => {
    const body = records.slice(records.indexOf("export function createPackReviewCopyResolver"));
    expect(body).toMatch(/^export function createPackReviewCopyResolver\(\): CopyResolver \{\s*return createSiteCopyResolver\("development"\);\s*\}/);
  });
});
