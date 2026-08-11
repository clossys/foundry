import { describe, expect, it } from "vitest";
import { escapeJsonForScriptTag, serializeJsonLd } from "./jsonLd.js";

describe("escapeJsonForScriptTag", () => {
  it("escapes every < and > so no HTML tag boundary can form", () => {
    const input = '{"a":"</script><script>"}';
    const out = escapeJsonForScriptTag(input);
    expect(out).toBe('{"a":"\\u003c/script\\u003e\\u003cscript\\u003e"}');
    expect(out.includes("<")).toBe(false);
    expect(out.includes(">")).toBe(false);
  });

  it("escapes &, defense-in-depth against entity injection", () => {
    expect(escapeJsonForScriptTag('{"a":"A & B"}')).toBe('{"a":"A \\u0026 B"}');
  });

  it("escapes U+2028 LINE SEPARATOR and U+2029 PARAGRAPH SEPARATOR", () => {
    const withSeparators = `{"a":"line1${"\u2028"}line2${"\u2029"}line3"}`;
    const out = escapeJsonForScriptTag(withSeparators);
    expect(out).toBe('{"a":"line1\\u2028line2\\u2029line3"}');
  });

  it("leaves ordinary text untouched", () => {
    expect(escapeJsonForScriptTag('{"a":"ordinary text, no special chars"}')).toBe(
      '{"a":"ordinary text, no special chars"}',
    );
  });

  it("is idempotent-safe to reason about: unescaping once fully reverses it", () => {
    const original = '{"a":"</script>&<b>"}';
    const escaped = escapeJsonForScriptTag(original);
    const unescaped = escaped
      .replace(/\\u003c/g, "<")
      .replace(/\\u003e/g, ">")
      .replace(/\\u0026/g, "&");
    expect(unescaped).toBe(original);
  });
});

describe("serializeJsonLd", () => {
  it("JSON.stringifies then escapes, in that order", () => {
    const out = serializeJsonLd({ "@type": "WebPage", name: "</script>" });
    expect(out).toBe('{"@type":"WebPage","name":"\\u003c/script\\u003e"}');
  });

  it("round-trips back to the original object through JSON.parse once < and > are restored", () => {
    const entry = { "@context": "https://schema.org", "@type": "Organization", name: "Acme & Co" };
    const serialized = serializeJsonLd(entry);
    const restored = JSON.parse(
      serialized.replace(/\\u003c/g, "<").replace(/\\u003e/g, ">").replace(/\\u0026/g, "&"),
    );
    expect(restored).toEqual(entry);
  });
});
