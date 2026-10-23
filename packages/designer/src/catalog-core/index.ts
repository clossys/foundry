import slots from "../catalog/slots/tokens.json" with { type: "json" };
import standard0 from "../catalog/standards/apg.json" with { type: "json" };
import standard1 from "../catalog/standards/dtcg.json" with { type: "json" };
import standard2 from "../catalog/standards/tailwind-v4-theme.json" with { type: "json" };
import standard3 from "../catalog/standards/wcag-2.2.json" with { type: "json" };
import standard4 from "../catalog/standards/web-app-manifest.json" with { type: "json" };
import foundrySource from "../catalog/sources/foundry.json" with { type: "json" };
import fill0 from "../catalog/fills/foundry/tokens.role.color.action.json" with { type: "json" };
import fill1 from "../catalog/fills/foundry/tokens.role.color.border.json" with { type: "json" };
import fill2 from "../catalog/fills/foundry/tokens.role.color.focus.json" with { type: "json" };
import fill3 from "../catalog/fills/foundry/tokens.role.color.scrim.json" with { type: "json" };
import fill4 from "../catalog/fills/foundry/tokens.role.color.status.json" with { type: "json" };
import fill5 from "../catalog/fills/foundry/tokens.role.color.surface.json" with { type: "json" };
import fill6 from "../catalog/fills/foundry/tokens.role.color.text.json" with { type: "json" };
import fill7 from "../catalog/fills/foundry/tokens.role.depth.elevation.json" with { type: "json" };
import fill8 from "../catalog/fills/foundry/tokens.role.interaction.control-size.json" with { type: "json" };
import fill9 from "../catalog/fills/foundry/tokens.role.interaction.density.json" with { type: "json" };
import fill10 from "../catalog/fills/foundry/tokens.role.interaction.state.json" with { type: "json" };
import fill11 from "../catalog/fills/foundry/tokens.role.interaction.touch-target.json" with { type: "json" };
import fill12 from "../catalog/fills/foundry/tokens.role.motion.transition.json" with { type: "json" };
import fill13 from "../catalog/fills/foundry/tokens.role.shape.control.json" with { type: "json" };
import fill14 from "../catalog/fills/foundry/tokens.role.shape.media.json" with { type: "json" };
import fill15 from "../catalog/fills/foundry/tokens.role.shape.surface.json" with { type: "json" };
import fill16 from "../catalog/fills/foundry/tokens.role.space.gutter.json" with { type: "json" };
import fill17 from "../catalog/fills/foundry/tokens.role.type.body.json" with { type: "json" };
import fill18 from "../catalog/fills/foundry/tokens.role.type.caption.json" with { type: "json" };
import fill19 from "../catalog/fills/foundry/tokens.role.type.code.json" with { type: "json" };
import fill20 from "../catalog/fills/foundry/tokens.role.type.display.json" with { type: "json" };
import fill21 from "../catalog/fills/foundry/tokens.role.type.heading.json" with { type: "json" };
import fill22 from "../catalog/fills/foundry/tokens.scale.color.fixed.json" with { type: "json" };
import fill23 from "../catalog/fills/foundry/tokens.scale.color.ramp.json" with { type: "json" };
import fill24 from "../catalog/fills/foundry/tokens.scale.depth.blur.json" with { type: "json" };
import fill25 from "../catalog/fills/foundry/tokens.scale.depth.layer-order.json" with { type: "json" };
import fill26 from "../catalog/fills/foundry/tokens.scale.motion.delay.json" with { type: "json" };
import fill27 from "../catalog/fills/foundry/tokens.scale.motion.duration.json" with { type: "json" };
import fill28 from "../catalog/fills/foundry/tokens.scale.motion.easing.json" with { type: "json" };
import fill29 from "../catalog/fills/foundry/tokens.scale.motion.spring.json" with { type: "json" };
import fill30 from "../catalog/fills/foundry/tokens.scale.shape.border-width.json" with { type: "json" };
import fill31 from "../catalog/fills/foundry/tokens.scale.shape.radius.json" with { type: "json" };
import fill32 from "../catalog/fills/foundry/tokens.scale.shape.ring-width.json" with { type: "json" };
import fill33 from "../catalog/fills/foundry/tokens.scale.space.breakpoint.json" with { type: "json" };
import fill34 from "../catalog/fills/foundry/tokens.scale.space.container.json" with { type: "json" };
import fill35 from "../catalog/fills/foundry/tokens.scale.space.step.json" with { type: "json" };
import fill36 from "../catalog/fills/foundry/tokens.scale.type.family.json" with { type: "json" };
import fill37 from "../catalog/fills/foundry/tokens.scale.type.leading.json" with { type: "json" };
import fill38 from "../catalog/fills/foundry/tokens.scale.type.tracking.json" with { type: "json" };
import { parseFill } from "./cell.js";
import type { CatalogData, FillDoc, Slot, Source, Standard } from "./types.js";

export * from "./types.js";
export * from "./api.js";
export * from "./ids.js";
export * from "./cell.js";
export * from "./stable.js";

export function loadCatalog(): CatalogData {
  const fills = [
    fill0, fill1, fill2, fill3, fill4, fill5, fill6, fill7,
    fill8, fill9, fill10, fill11, fill12, fill13, fill14, fill15,
    fill16, fill17, fill18, fill19, fill20, fill21, fill22, fill23,
    fill24, fill25, fill26, fill27, fill28, fill29, fill30, fill31,
    fill32, fill33, fill34, fill35, fill36, fill37, fill38,
  ].map(value => {
    const parsed = parseFill(value);
    const error = parsed.findings.find(finding => finding.severity === "error");
    if (error) throw new Error("catalog: " + error.message);
    return parsed.fill as FillDoc;
  });
  fills.sort((a, b) => {
    const left = a.$extensions["com.clossys.fill"].id;
    const right = b.$extensions["com.clossys.fill"].id;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  return {
    slots: slots as unknown as readonly Slot[],
    standards: [standard0, standard1, standard2, standard3, standard4] as unknown as readonly Standard[],
    sources: [foundrySource] as unknown as readonly Source[],
    fills,
  };
}
