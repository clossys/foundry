/**
 * Assembly guards for the site template's first routes (#1516, #1706).
 *
 * The template is scaffolded into a consumer repository and built there by
 * Next.js; nothing here builds or renders it. What can be checked from this
 * package is the pure module `templates/site/app/site-wiring.ts` (which
 * imports no `next` module), the client-safe copy module beside it, and the
 * shape of the files the manifest names.
 *
 * The wiring is exercised with fictional values only: no real address, key or
 * registry is read, and no network call is made.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createCopyResolver } from "@clossys/writer";
import type { CopyRegistry } from "@clossys/writer";
import { LEGAL_SECTION_IDS } from "./document/legal.js";
import type { LegalDocument, LegalDocumentKind } from "./document/legal.js";
import { evaluateWebRouteManifestWithSources } from "./web/checkWebRoutes.js";
import type { WebRouteManifest } from "./web/checkWebRoutes.js";
import { STUB_CONTACT_DELIVERY, createStubContactDelivery } from "./web/contact/index.js";
import type { ContactDelivery, ContactHandler, StubContactDelivery } from "./web/contact/index.js";
import { ContactView } from "./web/views/ContactView.js";
import {
  CONTACT_RATE_LIMIT,
  CONTACT_TOPICS,
  UNKNOWN_CLIENT_KEY,
  contactViewTopics,
  createContactSubmitter,
  createSiteContactHandler,
  deriveClientKey,
  parseBrandFacts,
  requireLegalDocument,
  resolveSiteTarget,
  selectContactDelivery,
} from "../templates/site/app/site-wiring.js";
import {
  allContactPageCopyIds,
  contactViewCopy,
  createMapResolver,
  requireCopy,
} from "../templates/site/app/site-copy.js";

// ---------------------------------------------------------------- locations

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(PACKAGE_DIR, "..", "..");
const TEMPLATE_DIR = join(PACKAGE_DIR, "templates", "site");
const APP_DIR = join(TEMPLATE_DIR, "app");

function readTemplate(path: string): string {
  return readFileSync(join(TEMPLATE_DIR, path), "utf8");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

// ------------------------------------------------------------------ fixtures

const CONTACT_EMAIL = "hello@example.com";
const SUBJECT = "Marker subject for a contact message";

function goodSubmission(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    topic: "product",
    name: "Ada Example",
    email: "ada@example.com",
    message: "A short fictional message.",
    website: "",
    ...overrides,
  };
}

function isStub(value: unknown): boolean {
  return typeof value === "object" && value !== null && STUB_CONTACT_DELIVERY in value;
}

/** A delivery that is not a stub and only records what it was handed. */
function recordingDelivery(): ContactDelivery & { readonly seen: unknown[] } {
  const seen: unknown[] = [];
  return {
    channel: "email",
    seen,
    deliver: async (message) => {
      seen.push(message);
      return { provider: "recording" };
    },
  };
}

// ------------------------------------------------------------ resolveSiteTarget

describe("resolveSiteTarget", () => {
  it("treats an absent target as production", () => {
    expect(resolveSiteTarget({})).toBe("production");
    expect(resolveSiteTarget({ SITE_TARGET: undefined })).toBe("production");
  });

  it("accepts each of the four targets", () => {
    for (const target of ["production", "preview", "development", "test"] as const) {
      expect(resolveSiteTarget({ SITE_TARGET: target })).toBe(target);
    }
  });

  it("throws on a value it does not know, including a blank or differently cased one", () => {
    for (const value of ["staging", "", " ", "Production", "production ", "prod"]) {
      expect(() => resolveSiteTarget({ SITE_TARGET: value })).toThrow(/SITE_TARGET/);
    }
  });
});

// ------------------------------------------------------- selectContactDelivery

describe("selectContactDelivery", () => {
  it("returns the production delivery for production and never a stub", () => {
    const real = recordingDelivery();
    const make = vi.fn(() => real);
    const chosen = selectContactDelivery("production", make);
    expect(chosen).toBe(real);
    expect(make).toHaveBeenCalledTimes(1);
    expect(isStub(chosen)).toBe(false);
  });

  it("refuses a production factory that hands back a stub", () => {
    expect(() => selectContactDelivery("production", () => createStubContactDelivery())).toThrow(/stub/i);
  });

  it("returns the branded stub for every other target and does not build the production delivery", () => {
    for (const target of ["preview", "development", "test"] as const) {
      const make = vi.fn(() => recordingDelivery());
      const chosen = selectContactDelivery(target, make);
      expect(isStub(chosen)).toBe(true);
      expect(make).not.toHaveBeenCalled();
    }
  });
});

