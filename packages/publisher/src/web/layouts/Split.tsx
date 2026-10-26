import { Slot, layoutState, slotNodes } from "./preview/structure.js";
import type { LayoutProps } from "./preview/structure.js";
/** Stage-projected DOM order; token-backed container rules own geometry. */
export function Split(props: LayoutProps) {
  const { members } = layoutState("layouts.split", props);
  const ids = props.stage.slotOrder.filter(id => id === "start" || id === "end");
  return <div data-layout="layouts.split" className="grid gap-lg">
    <Slot id="lead">{slotNodes(props, "lead")}</Slot>
    <div data-layout-columns="" className="flex flex-col gap-lg" data-ratio={members.ratio} data-align={members.align}>
      {ids.map(id => <div data-layout-slot={id} key={id} className="grid gap-lg">{slotNodes(props, id)}</div>)}
    </div>
  </div>;
}
