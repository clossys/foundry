import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createPostHogProvider } from "./providers/posthog.js";
import * as publicSurface from "./providers/posthog.js";
import { BLOCK_SELECTOR_GRAMMAR, PRIVATE_SUBTREE_SELECTORS } from "./providers/posthog-options.js";
import { BOTH, CHAIN_PARTS, CONTEXT, chain, clickProperties, configFor, createFake, setPage, start } from "./posthog-fake.test.js";

const VALID = ["aside", '.card [data-x="a b"]', "main > #pane", "div.a#b[c]", "[data-x]", "#only", ".only", "a b > c d", 'x[y="p/q:r.s-t_u"]'];

const INVALID: Array<[string, string]> = [
  ["a top-level comma", "a, b"],
  ["a comma without a space", "a,b"],
  ["a leading comma", ",a"],
  ["a pseudo-class", "a:hover"],
  ["a pseudo-element", "a::before"],
  ["a parenthesis", ":not(a)"],
  ["a parenthesis after a tag", "a(b)"],
  ["an escape", "a\\:b"],
  ["a general sibling combinator", "a ~ b"],
  ["an adjacent sibling combinator", "a + b"],
  ["a child combinator without spaces", "a>b"],
  ["a double space", "a  b"],
  ["a descendant combinator with a tab", "a\tb"],
  ["an unbalanced bracket", "a[b"],
  ["an unbalanced closing bracket", "a]"],
  ["an unterminated attribute value", 'a[b="c'],
  ["an attribute operator", 'a[b^="c"]'],
  ["an unquoted attribute value", "a[b=c]"],
  ["a single-quoted attribute value", "a[b='c']"],
  ["a space at the start", " a"],
  ["a space at the end", "a "],
  ["a trailing combinator", "a >"],
  ["a leading combinator", "> a"],
  ["an empty selector part", "a >  b"],
  ["a universal selector", "*"],
  ["a universal selector inside", "a *"],
  ["an upper-case tag", "DIV"],
  ["a tag with an underscore", "a_b"],
  ["a class starting with a digit", ".1a"],
  ["an empty class", "a."],
  ["an empty id", "a#"],
  ["an attribute with an upper-case name", "a[B]"],
  ["a quote inside a value", 'a[b="c"d"]'],
  ["a value with a backslash", 'a[b="c\\d"]'],
  ["a value with a bracket", 'a[b="]"]'],
  ["a non-ASCII class", ".é"],
  ["a newline", "a\nb"],
  ["a semicolon", "a;b"],
  ["a brace", "a{}"],
  ["an at-rule", "@media"],
];

function replayStarted(selectors: readonly string[]) {
  setPage();
  const { fake, provider } = start({ ...BOTH, blockSelectors: selectors });
  return { fake, provider, started: fake.names().includes("startSessionRecording") };
}

