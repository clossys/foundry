import { describe, expect, it } from "vitest";
import type { BrandFacts } from "./brand-facts.js";
import { validateBrandFacts } from "./brand-facts.js";
import {
  COMPANY_PHRASE_RE,
  MAX_LINE_CHARS,
  META_TAG_RE,
  checkBrandFactsDrift,
  hostOfValue,
  stripTrailingPunctuation,
  trimTrailingSeparators,
} from "./brand-facts-drift.js";

// Every value below is fictional; every domain is under the reserved
// `.example` TLD.
//
// Each witness is one 80 KB line built so that an unbounded quantifier in front
// of a suffix that fails is retried from every start position (quadratic
// backtracking). The matchers are called DIRECTLY: `checkBrandFactsDrift`
// refuses an over-cap line before any matcher runs, so an end-to-end test proves
// only the cap and would hide a matcher that is still quadratic.

const BUDGET_MS = 250;

/**
 * Runs `run` and returns its result with the fastest of up to three timings.
 * The machine running the suite may be heavily loaded, and a load spike must
 * not read as a slow matcher; a quadratic matcher is slow on every attempt
 * (seconds, not milliseconds), so a slow first attempt is not retried.
 */
function timed<T>(run: () => T): { result: T; ms: number } {
  let best = Number.POSITIVE_INFINITY;
  let result: T;
  let attempts = 0;
  do {
    const start = performance.now();
    result = run();
    best = Math.min(best, performance.now() - start);
    attempts++;
  } while (best >= BUDGET_MS && best < 5 * BUDGET_MS && attempts < 3);
  return { result, ms: best };
}

const facts: BrandFacts = {
  legalEntity: { name: "Lumenfold Labs Inc.", incorporated: true, jurisdiction: "Delaware" },
  brand: { name: "Lumenfold", wordmark: "LUMENFOLD" },
  domains: ["lumenfold.example"],
  canonicalOrigin: "https://lumenfold.example",
  contactEmail: "hello@lumenfold.example",
  taglines: [],
};

describe("brand-facts drift matchers are linear in line length", () => {
  it("trims trailing whitespace and commas (unquoted key value)", () => {
    const witness = " \t".repeat(40000) + "y";
    expect(witness.length).toBeGreaterThanOrEqual(80000);
    const { result, ms } = timed(() => trimTrailingSeparators(witness));
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(result).toBe(witness);
  });

  it("reads the host of a domain-style value", () => {
    // The plain witness is the brief's; the U+2028 one is what makes `.*$` fail
    // and retry from every `#` (a line terminator stops `.`, so `$` cannot match).
    for (const witness of ["#".repeat(80000) + " x", "#".repeat(80000) + "\u2028x"]) {
      const { result, ms } = timed(() => hostOfValue(witness));
      expect(ms).toBeLessThan(BUDGET_MS);
      expect(result).toBe("");
    }
  });

  it("strips trailing URL punctuation", () => {
    const witness = "https://a" + "!".repeat(80000) + "x";
    const { result, ms } = timed(() => stripTrailingPunctuation(witness));
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(result).toBe(witness);
  });

  it("finds company phrases", () => {
    const witness = "Aa ".repeat(26666);
    const { result, ms } = timed(() => [...witness.matchAll(COMPANY_PHRASE_RE)]);
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(result).toEqual([]);
  });

  it("finds meta tags", () => {
    const witness = "<meta".repeat(16000);
    const { result, ms } = timed(() => [...witness.matchAll(META_TAG_RE)]);
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(result).toEqual([]);
  });

  it("validates a contact email in the record", () => {
    const witness = "!@!." + "!.".repeat(40000) + " ";
    const { result, ms } = timed(() => validateBrandFacts({ ...facts, contactEmail: witness }));
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(result.ok).toBe(false);
  });
});

