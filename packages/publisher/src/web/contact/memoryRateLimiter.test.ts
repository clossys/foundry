import { describe, expect, it } from "vitest";
import { createMemoryRateLimiter } from "./memoryRateLimiter.js";

/** A controllable clock: `clock.now` is injected, `clock.t` is moved by the test. */
function makeClock(start = 0) {
  const clock = {
    t: start,
    now: () => clock.t,
  };
  return clock;
}

function makeLimiter(options: { limit: number; windowMs: number; maxKeys?: number; start?: number }) {
  const clock = makeClock(options.start ?? 0);
  const limiter = createMemoryRateLimiter({
    limit: options.limit,
    windowMs: options.windowMs,
    now: clock.now,
    ...(options.maxKeys === undefined ? {} : { maxKeys: options.maxKeys }),
  });
  return { limiter, clock };
}

describe("createMemoryRateLimiter — sliding window", () => {
  it("allows exactly `limit` uses per key inside one window", async () => {
    const { limiter } = makeLimiter({ limit: 2, windowMs: 1000 });
    expect(await limiter.check("a")).toBe(true);
    expect(await limiter.check("a")).toBe(true);
    expect(await limiter.check("a")).toBe(false);
  });

  it("returns exactly the booleans true and false", async () => {
    const { limiter } = makeLimiter({ limit: 1, windowMs: 1000 });
    const first = await limiter.check("a");
    const second = await limiter.check("a");
    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it("frees uses at or before t - windowMs, so a use recorded at t0 expires exactly at t0 + windowMs", async () => {
    const { limiter, clock } = makeLimiter({ limit: 2, windowMs: 1000 });
    expect(await limiter.check("a")).toBe(true);
    expect(await limiter.check("a")).toBe(true);
    clock.t = 999;
    expect(await limiter.check("a")).toBe(false);
    clock.t = 1000;
    expect(await limiter.check("a")).toBe(true);
    expect(await limiter.check("a")).toBe(true);
    expect(await limiter.check("a")).toBe(false);
  });

  it("slides: only the uses that have aged out are freed", async () => {
    const { limiter, clock } = makeLimiter({ limit: 2, windowMs: 1000 });
    clock.t = 0;
    expect(await limiter.check("a")).toBe(true);
    clock.t = 600;
    expect(await limiter.check("a")).toBe(true);
    clock.t = 999;
    expect(await limiter.check("a")).toBe(false);
    clock.t = 1000; // the use at 0 has expired, the use at 600 has not
    expect(await limiter.check("a")).toBe(true);
    clock.t = 1001;
    expect(await limiter.check("a")).toBe(false);
    clock.t = 1599;
    expect(await limiter.check("a")).toBe(false);
    clock.t = 1600; // the use at 600 has now expired
    expect(await limiter.check("a")).toBe(true);
  });

  it("never grants more than `limit` true answers in any interval of length windowMs", async () => {
    const { limiter, clock } = makeLimiter({ limit: 3, windowMs: 100 });
    const granted: number[] = [];
    for (let t = 0; t <= 1000; t += 7) {
      clock.t = t;
      if ((await limiter.check("a")) === true) granted.push(t);
    }
    for (const start of granted) {
      const inWindow = granted.filter((g) => g >= start && g < start + 100);
      expect(inWindow.length).toBeLessThanOrEqual(3);
    }
    expect(granted.length).toBeGreaterThan(3);
  });

  it("keeps keys independent", async () => {
    const { limiter } = makeLimiter({ limit: 1, windowMs: 1000 });
    expect(await limiter.check("a")).toBe(true);
    expect(await limiter.check("a")).toBe(false);
    expect(await limiter.check("b")).toBe(true);
    expect(await limiter.check("b")).toBe(false);
  });

  it("treats keys verbatim: no trimming and no case folding", async () => {
    const { limiter } = makeLimiter({ limit: 1, windowMs: 1000 });
    expect(await limiter.check("a")).toBe(true);
    expect(await limiter.check("A")).toBe(true);
    expect(await limiter.check(" a")).toBe(true);
    expect(await limiter.check("a ")).toBe(true);
    expect(await limiter.check("a")).toBe(false);
  });

  it("accepts a fractional windowMs", async () => {
    const { limiter, clock } = makeLimiter({ limit: 1, windowMs: 0.5 });
    expect(await limiter.check("a")).toBe(true);
    clock.t = 0.25;
    expect(await limiter.check("a")).toBe(false);
    clock.t = 0.5;
    expect(await limiter.check("a")).toBe(true);
  });
});

describe("createMemoryRateLimiter — denied checks do not consume", () => {
  it("a denial does not extend the window, so a persistent client recovers on schedule", async () => {
    const { limiter, clock } = makeLimiter({ limit: 1, windowMs: 1000 });
    clock.t = 0;
    expect(await limiter.check("a")).toBe(true);
    clock.t = 500;
    expect(await limiter.check("a")).toBe(false);
    clock.t = 900;
    expect(await limiter.check("a")).toBe(false);
    clock.t = 1000; // would still be denied had the denials at 500 or 900 been recorded
    expect(await limiter.check("a")).toBe(true);
  });

  it("many denials in a row still leave exactly `limit` uses to expire", async () => {
    const { limiter, clock } = makeLimiter({ limit: 2, windowMs: 1000 });
    expect(await limiter.check("a")).toBe(true);
    expect(await limiter.check("a")).toBe(true);
    for (let t = 1; t < 1000; t += 37) {
      clock.t = t;
      expect(await limiter.check("a")).toBe(false);
    }
    clock.t = 1000;
    expect(await limiter.check("a")).toBe(true);
    expect(await limiter.check("a")).toBe(true);
    expect(await limiter.check("a")).toBe(false);
  });
});

describe("createMemoryRateLimiter — maxKeys bound", () => {
  it("denies a new key at capacity without evicting any live key", async () => {
    const { limiter } = makeLimiter({ limit: 1, windowMs: 1000, maxKeys: 2 });
    expect(await limiter.check("a")).toBe(true);
    expect(await limiter.check("b")).toBe(true);
    expect(await limiter.check("c")).toBe(false); // store full, nothing expired
    // If "a" or "b" had been evicted to make room, one of these would be granted again.
    expect(await limiter.check("a")).toBe(false);
    expect(await limiter.check("b")).toBe(false);
    expect(await limiter.check("c")).toBe(false);
  });

  it("prunes keys whose every use has expired before deciding a new key is over capacity", async () => {
    const { limiter, clock } = makeLimiter({ limit: 1, windowMs: 1000, maxKeys: 2 });
    clock.t = 0;
    expect(await limiter.check("a")).toBe(true);
    expect(await limiter.check("b")).toBe(true);
    clock.t = 1000;
    expect(await limiter.check("c")).toBe(true);
    expect(await limiter.check("d")).toBe(true);
    expect(await limiter.check("e")).toBe(false); // c and d are live, store full
  });

  it("prunes only the expired keys, keeping the live ones", async () => {
    const { limiter, clock } = makeLimiter({ limit: 1, windowMs: 1000, maxKeys: 2 });
    clock.t = 0;
    expect(await limiter.check("a")).toBe(true);
    clock.t = 600;
    expect(await limiter.check("b")).toBe(true);
    clock.t = 1000; // "a" expired, "b" live
    expect(await limiter.check("c")).toBe(true); // room made by pruning "a" only
    expect(await limiter.check("b")).toBe(false); // "b" kept its live window
    expect(await limiter.check("d")).toBe(false); // store is full again: b + c
    expect(await limiter.check("a")).toBe(false); // "a" is now a new key at capacity
    clock.t = 1600; // "b" expired
    expect(await limiter.check("d")).toBe(true);
  });

  it("does not treat an existing key as new when the store is full", async () => {
    const { limiter } = makeLimiter({ limit: 2, windowMs: 1000, maxKeys: 1 });
    expect(await limiter.check("a")).toBe(true);
    expect(await limiter.check("a")).toBe(true);
    expect(await limiter.check("a")).toBe(false);
  });

  it("does not remember a key it denied for capacity", async () => {
    const { limiter, clock } = makeLimiter({ limit: 1, windowMs: 1000, maxKeys: 1 });
    clock.t = 0;
    expect(await limiter.check("a")).toBe(true);
    clock.t = 500;
    expect(await limiter.check("b")).toBe(false);
    clock.t = 1000; // "a" expired; "b"'s earlier denial must not count as a use
    expect(await limiter.check("b")).toBe(true);
  });

  it("defaults maxKeys to 10_000", async () => {
    const { limiter } = makeLimiter({ limit: 1, windowMs: 1_000_000 });
    for (let i = 0; i < 10_000; i += 1) {
      expect(await limiter.check(`k${i}`)).toBe(true);
    }
    expect(await limiter.check("one-too-many")).toBe(false);
    expect(await limiter.check("k0")).toBe(false);
  });
});

describe("createMemoryRateLimiter — clock moving backwards", () => {
  it("never grants a use that a forward clock would have denied", async () => {
    const { limiter, clock } = makeLimiter({ limit: 1, windowMs: 1000 });
    clock.t = 1000;
    expect(await limiter.check("a")).toBe(true);
    clock.t = 0;
    expect(await limiter.check("a")).toBe(false);
    clock.t = 1999;
    expect(await limiter.check("a")).toBe(false);
    clock.t = 2000;
    expect(await limiter.check("a")).toBe(true);
  });

  it("counts recorded uses later than the current time", async () => {
    const { limiter, clock } = makeLimiter({ limit: 2, windowMs: 1000 });
    clock.t = 1000;
    expect(await limiter.check("a")).toBe(true);
    clock.t = 1500;
    expect(await limiter.check("a")).toBe(true);
    clock.t = 200;
    expect(await limiter.check("a")).toBe(false);
    clock.t = 1500;
    expect(await limiter.check("a")).toBe(false);
    clock.t = 2000; // the use at 1000 has expired, the use at 1500 has not
    expect(await limiter.check("a")).toBe(true);
    expect(await limiter.check("a")).toBe(false);
  });

  it("does not prune a live key just because the clock went back", async () => {
    const { limiter, clock } = makeLimiter({ limit: 1, windowMs: 1000, maxKeys: 1 });
    clock.t = 1000;
    expect(await limiter.check("a")).toBe(true);
    clock.t = 0;
    expect(await limiter.check("b")).toBe(false); // "a" is still live, store full
    expect(await limiter.check("a")).toBe(false);
  });

  it("a denial made while the clock is behind does not disturb the recorded uses", async () => {
    const { limiter, clock } = makeLimiter({ limit: 1, windowMs: 1000 });
    clock.t = 1000;
    expect(await limiter.check("a")).toBe(true);
    clock.t = 0;
    expect(await limiter.check("a")).toBe(false);
    clock.t = 2000;
    expect(await limiter.check("a")).toBe(true);
  });
});

describe("createMemoryRateLimiter — clock failures at check time", () => {
  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
  ])("check fails (throws or rejects) when now() returns %s, and never answers true", async (_label, bad) => {
    const clock = makeClock(0);
    const limiter = createMemoryRateLimiter({ limit: 5, windowMs: 1000, now: clock.now });
    clock.t = bad;
    let answer: unknown = "not-called";
    let failed = false;
    try {
      answer = await limiter.check("a");
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
    expect(answer).not.toBe(true);
  });

  it("a failed check records nothing", async () => {
    const clock = makeClock(0);
    const limiter = createMemoryRateLimiter({ limit: 1, windowMs: 1000, now: clock.now });
    clock.t = Number.NaN;
    await expect(Promise.resolve().then(() => limiter.check("a"))).rejects.toThrow();
    clock.t = 10;
    expect(await limiter.check("a")).toBe(true);
    expect(await limiter.check("a")).toBe(false);
  });

  it("a non-number now() result also fails closed", async () => {
    const limiter = createMemoryRateLimiter({ limit: 5, windowMs: 1000, now: (() => "5") as never });
    await expect(Promise.resolve().then(() => limiter.check("a"))).rejects.toThrow();
  });
});

describe("createMemoryRateLimiter — construction validation", () => {
  const base = { limit: 2, windowMs: 1000, now: () => 0 };

  it("constructs with valid options and returns an object with a check function", () => {
    const limiter = createMemoryRateLimiter(base);
    expect(typeof limiter.check).toBe("function");
  });

  it.each([
    ["0", 0],
    ["-1", -1],
    ["1.5", 1.5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["2 ** 53 (not a safe integer)", 2 ** 53],
    ['the string "2"', "2"],
    ["undefined", undefined],
  ])("rejects limit %s", (_label, limit) => {
    expect(() => createMemoryRateLimiter({ ...base, limit: limit as never })).toThrow();
  });

  it.each([
    ["0", 0],
    ["-1", -1],
    ["1.5", 1.5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["2 ** 53 (not a safe integer)", 2 ** 53],
    ['the string "5"', "5"],
  ])("rejects maxKeys %s", (_label, maxKeys) => {
    expect(() => createMemoryRateLimiter({ ...base, maxKeys: maxKeys as never })).toThrow();
  });

  it.each([
    ["0", 0],
    ["-1", -1],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ['the string "1000"', "1000"],
    ["undefined", undefined],
  ])("rejects windowMs %s", (_label, windowMs) => {
    expect(() => createMemoryRateLimiter({ ...base, windowMs: windowMs as never })).toThrow();
  });

  it.each([
    ["undefined", undefined],
    ["a number", 5],
    ["a string", "now"],
    ["null", null],
    ["an object", {}],
  ])("rejects a clock that is %s", (_label, now) => {
    expect(() => createMemoryRateLimiter({ ...base, now: now as never })).toThrow();
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a string", "options"],
  ])("rejects options that are %s", (_label, options) => {
    expect(() => createMemoryRateLimiter(options as never)).toThrow();
  });

  it("accepts the smallest valid values", () => {
    expect(() => createMemoryRateLimiter({ limit: 1, windowMs: Number.MIN_VALUE, now: () => 0, maxKeys: 1 })).not.toThrow();
  });

  it("accepts maxKeys omitted or undefined", () => {
    expect(() => createMemoryRateLimiter(base)).not.toThrow();
    expect(() => createMemoryRateLimiter({ ...base, maxKeys: undefined })).not.toThrow();
  });
});
