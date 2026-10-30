import { Slot, layoutState, slotNodes } from "./preview/structure.js";
import type { LayoutProps } from "./preview/structure.js";
/** A single ordered column; the Stage owns container reflow. */
export function Stack(props: LayoutProps) {
  const { contract, members } = layoutState("layouts.stack", props);
  return <div data-layout="layouts.stack" data-measure={members.measure} data-align={members.align} className="grid gap-lg">
    {contract.slots.map(slot => <Slot id={slot.id} key={slot.id}>{slotNodes(props, slot.id)}</Slot>)}
  </div>;
}
