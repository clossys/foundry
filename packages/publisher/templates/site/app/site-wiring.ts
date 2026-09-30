/**
 * The site's server-side wiring, kept pure so it can be tested without Next.js.
 *
 * It imports no `next` module and reads no record and no environment: the
 * pages and `site-contact.ts` pass in what it needs. That is what lets a
 * test run it as plain functions.
 *
 * Server-only. It reaches the contact handler and Node's `crypto`, so no
 * client module may import it; the client-safe half is `site-copy.ts`.
 */
import { createHmac, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { gateLegalDocument } from "@clossys/publisher/document";
import type { LegalDocument } from "@clossys/publisher/document";
import {
  STUB_CONTACT_DELIVERY,
  createContactHandler,
  createMemoryRateLimiter,
  createStubContactDelivery,
} from "@clossys/publisher/web";
import type { ContactDelivery, ContactHandler, ContactResult, ContactUnavailableReason } from "@clossys/publisher/web";
import { CONTACT_TOPICS } from "./site-copy";

export { CONTACT_TOPICS, contactViewTopics } from "./site-copy";

// ------------------------------------------------------------------- target

export type SiteTarget = "production" | "preview" | "development" | "test";

const SITE_TARGETS: readonly string[] = ["production", "preview", "development", "test"];

/**
 * The deployment target, from `SITE_TARGET`. An absent value is `production`,
 * the strictest target, so forgetting to set it can only make the site refuse
 * more, never less. A value that is set but not one of the four throws: a
 * typo must not quietly select a different target.
 */
export function resolveSiteTarget(env: Readonly<Record<string, string | undefined>>): SiteTarget {
  const value = env["SITE_TARGET"];
  if (value === undefined) return "production";
  if (!SITE_TARGETS.includes(value)) {
    throw new Error("SITE_TARGET must be one of production, preview, development or test.");
  }
  return value as SiteTarget;
}

// ----------------------------------------------------------------- delivery

const NON_PRODUCTION_TARGETS: readonly string[] = ["preview", "development", "test"];

function isStubDelivery(value: unknown): boolean {
  return typeof value === "object" && value !== null && STUB_CONTACT_DELIVERY in value;
}

/**
 * Picks the delivery for a target. Production gets the real delivery from
 * `makeProduction` and refuses a stub; every other target gets the in-memory
 * stub and never builds the real one, so a preview cannot send a message.
 */
export function selectContactDelivery(target: SiteTarget, makeProduction: () => ContactDelivery): ContactDelivery {
  if (target !== "production") {
    // An allow-list: a value this function does not know is refused, never sent to the stub.
    if (typeof target !== "string" || !NON_PRODUCTION_TARGETS.includes(target)) {
      throw new Error("The contact delivery target must be production, preview, development or test.");
    }
    return createStubContactDelivery();
  }
  const delivery = makeProduction();
  if (isStubDelivery(delivery)) throw new Error("A stub delivery is refused for the production target.");
  return delivery;
}

// ------------------------------------------------------------------ handler

/**
 * Submissions per client per window. The limiter lives in one server
 * instance's memory, so each instance counts on its own; see the template
 * README, "Contact delivery".
 */
export const CONTACT_RATE_LIMIT = { limit: 5, windowMs: 10 * 60 * 1000 } as const;

export interface SiteContactHandlerConfig {
  readonly target: SiteTarget;
  /** Passed to the handler as it is: never wrapped, copied or replaced. */
  readonly delivery: ContactDelivery;
  /** Where messages go, and the sender they come from. */
  readonly contactEmail: string;
  /** The fixed subject of every message. */
  readonly subject: string;
  /** The limiter's clock. Defaults to `Date.now`. */
  readonly now?: () => number;
  readonly onUnavailable?: (reason: ContactUnavailableReason) => void;
}

/**
 * The contact handler for this site: the topics the form offers, one recipient,
 * a per-instance limiter, and the delivery exactly as given. On `production` a
 * stub delivery makes this throw (the handler itself refuses it).
 */
export function createSiteContactHandler(config: SiteContactHandlerConfig): ContactHandler {
  return createContactHandler({
    topics: CONTACT_TOPICS,
    from: config.contactEmail,
    to: [config.contactEmail],
    subject: config.subject,
    target: config.target,
    limiter: createMemoryRateLimiter({
      limit: CONTACT_RATE_LIMIT.limit,
      windowMs: CONTACT_RATE_LIMIT.windowMs,
      now: config.now ?? Date.now,
    }),
    delivery: config.delivery,
    ...(config.onUnavailable === undefined ? {} : { onUnavailable: config.onUnavailable }),
  });
}

// --------------------------------------------------------------- client key

/** The one bucket for every request that arrives without a usable forwarded-for header. */
export const UNKNOWN_CLIENT_KEY = "client-unknown";

/** Longest address text read. The longest textual IPv6 address is 45 characters. */
const ADDRESS_READ_LIMIT = 128;

/** Held in this process only, so a key cannot be matched to an address outside it. */
const KEY_SECRET = randomBytes(32);

/**
 * The canonical text the limiter key is derived from, or `undefined` when the
 * value is not an address.
 *
 * An IPv4 address is kept whole. An IPv6 address is reduced to its /64 prefix,
 * because one host normally holds a whole /64 and could otherwise take a new
 * bucket per address. An IPv4-mapped IPv6 address is the IPv4 address it
 * carries. The port (`ip:port`, `[ip]:port`), the brackets, a `%zone` suffix
 * and the letter case are removed first, so one address has one key however
 * the proxy spelled it.
 */
function canonicalAddress(raw: string): string | undefined {
  let text = raw;
  const bracketed = /^\[([^\]]*)\](?::\d{1,5})?$/.exec(text);
  if (bracketed !== null) text = bracketed[1] ?? "";
  else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d{1,5}$/.test(text)) text = text.slice(0, text.lastIndexOf(":"));
  const zone = text.indexOf("%");
  if (zone !== -1) text = text.slice(0, zone);

  const family = isIP(text);
  if (family === 4) return `v4:${text}`;
  if (family !== 6) return undefined;

  let groups = text.toLowerCase();
  const dotted = groups.lastIndexOf(".");
  if (dotted !== -1) {
    const colon = groups.lastIndexOf(":");
    const octets = groups.slice(colon + 1).split(".").map(Number);
    const high = ((octets[0] ?? 0) << 8) | (octets[1] ?? 0);
    const low = ((octets[2] ?? 0) << 8) | (octets[3] ?? 0);
    groups = `${groups.slice(0, colon + 1)}${high.toString(16)}:${low.toString(16)}`;
  }
  const halves = groups.split("::");
  const head = halves[0] === "" ? [] : (halves[0] ?? "").split(":");
  const tail = halves.length === 2 ? (halves[1] === "" ? [] : (halves[1] ?? "").split(":")) : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const words = [...head, ...Array<string>(Math.max(fill, 0)).fill("0"), ...tail].map((word) => Number.parseInt(word, 16));
  if (words.length !== 8 || words.some((word) => !Number.isInteger(word) || word < 0 || word > 0xffff)) return undefined;

  const mapped = words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
  if (mapped) return `v4:${words[6]! >> 8}.${words[6]! & 255}.${words[7]! >> 8}.${words[7]! & 255}`;
  return `v6:${words.slice(0, 4).map((word) => word.toString(16).padStart(4, "0")).join(":")}`;
}

