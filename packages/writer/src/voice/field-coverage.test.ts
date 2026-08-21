/**
 * `voice-record.template.jsonc` covers every bindable field, and nothing
 * else — the direct port of `@vespeneventures/ui/tokens`' own
 * `src/brand-coverage.test.ts`, run against `src/fields.ts`'s `VOICE_FIELDS`
 * instead of that package's `TOKENS`. See `src/fields.ts`'s header comment
 * for why every entry here is `bindable: true` and where this package's
 * fixed half actually lives instead (`types.ts`/`schema.ts`, never a runtime
 * field of any one `VoiceRecord`).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { VOICE_FIELDS } from "./fields.js";
import { parseTemplate, extractFieldPaths } from "./internal/parse-template.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const templateRaw = readFileSync(join(packageRoot, "templates", "voice-record.template.jsonc"), "utf8");
const templateParsed = parseTemplate(templateRaw);
const pathsInTemplate = extractFieldPaths(templateParsed);

describe("voice-record.template.jsonc covers every bindable field", () => {
  it("every field marked bindable in src/fields.ts appears in the template", () => {
    const bindable = Object.values(VOICE_FIELDS).filter((def) => def.bindable);
    expect(bindable.length).toBeGreaterThan(0);
    const missing = bindable.filter((def) => !pathsInTemplate.has(def.path)).map((def) => def.path);
    expect(missing).toEqual([]);
  });

  it("the template names no field this package doesn't declare", () => {
    // Guards the other direction: a stale or typo'd slot in the template
    // (e.g. a renamed field whose old path was never removed) would
    // otherwise go unnoticed, since it's harmless JSON on its own — the
    // exact failure mode `@vespeneventures/ui/tokens`' own second
    // brand-coverage test exists to catch, ported verbatim.
    const unknown = [...pathsInTemplate].filter((path) => !(path in VOICE_FIELDS));
    expect(unknown).toEqual([]);
  });

  it("no NON-bindable field is present in the template", () => {
    // Currently vacuous — every entry in VOICE_FIELDS is bindable: true, by
    // the finding recorded in fields.ts's header comment — but this test
    // stays, the same way tokens' third coverage test does, so that the day
    // a field is ever added here as bindable: false, this assertion
    // immediately means something instead of needing to be written from
    // scratch at that point.
    const notBindable = Object.values(VOICE_FIELDS)
      .filter((def) => !def.bindable)
      .map((def) => def.path);
    const wronglyPresent = notBindable.filter((path) => pathsInTemplate.has(path));
    expect(wronglyPresent).toEqual([]);
  });
});
