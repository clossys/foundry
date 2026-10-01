import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { computeCopyFingerprint, COPY_FINGERPRINT_ALGORITHM } from "./fingerprint.js";
import { prepareOptions } from "./field-options.js";
import { MESSAGING_KIT_COPY_IDS, resolveMessagingKit } from "./messaging-kit.js";
import { resolveSiteIdentity, SITE_IDENTITY_COPY_IDS } from "./site-identity.js";
import type { CopyRegistry, CopyRegistryEntry } from "./types.js";

const now = new Date("2026-09-27T00:00:00.000Z");

// Word counts strictly grow inside each messaging ladder.
const KIT_TEXTS = [
  "Example one-liner here",
  "An example elevator pitch text",
  "An example paragraph pitch text that runs longer",
  "Example short boilerplate text",
  "An example medium boilerplate text here",
  "An example long boilerplate text that runs on for longer",
] as const;
const IDENTITY_TEXTS = ["Example Site", "An example tagline"] as const;

function entryFor(id: string, text: string): CopyRegistryEntry {
  return {
    id,
    text,
    context: "fixture",
    status: "approved",
    approval: {
      approvedBy: "owner",
      approvedAt: "2026-08-01T00:00:00.000Z",
      textFingerprint: computeCopyFingerprint(text),
      fingerprintAlgorithm: COPY_FINGERPRINT_ALGORITHM,
    },
  };
}

function registryOf(entries: CopyRegistryEntry[]): CopyRegistry {
  return {
    id: "example-site",
    locale: "en",
    revision: "2026-09-01",
    source: { kind: "consumer", reference: "editorial/revisions/1" },
    entries,
  };
}

const kitRegistry = registryOf(MESSAGING_KIT_COPY_IDS.map((id, index) => entryFor(id, KIT_TEXTS[index]!)));
const identityRegistry = registryOf(SITE_IDENTITY_COPY_IDS.map((id, index) => entryFor(id, IDENTITY_TEXTS[index]!)));

const throwingOptions = {
  get locale(): string {
    throw new Error("boom");
  },
};

// Every one of these is malformed for `prepareOptions`, whatever the caller.
const MALFORMED: readonly [string, unknown][] = [
  ["a number", 5],
  ["a string", "en"],
  ["null", null],
  ["an array", []],
  ["a non-string locale", { now, locale: 42 }],
  ["a blank locale", { now, locale: "   " }],
  ["an options object whose getter throws", throwingOptions],
];

describe("prepareOptions", () => {
  it("fixes `now` once when options are absent", () => {
    const prepared = prepareOptions(undefined);
    expect(prepared.ok).toBe(true);
    if (prepared.ok) {
      expect(prepared.locale).toBeUndefined();
      expect(prepared.resolveOptions.now).toBeInstanceOf(Date);
    }
  });

  it("forwards only target, acceptDelegateInProduction and now, and ignores unknown keys", () => {
    const prepared = prepareOptions({ now, target: "preview", acceptDelegateInProduction: true, locale: "en", extra: 1 });
    expect(prepared).toEqual({
      ok: true,
      locale: "en",
      resolveOptions: { now, target: "preview", acceptDelegateInProduction: true },
    });
  });

  it("does not validate forwarded values; the resolver does", () => {
    const prepared = prepareOptions({ now: "yesterday", target: 7 });
    expect(prepared).toEqual({ ok: true, locale: undefined, resolveOptions: { now: "yesterday", target: 7 } });
  });

  it.each(MALFORMED)("refuses %s", (_label, options) => {
    expect(prepareOptions(options)).toEqual({ ok: false });
  });
});

