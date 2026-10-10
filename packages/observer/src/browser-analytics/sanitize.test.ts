import { describe, expect, it } from "vitest";
import {
  MAX_PROPERTY_STRING_LENGTH,
  createUrlSanitizer,
  sanitizeAnalyticsEvent,
} from "./sanitize.js";

const allow = { conversions: ["signup_started", "$opt_in"], properties: { signup_started: ["plan", "step", "ok", "$set"] } };

describe("sanitizeAnalyticsEvent: URLs keep origin and path only", () => {
  it("removes the query and the fragment from a pageview URL", () => {
    const event = sanitizeAnalyticsEvent(
      { kind: "pageview", location: { href: "https://example.test:8443/docs/start?token=abc&x=1#section-2" } },
      allow,
    );
    expect(event).toEqual({ kind: "pageview", url: "https://example.test:8443/docs/start", properties: {} });
    expect(JSON.stringify(event)).not.toContain("token");
    expect(JSON.stringify(event)).not.toContain("section-2");
  });

  it("drops credentials embedded in the URL", () => {
    const event = sanitizeAnalyticsEvent({ kind: "pageview", location: { href: "https://user:secret@example.test/a" } }, allow);
    expect(event).toEqual({ kind: "pageview", url: "https://example.test/a", properties: {} });
  });

  it("reduces the referrer to its origin", () => {
    const event = sanitizeAnalyticsEvent(
      { kind: "pageview", location: { href: "https://example.test/", referrer: "https://search.test/results?q=private+words#top" } },
      allow,
    );
    expect(event).toEqual({ kind: "pageview", url: "https://example.test/", referrerOrigin: "https://search.test", properties: {} });
  });

  it("omits an empty, unparseable or non-web referrer", () => {
    for (const referrer of ["", "not a url", "file:///home/a.html", "data:text/plain,hello"]) {
      const event = sanitizeAnalyticsEvent({ kind: "pageview", location: { href: "https://example.test/", referrer } }, allow);
      expect(event).toEqual({ kind: "pageview", url: "https://example.test/", properties: {} });
    }
  });

  it("drops an event whose URL is unparseable or not http(s)", () => {
    for (const href of ["", "/relative/path", "not a url", "file:///home/a.html", "javascript:alert(1)"]) {
      expect(sanitizeAnalyticsEvent({ kind: "pageview", location: { href } }, allow)).toBeNull();
    }
  });

  it("ignores any properties passed with a pageview", () => {
    const event = sanitizeAnalyticsEvent(
      { kind: "pageview", location: { href: "https://example.test/" }, properties: { plan: "pro" } },
      allow,
    );
    expect(event).toEqual({ kind: "pageview", url: "https://example.test/", properties: {} });
  });
});

describe("sanitizeAnalyticsEvent: normalizePath", () => {
  it("runs on the path and its accepted output replaces the path", () => {
    const normalizePath = (path: string) => path.replace(/\/\d+(?=\/|$)/g, "/:id");
    const event = sanitizeAnalyticsEvent(
      { kind: "pageview", location: { href: "https://example.test/orders/12345/items/7?x=1" } },
      { ...allow, normalizePath },
    );
    expect(event).toEqual({ kind: "pageview", url: "https://example.test/orders/:id/items/:id", properties: {} });
  });

  it("drops the event when the result does not start with /, contains ? or #, is not a string, or throws", () => {
    const bad: Array<(path: string) => string> = [
      () => "orders/1",
      () => "",
      (path) => `${path}?leak=1`,
      (path) => `${path}#leak`,
      () => 42 as unknown as string,
      () => {
        throw new Error("normalizer failed");
      },
    ];
    for (const normalizePath of bad) {
      expect(
        sanitizeAnalyticsEvent({ kind: "pageview", location: { href: "https://example.test/a" } }, { ...allow, normalizePath }),
      ).toBeNull();
    }
  });

  it("never lets a normalized path move the event to another host", () => {
    const sanitize = createUrlSanitizer(() => "//elsewhere.test/x");
    expect(sanitize("https://example.test/a")).toBe("https://example.test//elsewhere.test/x");
  });
});

describe("sanitizeAnalyticsEvent: conversions and properties", () => {
  it("sends only allowlisted conversions", () => {
    expect(
      sanitizeAnalyticsEvent({ kind: "conversion", name: "not_allowed", location: { href: "https://example.test/" } }, allow),
    ).toBeNull();
    expect(sanitizeAnalyticsEvent({ kind: "conversion", location: { href: "https://example.test/" } }, allow)).toBeNull();
    expect(
      sanitizeAnalyticsEvent({ kind: "conversion", name: "signup_started", location: { href: "https://example.test/" } }, allow),
    ).toEqual({ kind: "conversion", name: "signup_started", url: "https://example.test/", properties: {} });
  });

  it("refuses an allowlisted conversion name that begins with $", () => {
    expect(
      sanitizeAnalyticsEvent({ kind: "conversion", name: "$opt_in", location: { href: "https://example.test/" } }, allow),
    ).toBeNull();
  });

  it("keeps only allowlisted properties with bounded primitive values", () => {
    const event = sanitizeAnalyticsEvent(
      {
        kind: "conversion",
        name: "signup_started",
        location: { href: "https://example.test/signup?email=a@b.test" },
        properties: {
          plan: "starter",
          step: 2,
          ok: true,
          email: "a@b.test",
          $set: "x",
        },
      },
      allow,
    );
    expect(event).toEqual({
      kind: "conversion",
      name: "signup_started",
      url: "https://example.test/signup",
      properties: { plan: "starter", step: 2, ok: true },
    });
  });

  it("drops non-primitive, non-finite and over-long values", () => {
    for (const value of [{ nested: 1 }, ["a"], null, undefined, Number.NaN, Number.POSITIVE_INFINITY, "x".repeat(MAX_PROPERTY_STRING_LENGTH + 1), 10n, () => 1]) {
      const event = sanitizeAnalyticsEvent(
        { kind: "conversion", name: "signup_started", location: { href: "https://example.test/" }, properties: { plan: value } },
        allow,
      );
      expect(event).toEqual({ kind: "conversion", name: "signup_started", url: "https://example.test/", properties: {} });
    }
    const atLimit = "x".repeat(MAX_PROPERTY_STRING_LENGTH);
    expect(
      sanitizeAnalyticsEvent(
        { kind: "conversion", name: "signup_started", location: { href: "https://example.test/" }, properties: { plan: atLimit } },
        allow,
      ),
    ).toEqual({ kind: "conversion", name: "signup_started", url: "https://example.test/", properties: { plan: atLimit } });
  });

  it("does not read inherited properties", () => {
    const properties = Object.create({ plan: "inherited" }) as Record<string, unknown>;
    const event = sanitizeAnalyticsEvent(
      { kind: "conversion", name: "signup_started", location: { href: "https://example.test/" }, properties },
      allow,
    );
    expect(event).toEqual({ kind: "conversion", name: "signup_started", url: "https://example.test/", properties: {} });
  });

  it("returns frozen events", () => {
    const event = sanitizeAnalyticsEvent(
      { kind: "conversion", name: "signup_started", location: { href: "https://example.test/" }, properties: { plan: "a" } },
      allow,
    );
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event?.properties)).toBe(true);
  });
});