describe("P-43 posthog-block-selectors: host block selectors (C-63, C-68)", () => {
  it.each(VALID)("a valid selector is accepted by the grammar and starts replay: %s", (selector) => {
    expect(BLOCK_SELECTOR_GRAMMAR.test(selector)).toBe(true);
    expect(replayStarted([selector]).started).toBe(true);
  });

  it.each(INVALID)("leaves replay off with no start call and no throw, while pageviews and autocapture still run: %s", (_label, selector) => {
    expect(BLOCK_SELECTOR_GRAMMAR.test(selector)).toBe(false);
    setPage();
    const fake = createFake();
    const provider = createPostHogProvider(fake.sdk, configFor({ ...BOTH, blockSelectors: [selector] }));
    expect(() => provider.init(CONTEXT)).not.toThrow();
    expect(() => provider.optIn()).not.toThrow();
    expect(fake.names()).not.toContain("startSessionRecording");
    expect(fake.names()).not.toContain("get_session_id");
    provider.capture({ kind: "pageview", url: "https://example.test/", properties: {} });
    fake.emit("$autocapture", clickProperties(chain(CHAIN_PARTS.target)));
    expect(fake.sent.map((event) => event.event)).toEqual(["$pageview", "$autocapture"]);
  });

  it("one invalid selector among valid ones leaves replay off", () => {
    expect(replayStarted(["aside", "a, b", "main"]).started).toBe(false);
    expect(replayStarted(["aside", "main"]).started).toBe(true);
  });

  it("host selectors follow the private selectors in the joined block selector, in order", () => {
    const { fake } = replayStarted(["aside", ".card", "main > #pane"]);
    const configured = fake.inits[0]!.config.session_recording as { blockSelector: string };
    expect(configured.blockSelector).toBe([...PRIVATE_SUBTREE_SELECTORS, "aside", ".card", "main > #pane"].join(", "));
    expect(configured.blockSelector.startsWith(PRIVATE_SUBTREE_SELECTORS.join(", "))).toBe(true);
  });

  it("with no host selector the block selector is the private ones alone", () => {
    const { fake } = replayStarted([]);
    expect((fake.inits[0]!.config.session_recording as { blockSelector: string }).blockSelector).toBe(PRIVATE_SUBTREE_SELECTORS.join(", "));
  });

  it("a read-back that drops the private selectors after a valid host selector leaves replay off", () => {
    setPage();
    const fake = createFake();
    fake.reportedRecording = (configured) => ({ ...(configured as object), blockSelector: "aside" });
    const provider = createPostHogProvider(fake.sdk, configFor({ ...BOTH, blockSelectors: ["aside"] }));
    provider.init(CONTEXT);
    provider.optIn();
    expect(fake.names()).not.toContain("startSessionRecording");
  });

  it("a selector longer than 200 characters throws a TypeError before the expression runs; one of 200 does not", () => {
    setPage();
    const fake = createFake();
    expect(() => createPostHogProvider(fake.sdk, configFor({ ...BOTH, blockSelectors: [`.${"a".repeat(200)}`] }))).toThrow(TypeError);
    expect(() => createPostHogProvider(fake.sdk, configFor({ ...BOTH, blockSelectors: [`.${"a".repeat(199)}`] }))).not.toThrow();
  });

  it("a malformed list throws a TypeError: not an array, a non-string entry, an empty entry, or more than 50 entries", () => {
    setPage();
    for (const bad of ["aside", [5], [""], [null], Array.from({ length: 51 }, () => "a")]) {
      const config = configFor(BOTH) as unknown as { replay: Record<string, unknown> };
      config.replay.blockSelectors = bad;
      expect(() => createPostHogProvider(createFake().sdk, config as never)).toThrow(TypeError);
    }
    const fifty = configFor(BOTH) as unknown as { replay: Record<string, unknown> };
    fifty.replay.blockSelectors = Array.from({ length: 50 }, () => "a");
    expect(() => createPostHogProvider(createFake().sdk, fifty as never)).not.toThrow();
  });

  it("tens of thousands of repeated fragments ending in an invalid character return promptly when tested against the expression directly", () => {
    const hostile = [
      `${".a".repeat(30_000)}!`,
      `a${'[a="'.repeat(20_000)}!`,
      `${"a ".repeat(30_000)}!`,
      `${"a > ".repeat(20_000)}!`,
      `${"a".repeat(60_000)}!`,
      `${'[a="b"]'.repeat(10_000)}!`,
      `${"#a".repeat(30_000)}:`,
    ];
    const started = Date.now();
    for (const input of hostile) expect(BLOCK_SELECTOR_GRAMMAR.test(input)).toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("a long adversarial selector within the length cap leaves replay off without throwing", () => {
    const adversarial = `${".a".repeat(98)}!`;
    expect(adversarial.length).toBeLessThanOrEqual(200);
    expect(replayStarted([adversarial]).started).toBe(false);
  });

  it("BLOCK_SELECTOR_GRAMMAR is the literal expression the specification gives", () => {
    const docs = readFileSync(new URL("../../../../docs/browser-consent-analytics.md", import.meta.url), "utf8");
    const match = /const BLOCK_SELECTOR_GRAMMAR =\n {2}\/(.+)\/;\n/.exec(docs);
    expect(match).not.toBeNull();
    expect(BLOCK_SELECTOR_GRAMMAR.source).toBe(match![1]);
    expect(BLOCK_SELECTOR_GRAMMAR.flags).toBe("");
  });

  it("the two pieces the specification names are not exported", () => {
    expect(Object.keys(publicSurface)).not.toContain("BLOCK_SELECTOR_PART");
    expect(Object.keys(publicSurface)).not.toContain("BLOCK_SELECTOR_COMPOUND");
  });
});