// ------------------------------------------------------ createSiteContactHandler

describe("createSiteContactHandler", () => {
  function config(target: "production" | "preview" | "development" | "test", delivery: ContactDelivery) {
    return { target, delivery, contactEmail: CONTACT_EMAIL, subject: SUBJECT, now: () => 1_000 };
  }

  it("throws for target production with a stub delivery", () => {
    expect(() => createSiteContactHandler(config("production", createStubContactDelivery()))).toThrow(/stub/i);
  });

  it("builds for production with a delivery that is not a stub", () => {
    const delivery = recordingDelivery();
    expect(() => createSiteContactHandler(config("production", delivery))).not.toThrow();
  });

  describe("target test with a stub", () => {
    it("delivers a valid submission once, to the contact email only", async () => {
      const stub = createStubContactDelivery();
      const handler = createSiteContactHandler(config("test", stub));
      const result = await handler.handle(goodSubmission(), { clientKey: "client-a" });
      expect(result).toEqual({ status: "accepted" });
      expect(stub.deliveries).toHaveLength(1);
      const message = stub.deliveries[0]!;
      expect(message.to).toEqual([CONTACT_EMAIL]);
      expect(message.from).toBe(CONTACT_EMAIL);
      expect(message.subject).toBe(SUBJECT);
      expect(message.replyTo).toEqual(["ada@example.com"]);
    });

    it("accepts a honeypot submission and delivers nothing", async () => {
      const stub = createStubContactDelivery();
      const handler = createSiteContactHandler(config("test", stub));
      const result = await handler.handle(goodSubmission({ website: "https://spam.example" }), { clientKey: "client-a" });
      expect(result).toEqual({ status: "accepted" });
      expect(stub.deliveries).toHaveLength(0);
    });

    it("rate-limits past the limit, per client, and delivers nothing more", async () => {
      const stub = createStubContactDelivery();
      const handler = createSiteContactHandler(config("test", stub));
      for (let i = 0; i < CONTACT_RATE_LIMIT.limit; i += 1) {
        expect(await handler.handle(goodSubmission(), { clientKey: "client-a" })).toEqual({ status: "accepted" });
      }
      expect(await handler.handle(goodSubmission(), { clientKey: "client-a" })).toEqual({ status: "rate-limited" });
      expect(stub.deliveries).toHaveLength(CONTACT_RATE_LIMIT.limit);
      // Another client has its own allowance.
      expect(await handler.handle(goodSubmission(), { clientKey: "client-b" })).toEqual({ status: "accepted" });
    });

    it("refuses a topic the page does not offer", async () => {
      const stub = createStubContactDelivery();
      const handler = createSiteContactHandler(config("test", stub));
      const result = await handler.handle(goodSubmission({ topic: "not-offered" }), { clientKey: "client-a" });
      expect(result.status).toBe("invalid");
      expect(stub.deliveries).toHaveLength(0);
    });
  });
});

// ------------------------------------------------------------ deriveClientKey

