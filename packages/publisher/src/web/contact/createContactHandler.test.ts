import { describe, expect, it, vi } from "vitest";
import { createContactHandler } from "./createContactHandler.js";
import { createMemoryRateLimiter } from "./memoryRateLimiter.js";
import { createStubContactDelivery } from "./stubDelivery.js";
import {
  CONTACT_CLIENT_KEY_MAX_LENGTH,
  CONTACT_DEFAULT_CAPS,
  STUB_CONTACT_DELIVERY,
  type ContactFieldName,
  type ContactHandler,
  type ContactHandlerConfig,
  type ContactOutboundMessage,
  type ContactResult,
} from "./types.js";

// ---------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------

const TOPICS = ["general", "support"] as const;
const FROM = "Site Contact <contact@example.com>";
const TO = ["inbox@example.com", "ops@example.com"] as const;
const SUBJECT = "New contact form message";
const CLIENT_KEY = "client-1";
// Kept in one constant so an address is built as `<local>@${DOMAIN}` wherever the local part ends in a character the foreign-reference scan treats as a boundary.
const DOMAIN = "example.com";

/** A distinctive string that must never appear in any result or observer call. */
const MARKER = "ZZ-MARKER-9f3c1";

const valid = {
  topic: "general",
  name: "Ada Lovelace",
  email: "ada@example.com",
  phone: "+1 (555) 010-0100",
  message: "Hello there.\nSecond line.",
} as const;

const validWithoutPhone = {
  topic: valid.topic,
  name: valid.name,
  email: valid.email,
  message: valid.message,
} as const;

const EXPECTED_TEXT_WITH_PHONE = [
  "Topic: general",
  "Name: Ada Lovelace",
  "Email: ada@example.com",
  "Phone: +1 (555) 010-0100",
  "",
  "Hello there.",
  "Second line.",
].join("\n");

const EXPECTED_TEXT_WITHOUT_PHONE = [
  "Topic: general",
  "Name: Ada Lovelace",
  "Email: ada@example.com",
  "",
  "Hello there.",
  "Second line.",
].join("\n");

function makeDelivery() {
  return {
    channel: "email" as const,
    deliver: vi.fn(async (_message: ContactOutboundMessage) => ({ provider: "fake", messageId: "x" })),
  };
}

function makeLimiter(answer: boolean | Promise<boolean> = true) {
  return { check: vi.fn((_key: string): boolean | Promise<boolean> => answer) };
}

function makeHandler(overrides: Partial<ContactHandlerConfig> = {}) {
  const delivery = makeDelivery();
  const limiter = makeLimiter();
  const config: ContactHandlerConfig = {
    topics: [...TOPICS] as unknown as readonly [string, ...string[]],
    from: FROM,
    to: [...TO] as unknown as readonly [string, ...string[]],
    subject: SUBJECT,
    limiter,
    delivery,
    target: "test",
    createMessageId: () => "msg-1",
    ...overrides,
  };
  const handler = createContactHandler(config);
  return { handler, delivery, limiter, config };
}

// A default parameter would turn an explicit `undefined` key into CLIENT_KEY, so
// the "client key is undefined" case would never reach the handler; count arguments instead.
function submit(handler: ContactHandler, submission: unknown, ...rest: [clientKey?: unknown]): Promise<ContactResult> {
  const clientKey = rest.length > 0 ? rest[0] : CLIENT_KEY;
  return handler.handle(submission, { clientKey } as never);
}

function delivered(delivery: ReturnType<typeof makeDelivery>): ContactOutboundMessage {
  expect(delivery.deliver).toHaveBeenCalledTimes(1);
  const call = delivery.deliver.mock.calls[0];
  if (call === undefined) throw new Error("deliver was not called");
  return call[0];
}

function issuesOf(result: ContactResult) {
  expect(result.status).toBe("invalid");
  if (result.status !== "invalid") throw new Error("expected invalid");
  return result.fields;
}

// ---------------------------------------------------------------------------
// 1. Guard: the honeypot
// ---------------------------------------------------------------------------

describe("createContactHandler — honeypot", () => {
  it("answers accepted for a filled default honeypot, with zero deliveries and zero limiter calls", async () => {
    const { handler, delivery, limiter } = makeHandler();
    const result = await submit(handler, { ...valid, website: "http://spam.example" });
    expect(result).toStrictEqual({ status: "accepted" });
    expect(delivery.deliver).not.toHaveBeenCalled();
    expect(limiter.check).not.toHaveBeenCalled();
  });

  it("answers accepted for a filled honeypot whatever else the submission holds", async () => {
    const { handler, delivery, limiter } = makeHandler();
    expect(await submit(handler, { website: "x" })).toStrictEqual({ status: "accepted" });
    expect(await submit(handler, { topic: 5, name: null, website: "x" })).toStrictEqual({ status: "accepted" });
    expect(delivery.deliver).not.toHaveBeenCalled();
    expect(limiter.check).not.toHaveBeenCalled();
  });

  it("honours a custom honeypot field name", async () => {
    const { handler, delivery, limiter } = makeHandler({ honeypotField: "company_url" });
    const result = await submit(handler, { ...valid, company_url: "filled" });
    expect(result).toStrictEqual({ status: "accepted" });
    expect(delivery.deliver).not.toHaveBeenCalled();
    expect(limiter.check).not.toHaveBeenCalled();
  });

  it("with a custom honeypot name, the default name is just an ignored key", async () => {
    const { handler, delivery, limiter } = makeHandler({ honeypotField: "company_url" });
    const result = await submit(handler, { ...valid, website: "filled" });
    expect(result).toStrictEqual({ status: "accepted" });
    expect(limiter.check).toHaveBeenCalledTimes(1);
    expect(delivery.deliver).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(delivered(delivery))).not.toContain("filled");
  });

  it.each([
    ["a single space", " "],
    ["several spaces", "     "],
    ["a tab", "\t"],
    ["a newline", "\n"],
  ])("treats a whitespace-only honeypot (%s) as filled", async (_label, value) => {
    const { handler, delivery, limiter } = makeHandler();
    const result = await submit(handler, { ...valid, website: value });
    expect(result).toStrictEqual({ status: "accepted" });
    expect(delivery.deliver).not.toHaveBeenCalled();
    expect(limiter.check).not.toHaveBeenCalled();
  });

  it.each([
    ["the number 1", 1],
    ["the number 0", 0],
    ["true", true],
    ["false", false],
    ["an empty array", []],
    ["an empty object", {}],
    ["an array of strings", ["x"]],
    ["an object", { a: 1 }],
  ])("treats a non-string honeypot (%s) as filled", async (_label, value) => {
    const { handler, delivery, limiter } = makeHandler();
    const result = await submit(handler, { ...valid, website: value });
    expect(result).toStrictEqual({ status: "accepted" });
    expect(delivery.deliver).not.toHaveBeenCalled();
    expect(limiter.check).not.toHaveBeenCalled();
  });

  it.each([
    ["absent", undefined, false],
    ["undefined", undefined, true],
    ["null", null, true],
    ["an empty string", "", true],
  ])("does not treat a honeypot that is %s as filled", async (_label, value, present) => {
    const { handler, delivery, limiter } = makeHandler();
    const submission = present ? { ...valid, website: value } : { ...valid };
    const result = await submit(handler, submission);
    expect(result).toStrictEqual({ status: "accepted" });
    expect(limiter.check).toHaveBeenCalledTimes(1);
    expect(delivery.deliver).toHaveBeenCalledTimes(1);
  });

  it("does not exercise a broken limiter when the honeypot is filled", async () => {
    const limiter = {
      check: vi.fn((): boolean => {
        throw new Error("limiter down");
      }),
    };
    const { handler, delivery } = makeHandler({ limiter });
    const result = await submit(handler, { ...valid, website: "x" });
    expect(result).toStrictEqual({ status: "accepted" });
    expect(limiter.check).not.toHaveBeenCalled();
    expect(delivery.deliver).not.toHaveBeenCalled();
  });

  it("checks the client key before the honeypot: a bad key is unavailable even for a filled honeypot", async () => {
    const { handler, delivery, limiter } = makeHandler();
    const result = await submit(handler, { ...valid, website: "x" }, "");
    expect(result).toStrictEqual({ status: "unavailable" });
    expect(delivery.deliver).not.toHaveBeenCalled();
    expect(limiter.check).not.toHaveBeenCalled();
  });

  it("does not read the honeypot from a non-object submission", async () => {
    const { handler, delivery, limiter } = makeHandler();
    const result = await submit(handler, "website");
    expect(result.status).toBe("invalid");
    expect(delivery.deliver).not.toHaveBeenCalled();
    expect(limiter.check).not.toHaveBeenCalled();
  });

  it("does not read an inherited honeypot property", async () => {
    const { handler, delivery } = makeHandler();
    const submission = Object.assign(Object.create({ website: "inherited" }), valid);
    const result = await submit(handler, submission);
    expect(result).toStrictEqual({ status: "accepted" });
    expect(delivery.deliver).toHaveBeenCalledTimes(1);
  });
});

