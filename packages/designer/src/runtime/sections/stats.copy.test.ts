import { describe, expect, it } from "vitest";
import { STATS_COPY_REFS, statsCopyFrom } from "./stats.copy.js";
import { sectionCopyFixtureResolver } from "../../../../writer/src/catalog/__fixtures__/section-copy-resolver.fixture.js";
import sectionCopy from "../../../../writer/src/catalog/records/section-defaults.r1.en.json" with { type: "json" };

const refs = [...Object.values(STATS_COPY_REFS.trendLabels), ...Object.values(STATS_COPY_REFS.states)];

describe("sections.stats Writer host port", () => {
  it("reads every trend and state label from a Writer record bound to sections.stats", () => {
    for (const ref of refs) {
      const record = sectionCopy.records.find(row => row.id === ref.id);
      expect(record, ref.id).toMatchObject({ leaf: "strings.field-labels", status: "draft" });
      expect(sectionCopy.bindings).toContainEqual(expect.objectContaining({ recordId: ref.id, target: "sections.stats", kind: "CopyRef" }));
    }
    const copy = statsCopyFrom(sectionCopyFixtureResolver, "Figures");
    const text = (id: string) => sectionCopy.records.find(row => row.id === id)!.text;
    expect(copy).toEqual({
      label: "Figures",
      trendLabels: { up: text(STATS_COPY_REFS.trendLabels.up.id), down: text(STATS_COPY_REFS.trendLabels.down.id), neutral: text(STATS_COPY_REFS.trendLabels.neutral.id) },
      states: { loading: { label: text(STATS_COPY_REFS.states.loading.id) }, empty: { label: text(STATS_COPY_REFS.states.empty.id) }, error: { label: text(STATS_COPY_REFS.states.error.id) } },
    });
  });

  it("fails with the named shell copy error when the host supplies no resolver or an incomplete one", () => {
    expect(() => statsCopyFrom(undefined, "Figures")).toThrow("Designer shell copy requires a host resolver or explicit host labels");
    expect(() => statsCopyFrom(() => undefined, "Figures")).toThrow(`Designer shell copy unresolved: ${STATS_COPY_REFS.trendLabels.up.id}`);
  });
});
