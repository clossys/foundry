/**
 * Test host only: resolves the draft section-defaults string records through
 * the real Writer resolver at the preview target, so consumer tests read
 * Writer text instead of copying it. Never a production fallback.
 */
import { createCopyResolver } from "../../resolve.js";
import type { StringRecord } from "../../model/types.js";
import { withDeclaredCommonRecords } from "./shared-records.fixture.js";
import sectionCopy from "../records/section-defaults.r1.en.json" with { type: "json" };

type SectionCopyRef = { readonly id: string; readonly locale?: string; readonly values?: Readonly<Record<string, string | number | boolean>> };

const records = withDeclaredCommonRecords(sectionCopy).filter((record): record is StringRecord => "text" in record);
const resolve = createCopyResolver({
  id: "section-defaults-fixture", locale: sectionCopy.locale, revision: String(sectionCopy.revision),
  source: { kind: "generated", reference: "writer/section-defaults.r1.en.json" },
  entries: records.map(record => ({ ...record, placeholders: record.args?.map(arg => arg.name) })),
}, { target: "preview" });

/** Same shape as the Designer shell copy resolver; unknown ids resolve to undefined. */
export function sectionCopyFixtureResolver<R extends SectionCopyRef>(ref: R): { readonly ref: R; readonly text: string } | undefined {
  const resolved = resolve(ref);
  return resolved ? { ref, text: resolved.text } : undefined;
}
