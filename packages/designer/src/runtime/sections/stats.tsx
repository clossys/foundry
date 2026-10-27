import { StatGroup, type StatGroupItem } from "../../blocks/StatGroup.js";
import { membersOn, recordsOf, type GroupBSection, type SectionRenderInput } from "./group-b-support.js";
import { specimenDataset } from "../../studio/specimen-dataset.js";

/** sections.stats: each stat renders one Stat; the selected `layout` member picks grid or row. */
export function renderStats(input: SectionRenderInput) {
  const layout = membersOn(input, "layout").includes("row") ? "row" : "grid";
  return <StatGroup aria-label={specimenDataset.sections.statGroup["aria-label"]} layout={layout} items={recordsOf<StatGroupItem>(input, "stats")} />;
}

export const statsSection: GroupBSection = { leaf: "sections.stats", slots: ["stats"], render: renderStats };
