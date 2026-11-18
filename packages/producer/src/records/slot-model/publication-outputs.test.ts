/**
 * foundry-build-0048 U18 round 1 (B2): a publication candidate's `outputs` is checked by the one shared
 * check (@clossys/publisher checkPublicationOutputs) in the slot model, and its shape is in the
 * publication schema, so a bad outputs record is refused when it is written or pinned, not when a
 * reader first projects it. The submit and pin refusals run end to end in cli/init-outputs-slot2.e2e.test.ts.
 */
import { describe, expect, it } from "vitest";
import { validateFile } from "../../pipeline/schema.js";
import { validateCandidate } from "./validate.js";

const record = (outputs: unknown) => `${JSON.stringify({
  schema: "clossys.publication/1", format: "web.page.responsive", entryOrder: ["home"],
  meta: { source: { kind: "derived", ref: ["publisher:fixture"] } }, outputs,
}, null, 2)}\n`;
const BAD = { origin: "http://example.test", feed: "rss2", extra: 1 };
const GOOD = { origin: "https://example.test", identity: { name: "site.name", summary: "site.summary" }, share: true, locales: { default: "en", all: ["en", "fr"] } };
const messages = (outputs: unknown) => validateCandidate("publication", "publication.site", "site-v2.json", record(outputs)).map(issue => issue.message);

describe("publication outputs in the slot model", () => {
  it("refuses unknown keys, a non-https origin and an unknown feed", () => {
    expect(messages(BAD)).toEqual(expect.arrayContaining([
      "outputs: unknown key extra",
      "outputs.origin must be an https origin with no path, query or credentials",
      expect.stringMatching(/^outputs\.feed must be one of rss, atom/),
    ]));
    expect(messages({ forms: [{ id: "contact", kind: "contact", fields: [], maxBytes: 8_192, targetEnv: "https://x.test", honeypot: "website", to: "a" }] }))
      .toEqual(expect.arrayContaining([expect.stringMatching(/unknown key to/), expect.stringMatching(/targetEnv must name an environment variable/)]));
  });

  it("accepts a well-formed outputs record and a publication without one", () => {
    expect(messages(GOOD)).toEqual([]);
    expect(validateCandidate("publication", "publication.site", "site-v2.json", `${JSON.stringify({ schema: "clossys.publication/1", format: "web.page.responsive", entryOrder: [], meta: { source: { kind: "derived", ref: ["publisher:fixture"] } } }, null, 2)}\n`)).toEqual([]);
  });

  it("the publication schema states the outputs shape, and the publisher candidate schema applies it", () => {
    const file = "clossys/agents/publisher/publication.site/candidates/site-v2.json";
    const issues = (schema: string, outputs: unknown) => validateFile(schema, file, record(outputs)).map(issue => `${issue.path} ${issue.message}`);
    expect(issues("publication", GOOD)).toEqual([]);
    expect(issues("candidate-publisher", GOOD)).toEqual([]);
    const bad = issues("publication", BAD).join("\n");
    expect(bad).toMatch(/outputs.*unknown key extra/);
    expect(bad).toMatch(/outputs\/origin must match/);
    expect(bad).toMatch(/outputs\/feed must be one of/);
    expect(issues("candidate-publisher", BAD)).not.toEqual([]);
  });
});
