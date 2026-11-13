import { TYPE } from "@formatjs/icu-messageformat-parser";
import { describe, expect, it } from "vitest";
import { ICU_PARSE_LIMITS, parseIcuMessage } from "./parse.js";

describe("bounded ICU MessageFormat parser", () => {
  it("returns structured nested choices, offsets, and pound nodes", () => {
    const parsed = parseIcuMessage("{n, plural, offset:1 =0 {Nobody} one {{gender, select, she {She and # guest} other {They and # guest}}} other {# guests}}");
    expect(parsed.issues).toEqual([]);
    expect(parsed.arguments).toEqual(expect.arrayContaining([{ name: "n", type: "plural", syntaxType: "plural" }, { name: "gender", type: "select", syntaxType: "select" }]));
    expect(parsed.nodes[0]).toMatchObject({ kind: "choice", name: "n", offset: 1, options: [{ selector: "=0" }, { selector: "one" }, { selector: "other" }] });
    const root = parsed.nodes[0];
    if (root?.kind !== "choice") throw new Error("Expected plural node");
    const nested = root.options[1]?.nodes[0];
    expect(nested).toMatchObject({ kind: "choice", type: "select", options: [{ nodes: [{ kind: "literal", text: "She and # guest" }] }, {}] });
    expect(root.options[2]?.nodes).toEqual([{ kind: "pound" }, { kind: "literal", text: " guests" }]);
  });

  it("handles literal braces, doubled apostrophes, ordinary apostrophes and quoted pounds", () => {
    const { formatjsAst, ...literal } = parseIcuMessage("It's '{literal}' and ''quoted'' #");
    expect(literal).toEqual({ nodes: [{ kind: "literal", text: "It's {literal} and 'quoted' #" }], arguments: [], issues: [] });
    expect(formatjsAst).toMatchObject([{ type: TYPE.literal, value: "It's {literal} and 'quoted' #" }]);
    const parsed = parseIcuMessage("{n, plural, other {'#' and #}} ");
    expect(parsed.issues).toEqual([]);
    expect(parsed.nodes[0]).toMatchObject({ options: [{ nodes: [{ kind: "literal", text: "# and " }, { kind: "pound" }] }] });
  });

  it("retains number/date/time styles and normalizes model argument types", () => {
    const parsed = parseIcuMessage("{name}: {amount, number, currency} {at, date, full} {at, time, short} {rank, selectordinal, one {#st} other {#th}}");
    expect(parsed.issues).toEqual([]);
    expect(parsed.arguments).toEqual(expect.arrayContaining([
      { name: "name", type: "string", syntaxType: "argument" }, { name: "amount", type: "number", syntaxType: "number" },
      { name: "at", type: "date", syntaxType: "date" }, { name: "at", type: "date", syntaxType: "time" },
      { name: "rank", type: "plural", syntaxType: "selectordinal" },
    ]));
    expect(parsed.nodes).toContainEqual({ kind: "argument", name: "amount", type: "number", style: "currency" });
  });

  it.each([
    ["{name", "argument"], ["{n, plural, one {one}}", "missing-other"],
    ["{n, plural, one {a} one {b} other {c}}", "duplicate-selector"],
    ["{n, plural, =1 {a} =01 {b} other {c}}", "duplicate-selector"],
    ["{s, select, a {a}}", "missing-other"], ["{n, plural, other {x}", "unbalanced"],
    ["{n, plural, offset:-1 other {x}}", "offset"], ["{s, select, offset:1 other {x}}", "offset"],
    ["{n, choice, 0#none|1#one}", "unsupported-type"], ["{n, number, ::currency/USD}", "unsupported-style"],
    ["{at, date, yyyy-MM-dd}", "unsupported-style"], ["{n, number, 'unfinished}", "quote"],
    ["{n, plural, =-2.5 {negative} other {other}}", "choice"],
    ["{n, plural, =.5 {half} other {other}}", "selector"],
    ["{user.name}", "argument"], ["{user-name}", "argument"],
  ])("rejects unsupported or malformed source %s", (text, code) => {
    expect(parseIcuMessage(text).issues).toContainEqual(expect.objectContaining({ code }));
  });

  it("accepts exact signed integer selectors and numeric argument indexes", () => {
    expect(parseIcuMessage("{0, plural, =-2 {negative} =+5 {positive} other {{1}}}").issues).toEqual([]);
  });

  it("follows engine grammar for top-level closing braces and implicitly closed literal quotes", () => {
    expect(parseIcuMessage("Hello }").nodes).toEqual([{ kind: "literal", text: "Hello }" }]);
    const quoted = parseIcuMessage("'{unfinished");
    expect(quoted.issues).toEqual([]);
    expect(quoted.nodes).toEqual([{ kind: "literal", text: "{unfinished" }]);
  });

  it("retains the engine AST with literal angle tags and deduplicated model arguments", () => {
    const parsed = parseIcuMessage("<b>{name}</b> {name} {when, time}");
    expect(parsed.issues).toEqual([]);
    expect(parsed.arguments).toEqual([{ name: "name", type: "string", syntaxType: "argument" }, { name: "when", type: "date", syntaxType: "time" }]);
    expect(parsed.formatjsAst).toMatchObject([
      { type: TYPE.literal, value: "<b>" }, { type: TYPE.argument, value: "name" },
      { type: TYPE.literal, value: "</b> " }, { type: TYPE.argument, value: "name" },
      { type: TYPE.literal, value: " " }, { type: TYPE.time, value: "when" },
    ]);
    expect(parsed.formatjsAst?.some(element => element.type === TYPE.tag)).toBe(false);
  });

  it.each([
    "{naïve}", "{value, number, unknown}", "{when, date, ::yyyyMMdd}",
    "{n, plural, invented {no} other {yes}}", "{n, plural, offset:-1 other {#}}",
    "{n, plural, =1 {one} =01 {also one} other {other}}",
  ])("withholds the runtime AST when Writer validation fails: %s", text => {
    const parsed = parseIcuMessage(text);
    expect(parsed.issues.length).toBeGreaterThan(0);
    expect(parsed.formatjsAst).toBeUndefined();
    expect(parsed.issues[0]?.index).toEqual(expect.any(Number));
  });

  it("fails with structured issues at deterministic source and nesting bounds", () => {
    expect(parseIcuMessage("x".repeat(ICU_PARSE_LIMITS.sourceLength)).issues).toEqual([]);
    expect(parseIcuMessage("x".repeat(ICU_PARSE_LIMITS.sourceLength + 1)).issues[0]?.code).toBe("limit");
    const atDepth = "{s, select, other {".repeat(ICU_PARSE_LIMITS.depth) + "x" + "}}".repeat(ICU_PARSE_LIMITS.depth);
    expect(parseIcuMessage(atDepth).issues).toEqual([]);
    const nested = "{s, select, other {".repeat(ICU_PARSE_LIMITS.depth + 1) + "x" + "}}".repeat(ICU_PARSE_LIMITS.depth + 1);
    expect(parseIcuMessage(nested).issues[0]?.code).toBe("limit");
    expect(parseIcuMessage("{x}".repeat(ICU_PARSE_LIMITS.nodes)).issues).toEqual([]);
    expect(parseIcuMessage("{x}".repeat(ICU_PARSE_LIMITS.nodes + 1)).issues[0]?.code).toBe("limit");
    const deeplyNested = "{s, select, other {".repeat(2_000) + "x" + "}}".repeat(2_000);
    expect(parseIcuMessage(deeplyNested).issues[0]?.code).toBe("limit");
  });
});
