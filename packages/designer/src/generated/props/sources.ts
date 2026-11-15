import sectionSlots from "../../catalog/slots/sections.json" with { type: "json" };
import retired from "../../catalog/retired.json" with { type: "json" };
import type { PropsSection } from "./generate.js";

/** Live sections: every registered section slot that is not retired in place. */
export const liveSections = (): PropsSection[] => {
  const gone = new Set((retired as { id: string }[]).map(entry => entry.id));
  return (sectionSlots as unknown as PropsSection[]).filter(slot => !gone.has(slot.id));
};