describe("deriveClientKey", () => {
  const ADDRESSES = ["203.0.113.7", "203.0.113.8", "198.51.100.23", "2001:db8::1"];

  it("gives different addresses different keys", () => {
    const keys = ADDRESSES.map((address) => deriveClientKey(address));
    expect(new Set(keys).size).toBe(ADDRESSES.length);
  });

  it("gives the same address the same key", () => {
    expect(deriveClientKey("203.0.113.7")).toBe(deriveClientKey("203.0.113.7"));
    expect(deriveClientKey(" 203.0.113.7 ")).toBe(deriveClientKey("203.0.113.7"));
  });

  it("never contains the address it was derived from", () => {
    for (const address of ADDRESSES) {
      const key = deriveClientKey(address);
      expect(key).not.toContain(address);
      expect(key).not.toContain(address.replaceAll(".", ""));
      expect(key.length).toBeLessThanOrEqual(256);
    }
  });

  it("puts every request without the header into one bucket that no address shares", () => {
    const missing = [undefined, null, "", "   ", ",", " , "].map((value) => deriveClientKey(value));
    expect(new Set(missing).size).toBe(1);
    expect(missing[0]).toBe(UNKNOWN_CLIENT_KEY);
    for (const address of ADDRESSES) expect(deriveClientKey(address)).not.toBe(UNKNOWN_CLIENT_KEY);
  });

  it("keys on the last hop, so a caller cannot rotate its bucket by prefixing the header", () => {
    const real = deriveClientKey("203.0.113.7");
    expect(deriveClientKey("198.51.100.1, 203.0.113.7")).toBe(real);
    expect(deriveClientKey("192.0.2.9, 198.51.100.1, 203.0.113.7")).toBe(real);
  });

  it("stays within the handler's client key length for an oversized header", () => {
    const key = deriveClientKey("9".repeat(20_000));
    expect(key.length).toBeLessThanOrEqual(256);
    expect(key).not.toBe(UNKNOWN_CLIENT_KEY);
  });
});

// ------------------------------------------------------------- CONTACT_TOPICS

describe("CONTACT_TOPICS", () => {
  it("lists the four topics", () => {
    expect([...CONTACT_TOPICS]).toEqual(["product", "press", "partnership", "other"]);
  });

  it("feeds the view: it offers exactly these topics, in this order", () => {
    expect(contactViewTopics().map((topic) => topic.id)).toEqual([...CONTACT_TOPICS]);
  });

  it("feeds the handler: every topic the view offers is accepted, and one it does not is not", async () => {
    const stub = createStubContactDelivery();
    const handler = createSiteContactHandler({ target: "test", delivery: stub, contactEmail: CONTACT_EMAIL, subject: SUBJECT, now: () => 0 });
    let client = 0;
    for (const topic of contactViewTopics()) {
      client += 1;
      const result = await handler.handle(goodSubmission({ topic: topic.id }), { clientKey: `client-${client}` });
      expect(result).toEqual({ status: "accepted" });
    }
    expect(stub.deliveries).toHaveLength(CONTACT_TOPICS.length);
    expect((await handler.handle(goodSubmission({ topic: "sales" }), { clientKey: "client-x" })).status).toBe("invalid");
  });
});

// -------------------------------------------------------- requireLegalDocument

const ref = (id: string) => ({ id });

function legalDoc(kind: LegalDocumentKind, status: "draft" | "counsel-reviewed"): LegalDocument {
  const docId = `marker.${kind}`;
  return {
    id: docId,
    title: ref(`${docId}.title`),
    sections: LEGAL_SECTION_IDS[kind].map((id) => ({
      kind: "section",
      id,
      level: 2,
      heading: ref(`${docId}.${id}.heading`),
      blocks: [{ kind: "paragraph", content: [{ kind: "text", text: ref(`${docId}.${id}.p1`) }] }],
    })),
    legal: {
      kind,
      status,
      effectiveDate: "2026-01-15",
      lastUpdated: "2026-02-01",
      variables: { entity: "Marker Entity", jurisdiction: "Marker Jurisdiction", contact: "marker-contact" },
      ...(status === "draft" ? { factsToConfirm: [ref("marker.fact.one")] } : {}),
    },
  } as unknown as LegalDocument;
}

describe("requireLegalDocument", () => {
  it("throws on a draft for production", () => {
    expect(() => requireLegalDocument(legalDoc("terms", "draft"), "production")).toThrow(/legal-gate-not-counsel-reviewed/);
  });

  it("returns a counsel-reviewed document for production", () => {
    const doc = legalDoc("privacy", "counsel-reviewed");
    expect(requireLegalDocument(doc, "production")).toBe(doc);
  });

  it("accepts a draft for every other target", () => {
    for (const target of ["preview", "development", "test"] as const) {
      expect(() => requireLegalDocument(legalDoc("terms", "draft"), target)).not.toThrow();
    }
  });

  it("throws on a document that is not a valid legal document, whatever the target", () => {
    expect(() => requireLegalDocument({ id: "nope" }, "preview")).toThrow();
    expect(() => requireLegalDocument(null, "test")).toThrow();
  });
});

