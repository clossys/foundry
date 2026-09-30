import { describe, expect, it } from "vitest";
import { blankCssDeclPercents } from "./css-decl-percent.js";
import { checkFactsTraceability } from "./facts-gate.js";

// The regex below is the version from #1680, kept here verbatim as the oracle.
// `blankCssDeclPercents` must return exactly what this replace returns.
const ORACLE_RE = /\b[\w-]+\s*:\s*[^;`"'}\n]*(?<!\d)(?<!\d\.)\d+(?:\.\d+)*\s*%/g;

function oracle(text: string): string {
  return text.replace(ORACLE_RE, (m) => " ".repeat(m.length));
}

/** Seeded PRNG (mulberry32) so the corpus is the same on every run. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function corpus(seed: number, count: number, alphabet: string[], maxLength: number): string[] {
  const next = prng(seed);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const length = Math.floor(next() * (maxLength + 1));
    let s = "";
    for (let j = 0; j < length; j++) s += alphabet[Math.floor(next() * alphabet.length)] as string;
    out.push(s);
  }
  return out;
}

const ALPHABET = [..."abcdefghijklmnopqrstuvwxyz", "-", ":", " ", "\t", ..."0123456789", ".", "%", ";", '"', "'", "`", "}"];

function firstDivergence(inputs: string[]): { input: string; expected: string; actual: string } | undefined {
  for (const input of inputs) {
    const expected = oracle(input);
    const actual = blankCssDeclPercents(input);
    if (actual !== expected) return { input, expected, actual };
  }
  return undefined;
}

describe("blankCssDeclPercents matches the #1680 regex", () => {
  it("returns the oracle's output on 3,000 generated strings", () => {
    const inputs = corpus(1686, 3000, ALPHABET, 40);
    // Uniform draws rarely form a declaration, so require some matches here
    // and cover the match cases in depth in the weighted corpus below.
    expect(inputs.filter((s) => oracle(s) !== s).length).toBeGreaterThan(10);
    expect(firstDivergence(inputs)).toBeUndefined();
  });

  it("returns the oracle's output on 3,000 strings built from declaration-shaped pieces", () => {
    // Short pieces instead of single characters, so many strings contain a
    // declaration and some contain several.
    const pieces = ["a:", "w-x: ", "a", ":", " ", "\t", "1", "2.5", ".", "%", "5%", " 50 %", ";", '"', "'", "`", "}"];
    const inputs = corpus(1680, 3000, pieces, 12);
    expect(inputs.filter((s) => oracle(s) !== s).length).toBeGreaterThan(300);
    expect(firstDivergence(inputs)).toBeUndefined();
  });

  it("returns the oracle's output when newlines, carriage returns and other whitespace occur", () => {
    const alphabet = [..."ab-_:", " ", "\n", "\r", " ", ..."0123456789", ".", "%", ";", "}"];
    const inputs = corpus(1613, 2000, alphabet, 30);
    expect(inputs.filter((s) => oracle(s) !== s).length).toBeGreaterThan(50);
    expect(firstDivergence(inputs)).toBeUndefined();
  });
});

describe("blankCssDeclPercents behavior", () => {
  it("blanks a declaration through its last percentage: `a: 3% 50%`", () => {
    expect(blankCssDeclPercents("a: 3% 50% b")).toBe(" ".repeat(10) + "b");
    expect(blankCssDeclPercents("a: 3% 50%")).toBe(" ".repeat(9));
  });

  it("blanks a value with more than one fraction group: `x: 1.2.3%`", () => {
    expect(blankCssDeclPercents("x: 1.2.3%")).toBe(" ".repeat(9));
  });

  it("blanks a percentage after other words and digits: `grid: 1fr 2 50%`", () => {
    expect(blankCssDeclPercents("grid: 1fr 2 50%")).toBe(" ".repeat(15));
  });

  it("leaves a declaration with no percentage alone", () => {
    expect(blankCssDeclPercents("a: 1.")).toBe("a: 1.");
    expect(blankCssDeclPercents("a:" + "1".repeat(20))).toBe("a:" + "1".repeat(20));
  });

  it("does not cross a `;`, a quote, a backtick or a brace", () => {
    for (const stop of [";", '"', "'", "`", "}"]) {
      const text = `a: 5${stop} 7%`;
      expect(blankCssDeclPercents(text)).toBe(oracle(text));
      expect(blankCssDeclPercents(text).startsWith("a: 5")).toBe(true);
    }
  });
});

// Each input is 100,000 characters. Best of three, as in
// brand-facts-drift.redos.test.ts: a loaded machine must not read as a slow
// scan, and a quadratic scan is slow on every attempt.
const BUDGET_MS = 1000;

function best<T>(run: () => T): { result: T; ms: number } {
  let ms = Number.POSITIVE_INFINITY;
  let result!: T;
  for (let attempt = 0; attempt < 3; attempt++) {
    const start = performance.now();
    result = run();
    ms = Math.min(ms, performance.now() - start);
    if (ms < BUDGET_MS) break;
  }
  return { result, ms };
}

describe("blankCssDeclPercents stays fast on adversarial lines", () => {
  const inputs: Record<string, string> = {
    'digit-dot pairs after one declaration start ("a: " + "1." x 49999)': "a: " + "1.".repeat(49999),
    'many declaration starts, spaced ("a:1 " x 25000)': "a:1 ".repeat(25000),
    'many declaration starts, adjacent ("a:" x 50000)': "a:".repeat(50000),
    'one long digit run ("a:" + "1" x 100000)': "a:" + "1".repeat(100000),
  };

  for (const [name, text] of Object.entries(inputs)) {
    it(`${name}: the scan alone`, () => {
      expect(text.length).toBeGreaterThanOrEqual(100000);
      const { result, ms } = best(() => blankCssDeclPercents(text));
      expect(result).toBe(text);
      expect(ms).toBeLessThan(BUDGET_MS);
    });

    it(`${name}: through checkFactsTraceability`, () => {
      const { result, ms } = best(() => checkFactsTraceability([{ path: "card.css", content: text }], []));
      expect(result.claimsScanned).toBe(0);
      expect(ms).toBeLessThan(BUDGET_MS);
    });
  }
});