describe("both callers refuse options identically", () => {
  it.each(MALFORMED)("%s is invalid-options on every field of both kits", (_label, options) => {
    const kit = resolveMessagingKit(kitRegistry, options);
    const identity = resolveSiteIdentity(identityRegistry, options);
    expect(kit.complete).toBe(false);
    expect(identity.complete).toBe(false);
    expect(kit.issues.map((issue) => issue.reason)).toEqual(MESSAGING_KIT_COPY_IDS.map(() => "invalid-options"));
    expect(identity.issues.map((issue) => issue.reason)).toEqual(SITE_IDENTITY_COPY_IDS.map(() => "invalid-options"));
  });

  it("ignores unknown option keys for both callers", () => {
    const options = { now, unknownKey: "x", another: { nested: true } };
    expect(resolveMessagingKit(kitRegistry, options).complete).toBe(true);
    expect(resolveSiteIdentity(identityRegistry, options).complete).toBe(true);
  });

  it("differs between the callers only in the words of its messages", () => {
    const kit = resolveMessagingKit(kitRegistry, 5).issues[0];
    const identity = resolveSiteIdentity(identityRegistry, 5).issues[0];
    expect(kit).toEqual({ reason: "invalid-options", field: "pitch.oneLiner", id: "messaging.pitch.one-liner", message: "Messaging kit options are malformed." });
    expect(identity).toEqual({ reason: "invalid-options", field: "name", id: "site.name", message: "Site identity options are malformed." });
  });

  it("keeps the same placeholder and blank wording per caller", () => {
    const text = "An example {thing} elevator pitch text";
    const rewritten = resolveMessagingKit(
      registryOf(MESSAGING_KIT_COPY_IDS.map((id, index) => entryFor(id, index === 1 ? text : KIT_TEXTS[index]!))),
      { now },
    );
    expect(rewritten.issues).toEqual([
      {
        reason: "messaging-placeholder",
        field: "pitch.elevator",
        id: "messaging.pitch.elevator",
        message:
          'Messaging kit entry "messaging.pitch.elevator" must be literal text; its entry declares placeholders or contains text the resolver would rewrite.',
      },
    ]);
    const identity = resolveSiteIdentity(
      registryOf(SITE_IDENTITY_COPY_IDS.map((id, index) => entryFor(id, index === 0 ? "{thing} Site" : IDENTITY_TEXTS[index]!))),
      { now },
    );
    expect(identity.issues).toEqual([
      {
        reason: "site-identity-placeholder",
        field: "name",
        id: "site.name",
        message:
          'Site identity "site.name" must be literal text; its entry declares placeholders or contains text the resolver would rewrite.',
      },
    ]);
  });
});

describe("the helpers exist once and both callers use them", () => {
  it("routes both callers through field-options", async () => {
    vi.resetModules();
    const prepareCalls: unknown[] = [];
    const fieldCalls: string[] = [];
    vi.doMock("./field-options.js", async (importOriginal) => {
      const original = await importOriginal<typeof import("./field-options.js")>();
      return {
        ...original,
        prepareOptions: (options: unknown) => {
          prepareCalls.push(options);
          return original.prepareOptions(options);
        },
        resolveField: (...args: Parameters<typeof original.resolveField>) => {
          fieldCalls.push(args[2]);
          return original.resolveField(...args);
        },
      };
    });
    try {
      const kit = await import("./messaging-kit.js");
      const identity = await import("./site-identity.js");

      kit.resolveMessagingKit(kitRegistry, { now });
      expect(prepareCalls).toHaveLength(1);
      expect(fieldCalls).toEqual([...MESSAGING_KIT_COPY_IDS]);

      identity.resolveSiteIdentity(identityRegistry, { now });
      expect(prepareCalls).toHaveLength(2);
      expect(fieldCalls).toEqual([...MESSAGING_KIT_COPY_IDS, ...SITE_IDENTITY_COPY_IDS]);
    } finally {
      vi.doUnmock("./field-options.js");
      vi.resetModules();
    }
  });

  it("defines prepareOptions and resolveField in exactly one source file", () => {
    const dir = new URL(".", import.meta.url);
    const sources = readdirSync(dir).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));
    for (const name of ["prepareOptions", "resolveField"]) {
      const definers = sources.filter((file) =>
        new RegExp(`^(export )?function ${name}\\b`, "m").test(readFileSync(new URL(file, dir), "utf8")),
      );
      expect(definers).toEqual(["field-options.ts"]);
    }
  });

  it("is not exported from the package index", () => {
    expect(readFileSync(new URL("index.ts", import.meta.url), "utf8")).not.toContain("field-options");
  });
});
