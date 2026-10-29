import { expect, it } from "vitest";
import { buildSecurityTxt } from "./security.js";
import type { SecurityTxtOptions } from "./security.js";

const required: SecurityTxtOptions = { contact: "https://example.test/security/contact", expires: "2030-06-30T12:00:00Z" };

it("emits explicit RFC 9116 required fields and a final newline", () => {
  expect(buildSecurityTxt(required)).toBe("Contact: https://example.test/security/contact\nExpires: 2030-06-30T12:00:00Z\n");
});

it("preserves contact priority and serializes optional standard fields deterministically", () => {
  const options: SecurityTxtOptions = {
    ...required, contact: ["https://example.test/security/contact", "mailto:security@example.test", "tel:+12025550123"],
    policy: "https://example.test/security/policy", preferredLanguages: ["en"],
  };
  const before = JSON.stringify(options);
  const expected = "Contact: https://example.test/security/contact\nContact: mailto:security@example.test\nContact: tel:+12025550123\nExpires: 2030-06-30T12:00:00Z\nPolicy: https://example.test/security/policy\nPreferred-Languages: en\n";
  expect(buildSecurityTxt(options)).toBe(expected);
  expect(buildSecurityTxt(options)).toBe(expected);
  expect(JSON.stringify(options)).toBe(before);
});

it("requires a nonempty Contact and an explicit Expires at runtime", () => {
  for (const contact of [undefined, null, "", [], [""]]) {
    expect(() => buildSecurityTxt({ ...required, contact } as unknown as SecurityTxtOptions)).toThrow(/contact/i);
  }
  const { expires: _expires, ...missingExpires } = required;
  expect(() => buildSecurityTxt(missingExpires as SecurityTxtOptions)).toThrow(/expires/i);
});

it.each([
  "", "tomorrow", "2030-06-30", "2030-06-30T12:00:00", "2030-02-30T12:00:00Z",
  "2030-13-01T12:00:00Z", "2030-06-30T24:00:00Z", "2030-06-30T12:60:00Z",
  "2030-06-30T12:00:00+24:00", "2030-06-30T12:00:00Z\nContact: https://example.test/other",
])("refuses malformed Expires %j", expires => {
  expect(() => buildSecurityTxt({ ...required, expires })).toThrow(/expires/i);
});

it("accepts explicit leap-day and timezone timestamps without consulting current time", () => {
  const expires = "2024-02-29T12:30:00+02:30";
  expect(buildSecurityTxt({ ...required, expires })).toContain(`Expires: ${expires}\n`);
});

it.each([
  "https://example.test/contact\nExpires: 2099-01-01T00:00:00Z", "https://example.test/contact\r",
  "https://example.test/%0aContact:other", "mailto:security@example.test?subject=%0d%0aInjected",
  "javascript:alert(1)", "data:text/plain,contact", "file:///contact", "http://example.test/contact",
  "https://user:password@example.test/contact", "/security/contact", "security@example.test", "mailto:", "tel:",
])("refuses unsafe or malformed Contact URI %j", contact => {
  expect(() => buildSecurityTxt({ ...required, contact })).toThrow(/contact/i);
});

it.each(["http://example.test/policy", "/policy", "javascript:policy", "https://example.test/policy\nContact:other", "https://example.test/%0dpolicy", "https://user:password@example.test/policy"])("requires an injection-safe HTTPS Policy URI %j", policy => {
  expect(() => buildSecurityTxt({ ...required, policy })).toThrow(/policy/i);
});

it("refuses malformed language tags and field injection", () => {
  for (const preferredLanguages of [[], [""], ["en\nPolicy: https://example.test"], ["en,other"], ["not_a_tag"]]) {
    expect(() => buildSecurityTxt({ ...required, preferredLanguages })).toThrow(/language/i);
  }
});