// --------------------------------------------------------- createContactSubmitter

describe("createContactSubmitter", () => {
  function fakeHandler(): ContactHandler & { readonly calls: { submission: unknown; clientKey: string }[] } {
    const calls: { submission: unknown; clientKey: string }[] = [];
    return {
      calls,
      handle: async (submission, options) => {
        calls.push({ submission, clientKey: options.clientKey });
        return { status: "accepted" };
      },
    };
  }

  it("builds the handler once and keys each call on the forwarded-for header", async () => {
    const handler = fakeHandler();
    const build = vi.fn(() => handler);
    const submit = createContactSubmitter(build, () => undefined);
    await submit({ a: 1 }, "203.0.113.7");
    await submit({ a: 2 }, "203.0.113.8");
    expect(build).toHaveBeenCalledTimes(1);
    expect(handler.calls.map((call) => call.clientKey)).toEqual([deriveClientKey("203.0.113.7"), deriveClientKey("203.0.113.8")]);
  });

  it("returns unavailable when construction throws, and logs a code only", async () => {
    const log = vi.fn();
    const marker = "marker-text-that-must-not-be-logged";
    const submit = createContactSubmitter(() => {
      throw new Error(marker);
    }, log);
    expect(await submit(goodSubmission(), "203.0.113.7")).toEqual({ status: "unavailable" });
    expect(log).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain(marker);
    expect(log.mock.calls[0]).toHaveLength(1);
    expect(log.mock.calls[0]![0]).toMatch(/^[a-z0-9-]+$/);
  });

  it("tries again after a construction failure instead of failing for good", async () => {
    let attempts = 0;
    const handler = fakeHandler();
    const submit = createContactSubmitter(() => {
      attempts += 1;
      if (attempts === 1) throw new Error("first attempt fails");
      return handler;
    }, () => undefined);
    expect(await submit(goodSubmission(), "203.0.113.7")).toEqual({ status: "unavailable" });
    expect(await submit(goodSubmission(), "203.0.113.7")).toEqual({ status: "accepted" });
  });
});

// ---------------------------------------------------------------- brand facts

describe("parseBrandFacts", () => {
  const record = () => ({
    legalEntity: { name: "Marker Entity Ltd", incorporated: true, jurisdiction: "Markerland" },
    brand: { name: "Marker" },
    domains: ["marker.example"],
    canonicalOrigin: "https://marker.example",
    contactEmail: CONTACT_EMAIL,
    taglines: [{ copyId: "marker.tagline.one" }, { copyId: "marker.tagline.two" }],
  });

  it("reads the fields the pages use, and the first tagline's copy id", () => {
    expect(parseBrandFacts(record())).toEqual({
      brandLabel: "Marker",
      entity: "Marker Entity Ltd",
      contactEmail: CONTACT_EMAIL,
      canonicalOrigin: "https://marker.example",
      taglineCopyId: "marker.tagline.one",
    });
  });

  it("prefers the wordmark for the banner and allows a record with no taglines", () => {
    const facts = record();
    const parsed = parseBrandFacts({ ...facts, brand: { name: "Marker", wordmark: "MARKER" }, taglines: [] });
    expect(parsed.brandLabel).toBe("MARKER");
    expect(parsed.taglineCopyId).toBeUndefined();
  });

  it("throws, naming the path and no value, on a missing or blank field", () => {
    const secret = "marker-value-that-must-not-be-echoed";
    for (const [path, mutate] of [
      ["contactEmail", (f: Record<string, unknown>) => ({ ...f, contactEmail: "  " })],
      ["legalEntity.name", (f: Record<string, unknown>) => ({ ...f, legalEntity: { name: 3, secret } })],
      ["brand", (f: Record<string, unknown>) => ({ ...f, brand: null })],
      ["canonicalOrigin", (f: Record<string, unknown>) => ({ ...f, canonicalOrigin: undefined })],
    ] as const) {
      let message = "";
      try {
        parseBrandFacts(mutate(record()));
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message, path).toContain(path);
      expect(message).not.toContain(secret);
    }
    expect(() => parseBrandFacts(null)).toThrow();
    expect(() => parseBrandFacts([])).toThrow();
  });
});

