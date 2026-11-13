import { Timeline } from "../../blocks/Timeline.js";
import { timelineSample } from "../../blocks/timeline/sample.js";

/** One keyed contribution for the central Studio/contract owner to append. */
export const timelineA270Contribution = {
  id: "sections.timeline",
  allowedComposes: ["components.card", "components.semantic-content"],
  requiredComponentParts: { "components.card": ["CardHeader", "CardTitle", "CardContent"] },
  renderSpecimen: () => <Timeline {...timelineSample} />,
} as const;