describe("hostOfValue, trimTrailingSeparators and stripTrailingPunctuation keep their behavior", () => {
  it("hostOfValue tolerates a scheme, a path, a port, and a trailing dot", () => {
    expect(hostOfValue("HTTPS://Example.Test:8080/a?b#c")).toBe("example.test");
    expect(hostOfValue(" example.test. ")).toBe("example.test");
    expect(hostOfValue("example.test/x")).toBe("example.test");
    expect(hostOfValue("example.test?q")).toBe("example.test");
  });

  it("trimTrailingSeparators trims whitespace and commas only at the end", () => {
    expect(trimTrailingSeparators("a b ,  , \t")).toBe("a b");
    expect(trimTrailingSeparators(" ,a")).toBe(" ,a");
    expect(trimTrailingSeparators("")).toBe("");
    expect(trimTrailingSeparators(" , ")).toBe("");
  });

  it("stripTrailingPunctuation trims sentence punctuation only at the end", () => {
    expect(stripTrailingPunctuation("https://a.example/x.")).toBe("https://a.example/x");
    expect(stripTrailingPunctuation("https://a.example/x?!,;:.")).toBe("https://a.example/x");
    expect(stripTrailingPunctuation("https://a.example/x?y=1")).toBe("https://a.example/x?y=1");
    expect(stripTrailingPunctuation("...")).toBe("");
  });
});

describe("checkBrandFactsDrift caps the line length and fails closed", () => {
  const longClean = "x".repeat(80 * 1024);
  const run = (content: string) => checkBrandFactsDrift([{ path: "page.md", content }], facts);

  it("exposes a 16384-character cap", () => {
    expect(MAX_LINE_CHARS).toBe(16384);
  });

  it("makes an 80 KB clean line indeterminate and names file:line", () => {
    const result = run(`ok\n${longClean}\nok`);
    expect(result.state).toBe("indeterminate");
    expect(result.indeterminateReasons).toHaveLength(1);
    expect(result.indeterminateReasons[0]).toContain("page.md:2");
  });

  it("makes an 80 KB line indeterminate even when it carries the ignore marker", () => {
    const result = run(`<!-- brand-facts:ignore -->${longClean}`);
    expect(result.state).toBe("indeterminate");
    expect(result.ignored).toEqual([]);
    expect(result.indeterminateReasons[0]).toContain("page.md:1");
  });

  it("accepts a line of exactly the cap and refuses one character more", () => {
    expect(run("x".repeat(MAX_LINE_CHARS)).state).toBe("clean");
    expect(run("x".repeat(MAX_LINE_CHARS + 1)).state).toBe("indeterminate");
  });

  it("does not let a CRLF terminator count toward the cap", () => {
    expect(run(`${"x".repeat(MAX_LINE_CHARS)}\r\nok`).state).toBe("clean");
  });

  it("still reports drift found on other lines, and indeterminate wins", () => {
    const result = run(`Lumenfold Labs Ltd sells things.\n${longClean}`);
    expect(result.state).toBe("indeterminate");
    expect(result.findings.map((f) => f.kind)).toEqual(["legal-name"]);
  });

  it("bounds the number of reasons for a file of many long lines", () => {
    const result = run(Array.from({ length: 100 }, () => longClean).join("\n"));
    expect(result.state).toBe("indeterminate");
    expect(result.indeterminateReasons.length).toBeLessThanOrEqual(21);
    expect(result.indeterminateReasons.at(-1)).toContain("80 more");
  });
});

describe("checkBrandFactsDrift finishes on pathological lines just under the cap", () => {
  const pad = (unit: string, prefix = "") => (prefix + unit.repeat(Math.ceil(MAX_LINE_CHARS / unit.length))).slice(0, MAX_LINE_CHARS);
  const witnesses: Record<string, string> = {
    separators: pad(" \t", "tagline: x"),
    fragments: pad("#", "domain: "),
    punctuation: pad("!", "https://a"),
    capitalizedWords: pad("Aa "),
    metaOpeners: pad("<meta"),
    emails: pad("!.", "!@!."),
    incorporated: pad("incorporated in "),
    governed: pad("governed by the laws of Aa "),
    urls: pad("https://a.example/x "),
  };
  for (const [name, line] of Object.entries(witnesses)) {
    it(`runs the whole check on ${name}`, () => {
      expect(line.length).toBeLessThanOrEqual(MAX_LINE_CHARS);
      const { ms } = timed(() => checkBrandFactsDrift([{ path: "page.md", content: line }], facts));
      expect(ms).toBeLessThan(1000);
    });
  }
});