// -------------------------------------------------------------------- copy ids

function fixtureRegistry(ids: readonly string[]): CopyRegistry {
  return {
    id: "marker-site-copy",
    locale: "en",
    revision: "1",
    source: { kind: "consumer", reference: "fixtures/marker-site-copy" },
    entries: ids.map((id) => ({ id, text: `Marker text for ${id}`, context: "fixture", status: "approved" as const })),
  };
}

describe("site copy", () => {
  const ids = allContactPageCopyIds();

  it("lists each id once", () => {
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("requireCopy resolves every id into a plain map the client can carry", () => {
    const map = requireCopy(createCopyResolver(fixtureRegistry(ids), { target: "preview" }), ids);
    expect(Object.keys(map).sort()).toEqual([...ids].sort());
    expect(JSON.parse(JSON.stringify(map))).toEqual(map);
  });

  it("requireCopy throws naming the missing id, and only the id", () => {
    const missing = ids[0]!;
    const registry = fixtureRegistry(ids.filter((id) => id !== missing));
    let thrown: unknown;
    try {
      requireCopy(createCopyResolver(registry, { target: "preview" }), ids);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain(missing);
    expect((thrown as Error).message).not.toContain("Marker text");
  });

  it("the map resolver answers only ids in the map, and only a bare reference", () => {
    const map = requireCopy(createCopyResolver(fixtureRegistry(ids), { target: "preview" }), ids);
    const resolve = createMapResolver(map);
    expect(resolve({ id: ids[0]! })?.text).toBe(`Marker text for ${ids[0]}`);
    expect(resolve({ id: "site.not.in.the.map" })).toBeUndefined();
    expect(resolve({ id: "toString" })).toBeUndefined();
    expect(resolve({ id: ids[0]!, values: { a: "b" } })).toBeUndefined();
  });

  it("gives ContactView every id it reads, so the page renders from the map alone", () => {
    const map = requireCopy(createCopyResolver(fixtureRegistry(ids), { target: "preview" }), ids);
    const html = renderToStaticMarkup(
      createElement(ContactView, {
        brand: "Marker Brand",
        legal: { entity: "Marker Entity", links: [{ label: "Marker link", href: "/privacy" }] },
        resolveCopyId: createMapResolver(map),
        copy: contactViewCopy(),
        topics: contactViewTopics(),
        onSubmit: async () => ({ status: "accepted" }),
      }),
    );
    expect(html).toContain("Marker text for site.contact.heading");
    for (const topic of contactViewTopics()) expect(html).toContain(`Marker text for ${topic.label.id}`);
  });
});

// ----------------------------------------------------------------- the manifest

describe("the template manifest", () => {
  const manifest = JSON.parse(readTemplate("web-route-manifest.json")) as WebRouteManifest;
  const sources: Record<string, string> = {};
  for (const route of manifest.routes) {
    if (route.file !== undefined) sources[route.file] = readTemplate(route.file);
  }
  const route = (id: string) => manifest.routes.find((entry) => entry.id === id);
  const importsFromWeb = (source: string, name: string) =>
    new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*["']@clossys/publisher/web["']`).test(source);

  it("passes the route check with the real sources", () => {
    const result = evaluateWebRouteManifestWithSources(manifest, sources);
    expect(result.findings).toEqual([]);
    expect(result.exitCode).toBe(0);
  });

  it("routes each page to its view, and each route file imports that view", () => {
    expect(route("/")?.template).toBe("LandingView");
    expect(route("/contact")?.template).toBe("ContactView");
    expect(route("/terms")?.template).toBe("LegalView");
    expect(route("/privacy")?.template).toBe("LegalView");
    for (const id of ["/", "/terms", "/privacy"]) {
      const entry = route(id)!;
      expect(importsFromWeb(sources[entry.file!]!, entry.template!)).toBe(true);
    }
  });

  it("registers every template the routes name", () => {
    for (const entry of manifest.routes) expect(manifest.registeredTemplates).toContain(entry.template);
  });

  it("renders the contact view from a client module, never from the server page", () => {
    const page = readTemplate("app/contact/page.tsx");
    const form = readTemplate("app/contact/contact-form.tsx");
    expect(route("/contact")?.file).toBe("app/contact/page.tsx");
    expect(importsFromWeb(page, "ContactView")).toBe(false);
    expect(form.trimStart().startsWith('"use client"')).toBe(true);
    expect(importsFromWeb(form, "ContactView")).toBe(true);
  });

  it("keeps the submit path on the server: an inline server action that reads the forwarded-for header", () => {
    const page = readTemplate("app/contact/page.tsx");
    expect(page).toMatch(/["']use server["']/);
    expect(page).toMatch(/x-forwarded-for/);
    expect(page).toMatch(/onSubmit=\{/);
    expect(page.trimStart().startsWith('"use client"')).toBe(false);
  });

  it("renders the 500 page from a client error boundary and the 404 page from not-found", () => {
    const error = readTemplate("app/error.tsx");
    const notFound = readTemplate("app/not-found.tsx");
    expect(error.trimStart().startsWith('"use client"')).toBe(true);
    expect(importsFromWeb(error, "ErrorView") || /site-error-view/.test(error)).toBe(true);
    expect(/site-error-view/.test(notFound) || importsFromWeb(notFound, "ErrorView")).toBe(true);
  });
});

// ------------------------------------------------------------------ file rules

describe("template file rules", () => {
  const appFiles = walk(APP_DIR).filter((file) => /\.(ts|tsx)$/.test(file));
  const rel = (file: string) => file.slice(APP_DIR.length + 1).split("\\").join("/");

  it("reads the four records only in app/site-records.ts", () => {
    const needles = ["brand-facts.json", "copy-registry.json", "legal/terms.json", "legal/privacy.json"];
    const readers = appFiles.filter((file) => needles.some((needle) => readFileSync(file, "utf8").includes(needle)));
    expect(readers.map(rel)).toEqual(["site-records.ts"]);
  });

  it("keeps the wiring free of any next module and of the records", () => {
    for (const name of ["site-wiring.ts", "site-copy.ts"]) {
      const source = readFileSync(join(APP_DIR, name), "utf8");
      expect(source).not.toMatch(/from\s+["']next(\/|["'])/);
      expect(source).not.toMatch(/clossys\/(strategist|writer|publisher)\/.*\.json/);
    }
  });

  it("reads the delivery key from the environment on each call, through a function", () => {
    const source = readFileSync(join(APP_DIR, "site-delivery.ts"), "utf8");
    const reads = source.match(/process\.env\.[A-Z_]+/g) ?? [];
    expect(reads).toEqual(["process.env.RESEND_API_KEY"]);
    expect(source).toMatch(/apiKey:\s*\(\)\s*=>\s*process\.env\.RESEND_API_KEY/);
  });

  it("carries no key, token or password literal", () => {
    const suspicious = /\bre_[A-Za-z0-9]{8,}|sk_(live|test)_|-----BEGIN|password\s*[:=]\s*["'][^"']+["']/i;
    for (const file of walk(TEMPLATE_DIR).filter((f) => !f.endsWith(".md"))) {
      expect(readFileSync(file, "utf8"), rel(file)).not.toMatch(suspicious);
    }
  });

  it("declares the delivery dependencies at the ranges the workspace publishes", () => {
    const manifest = JSON.parse(readTemplate("package.json")) as { dependencies: Record<string, string> };
    const messenger = JSON.parse(readFileSync(join(REPO_ROOT, "packages", "messenger", "package.json"), "utf8")) as {
      version: string;
      peerDependencies: Record<string, string>;
    };
    expect(manifest.dependencies["@clossys/writer"]).toBe("^0.4.0");
    expect(manifest.dependencies["@clossys/messenger"]).toBe("^0.2.0");
    expect(manifest.dependencies["resend"]).toBe(messenger.peerDependencies["resend"]);
  });
});

// A stub reached through the handler stays a stub: nothing in the wiring re-wraps it.
describe("stub identity", () => {
  it("keeps the stub brand on the delivery the target selects", () => {
    const chosen = selectContactDelivery("test", () => recordingDelivery()) as StubContactDelivery;
    expect(chosen[STUB_CONTACT_DELIVERY]).toBe(true);
    expect(chosen.deliveries).toEqual([]);
  });
});