/**
 * The limiter key for a request, derived from its `x-forwarded-for` header.
 *
 * It reads the last address in the header, the one the nearest proxy appended,
 * because the earlier ones are whatever the caller chose to send. That value
 * is normalised (see `canonicalAddress`): IPv6 by /64 prefix, spelling
 * variants folded together. A value that is not an address gets no key of its
 * own; it joins the shared unknown bucket, so junk cannot be rotated to mint
 * buckets. The canonical text is keyed (HMAC-SHA-256 with a secret held in this
 * process) so the key is opaque and never contains the address, and is a fixed
 * length, well inside the handler's 256 limit. A request with no usable header
 * shares that one bucket, so it is limited too instead of being exempt.
 *
 * This is only as strong as the proxy that sets the header: see the template
 * README, "Contact delivery".
 */
export function deriveClientKey(forwardedFor: string | null | undefined): string {
  if (typeof forwardedFor !== "string") return UNKNOWN_CLIENT_KEY;
  const hops = forwardedFor.split(",");
  const last = (hops[hops.length - 1] ?? "").trim().slice(0, ADDRESS_READ_LIMIT);
  const canonical = canonicalAddress(last);
  if (canonical === undefined) return UNKNOWN_CLIENT_KEY;
  return `client-${createHmac("sha256", KEY_SECRET).update(canonical).digest("hex")}`;
}