describe("createContactHandler — honeypotField configuration", () => {
  it.each(["topic", "name", "email", "phone", "message"] satisfies ContactFieldName[])(
    "refuses a honeypot named after the field %s",
    (field) => {
      expect(() => makeHandler({ honeypotField: field })).toThrow();
    },
  );

  it.each([
    ["empty", ""],
    ["starting with a digit", "1abc"],
    ["starting with an underscore", "_abc"],
    ["containing a space", "a b"],
    ["containing a dot", "a.b"],
    ["containing a newline", "abc\n"],
    ["65 characters long", "a".repeat(65)],
    ["non-ASCII", "sité"],
  ])("refuses a honeypot name that is %s", (_label, honeypotField) => {
    expect(() => makeHandler({ honeypotField })).toThrow();
  });

  it("refuses a non-string honeypot name", () => {
    expect(() => makeHandler({ honeypotField: 5 as never })).toThrow();
  });

  it.each(["a", "website", "Company-Url_2", "a".repeat(64)])("accepts the honeypot name %s", (honeypotField) => {
    expect(() => makeHandler({ honeypotField })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 2. Guard: limiter and client key
// ---------------------------------------------------------------------------

describe("createContactHandler — limiter failures fail closed", () => {
  it("answers unavailable when the limiter throws synchronously", async () => {
    const limiter = {
      check: vi.fn((): boolean => {
        throw new Error("limiter down");
      }),
    };
    const { handler, delivery } = makeHandler({ limiter });
    expect(await submit(handler, valid)).toStrictEqual({ status: "unavailable" });
    expect(limiter.check).toHaveBeenCalledTimes(1);
    expect(delivery.deliver).not.toHaveBeenCalled();
  });

  it("answers unavailable when the limiter rejects", async () => {
    const limiter = { check: vi.fn(async () => Promise.reject(new Error("limiter down"))) };
    const { handler, delivery } = makeHandler({ limiter: limiter as never });
    expect(await submit(handler, valid)).toStrictEqual({ status: "unavailable" });
    expect(limiter.check).toHaveBeenCalledTimes(1);
    expect(delivery.deliver).not.toHaveBeenCalled();
  });

  it.each([
    ["the number 1", 1],
    ["the number 0", 0],
    ["undefined", undefined],
    ["null", null],
    ['the string "true"', "true"],
    ["an object", {}],
    ["an array", [true]],
  ])("answers unavailable when the limiter returns %s", async (_label, answer) => {
    const limiter = { check: vi.fn(() => answer) };
    const { handler, delivery } = makeHandler({ limiter: limiter as never });
    expect(await submit(handler, valid)).toStrictEqual({ status: "unavailable" });
    expect(delivery.deliver).not.toHaveBeenCalled();
  });

  it.each([
    ["the number 1", 1],
    ["undefined", undefined],
    ['the string "true"', "true"],
  ])("answers unavailable when the limiter resolves %s", async (_label, answer) => {
    const limiter = { check: vi.fn(async () => answer) };
    const { handler, delivery } = makeHandler({ limiter: limiter as never });
    expect(await submit(handler, valid)).toStrictEqual({ status: "unavailable" });
    expect(delivery.deliver).not.toHaveBeenCalled();
  });

  it("answers rate-limited when the limiter returns false", async () => {
    const limiter = makeLimiter(false);
    const { handler, delivery } = makeHandler({ limiter });
    expect(await submit(handler, valid)).toStrictEqual({ status: "rate-limited" });
    expect(limiter.check).toHaveBeenCalledTimes(1);
    expect(delivery.deliver).not.toHaveBeenCalled();
  });

  it("answers rate-limited when the limiter resolves false", async () => {
    const limiter = { check: vi.fn(async () => false) };
    const { handler, delivery } = makeHandler({ limiter });
    expect(await submit(handler, valid)).toStrictEqual({ status: "rate-limited" });
    expect(delivery.deliver).not.toHaveBeenCalled();
  });

  it("proceeds to delivery only for exactly true", async () => {
    const limiter = { check: vi.fn(async () => true) };
    const { handler, delivery } = makeHandler({ limiter });
    expect(await submit(handler, valid)).toStrictEqual({ status: "accepted" });
    expect(delivery.deliver).toHaveBeenCalledTimes(1);
  });

  it("asks the limiter exactly once per valid submission, with the client key verbatim", async () => {
    const { handler, limiter } = makeHandler();
    const key = "  client key/1:abc  ";
    await submit(handler, valid, key);
    expect(limiter.check).toHaveBeenCalledTimes(1);
    expect(limiter.check).toHaveBeenCalledWith(key);
  });

  it("does not ask the limiter for an invalid submission", async () => {
    const { handler, limiter, delivery } = makeHandler();
    expect((await submit(handler, { ...valid, email: "nope" })).status).toBe("invalid");
    expect(limiter.check).not.toHaveBeenCalled();
    expect(delivery.deliver).not.toHaveBeenCalled();
  });

  it("does not deliver until the limiter's answer has arrived", async () => {
    let release: (value: boolean) => void = () => {};
    const pending = new Promise<boolean>((resolve) => {
      release = resolve;
    });
    const limiter = { check: vi.fn(() => pending) };
    const { handler, delivery } = makeHandler({ limiter });
    const promise = submit(handler, valid);
    await Promise.resolve();
    await Promise.resolve();
    expect(delivery.deliver).not.toHaveBeenCalled();
    release(true);
    expect(await promise).toStrictEqual({ status: "accepted" });
    expect(delivery.deliver).toHaveBeenCalledTimes(1);
  });
});

describe("createContactHandler — client key boundary", () => {
  it.each([
    ["an empty string", ""],
    ["a whitespace-only string", "   "],
    ["a tab-and-newline string", "\t\n"],
    ["a 257-character string", "k".repeat(CONTACT_CLIENT_KEY_MAX_LENGTH + 1)],
    ["a 10 000-character string", "k".repeat(10_000)],
    ["undefined", undefined],
    ["null", null],
    ["a number", 5],
    ["an object", { toString: () => "key" }],
    ["an array", ["key"]],
  ])("answers unavailable for a client key that is %s, with zero limiter calls and zero deliveries", async (_label, key) => {
    const { handler, delivery, limiter } = makeHandler();
    expect(await submit(handler, valid, key)).toStrictEqual({ status: "unavailable" });
    expect(limiter.check).not.toHaveBeenCalled();
    expect(delivery.deliver).not.toHaveBeenCalled();
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a string", "client-1"],
    ["a number", 5],
    ["an empty object", {}],
    ["an object with a non-string clientKey", { clientKey: 5 }],
  ])("answers unavailable when options are %s", async (_label, options) => {
    const { handler, delivery, limiter } = makeHandler();
    const result = await handler.handle(valid, options as never);
    expect(result).toStrictEqual({ status: "unavailable" });
    expect(limiter.check).not.toHaveBeenCalled();
    expect(delivery.deliver).not.toHaveBeenCalled();
  });

  it("checks the client key before validation: a bad key with an invalid submission is unavailable", async () => {
    const { handler, limiter } = makeHandler();
    expect(await submit(handler, {}, "")).toStrictEqual({ status: "unavailable" });
    expect(limiter.check).not.toHaveBeenCalled();
  });

  it("accepts a client key of exactly 256 characters and passes it through unchanged", async () => {
    const { handler, limiter, delivery } = makeHandler();
    const key = "k".repeat(CONTACT_CLIENT_KEY_MAX_LENGTH);
    expect(await submit(handler, valid, key)).toStrictEqual({ status: "accepted" });
    expect(limiter.check).toHaveBeenCalledWith(key);
    expect(delivery.deliver).toHaveBeenCalledTimes(1);
  });

  it("exposes the maximum client key length as 256", () => {
    expect(CONTACT_CLIENT_KEY_MAX_LENGTH).toBe(256);
  });
});

describe("createContactHandler — onUnavailable", () => {
  it("receives client-key for a bad client key", async () => {
    const onUnavailable = vi.fn();
    const { handler } = makeHandler({ onUnavailable });
    await submit(handler, valid, "");
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(onUnavailable).toHaveBeenCalledWith("client-key");
  });

  it("receives limiter-failed when the limiter throws", async () => {
    const onUnavailable = vi.fn();
    const limiter = {
      check: vi.fn((): boolean => {
        throw new Error(`boom ${MARKER}`);
      }),
    };
    const { handler } = makeHandler({ limiter, onUnavailable });
    await submit(handler, valid);
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(onUnavailable).toHaveBeenCalledWith("limiter-failed");
  });

  it("receives limiter-failed when the limiter rejects", async () => {
    const onUnavailable = vi.fn();
    const limiter = { check: vi.fn(async () => Promise.reject(new Error("down"))) };
    const { handler } = makeHandler({ limiter: limiter as never, onUnavailable });
    await submit(handler, valid);
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(onUnavailable).toHaveBeenCalledWith("limiter-failed");
  });

  it("receives limiter-non-boolean when the limiter answers with a non-boolean", async () => {
    const onUnavailable = vi.fn();
    const limiter = { check: vi.fn(() => 1) };
    const { handler } = makeHandler({ limiter: limiter as never, onUnavailable });
    await submit(handler, valid);
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(onUnavailable).toHaveBeenCalledWith("limiter-non-boolean");
  });

  it("receives message-id-failed when the id source throws", async () => {
    const onUnavailable = vi.fn();
    const { handler } = makeHandler({
      onUnavailable,
      createMessageId: () => {
        throw new Error("no id");
      },
    });
    await submit(handler, valid);
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(onUnavailable).toHaveBeenCalledWith("message-id-failed");
  });

  it("receives delivery-failed, as a code only, when delivery throws", async () => {
    const onUnavailable = vi.fn();
    const delivery = {
      channel: "email" as const,
      deliver: vi.fn(async () => {
        throw new Error(`provider rejected reply-to ${valid.email} ${MARKER}`);
      }),
    };
    const { handler } = makeHandler({ delivery, onUnavailable });
    await submit(handler, valid);
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(onUnavailable.mock.calls[0]).toEqual(["delivery-failed"]);
  });

  it("is not called for accepted, invalid or rate-limited outcomes", async () => {
    const onUnavailable = vi.fn();
    const limiter = { check: vi.fn(() => true) };
    const { handler } = makeHandler({ limiter, onUnavailable });
    await submit(handler, valid);
    await submit(handler, {});
    await submit(handler, { ...valid, website: "x" });
    limiter.check.mockReturnValue(false);
    await submit(handler, valid);
    expect(onUnavailable).not.toHaveBeenCalled();
  });

  it("has its own throw swallowed without changing the result", async () => {
    const onUnavailable = vi.fn(() => {
      throw new Error("observer failed");
    });
    const limiter = {
      check: vi.fn((): boolean => {
        throw new Error("down");
      }),
    };
    const { handler } = makeHandler({ limiter, onUnavailable });
    await expect(submit(handler, valid)).resolves.toStrictEqual({ status: "unavailable" });
    expect(onUnavailable).toHaveBeenCalledTimes(1);
  });

  it("works without an observer", async () => {
    const { handler } = makeHandler();
    await expect(submit(handler, valid, "")).resolves.toStrictEqual({ status: "unavailable" });
  });
});

describe("createContactHandler — with the bundled memory limiter", () => {
  function makeLimitedHandler(limit: number) {
    const clock = { t: 0 };
    const limiter = createMemoryRateLimiter({ limit, windowMs: 60_000, now: () => clock.t });
    return { ...makeHandler({ limiter }), clock };
  }

  it("rate-limits the third valid call with limit 2, and accepts again after the window passes", async () => {
    const { handler, delivery, clock } = makeLimitedHandler(2);
    expect(await submit(handler, valid)).toStrictEqual({ status: "accepted" });
    expect(await submit(handler, valid)).toStrictEqual({ status: "accepted" });
    expect(await submit(handler, valid)).toStrictEqual({ status: "rate-limited" });
    expect(delivery.deliver).toHaveBeenCalledTimes(2);

    clock.t = 59_999;
    expect(await submit(handler, valid)).toStrictEqual({ status: "rate-limited" });
    expect(delivery.deliver).toHaveBeenCalledTimes(2);

    clock.t = 60_000;
    expect(await submit(handler, valid)).toStrictEqual({ status: "accepted" });
    expect(delivery.deliver).toHaveBeenCalledTimes(3);
  });

  it("keeps separate allowances per client key", async () => {
    const { handler, delivery } = makeLimitedHandler(1);
    expect(await submit(handler, valid, "one")).toStrictEqual({ status: "accepted" });
    expect(await submit(handler, valid, "one")).toStrictEqual({ status: "rate-limited" });
    expect(await submit(handler, valid, "two")).toStrictEqual({ status: "accepted" });
    expect(delivery.deliver).toHaveBeenCalledTimes(2);
  });

  it("does not spend the allowance on invalid submissions or honeypot hits", async () => {
    const { handler, delivery } = makeLimitedHandler(1);
    expect((await submit(handler, { ...valid, email: "nope" })).status).toBe("invalid");
    expect((await submit(handler, {})).status).toBe("invalid");
    expect(await submit(handler, { ...valid, website: "x" })).toStrictEqual({ status: "accepted" });
    expect(await submit(handler, valid)).toStrictEqual({ status: "accepted" });
    expect(delivery.deliver).toHaveBeenCalledTimes(1);
  });

  it("delivers exactly once when two calls for one key race with limit 1", async () => {
    const { handler, delivery } = makeLimitedHandler(1);
    const results = await Promise.all([submit(handler, valid), submit(handler, valid)]);
    expect(results.map((r) => r.status).sort()).toEqual(["accepted", "rate-limited"]);
    expect(delivery.deliver).toHaveBeenCalledTimes(1);
  });

  it("answers unavailable, never accepted, when the injected clock is broken", async () => {
    const limiter = createMemoryRateLimiter({ limit: 5, windowMs: 1000, now: () => Number.NaN });
    const { handler, delivery } = makeHandler({ limiter });
    expect(await submit(handler, valid)).toStrictEqual({ status: "unavailable" });
    expect(delivery.deliver).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. Guard: header and line injection
// ---------------------------------------------------------------------------

const CONTROL_CHARS: ReadonlyArray<readonly [string, string]> = [
  ["CR", "\r"],
  ["LF", "\n"],
  ["CRLF", "\r\n"],
  ["NUL", "\0"],
  ["BEL", "\u0007"],
  ["ESC", "\u001b"],
  ["DEL", "\u007f"],
  ["NEL (U+0085)", "\u0085"],
  ["C1 U+009F", "\u009f"],
];

const SINGLE_LINE_ONLY_CHARS: ReadonlyArray<readonly [string, string]> = [
  ["TAB", "\t"],
  ["LINE SEPARATOR (U+2028)", " "],
  ["PARAGRAPH SEPARATOR (U+2029)", " "],
];

const SINGLE_LINE_FIELDS: ReadonlyArray<readonly [Exclude<ContactFieldName, "message">, (c: string) => string]> = [
  ["name", (c) => `Ada${c}Lovelace`],
  ["email", (c) => `ada${c}@${DOMAIN}`],
  ["topic", (c) => `general${c}`],
  ["phone", (c) => `555${c}0100`],
];

const injectionCases = SINGLE_LINE_FIELDS.flatMap(([field, build]) =>
  [...CONTROL_CHARS, ...SINGLE_LINE_ONLY_CHARS].map(
    ([label, char]) => [field, label, build(char)] as const,
  ),
);

describe("createContactHandler — header and line injection", () => {
  it.each(injectionCases)(
    "refuses %s containing %s with control-character, delivering nothing and never asking the limiter",
    async (field, _label, value) => {
      const { handler, delivery, limiter } = makeHandler();
      const result = await submit(handler, { ...valid, [field]: value });
      expect(result).toStrictEqual({ status: "invalid", fields: [{ field, code: "control-character" }] });
      expect(delivery.deliver).not.toHaveBeenCalled();
      expect(limiter.check).not.toHaveBeenCalled();
    },
  );

  it.each(["name", "email", "topic"] as const)(
    "refuses a %s whose only control character is at the very end or start",
    async (field) => {
      const { handler, delivery, limiter } = makeHandler();
      const base = valid[field];
      for (const value of [`${base}\r\n`, `\r\n${base}`, `${base}\n`, `\n${base}`, `${base}\r`]) {
        const result = await submit(handler, { ...valid, [field]: value });
        expect(result).toStrictEqual({ status: "invalid", fields: [{ field, code: "control-character" }] });
      }
      expect(delivery.deliver).not.toHaveBeenCalled();
      expect(limiter.check).not.toHaveBeenCalled();
    },
  );

  it("refuses a value that is only control characters as control-character, not required", async () => {
    const { handler } = makeHandler();
    const result = await submit(handler, { ...valid, name: "\r\n" });
    expect(result).toStrictEqual({ status: "invalid", fields: [{ field: "name", code: "control-character" }] });
  });

  it("refuses a Bcc header smuggled after a line break in the name", async () => {
    const { handler, delivery, limiter } = makeHandler();
    const result = await submit(handler, { ...valid, name: "Ada\r\nBcc: x@example.com" });
    expect(result).toStrictEqual({ status: "invalid", fields: [{ field: "name", code: "control-character" }] });
    expect(delivery.deliver).not.toHaveBeenCalled();
    expect(limiter.check).not.toHaveBeenCalled();
  });

  it("refuses a Bcc header smuggled after a line break in the email", async () => {
    const { handler, delivery } = makeHandler();
    const result = await submit(handler, { ...valid, email: "ada@example.com\r\nBcc: x@example.com" });
    expect(result).toStrictEqual({ status: "invalid", fields: [{ field: "email", code: "control-character" }] });
    expect(delivery.deliver).not.toHaveBeenCalled();
  });

  it("reports every injected field, in field order", async () => {
    const { handler } = makeHandler();
    const result = await submit(handler, { ...valid, topic: "a\nb", name: "a\rb", email: "a\0b", phone: "5 5" });
    expect(issuesOf(result)).toEqual([
      { field: "topic", code: "control-character" },
      { field: "name", code: "control-character" },
      { field: "email", code: "control-character" },
      { field: "phone", code: "control-character" },
    ]);
  });

  describe("message field", () => {
    it("allows CR, LF and tab", async () => {
      const { handler, delivery } = makeHandler();
      const result = await submit(handler, { ...valid, message: "line1\r\nline2\rline3\nline4\tindented" });
      expect(result).toStrictEqual({ status: "accepted" });
      expect(delivery.deliver).toHaveBeenCalledTimes(1);
    });

    it.each([
      ["NUL", "\0"],
      ["BEL", "\u0007"],
      ["ESC", "\u001b"],
      ["vertical tab", "\u000b"],
      ["form feed", "\u000c"],
      ["DEL", "\u007f"],
      ["NEL (U+0085)", "\u0085"],
      ["C1 U+009F", "\u009f"],
    ])("refuses %s with control-character", async (_label, char) => {
      const { handler, delivery, limiter } = makeHandler();
      const result = await submit(handler, { ...valid, message: `first${char}second` });
      expect(result).toStrictEqual({ status: "invalid", fields: [{ field: "message", code: "control-character" }] });
      expect(delivery.deliver).not.toHaveBeenCalled();
      expect(limiter.check).not.toHaveBeenCalled();
    });

    it("refuses a control character even when it follows permitted ones", async () => {
      const { handler, delivery } = makeHandler();
      const result = await submit(handler, { ...valid, message: "ok\r\n\t\0" });
      expect(result).toStrictEqual({ status: "invalid", fields: [{ field: "message", code: "control-character" }] });
      expect(delivery.deliver).not.toHaveBeenCalled();
    });

    it("permits U+2028 and U+2029, which are not category Cc", async () => {
      const { handler, delivery } = makeHandler();
      const result = await submit(handler, { ...valid, message: "a b c" });
      expect(result).toStrictEqual({ status: "accepted" });
      expect(delivery.deliver).toHaveBeenCalledTimes(1);
    });
  });
});

// ---------------------------------------------------------------------------
// 4. Guard: stub delivery never delivers in production
// ---------------------------------------------------------------------------

describe("createContactHandler — stub delivery", () => {
  it("refuses at construction when the target is production", () => {
    expect(() => makeHandler({ target: "production", delivery: createStubContactDelivery() })).toThrow();
  });

  it("refuses production even when the stub is the same one used elsewhere", () => {
    const stub = createStubContactDelivery();
    makeHandler({ target: "preview", delivery: stub });
    expect(() => makeHandler({ target: "production", delivery: stub })).toThrow();
  });

  it("refuses a production handler whose delivery inherits the stub brand", () => {
    const stub = createStubContactDelivery();
    const derived = Object.create(stub) as typeof stub;
    expect(() => makeHandler({ target: "production", delivery: derived })).toThrow();
  });

  it("refuses a production handler whose delivery carries the brand with a falsy value", () => {
    const forged = { channel: "email" as const, deliver: async () => undefined, [STUB_CONTACT_DELIVERY]: false };
    expect(() => makeHandler({ target: "production", delivery: forged as never })).toThrow();
  });

  it.each(["preview", "development", "test"] as const)("constructs with a stub when the target is %s", (target) => {
    expect(() => makeHandler({ target, delivery: createStubContactDelivery() })).not.toThrow();
  });

  it("delivers a valid submission into the stub exactly once, and answers accepted", async () => {
    const stub = createStubContactDelivery();
    const { handler } = makeHandler({ target: "preview", delivery: stub });
    expect(await submit(handler, valid)).toStrictEqual({ status: "accepted" });
    expect(stub.deliveries).toHaveLength(1);
    const [message] = stub.deliveries;
    expect(message?.id).toBe("msg-1");
    expect(message?.text).toBe(EXPECTED_TEXT_WITH_PHONE);
    expect(message?.replyTo).toEqual([valid.email]);
  });

  it("records nothing in the stub for a refused submission", async () => {
    const stub = createStubContactDelivery();
    const { handler } = makeHandler({ target: "preview", delivery: stub, limiter: makeLimiter(false) });
    expect(await submit(handler, valid)).toStrictEqual({ status: "rate-limited" });
    expect(await submit(handler, {})).toMatchObject({ status: "invalid" });
    expect(await submit(handler, { ...valid, website: "x" })).toStrictEqual({ status: "accepted" });
    expect(stub.deliveries).toHaveLength(0);
  });

  it("keeps deliveries in call order and separate per stub", async () => {
    const stubA = createStubContactDelivery();
    const stubB = createStubContactDelivery();
    let counter = 0;
    const { handler } = makeHandler({ target: "test", delivery: stubA, createMessageId: () => `m-${(counter += 1)}` });
    await submit(handler, valid);
    await submit(handler, { ...valid, name: "Grace Hopper" });
    expect(stubA.deliveries.map((m) => m.id)).toEqual(["m-1", "m-2"]);
    expect(stubB.deliveries).toHaveLength(0);
  });

  it("carries the brand and the email channel", () => {
    const stub = createStubContactDelivery();
    expect(STUB_CONTACT_DELIVERY in stub).toBe(true);
    expect(stub[STUB_CONTACT_DELIVERY]).toBe(true);
    expect(stub.channel).toBe("email");
    expect(STUB_CONTACT_DELIVERY).toBe(Symbol.for("publisher.web.contact.stub-delivery"));
  });

  it("resolves the stub's acceptance with the stub provider and the message id", async () => {
    const stub = createStubContactDelivery();
    const message = {
      id: "abc",
      event: "publisher.contact.submitted",
      category: "contact",
      channel: "email",
      from: FROM,
      to: [...TO],
      replyTo: [valid.email],
      subject: SUBJECT,
      text: "body",
    } as unknown as ContactOutboundMessage;
    await expect(stub.deliver(message)).resolves.toEqual({ provider: "stub", messageId: "abc" });
    expect(stub.deliveries).toHaveLength(1);
  });

  it("stores frozen copies, not the caller's object", async () => {
    const stub = createStubContactDelivery();
    const message = {
      id: "abc",
      event: "publisher.contact.submitted",
      category: "contact",
      channel: "email",
      from: FROM,
      to: [...TO],
      replyTo: [valid.email],
      subject: SUBJECT,
      text: "body",
    } as unknown as ContactOutboundMessage;
    await stub.deliver(message);
    const [stored] = stub.deliveries;
    expect(stored).toEqual(message);
    expect(stored).not.toBe(message);
    expect(Object.isFrozen(stored)).toBe(true);
  });

  it.each([
    ["prod", "prod"],
    ["Production", "Production"],
    ["an empty string", ""],
    ["undefined", undefined],
    ["null", null],
    ["a number", 1],
  ])("refuses an unknown target (%s) at construction, even with a real delivery", (_label, target) => {
    expect(() => makeHandler({ target: target as never })).toThrow();
  });

  it('refuses the typo target "prod" with a stub too, so a typo cannot silently admit a stub', () => {
    expect(() => makeHandler({ target: "prod" as never, delivery: createStubContactDelivery() })).toThrow();
  });

  it("accepts a non-stub fake delivery with the production target", async () => {
    const { handler, delivery } = makeHandler({ target: "production" });
    expect(await submit(handler, valid)).toStrictEqual({ status: "accepted" });
    expect(delivery.deliver).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Per-field validation
// ---------------------------------------------------------------------------

describe("createContactHandler — topic", () => {
  it.each([
    ["an unlisted id", "billing"],
    ["a different case", "GENERAL"],
    ["a leading space", " general"],
    ["a trailing space", "general "],
    ["a prefix of a real id", "gen"],
    ["an id with a suffix", "general2"],
    ["a prototype key", "constructor"],
    ["__proto__", "__proto__"],
  ])("reports unknown-topic for %s", async (_label, topic) => {
    const { handler, delivery, limiter } = makeHandler();
    const result = await submit(handler, { ...valid, topic });
    expect(result).toStrictEqual({ status: "invalid", fields: [{ field: "topic", code: "unknown-topic" }] });
    expect(delivery.deliver).not.toHaveBeenCalled();
    expect(limiter.check).not.toHaveBeenCalled();
  });

  it("accepts every configured topic exactly", async () => {
    const { handler, delivery } = makeHandler();
    for (const topic of TOPICS) {
      expect(await submit(handler, { ...valid, topic })).toStrictEqual({ status: "accepted" });
    }
    expect(delivery.deliver).toHaveBeenCalledTimes(TOPICS.length);
  });

  it.each([
    ["empty", ""],
    ["whitespace-only", "   "],
  ])("reports required for a %s topic", async (_label, topic) => {
    const { handler } = makeHandler();
    const result = await submit(handler, { ...valid, topic });
    expect(result).toStrictEqual({ status: "invalid", fields: [{ field: "topic", code: "required" }] });
  });
});

describe("createContactHandler — missing required fields", () => {
  it.each(["topic", "name", "email", "message"] as const)("reports required when %s is absent", async (field) => {
    const { handler, delivery, limiter } = makeHandler();
    const submission: Record<string, unknown> = { ...valid };
    delete submission[field];
    const result = await submit(handler, submission);
    expect(result).toStrictEqual({ status: "invalid", fields: [{ field, code: "required" }] });
    expect(delivery.deliver).not.toHaveBeenCalled();
    expect(limiter.check).not.toHaveBeenCalled();
  });

  it.each(["topic", "name", "email", "message"] as const)("reports required when %s is undefined", async (field) => {
    const { handler } = makeHandler();
    const result = await submit(handler, { ...valid, [field]: undefined });
    expect(result).toStrictEqual({ status: "invalid", fields: [{ field, code: "required" }] });
  });

  it.each(["name", "email", "message"] as const)("reports required when %s is empty or whitespace-only", async (field) => {
    const { handler } = makeHandler();
    for (const value of ["", " ", "   ", " ", "　"]) {
      const result = await submit(handler, { ...valid, [field]: value });
      expect(result).toStrictEqual({ status: "invalid", fields: [{ field, code: "required" }] });
    }
  });

  it("reports required for a message of only permitted whitespace (tab, CR, LF)", async () => {
    const { handler } = makeHandler();
    const result = await submit(handler, { ...valid, message: "\t\r\n \n" });
    expect(result).toStrictEqual({ status: "invalid", fields: [{ field: "message", code: "required" }] });
  });

  it("reports required for every required field, in order, for an empty submission", async () => {
    const { handler } = makeHandler();
    expect(issuesOf(await submit(handler, {}))).toEqual([
      { field: "topic", code: "required" },
      { field: "name", code: "required" },
      { field: "email", code: "required" },
      { field: "message", code: "required" },
    ]);
  });

  it("never reports required for phone", async () => {
    const { handler, delivery } = makeHandler();
    for (const phone of [undefined, "", "   ", "\t"] as const) {
      const submission = phone === undefined ? { ...validWithoutPhone } : { ...valid, phone };
      // a tab is a control character in a single-line field, so it is refused as such, not as required
      const result = await submit(handler, submission);
      if (phone === "\t") {
        expect(result).toStrictEqual({ status: "invalid", fields: [{ field: "phone", code: "control-character" }] });
      } else {
        expect(result).toStrictEqual({ status: "accepted" });
      }
    }
    expect(delivery.deliver).toHaveBeenCalledTimes(3);
  });

  it("does not read inherited properties", async () => {
    const { handler, delivery } = makeHandler();
    const inherited = Object.create(valid);
    const result = await submit(handler, inherited);
    expect(issuesOf(result)).toEqual([
      { field: "topic", code: "required" },
      { field: "name", code: "required" },
      { field: "email", code: "required" },
      { field: "message", code: "required" },
    ]);
    expect(delivery.deliver).not.toHaveBeenCalled();
  });
});

describe("createContactHandler — non-string values", () => {
  it.each([
    ["a number", 5],
    ["null", null],
    ["true", true],
    ["false", false],
    ["an array", ["x"]],
    ["an object", { a: 1 }],
    ["a bigint", 10n],
  ])("reports not-a-string for a %s in every field", async (_label, value) => {
    const { handler, delivery, limiter } = makeHandler();
    const result = await submit(handler, { topic: value, name: value, email: value, phone: value, message: value });
    expect(issuesOf(result)).toEqual([
      { field: "topic", code: "not-a-string" },
      { field: "name", code: "not-a-string" },
      { field: "email", code: "not-a-string" },
      { field: "phone", code: "not-a-string" },
      { field: "message", code: "not-a-string" },
    ]);
    expect(delivery.deliver).not.toHaveBeenCalled();
    expect(limiter.check).not.toHaveBeenCalled();
  });

  it("reports not-a-string for a single non-string field and leaves the others alone", async () => {
    const { handler } = makeHandler();
    expect(await submit(handler, { ...valid, name: 42 })).toStrictEqual({
      status: "invalid",
      fields: [{ field: "name", code: "not-a-string" }],
    });
  });

  it("reports not-a-string, not required, for null and an empty array", async () => {
    const { handler } = makeHandler();
    expect(issuesOf(await submit(handler, { ...valid, email: null }))).toEqual([{ field: "email", code: "not-a-string" }]);
    expect(issuesOf(await submit(handler, { ...valid, message: [] }))).toEqual([{ field: "message", code: "not-a-string" }]);
  });

  it("treats a String object as not-a-string", async () => {
    const { handler } = makeHandler();
    const result = await submit(handler, { ...valid, name: new String("Ada") });
    expect(issuesOf(result)).toEqual([{ field: "name", code: "not-a-string" }]);
  });
});

describe("createContactHandler — non-object submissions", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "x"],
    ["an empty string", ""],
    ["an array", []],
    ["an array of fields", [valid]],
    ["a number", 5],
    ["a boolean", true],
    ["a bigint", 10n],
    ["a symbol", Symbol("x")],
    ["a function", () => valid],
  ])("reads %s as an empty record, so every required field is required", async (_label, submission) => {
    const { handler, delivery, limiter } = makeHandler();
    const result = await submit(handler, submission);
    expect(result).toStrictEqual({
      status: "invalid",
      fields: [
        { field: "topic", code: "required" },
        { field: "name", code: "required" },
        { field: "email", code: "required" },
        { field: "message", code: "required" },
      ],
    });
    expect(delivery.deliver).not.toHaveBeenCalled();
    expect(limiter.check).not.toHaveBeenCalled();
  });

  it("accepts a null-prototype object", async () => {
    const { handler, delivery } = makeHandler();
    const submission = Object.assign(Object.create(null), valid);
    expect(await submit(handler, submission)).toStrictEqual({ status: "accepted" });
    expect(delivery.deliver).toHaveBeenCalledTimes(1);
  });

  it("does not read fields from an array that has them as properties", async () => {
    const { handler } = makeHandler();
    const submission = Object.assign([], valid);
    expect(issuesOf(await submit(handler, submission))).toHaveLength(4);
  });
});

describe("createContactHandler — email shape", () => {
  it.each([
    ["no @", "ada.example.com"],
    ["an empty local part", `@${DOMAIN}`],
    ["an empty domain", "ada@"],
    ["two @", "a@b@example.com"],
    ["a space in the local part", "a b@example.com"],
    ["a space in the domain", "ada@exa mple.com"],
    ["a single-label domain", "a@b"],
    ["angle brackets", "<a@b.co>"],
    ["a display name", "Ada <ada@example.com>"],
    ["a comma-separated list", "a@b.co,c@d.co"],
    ["a semicolon-separated list", "a@b.co;c@d.co"],
    ["a space-separated list", "a@b.co c@d.co"],
    ["a leading dot", ".a@b.co"],
    ["a trailing dot in the local part", "a.@b.co"],
    ["a doubled dot in the local part", "a..b@b.co"],
    ["a trailing dot in the domain", "ada@example.com."],
    ["an empty domain label", "ada@example..com"],
    ["a domain label starting with a hyphen", "ada@-example.com"],
    ["a domain label ending with a hyphen", "ada@example-.com"],
    ["a leading dot in the domain", "ada@.example.com"],
    ["a non-ASCII local part", `adá@${DOMAIN}`],
    ["a non-ASCII domain", "ada@exämple.com"],
    ["a quoted local part", `"a b"@${DOMAIN}`],
    ["a parenthesised comment", `ada(comment)@${DOMAIN}`],
    ["a backslash", "a\\b@example.com"],
    ["an underscore in the domain", "ada@exa_mple.com"],
    ["a local part of 65 characters", `${"a".repeat(65)}@${DOMAIN}`],
  ])("reports malformed for %s", async (_label, email) => {
    const { handler, delivery, limiter } = makeHandler();
    const result = await submit(handler, { ...valid, email });
    expect(result).toStrictEqual({ status: "invalid", fields: [{ field: "email", code: "malformed" }] });
    expect(delivery.deliver).not.toHaveBeenCalled();
    expect(limiter.check).not.toHaveBeenCalled();
  });

  it.each([
    ["a plain address", "ada@example.com"],
    ["a tagged address", "first.last+tag@sub.example.co"],
    ["an apostrophe", "o'brien@example.com"],
    ["allowed punctuation", "a!#$%&'*+/=?^_`{|}~-b@example.com"],
    ["a numeric domain label", "ada@123.example.com"],
    ["a hyphen inside a label", "ada@ex-ample.com"],
    ["a local part of exactly 64 characters", `${"a".repeat(64)}@${DOMAIN}`],
    ["uppercase", "ADA@EXAMPLE.COM"],
  ])("accepts %s", async (_label, email) => {
    const { handler, delivery } = makeHandler();
    expect(await submit(handler, { ...valid, email })).toStrictEqual({ status: "accepted" });
    expect(delivered(delivery).replyTo).toEqual([email]);
  });

  it("trims surrounding whitespace before validating, and uses the trimmed address as replyTo", async () => {
    const { handler, delivery } = makeHandler();
    expect(await submit(handler, { ...valid, email: "  ada@example.com  " })).toStrictEqual({ status: "accepted" });
    const message = delivered(delivery);
    expect(message.replyTo).toEqual(["ada@example.com"]);
    expect(message.text).toContain("Email: ada@example.com\n");
  });
});

describe("createContactHandler — phone shape", () => {
  it.each([
    ["letters", "call me"],
    ["letters mixed with digits", "555-abcd"],
    ["markup", "555<script>"],
    ["no digit", "+-() "],
    ["only punctuation", "..."],
    ["an @", "555@0100"],
    ["a comma", "555,0100"],
    ["a non-ASCII digit", "٥٥٥"],
    ["a full-width digit", "５５５"],
  ])("reports malformed for %s", async (_label, phone) => {
    const { handler, delivery, limiter } = makeHandler();
    const result = await submit(handler, { ...valid, phone });
    expect(result).toStrictEqual({ status: "invalid", fields: [{ field: "phone", code: "malformed" }] });
    expect(delivery.deliver).not.toHaveBeenCalled();
    expect(limiter.check).not.toHaveBeenCalled();
  });

  it.each([
    ["an international number", "+1 (555) 010-0100"],
    ["dots", "555.010.0100"],
    ["an extension with x", "555 010 0100 x123"],
    ["an extension with X", "555 010 0100 X123"],
    ["slashes, hashes and stars", "555/010#*1"],
    ["a single digit", "5"],
  ])("accepts %s", async (_label, phone) => {
    const { handler, delivery } = makeHandler();
    expect(await submit(handler, { ...valid, phone })).toStrictEqual({ status: "accepted" });
    expect(delivered(delivery).text).toContain(`Phone: ${phone}\n`);
  });

  it.each([
    ["an empty string", ""],
    ["whitespace only", "   "],
  ])("treats %s as absent: no Phone line and no issue", async (_label, phone) => {
    const { handler, delivery } = makeHandler();
    expect(await submit(handler, { ...valid, phone })).toStrictEqual({ status: "accepted" });
    expect(delivered(delivery).text).toBe(EXPECTED_TEXT_WITHOUT_PHONE);
  });
});

// ---------------------------------------------------------------------------
// Caps
// ---------------------------------------------------------------------------

describe("createContactHandler — length caps", () => {
  const defaultCaps: ReadonlyArray<readonly [ContactFieldName, string]> = [
    ["topic", "x".repeat(CONTACT_DEFAULT_CAPS.topic + 1)],
    ["name", "n".repeat(CONTACT_DEFAULT_CAPS.name + 1)],
    ["email", "e".repeat(CONTACT_DEFAULT_CAPS.email + 1)],
    ["phone", "5".repeat(CONTACT_DEFAULT_CAPS.phone + 1)],
    ["message", "m".repeat(CONTACT_DEFAULT_CAPS.message + 1)],
  ];

  it("exposes the documented default caps", () => {
    expect(CONTACT_DEFAULT_CAPS).toEqual({ topic: 100, name: 100, email: 254, phone: 40, message: 5000, total: 6000 });
  });

  it.each(defaultCaps)("reports too-long, and only too-long, when %s is one over its default cap", async (field, value) => {
    const { handler, delivery, limiter } = makeHandler();
    const result = await submit(handler, { ...valid, [field]: value });
    expect(result).toStrictEqual({ status: "invalid", fields: [{ field, code: "too-long" }] });
    expect(delivery.deliver).not.toHaveBeenCalled();
    expect(limiter.check).not.toHaveBeenCalled();
  });

  it("reports too-long before control-character, required-shape or malformed checks", async () => {
    const { handler } = makeHandler();
    expect(issuesOf(await submit(handler, { ...valid, name: `${"a".repeat(101)}\r` }))).toEqual([
      { field: "name", code: "too-long" },
    ]);
    expect(issuesOf(await submit(handler, { ...valid, email: `${"a".repeat(255)}\n` }))).toEqual([
      { field: "email", code: "too-long" },
    ]);
    expect(issuesOf(await submit(handler, { ...valid, message: `${"a".repeat(5001)}\0` }))).toEqual([
      { field: "message", code: "too-long" },
    ]);
  });

  it("measures the raw value, before trimming", async () => {
    const { handler } = makeHandler();
    const result = await submit(handler, { ...valid, name: `${" ".repeat(101)}Ada` });
    expect(issuesOf(result)).toEqual([{ field: "name", code: "too-long" }]);
  });

  it("measures in UTF-16 code units", async () => {
    const { handler } = makeHandler({ caps: { name: 4 } });
    // Two astral characters are four code units: allowed. Three are six: too long.
    expect(await submit(handler, { ...valid, name: "\u{1F600}\u{1F600}" })).toStrictEqual({ status: "accepted" });
    expect(issuesOf(await submit(handler, { ...valid, name: "\u{1F600}\u{1F600}\u{1F600}" }))).toEqual([
      { field: "name", code: "too-long" },
    ]);
  });

  it("accepts values exactly at their caps", async () => {
    const { handler, delivery } = makeHandler();
    const result = await submit(handler, { ...valid, name: "n".repeat(100), message: "m".repeat(5000) });
    expect(result).toStrictEqual({ status: "accepted" });
    expect(delivery.deliver).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["topic", { topic: 3 }],
    ["name", { name: 5 }],
    ["email", { email: 10 }],
    ["phone", { phone: 4 }],
    ["message", { message: 10 }],
  ] as const)("honours a caps override for %s", async (field, caps) => {
    const topics = field === "topic" ? (["gen"] as const) : undefined;
    const { handler, delivery } = makeHandler({
      caps,
      ...(topics === undefined ? {} : { topics: [...topics] as unknown as readonly [string, ...string[]] }),
    });
    const submission = field === "topic" ? { ...valid, topic: "gen" } : { ...valid };
    const result = await submit(handler, submission);
    if (field === "topic") {
      expect(result).toStrictEqual({ status: "accepted" });
      expect(issuesOf(await submit(handler, { ...valid, topic: "gene" }))).toEqual([{ field: "topic", code: "too-long" }]);
    } else {
      expect(issuesOf(result)).toContainEqual({ field, code: "too-long" });
      expect(delivery.deliver).not.toHaveBeenCalled();
    }
  });

  it("keeps the other default caps when only one is overridden", async () => {
    const { handler, delivery } = makeHandler({ caps: { phone: 10 } });
    expect(await submit(handler, { ...valid, phone: "555", message: "m".repeat(5000) })).toStrictEqual({ status: "accepted" });
    expect(delivery.deliver).toHaveBeenCalledTimes(1);
  });

  describe("total cap", () => {
    const sum = Object.values(valid).reduce((n, v) => n + v.length, 0);

    it("reports { field: submission, code: too-long } when the fields together exceed caps.total", async () => {
      const { handler, delivery, limiter } = makeHandler({ caps: { total: 20 } });
      const result = await submit(handler, valid);
      expect(result).toStrictEqual({ status: "invalid", fields: [{ field: "submission", code: "too-long" }] });
      expect(delivery.deliver).not.toHaveBeenCalled();
      expect(limiter.check).not.toHaveBeenCalled();
    });

    it("accepts a submission whose fields total exactly caps.total", async () => {
      const { handler } = makeHandler({ caps: { total: sum } });
      expect(await submit(handler, valid)).toStrictEqual({ status: "accepted" });
    });

    it("rejects a submission one code unit over caps.total", async () => {
      const { handler } = makeHandler({ caps: { total: sum - 1 } });
      expect(await submit(handler, valid)).toStrictEqual({
        status: "invalid",
        fields: [{ field: "submission", code: "too-long" }],
      });
    });

    it("reports the total cap in addition to, and after, per-field issues", async () => {
      const { handler } = makeHandler({ caps: { name: 5, total: 20 } });
      expect(issuesOf(await submit(handler, valid))).toEqual([
        { field: "name", code: "too-long" },
        { field: "submission", code: "too-long" },
      ]);
    });

    it("counts only fields that are strings", async () => {
      const { handler } = makeHandler({ caps: { total: 20 } });
      // 7 (topic) + 12 (name) = 19 code units of strings; the rest are non-strings.
      const result = await submit(handler, { topic: "general", name: "Ada Lovelace", email: 5, phone: 5, message: 5 });
      expect(issuesOf(result).some((issue) => issue.field === "submission")).toBe(false);
    });

    it("excludes the honeypot and unknown keys from the total", async () => {
      const { handler } = makeHandler({ caps: { total: sum } });
      const result = await submit(handler, { ...valid, website: "", extra: "x".repeat(10_000), other: "y".repeat(10_000) });
      expect(result).toStrictEqual({ status: "accepted" });
    });

    it("at default caps does not bind for a maximal valid submission", async () => {
      const { handler } = makeHandler();
      const result = await submit(handler, {
        topic: "general",
        name: "n".repeat(100),
        email: `${"a".repeat(64)}@${"b".repeat(60)}.example.com`,
        phone: "5".repeat(40),
        message: "m".repeat(5000),
      });
      expect(result).toStrictEqual({ status: "accepted" });
    });
  });
});

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

describe("createContactHandler — results carry codes only", () => {
  const markedSubmissions: ReadonlyArray<readonly [string, unknown]> = [
    ["a marked unknown topic", { ...valid, topic: `${MARKER}` }],
    ["a marked control-character name", { ...valid, name: `${MARKER}\r\nBcc: x@example.com` }],
    ["a marked malformed email", { ...valid, email: `${MARKER}@@${DOMAIN}` }],
    ["a marked malformed phone", { ...valid, phone: `${MARKER}` }],
    ["a marked message with a NUL", { ...valid, message: `${MARKER}\0` }],
    ["a marked over-long name", { ...valid, name: MARKER.repeat(20) }],
    ["a marked extra key", { name: `\r${MARKER}`, [MARKER]: MARKER, extra: MARKER }],
    ["a marked non-string", { ...valid, name: { nested: MARKER }, email: [MARKER] }],
    ["a marked total overflow", { ...valid, message: MARKER.repeat(500) }],
  ];

  it.each(markedSubmissions)("never echoes any submitted text for %s", async (_label, submission) => {
    const { handler } = makeHandler({ caps: { total: 100 } });
    const result = await submit(handler, submission);
    expect(result.status).toBe("invalid");
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(MARKER);
    expect(serialized).not.toContain("Bcc");
    expect(serialized).not.toContain("x@example.com");
  });

  it("only ever holds the keys field and code in an issue, and only strings in them", async () => {
    const { handler } = makeHandler({ caps: { total: 10 } });
    const result = await submit(handler, { topic: MARKER, name: `${MARKER}\r`, email: MARKER, phone: MARKER, message: MARKER });
    for (const issue of issuesOf(result)) {
      expect(Object.keys(issue).sort()).toEqual(["code", "field"]);
      expect(typeof issue.field).toBe("string");
      expect(typeof issue.code).toBe("string");
    }
    expect(Object.keys(result).sort()).toEqual(["fields", "status"]);
  });

  it("has no extra keys on accepted, rate-limited and unavailable results", async () => {
    expect(Object.keys(await submit(makeHandler().handler, valid))).toEqual(["status"]);
    expect(Object.keys(await submit(makeHandler({ limiter: makeLimiter(false) }).handler, valid))).toEqual(["status"]);
    expect(Object.keys(await submit(makeHandler().handler, valid, ""))).toEqual(["status"]);
  });

  it("never echoes text from a failing delivery or limiter into the result", async () => {
    const delivery = {
      channel: "email" as const,
      deliver: vi.fn(async () => {
        throw new Error(`provider said no to ${valid.email} ${MARKER}`);
      }),
    };
    const { handler } = makeHandler({ delivery });
    const result = await submit(handler, valid);
    expect(result).toStrictEqual({ status: "unavailable" });
    expect(JSON.stringify(result)).not.toContain(MARKER);
    expect(JSON.stringify(result)).not.toContain(valid.email);
  });

  it("reports issues in field order, then submission, whatever order the keys were supplied in", async () => {
    const { handler } = makeHandler({ caps: { total: 5 } });
    const result = await submit(handler, {
      message: "",
      phone: "abc",
      email: "bad",
      name: "",
      topic: "nope",
    });
    expect(issuesOf(result)).toEqual([
      { field: "topic", code: "unknown-topic" },
      { field: "name", code: "required" },
      { field: "email", code: "malformed" },
      { field: "phone", code: "malformed" },
      { field: "message", code: "required" },
      { field: "submission", code: "too-long" },
    ]);
  });

  it("reports at most one issue per field", async () => {
    const { handler } = makeHandler();
    const result = await submit(handler, {
      topic: `${"x".repeat(101)}\n`,
      name: `${"n".repeat(101)}\r`,
      email: `${"e".repeat(255)}\0`,
      phone: `${"5".repeat(41)} `,
      message: `${"m".repeat(5001)}\0`,
    });
    const fields = issuesOf(result).map((issue) => issue.field);
    expect(fields).toEqual(["topic", "name", "email", "phone", "message"]);
    expect(new Set(fields).size).toBe(fields.length);
  });

  it("checks not-a-string, then too-long, then control-character, then required, then shape", async () => {
    const { handler } = makeHandler();
    expect(issuesOf(await submit(handler, { ...valid, email: 5 }))).toEqual([{ field: "email", code: "not-a-string" }]);
    expect(issuesOf(await submit(handler, { ...valid, email: `${"a".repeat(255)}` }))).toEqual([
      { field: "email", code: "too-long" },
    ]);
    expect(issuesOf(await submit(handler, { ...valid, email: "a\0b" }))).toEqual([
      { field: "email", code: "control-character" },
    ]);
    expect(issuesOf(await submit(handler, { ...valid, email: "   " }))).toEqual([{ field: "email", code: "required" }]);
    expect(issuesOf(await submit(handler, { ...valid, email: "a b" }))).toEqual([{ field: "email", code: "malformed" }]);
  });
});

// ---------------------------------------------------------------------------
// The delivered message
// ---------------------------------------------------------------------------

describe("createContactHandler — the delivered message", () => {
  it("delivers exactly once for a valid submission and answers accepted", async () => {
    const { handler, delivery } = makeHandler();
    expect(await submit(handler, valid)).toStrictEqual({ status: "accepted" });
    expect(delivery.deliver).toHaveBeenCalledTimes(1);
  });

  it("takes to, from and subject from config, and replyTo from the submitted email", async () => {
    const { handler, delivery } = makeHandler();
    await submit(handler, valid);
    const message = delivered(delivery);
    expect(message.to).toEqual([...TO]);
    expect(message.from).toBe(FROM);
    expect(message.subject).toBe(SUBJECT);
    expect(message.replyTo).toEqual([valid.email]);
    expect(message.replyTo).toHaveLength(1);
  });

  it("sets the fixed literals and the configured message id", async () => {
    const { handler, delivery } = makeHandler({ createMessageId: () => "id-42" });
    await submit(handler, valid);
    const message = delivered(delivery);
    expect(message.id).toBe("id-42");
    expect(message.event).toBe("publisher.contact.submitted");
    expect(message.category).toBe("contact");
    expect(message.channel).toBe("email");
  });

  it("builds plain text only, with no html, headers, cc, bcc or attachments", async () => {
    const { handler, delivery } = makeHandler();
    await submit(handler, valid);
    const message = delivered(delivery) as unknown as Record<string, unknown>;
    expect(message.html).toBeUndefined();
    for (const key of ["headers", "cc", "bcc", "attachments"]) {
      expect(message).not.toHaveProperty(key);
    }
    const allowed = new Set(["id", "event", "category", "channel", "from", "to", "replyTo", "subject", "text", "html"]);
    for (const [key, value] of Object.entries(message)) {
      if (value !== undefined) expect(allowed.has(key)).toBe(true);
    }
  });

  it("builds the documented text layout with a phone line", async () => {
    const { handler, delivery } = makeHandler();
    await submit(handler, valid);
    expect(delivered(delivery).text).toBe(EXPECTED_TEXT_WITH_PHONE);
  });

  it("builds the documented text layout without a phone line", async () => {
    const { handler, delivery } = makeHandler();
    await submit(handler, validWithoutPhone);
    expect(delivered(delivery).text).toBe(EXPECTED_TEXT_WITHOUT_PHONE);
  });

  it("has no trailing newline and no Phone line when phone is absent", async () => {
    const { handler, delivery } = makeHandler();
    await submit(handler, validWithoutPhone);
    const { text } = delivered(delivery);
    expect(text.endsWith("\n")).toBe(false);
    expect(text).not.toContain("Phone:");
  });

  it("normalises CRLF and lone CR in the message to LF", async () => {
    const { handler, delivery } = makeHandler();
    await submit(handler, { ...valid, message: "one\r\ntwo\rthree\nfour" });
    expect(delivered(delivery).text).toBe(
      ["Topic: general", "Name: Ada Lovelace", "Email: ada@example.com", "Phone: +1 (555) 010-0100", "", "one", "two", "three", "four"].join(
        "\n",
      ),
    );
    expect(delivered(delivery).text).not.toContain("\r");
  });

  it("trims the single-line values and the message", async () => {
    const { handler, delivery } = makeHandler();
    await submit(handler, {
      topic: "general",
      name: "  Ada Lovelace  ",
      email: " ada@example.com ",
      phone: "  +1 (555) 010-0100  ",
      message: "\n\n  Hello\r\nWorld \r\n",
    });
    expect(delivered(delivery).text).toBe(
      ["Topic: general", "Name: Ada Lovelace", "Email: ada@example.com", "Phone: +1 (555) 010-0100", "", "Hello", "World"].join("\n"),
    );
  });

  it("keeps tabs and blank lines inside the message", async () => {
    const { handler, delivery } = makeHandler();
    await submit(handler, { ...valid, message: "a\tb\n\nc" });
    expect(delivered(delivery).text.endsWith("\n\na\tb\n\nc")).toBe(true);
  });

  it("applies no Unicode normalisation", async () => {
    const { handler, delivery } = makeHandler();
    const decomposed = "Amélie";
    await submit(handler, { ...valid, name: decomposed });
    expect(delivered(delivery).text).toContain(`Name: ${decomposed}\n`);
    expect(delivered(delivery).text).not.toContain("Name: Amélie");
  });

  it("keeps the submitted name and email out of the subject, from and to", async () => {
    const { handler, delivery } = makeHandler();
    await submit(handler, valid);
    const message = delivered(delivery);
    const headerish = JSON.stringify([message.subject, message.from, message.to]);
    expect(headerish).not.toContain("Ada");
    expect(headerish).not.toContain("Lovelace");
    expect(headerish).not.toContain(valid.email);
    expect(message.subject).toBe(SUBJECT);
  });

  it("puts the submitted email in no header other than replyTo, and the name in none", async () => {
    const { handler, delivery } = makeHandler();
    await submit(handler, valid);
    const message = delivered(delivery);
    const { text, replyTo, ...rest } = message;
    expect(JSON.stringify(rest)).not.toContain(valid.email);
    expect(JSON.stringify(rest)).not.toContain("Ada");
    expect(JSON.stringify(replyTo)).not.toContain("Ada");
    expect(text).toContain(valid.name);
  });

  it("ignores unknown keys in the submission and never lets them reach the message", async () => {
    const { handler, delivery } = makeHandler();
    const result = await submit(handler, {
      ...valid,
      to: "evil@example.com",
      subject: "Hacked subject",
      bcc: "spy@example.com",
      cc: "spy2@example.com",
      from: "evil@example.com",
      replyTo: "evil@example.com",
      headers: { "X-Evil": "1" },
      html: "<b>evil</b>",
      attachments: [{ filename: "x", content: "y" }],
      id: "forged-id",
      event: "forged.event",
      category: "forged",
      channel: "sms",
      [MARKER]: MARKER,
    });
    expect(result).toStrictEqual({ status: "accepted" });
    const message = delivered(delivery) as unknown as Record<string, unknown>;
    expect(message.to).toEqual([...TO]);
    expect(message.from).toBe(FROM);
    expect(message.subject).toBe(SUBJECT);
    expect(message.replyTo).toEqual([valid.email]);
    expect(message.id).toBe("msg-1");
    expect(message.event).toBe("publisher.contact.submitted");
    expect(message.category).toBe("contact");
    expect(message.channel).toBe("email");
    expect(message.html).toBeUndefined();
    for (const key of ["headers", "bcc", "cc", "attachments"]) {
      expect(message).not.toHaveProperty(key);
    }
    expect(message.text).toBe(EXPECTED_TEXT_WITH_PHONE);
    expect(JSON.stringify(message)).not.toMatch(/evil|spy|Hacked|forged|ZZ-MARKER/);
  });

  it("never reads an ignored key's value", async () => {
    const { handler } = makeHandler();
    const submission: Record<string, unknown> = { ...valid };
    Object.defineProperty(submission, "sneaky", {
      enumerable: true,
      get() {
        throw new Error("an ignored key was read");
      },
    });
    await expect(submit(handler, submission)).resolves.toStrictEqual({ status: "accepted" });
  });

  it("generates a distinct default message id per delivery when none is configured", async () => {
    const delivery = makeDelivery();
    const { handler } = makeHandler({ delivery, createMessageId: undefined });
    await submit(handler, valid);
    await submit(handler, valid);
    const [first, second] = delivery.deliver.mock.calls.map((call) => call[0].id);
    expect(typeof first).toBe("string");
    expect((first ?? "").length).toBeGreaterThan(0);
    expect(typeof second).toBe("string");
    expect(first).not.toBe(second);
  });

  it("calls createMessageId once per delivery and not at all for refused submissions", async () => {
    const createMessageId = vi.fn(() => "msg-1");
    const { handler } = makeHandler({ createMessageId });
    await submit(handler, {});
    await submit(handler, { ...valid, website: "x" });
    await submit(handler, valid, "");
    expect(createMessageId).not.toHaveBeenCalled();
    await submit(handler, valid);
    expect(createMessageId).toHaveBeenCalledTimes(1);
  });

  it("does not answer until delivery has resolved", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const delivery = {
      channel: "email" as const,
      deliver: vi.fn(async () => {
        await gate;
        return { provider: "fake", messageId: "x" };
      }),
    };
    const { handler } = makeHandler({ delivery });
    let settled = false;
    const promise = submit(handler, valid).then((result) => {
      settled = true;
      return result;
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(delivery.deliver).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    release();
    expect(await promise).toStrictEqual({ status: "accepted" });
    expect(settled).toBe(true);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a string", "sent"],
    ["an object", { provider: "x" }],
  ])("ignores whatever delivery resolves with (%s)", async (_label, resolved) => {
    const delivery = { channel: "email" as const, deliver: vi.fn(async () => resolved) };
    const { handler } = makeHandler({ delivery });
    expect(await submit(handler, valid)).toStrictEqual({ status: "accepted" });
  });
});

// ---------------------------------------------------------------------------
// Failure handling: handle() never throws
// ---------------------------------------------------------------------------

describe("createContactHandler — failures never escape handle()", () => {
  it("answers unavailable when delivery rejects, calling deliver once and not retrying", async () => {
    const delivery = { channel: "email" as const, deliver: vi.fn(async () => Promise.reject(new Error("provider down"))) };
    const { handler } = makeHandler({ delivery });
    await expect(submit(handler, valid)).resolves.toStrictEqual({ status: "unavailable" });
    expect(delivery.deliver).toHaveBeenCalledTimes(1);
  });

  it("answers unavailable when delivery throws synchronously", async () => {
    const delivery = {
      channel: "email" as const,
      deliver: vi.fn(() => {
        throw new Error("sync provider failure");
      }),
    };
    const { handler } = makeHandler({ delivery: delivery as never });
    await expect(submit(handler, valid)).resolves.toStrictEqual({ status: "unavailable" });
    expect(delivery.deliver).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a string", "boom"],
    ["undefined", undefined],
    ["null", null],
    ["a number", 500],
    ["an object", { code: "E" }],
  ])("answers unavailable when delivery rejects with %s", async (_label, reason) => {
    const delivery = { channel: "email" as const, deliver: vi.fn(async () => Promise.reject(reason)) };
    const { handler } = makeHandler({ delivery });
    await expect(submit(handler, valid)).resolves.toStrictEqual({ status: "unavailable" });
  });

  it("does not refund or retry: a failed delivery still consumed the limiter check exactly once", async () => {
    const delivery = { channel: "email" as const, deliver: vi.fn(async () => Promise.reject(new Error("down"))) };
    const limiter = makeLimiter(true);
    const { handler } = makeHandler({ delivery, limiter });
    await submit(handler, valid);
    expect(limiter.check).toHaveBeenCalledTimes(1);
    expect(delivery.deliver).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["throws", () => { throw new Error("no id"); }],
    ["returns an empty string", () => ""],
    ["returns a number", () => 5 as never],
    ["returns undefined", () => undefined as never],
    ["returns null", () => null as never],
  ])("answers unavailable, delivering nothing, when createMessageId %s", async (_label, createMessageId) => {
    const { handler, delivery } = makeHandler({ createMessageId });
    await expect(submit(handler, valid)).resolves.toStrictEqual({ status: "unavailable" });
    expect(delivery.deliver).not.toHaveBeenCalled();
  });

  it("answers unavailable, never throwing, when reading a submission property throws", async () => {
    const { handler, delivery } = makeHandler();
    const submission = {
      ...valid,
      get message(): string {
        throw new Error("getter failed");
      },
    };
    await expect(submit(handler, submission)).resolves.toStrictEqual({ status: "unavailable" });
    expect(delivery.deliver).not.toHaveBeenCalled();
  });

  it("reports internal-error to onUnavailable when reading a submission property throws", async () => {
    const onUnavailable = vi.fn();
    const { handler } = makeHandler({ onUnavailable });
    const submission = {
      ...valid,
      get message(): string {
        throw new Error("getter failed");
      },
    };
    await submit(handler, submission);
    expect(onUnavailable).toHaveBeenCalledExactlyOnceWith("internal-error");
  });

  it("answers unavailable, never throwing, when the submission is a hostile proxy", async () => {
    const { handler, delivery } = makeHandler();
    const hostile = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new Error("trap");
        },
        get() {
          throw new Error("trap");
        },
        has() {
          throw new Error("trap");
        },
        ownKeys() {
          throw new Error("trap");
        },
      },
    );
    await expect(submit(handler, hostile)).resolves.toStrictEqual({ status: "unavailable" });
    expect(delivery.deliver).not.toHaveBeenCalled();
  });

  it("never throws for any submission or options value", async () => {
    const { handler } = makeHandler();
    const weird: unknown[] = [undefined, null, 0, "", [], () => {}, Symbol("x"), 10n, new Date(), Object.create(null), NaN];
    for (const submission of weird) {
      await expect(handler.handle(submission, { clientKey: CLIENT_KEY })).resolves.toBeDefined();
      await expect(handler.handle(submission, undefined as never)).resolves.toStrictEqual({ status: "unavailable" });
    }
  });

  it("returns a promise, not a value, from handle", () => {
    const { handler } = makeHandler();
    expect(submit(handler, valid)).toBeInstanceOf(Promise);
  });
});

// ---------------------------------------------------------------------------
// Construction validation
// ---------------------------------------------------------------------------

describe("createContactHandler — config validation", () => {
  it("constructs synchronously with a valid config and returns a handler", () => {
    const { handler } = makeHandler();
    expect(typeof handler.handle).toBe("function");
  });

  it.each([
    ["empty topics", { topics: [] as never }],
    ["undefined topics", { topics: undefined as never }],
    ["duplicate topics", { topics: ["a", "a"] as never }],
    ["an empty topic id", { topics: ["a", ""] as never }],
    ["a whitespace-only topic id", { topics: ["a", "  "] as never }],
    ["a non-string topic id", { topics: ["a", 5] as never }],
    ["a control character in a topic id", { topics: ["a\nb"] as never }],
    ["a U+2028 in a topic id", { topics: ["a b"] as never }],
    ["a topic id over the default topic cap", { topics: ["t".repeat(101)] as never }],
    ["a topic id over an overridden topic cap", { topics: ["general"] as never, caps: { topic: 3 } }],
  ])("throws for %s", (_label, overrides) => {
    expect(() => makeHandler(overrides)).toThrow();
  });

  it.each([
    ["empty to", { to: [] as never }],
    ["undefined to", { to: undefined as never }],
    ["an empty recipient", { to: ["a@example.com", ""] as never }],
    ["a non-string recipient", { to: [5] as never }],
    ["a line break in a recipient", { to: ["a@example.com\r\nBcc: x@example.com"] as never }],
    ["a newline in a recipient", { to: ["a@example.com\nb@example.com"] as never }],
    ["a NUL in a recipient", { to: ["a@example.com\0"] as never }],
    ["a control character in the second recipient", { to: ["a@example.com", "b@example.com\u0007"] as never }],
  ])("throws for %s", (_label, overrides) => {
    expect(() => makeHandler(overrides)).toThrow();
  });

  it.each([
    ["an empty from", { from: "" }],
    ["undefined from", { from: undefined as never }],
    ["a non-string from", { from: 5 as never }],
    ["a CRLF in from", { from: "a@example.com\r\nBcc: x@example.com" }],
    ["a LF in from", { from: "a@example.com\nBcc: x@example.com" }],
    ["a NUL in from", { from: "a@example.com\0" }],
    ["a DEL in from", { from: "a@example.com\u007f" }],
  ])("throws for %s", (_label, overrides) => {
    expect(() => makeHandler(overrides)).toThrow();
  });

  it.each([
    ["an empty subject", { subject: "" }],
    ["a whitespace-only subject", { subject: "   " }],
    ["undefined subject", { subject: undefined as never }],
    ["a non-string subject", { subject: 5 as never }],
    ["a CRLF in the subject", { subject: "Hi\r\nBcc: x@example.com" }],
    ["a CR in the subject", { subject: "Hi\rthere" }],
    ["a tab in the subject", { subject: "Hi\tthere" }],
    ["a NUL in the subject", { subject: "Hi\0" }],
    ["a NEL in the subject", { subject: "Hi\u0085" }],
  ])("throws for %s", (_label, overrides) => {
    expect(() => makeHandler(overrides)).toThrow();
  });

  it.each(["topic", "name", "email", "phone", "message", "total"] as const)("throws for an invalid %s cap", (key) => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, "10" as never, null as never]) {
      expect(() => makeHandler({ caps: { [key]: bad } })).toThrow();
    }
  });

  it("accepts a valid partial caps override and an empty caps object", () => {
    expect(() => makeHandler({ caps: {} })).not.toThrow();
    expect(() => makeHandler({ caps: { message: 100, total: 200 } })).not.toThrow();
    expect(() => makeHandler({ caps: { phone: 1 } })).not.toThrow();
  });

  it.each([
    ["a missing limiter", { limiter: undefined as never }],
    ["a null limiter", { limiter: null as never }],
    ["a limiter without check", { limiter: {} as never }],
    ["a limiter whose check is not a function", { limiter: { check: true } as never }],
    ["a missing delivery", { delivery: undefined as never }],
    ["a null delivery", { delivery: null as never }],
    ["a delivery without deliver", { delivery: { channel: "email" } as never }],
    ["a delivery whose deliver is not a function", { delivery: { channel: "email", deliver: 1 } as never }],
    ["a delivery on another channel", { delivery: { channel: "sms", deliver: async () => undefined } as never }],
    ["a delivery with no channel", { delivery: { deliver: async () => undefined } as never }],
  ])("throws for %s", (_label, overrides) => {
    expect(() => makeHandler(overrides)).toThrow();
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "config"],
  ])("throws when the whole config is %s", (_label, config) => {
    expect(() => createContactHandler(config as never)).toThrow();
  });

  it("validates eagerly: a bad config throws at construction, not at first handle", () => {
    const delivery = makeDelivery();
    expect(() => makeHandler({ topics: [] as never, delivery })).toThrow();
    expect(delivery.deliver).not.toHaveBeenCalled();
  });
});
