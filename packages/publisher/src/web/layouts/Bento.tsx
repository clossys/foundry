import { Slot, layoutState, slotNodes } from "./preview/structure.js";
import type { LayoutProps, TileSpan } from "./preview/structure.js";
export interface BentoProps extends LayoutProps { readonly spans?: readonly (TileSpan | undefined)[] }
/** CSS grid's forward row cursor preserves source order without dense placement. */
export function Bento(props: BentoProps) {
  const { contract, members } = layoutState("layouts.bento", props);
  const tiles = props.slots.tiles ?? [];
  if (!Array.isArray(tiles) || props.spans && props.spans.length !== tiles.length) throw new Error("Bento spans must match tile count");
  const allowed = contract.slots.find(slot => slot.id === "tiles")!.tile!.spans;
  const spans = tiles.map((_, index) => props.spans?.[index] ?? (members.rhythm === "feature-first" && index === 0 ? "2x2" : "1x1"));
  if (spans.some(span => !allowed.includes(span))) throw new Error("Unknown tile span");
  return <div data-layout="layouts.bento" data-density={members.density} className="grid">
    <Slot id="lead">{slotNodes(props, "lead")}</Slot>
    <div data-layout-slot="tiles" className="grid">
      {tiles.map((tile, index) => <div key={index} data-span={spans[index]}>{tile}</div>)}
    </div>
  </div>;
}