// ---------------------------------------------------------------- submitter

/**
 * The function the contact page's server action calls. It builds the handler
 * on first use and keeps it (so the limiter's counts persist across requests
 * in one instance), keys each call on the forwarded-for header, and returns
 * the handler's result.
 *
 * If building the handler throws (a missing record, a stub on production),
 * every submission is `unavailable` and delivers nothing; the failure is
 * logged as a code only, never the error, which could echo configuration. A
 * failed build is not kept, so the next request tries again.
 */
export function createContactSubmitter(
  build: () => ContactHandler,
  log: (code: string) => void,
): (submission: unknown, forwardedFor: string | null | undefined) => Promise<ContactResult> {
  let handler: ContactHandler | undefined;
  return async (submission, forwardedFor) => {
    try {
      handler ??= build();
    } catch {
      log("contact-handler-unavailable");
      return { status: "unavailable" };
    }
    try {
      return await handler.handle(submission, { clientKey: deriveClientKey(forwardedFor) });
    } catch {
      log("contact-handle-failed");
      return { status: "unavailable" };
    }
  };
}

// --------------------------------------------------------------- legal gate

/**
 * Returns the legal document if it may be published for the target. Every
 * target requires a valid document; `production` also requires it to be
 * counsel-reviewed, so a draft can never be served there. Throws with the
 * gate's rule codes only, never the document's text.
 */
export function requireLegalDocument(document: unknown, target: SiteTarget): LegalDocument {
  const result = gateLegalDocument(document, target === "production" ? "production" : "preview");
  if (!result.ok) {
    const rules = [...new Set(result.findings.map((finding) => finding.rule))].join(", ");
    throw new Error(`The legal document is refused for ${target}: ${rules}.`);
  }
  return document as LegalDocument;
}

// -------------------------------------------------------------- brand facts

/** What the pages read from the brand-facts record. */
export interface SiteBrandFacts {
  /** The name shown in the page banner: the wordmark when there is one, else the brand name. */
  readonly brandLabel: string;
  /** The registered legal name, shown in the legal row. */
  readonly entity: string;
  readonly contactEmail: string;
  readonly canonicalOrigin: string;
  /** The first tagline's copy id, when the record lists one. */
  readonly taglineCopyId: string | undefined;
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`brand-facts: ${path} is not an object.`);
  return value as Record<string, unknown>;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`brand-facts: ${path} is not a non-empty string.`);
  return value;
}

/** Reads the fields the site needs from the brand-facts record; throws, naming the path only, on anything missing. */
export function parseBrandFacts(record: unknown): SiteBrandFacts {
  const facts = object(record, "the record");
  const brand = object(facts["brand"], "brand");
  const legalEntity = object(facts["legalEntity"], "legalEntity");
  const wordmark = brand["wordmark"];
  const taglines = facts["taglines"];
  let taglineCopyId: string | undefined;
  if (Array.isArray(taglines) && taglines.length > 0) {
    taglineCopyId = text(object(taglines[0], "taglines[0]")["copyId"], "taglines[0].copyId");
  }
  return {
    brandLabel: wordmark === undefined ? text(brand["name"], "brand.name") : text(wordmark, "brand.wordmark"),
    entity: text(legalEntity["name"], "legalEntity.name"),
    contactEmail: text(facts["contactEmail"], "contactEmail"),
    canonicalOrigin: text(facts["canonicalOrigin"], "canonicalOrigin"),
    taglineCopyId,
  };
}
