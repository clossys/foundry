import { describe, expect, it } from "vitest";
import { checkPublicationOutputs, publicationFormDefaults, type PublicationOutputs } from "./outputs.js";

const valid = (): PublicationOutputs => ({
  origin: "https://example.com",
  identity: { name: "site.name", summary: "site.summary" },
  share: true, jsonLd: true, llms: true, feed: "atom",
  forms: [publicationFormDefaults("contact"), publicationFormDefaults("newsletter")],
  locales: { default: "en", all: ["en", "fr-CA"] },
});
const with_ = (change: (value: any) => void) => { const value: any = structuredClone(valid()); change(value); return checkPublicationOutputs(value); };

describe("checkPublicationOutputs", () => {
  it("accepts the standard contact and newsletter forms with every optional output", () => {
    expect(checkPublicationOutputs(valid())).toEqual([]);
    expect(checkPublicationOutputs({})).toEqual([]);
  });
  it("refuses a target that is a value instead of an environment variable name", () => {
    expect(with_(value => { value.forms[0].targetEnv = "https://hooks.example.com/abc"; })).toEqual([expect.stringMatching(/forms\[0\]\.targetEnv/)]);
    expect(with_(value => { value.forms[0].targetEnv = "lower_case"; })).toEqual([expect.stringMatching(/targetEnv/)]);
  });
  it("refuses unknown keys, unbounded sizes and a honeypot that shadows a field", () => {
    expect(with_(value => { value.extra = true; })).toEqual([expect.stringMatching(/unknown key extra/)]);
    expect(with_(value => { value.forms[0].maxBytes = 10_000_000; })).toEqual([expect.stringMatching(/maxBytes/)]);
    expect(with_(value => { value.forms[0].fields[0].maxLength = 0; })).toEqual([expect.stringMatching(/maxLength/)]);
    expect(with_(value => { value.forms[0].honeypot = "email"; })).toEqual([expect.stringMatching(/honeypot/)]);
    expect(with_(value => { value.forms[1].id = "contact"; })).toEqual([expect.stringMatching(/duplicate form id contact/)]);
    expect(with_(value => { value.forms[0].fields = value.forms[0].fields.filter((field: any) => field.type !== "email"); })).toEqual([expect.stringMatching(/email field/)]);
  });
  it("refuses page-meta outputs without an https origin and Writer identity keys", () => {
    expect(with_(value => { delete value.origin; })).toEqual(expect.arrayContaining([expect.stringMatching(/origin/)]));
    expect(with_(value => { value.origin = "http://example.com"; })).toEqual([expect.stringMatching(/origin/)]);
    expect(with_(value => { value.identity.name = "Literal Name"; })).toEqual([expect.stringMatching(/identity\.name/)]);
    expect(with_(value => { value.feed = "json"; })).toEqual([expect.stringMatching(/feed/)]);
  });
  it("refuses locales that are not canonical, repeated, or miss the default", () => {
    expect(with_(value => { value.locales.all = ["en", "en"]; })).toEqual([expect.stringMatching(/locales/)]);
    expect(with_(value => { value.locales.default = "de"; })).toEqual([expect.stringMatching(/locales\.default/)]);
    expect(with_(value => { value.locales.all = ["en", "FR"]; })).toEqual([expect.stringMatching(/locales\.all/)]);
    // Round 1: two spellings of one locale are one folder on a case-insensitive file system.
    expect(with_(value => { value.locales.all = ["en", "en-US", "en-us"]; })).toEqual([expect.stringMatching(/locales\.all.*case-insensitively/)]);
  });
});
