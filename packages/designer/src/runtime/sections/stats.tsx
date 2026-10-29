import { StatGroup, type StatGroupItem } from "../../blocks/StatGroup.js";
import { membersOn, recordsOf, type GroupBSection, type SectionRenderInput } from "./group-b-support.js";
import { specimenDataset } from "../../studio/specimen-dataset.js";

/** sections.stats: each stat renders one Stat; the selected `layout` member picks grid or row. */
export function renderStats(input: SectionRenderInput) {
  const layout = membersOn(input, "layout").includes("row") ? "row" : "grid";
  const selectedMotion = membersOn(input, "motion");
  if (selectedMotion.length > 1 || selectedMotion.some(member => member !== "static" && member !== "count")) throw new TypeError("sections.stats: unknown or conflicting motion member");
  const motion = selectedMotion[0] === "count" ? "count" : "static";
  return <StatGroup aria-label={specimenDataset.sections.statGroup["aria-label"]} layout={layout} motion={motion} items={recordsOf<StatGroupItem>(input, "stats")} />;
}

export const statsSection: GroupBSection = { leaf: "sections.stats", slots: ["stats"], render: renderStats };
