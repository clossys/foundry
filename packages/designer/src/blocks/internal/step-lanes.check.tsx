import { OrderedStepSequence } from "../OrderedStepSequence.js";
export const validLanes = <OrderedStepSequence lanes={{ a: "Team", b: "Service" }} items={[{ id: "a", ordinal: 1, heading: "Share", lane: "a" }, { id: "b", ordinal: 2, heading: "Check", lane: "b" }, { id: "c", ordinal: 3, heading: "Act", lane: "a" }]} end="ends" labelledBy="process-heading" />;
// @ts-expect-error lane vocabulary is closed
export const invalidLane = <OrderedStepSequence items={[{ id: "a", ordinal: 1, heading: "Share", lane: "c" }]} />;
// @ts-expect-error termination vocabulary is closed
export const invalidEnd = <OrderedStepSequence items={[]} end="later" />;