describe("the jurisdiction place scan is bounded per line and per file", () => {
  const run = (content: string) => checkBrandFactsDrift([{ path: "page.md", content }], facts);
  const line = "INCORPORATED IN ".repeat(MAX_LINE_CHARS / "INCORPORATED IN ".length);
  const jurisdictionFindings = (result: ReturnType<typeof run>) => result.findings.filter((f) => f.kind === "jurisdiction");

  it("reports at most 16 jurisdiction findings for one repeated-phrase line at the cap", () => {
    expect(line.length).toBe(MAX_LINE_CHARS);
    expect(jurisdictionFindings(run(line)).length).toBeLessThanOrEqual(16);
  });

  it("reports at most 320 jurisdiction findings for 20 such lines, in under 200000 serialized characters", () => {
    const result = run(Array.from({ length: 20 }, () => line).join("\n"));
    expect(jurisdictionFindings(result).length).toBeLessThanOrEqual(320);
    expect(JSON.stringify(result).length).toBeLessThan(200000);
  });

  it("reports exactly 16 findings for a line carrying 17 different drifting places", () => {
    const states = [
      "Nevada", "Oregon", "Maine", "Idaho", "Kansas", "Ohio", "Texas", "Vermont", "Georgia",
      "Hawaii", "Iowa", "Montana", "Wyoming", "Florida", "Indiana", "Alabama", "Arkansas",
    ];
    const line = states.map((state) => `Incorporated in ${state}.`).join(" ");
    const found = jurisdictionFindings(run(line));
    expect(found).toHaveLength(16);
    expect(found.map((f) => f.found)).toEqual(states.slice(0, 16));
  });

  it("still reports drift after 16 matching mentions followed by one differing place", () => {
    const correct = "<p>Lumenfold Labs Inc. is incorporated in Delaware.</p>";
    const wrong = "<p>Our affiliate is registered in Nevada.</p>";
    const result = run(correct.repeat(16) + wrong);
    expect(result.state).toBe("drift");
    expect(result.findings.map((f) => [f.kind, f.found, f.expected])).toEqual([["jurisdiction", "Nevada", "Delaware"]]);
  });

  it("still reads an ordinary place", () => {
    expect(run("Incorporated in Delaware.").state).toBe("clean");
    const found = jurisdictionFindings(run("Incorporated in Nevada."));
    expect(found.map((f) => [f.line, f.found, f.expected])).toEqual([[1, "Nevada", "Delaware"]]);
  });
});

describe("the ignore marker", () => {
  const run = (content: string) => checkBrandFactsDrift([{ path: "page.md", content }], facts);

  it("is not triggered by a URL fragment that spells the marker", () => {
    const result = run("Lumenfold Labs Ltd, see https://x.example/#brand-facts:ignore");
    expect(result.state).toBe("drift");
    expect(result.ignored).toEqual([]);
  });

  it("is not triggered by a mid-line hash", () => {
    expect(run("Lumenfold Labs Ltd # brand-facts:ignore").state).toBe("drift");
  });

  it("still silences a line that opens with a hash comment, and only that line", () => {
    const result = run("# brand-facts:ignore Lumenfold Labs Ltd\nLumenfold Labs Ltd");
    expect(result.ignored).toHaveLength(1);
    expect(result.findings.map((f) => f.line)).toEqual([2]);
  });

  it("still silences a line with an HTML, block or line comment marker", () => {
    for (const marker of ["<!-- brand-facts:ignore -->", "/* brand-facts:ignore */", "{/* brand-facts:ignore */}", "// brand-facts:ignore"]) {
      const result = run(`Lumenfold Labs Ltd ${marker}`);
      expect(result.ignored).toHaveLength(1);
      expect(result.findings).toEqual([]);
    }
  });
});
