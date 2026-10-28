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
    expect(nested).toMatchObject({ kind: "choice", type: "select", options: [{ nodes: [{ kind: "literal", text: "She and " }, { kind: "pound" }, { kind: "literal", text: " guest" }] }, {}] });
  });

  it("handles literal braces, doubled apostrophes, ordinary apostrophes and quoted pounds", () => {
    expect(parseIcuMessage("It's '{literal}' and ''quoted'' #")).toEqual({ nodes: [{ kind: "literal", text: "It's {literal} and 'quoted' #" }], arguments: [], issues: [] });
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
    ["Hello }", "unbalanced"], ["{name", "argument"], ["{n, plural, one {one}}", "missing-other"],
    ["{n, plural, one {a} one {b} other {c}}", "duplicate-selector"],
    ["{n, plural, =1 {a} =1.0 {b} other {c}}", "duplicate-selector"],
    ["{s, select, a {a}}", "missing-other"], ["{n, plural, other {x}", "unbalanced"],
    ["{n, plural, offset:-1 other {x}}", "offset"], ["{s, select, offset:1 other {x}}", "offset"],
    ["{n, choice, 0#none|1#one}", "unsupported-type"], ["{n, number, ::currency/USD}", "unsupported-style"],
    ["{at, date, yyyy-MM-dd}", "unsupported-style"], ["'{unfinished", "quote"],
  ])("rejects unsupported or malformed source %s", (text, code) => {
    expect(parseIcuMessage(text).issues).toContainEqual(expect.objectContaining({ code }));
  });

  it("accepts exact signed decimal selectors and numeric argument indexes", () => {
    expect(parseIcuMessage("{0, plural, =-2.5 {negative} =.5 {half} other {{1}}}").issues).toEqual([]);
  });

  it("fails with structured issues at deterministic source and nesting bounds", () => {
    expect(parseIcuMessage("x".repeat(ICU_PARSE_LIMITS.sourceLength + 1)).issues[0]?.code).toBe("limit");
    const nested = "{s, select, other {".repeat(ICU_PARSE_LIMITS.depth + 1) + "x" + "}}".repeat(ICU_PARSE_LIMITS.depth + 1);
    expect(parseIcuMessage(nested).issues[0]?.code).toBe("limit");
    expect(parseIcuMessage("{x}".repeat(ICU_PARSE_LIMITS.nodes + 1)).issues[0]?.code).toBe("limit");
  });
});
