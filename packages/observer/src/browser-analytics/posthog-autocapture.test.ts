import { describe, expect, it } from "vitest";
import { parseElementsChain, rebuildAutocapture } from "./providers/posthog-autocapture.js";
import { CHAIN_PARTS, chain, clickProperties, setPage, start } from "./posthog-fake.test.js";

const ATTR = (value: string) => `attr__data-analytics-id="${value}"`;
const LEAKS = ["Buy now secret-text", "token=abc123", "abc123", "/buy", "href", "other.test", "card-1", "primary", "nth-child"];

function accepted(properties: Record<string, unknown>): Record<string, unknown> | null {
  setPage();
  const { fake } = start({ autocapture: true });
  const out = fake.emit("$autocapture", properties) as { properties: Record<string, unknown> } | null;
  return out ? out.properties : null;
}

describe("P-36 posthog-autocapture: corpus (C-66, test obligation d)", () => {
  it("a click on an opted-in element keeps only its tag and the attribute, with no text, link, class, id, position or ancestor", () => {
    const properties = accepted(clickProperties(chain(CHAIN_PARTS.target, CHAIN_PARTS.div, CHAIN_PARTS.body)));
    expect(properties).not.toBeNull();
    expect(properties!.$event_type).toBe("click");
    expect(properties!.$elements_chain).toBe('button:attr__data-analytics-id="cta-main"');
    expect(properties!.$current_url).toBe("https://example.test/pricing");
    const text = JSON.stringify(properties);
    for (const leak of LEAKS) expect(text).not.toContain(leak);
    for (const dropped of ["$el_text", "$elements", "$external_click_url", "attr__href"]) {
      expect(Object.keys(properties!)).not.toContain(dropped);
    }
  });

  it("a submit event is kept", () => {
    const properties = accepted(clickProperties(`form:${ATTR("signup-form")}`, { $event_type: "submit" }));
    expect(properties?.$event_type).toBe("submit");
    expect(properties?.$elements_chain).toBe('form:attr__data-analytics-id="signup-form"');
  });

  it("the legacy elements list is read when no chain is present", () => {
    const properties = accepted({
      $event_type: "click",
      $elements: [
        { tag_name: "a", attr__href: "/x?token=abc123", "attr__data-analytics-id": "nav-link", $el_text: "Buy now secret-text" },
        { tag_name: "body" },
      ],
      $current_url: "https://example.test/pricing?token=abc123",
    });
    expect(properties?.$elements_chain).toBe('a:attr__data-analytics-id="nav-link"');
    expect(JSON.stringify(properties)).not.toContain("abc123");
  });

  const DROPPED: Array<[string, Record<string, unknown>]> = [
    ["the target lacks the attribute although an ancestor has it", clickProperties(chain("button:nth-child=\"1\"", `div:${ATTR("outer")}`))],
    ["the attribute value is empty", clickProperties(`button:${ATTR("")}`)],
    ["the attribute value has upper-case letters", clickProperties(`button:${ATTR("Cta")}`)],
    ["the attribute value has a space", clickProperties(`button:${ATTR("a b")}`)],
    ["the attribute value starts with a dash", clickProperties(`button:${ATTR("-a")}`)],
    ["the attribute value is 65 characters", clickProperties(`button:${ATTR("a".repeat(65))}`)],
    ["a change event", clickProperties(`button:${ATTR("cta")}`, { $event_type: "change" })],
    ["an input event", clickProperties(`button:${ATTR("cta")}`, { $event_type: "input" })],
    ["a missing event type", (() => { const p = clickProperties(`button:${ATTR("cta")}`); delete p.$event_type; return p; })()],
    ["an event type that is not a string", clickProperties(`button:${ATTR("cta")}`, { $event_type: ["click"] })],
    ["an input target", clickProperties(`input:${ATTR("cta")}`)],
    ["a textarea target", clickProperties(`textarea:${ATTR("cta")}`)],
    ["a select target", clickProperties(`select:${ATTR("cta")}`)],
    ["a contenteditable target", clickProperties(`div:${ATTR("cta")}attr__contenteditable="true"`)],
    ["a target inside data-private", clickProperties(chain(`button:${ATTR("cta")}`, 'div:attr__data-private=""'))],
    ["a target inside the consent banner", clickProperties(chain(`button:${ATTR("cta")}`, 'section:attr__data-consent-banner=""', "body:nth-child=\"1\""))],
    ["a target marked data-private itself", clickProperties(`button:${ATTR("cta")}attr__data-private=""`)],
    ["a target inside a password field", clickProperties(chain(`span:${ATTR("cta")}`, 'input:attr__type="password"'))],
    ["a target with a password type, upper case", clickProperties(chain(`span:${ATTR("cta")}`, 'div:attr__type="PASSWORD"'))],
    ["a target inside a cc- autocomplete field", clickProperties(chain(`span:${ATTR("cta")}`, 'div:attr__autocomplete="cc-number"'))],
    ["a target inside a cc- autocomplete field, upper case", clickProperties(chain(`span:${ATTR("cta")}`, 'div:attr__autocomplete="CC-name"'))],
    ["an empty chain", clickProperties("")],
    ["a chain with no element data and no list", { $event_type: "click", $current_url: "https://example.test/" }],
    ["a chain that is not a string", clickProperties("x", { $elements_chain: 5 })],
    ["a chain with an unclosed quote", clickProperties(`button:attr__data-analytics-id="cta`)],
    ["a chain with an empty tag", clickProperties(`:${ATTR("cta")}`)],
    ["a chain with a duplicate attribute", clickProperties(`button:${ATTR("cta")}${ATTR("other")}`)],
    ["a tag with a capital letter", clickProperties(`Button:${ATTR("cta")}`)],
    ["a tag with a dash", clickProperties(`my-button:${ATTR("cta")}`)],
    ["a tag that starts with a digit", clickProperties(`1a:${ATTR("cta")}`)],
    ["an unparseable elements list", { $event_type: "click", $elements: "oops", $current_url: "https://example.test/" }],
    ["an empty elements list", { $event_type: "click", $elements: [], $current_url: "https://example.test/" }],
    ["an elements list whose entry has no tag", { $event_type: "click", $elements: [{ "attr__data-analytics-id": "cta" }], $current_url: "https://example.test/" }],
    ["an overlong chain", clickProperties(`button:${ATTR("cta")}` + ";div:" + `attr__x="${"a".repeat(120_000)}"`)],
  ];

  it.each(DROPPED)("is dropped: %s", (_label, properties) => {
    expect(accepted(properties)).toBeNull();
  });

  it("a quote escaped inside another attribute's value does not end the chain early", () => {
    const properties = accepted(clickProperties(`button:attr__title="say \\"hi\\""${ATTR("cta")}`));
    expect(properties?.$elements_chain).toBe('button:attr__data-analytics-id="cta"');
  });

  it("a private marker in a quoted value of another attribute does not count as a marker", () => {
    const properties = accepted(clickProperties(`button:attr__title="attr__data-private=\\"\\""${ATTR("cta")}`));
    expect(properties?.$elements_chain).toBe('button:attr__data-analytics-id="cta"');
  });

  it("a hostile href with a query token never reaches the URL fields", () => {
    const properties = accepted(clickProperties(`a:${ATTR("cta")}attr__href="https://evil.test/?token=abc123"`, { $current_url: "https://example.test/pricing?token=abc123#x" }));
    expect(properties?.$current_url).toBe("https://example.test/pricing");
    expect(JSON.stringify(properties)).not.toMatch(/evil|abc123/);
  });

  it("no raw input value reaches the seam in any recorded call or hook output", () => {
    setPage();
    const { fake } = start({ autocapture: true });
    const secret = "hunter2-secret-value";
    fake.emit("$autocapture", { ...clickProperties(`input:${ATTR("cta")}attr__value="${secret}"`), $el_text: secret });
    fake.emit("$autocapture", { ...clickProperties(`button:${ATTR("cta")}attr__value="${secret}"`, { $event_type: "change" }), value: secret });
    fake.emit("$autocapture", { ...clickProperties(`button:${ATTR("cta")}attr__value="${secret}"`), value: secret, $el_text: secret });
    expect(JSON.stringify(fake.sent)).not.toContain(secret);
    expect(JSON.stringify(fake.calls)).not.toContain(secret);
    expect(fake.sent).toHaveLength(1);
  });

  it("the chain parser returns elements in order with their attributes, and null on a malformed chain", () => {
    const elements = parseElementsChain(chain(CHAIN_PARTS.target, CHAIN_PARTS.div, CHAIN_PARTS.body));
    expect(elements?.map((element) => element.tag)).toEqual(["button", "div", "body"]);
    expect(elements?.[0]?.attributes.get("attr__data-analytics-id")).toBe("cta-main");
    expect(elements?.[0]?.attributes.get("attr__href")).toBe("/buy?token=abc123");
    for (const bad of ["", ";", "a;", ";a", "a:attr__x=", 'a:attr__x="v"junk', 5, null, undefined]) {
      expect(parseElementsChain(bad)).toBeNull();
    }
  });

  it("the chain parser runs in linear time on long adversarial chains", () => {
    const started = Date.now();
    for (const adversarial of [
      "a".repeat(90_000),
      ":".repeat(90_000),
      `a${":x=".repeat(30_000)}`,
      Array.from({ length: 20_000 }, () => "a:b").join(";"),
      `a:${'attr__x="'.repeat(10_000)}`,
    ]) {
      parseElementsChain(adversarial);
    }
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("rebuildAutocapture is a pure function of its argument", () => {
    const input = clickProperties(chain(CHAIN_PARTS.target, CHAIN_PARTS.div));
    const snapshot = JSON.stringify(input);
    expect(rebuildAutocapture(input)).toEqual({ eventType: "click", elementsChain: 'button:attr__data-analytics-id="cta-main"' });
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
