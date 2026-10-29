/**
 * frames.sheet runtime renderer: the real Drawer edge sheet from JSON `heading` (text,
 * close and trigger labels), `body` and `footer` content and the selected placement/wide
 * members. It opens from its own trigger; the host's `body`/`footer` panels replace the JSON text.
 */
import type { ReactNode } from "react";
import { Drawer, type DrawerProps } from "../../blocks/Drawer.js";
import { Button } from "../../selected-components/Button.js";
import type { RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";
import { runtimeValue, type SurfaceRendererEntry } from "../contract.js";
import { frameContent, type FrameInput, type FrameJson } from "./frame-content.js";

const read = frameContent("frames.sheet");
const PLACEMENTS = ["start", "end", "bottom"] as const, WIDE = ["dismiss", "sheet"] as const;

export function sheetProps(input: Pick<FrameInput, "content" | "selection" | "host">): DrawerProps {
  read.only(input, ["heading", "body", "footer"]);
  const panels = input.host?.panels, heading = read.record(runtimeValue(input, "heading")) ?? read.fail("heading content is required");
  const body = panels?.body ?? read.text(runtimeValue(input, "body")) ?? read.fail("body content is required");
  const footer = panels?.footer ?? read.text(runtimeValue(input, "footer"));
  const placement = PLACEMENTS.find(value => input.selection.members.includes(`placement.${value}`));
  const wide = WIDE.find(value => input.selection.members.includes(`wide.${value}`));
  return {
    heading: read.required(heading.text, "heading.text"), closeLabel: read.required(heading.closeLabel, "heading.closeLabel"),
    trigger: <Button variant="secondary">{read.required(heading.triggerLabel, "heading.triggerLabel")}</Button>,
    children: body, ...(footer !== undefined ? { footer } : {}),
    ...(placement ? { placement } : {}), ...(wide ? { wide } : {}),
  };
}

export function renderSheet(input: RuntimeRenderInput<ReactNode>): ReactNode {
  return <Drawer {...sheetProps(input)} />;
}

function sample(dataset: Parameters<SurfaceRendererEntry["sample"]>[0]): FrameJson {
  const sheet = dataset.frames.sheet;
  return { heading: { text: sheet.heading, closeLabel: sheet.closeLabel, triggerLabel: sheet.trigger }, body: sheet.body };
}

export const sheetRenderer: SurfaceRendererEntry = { leaf: "frames.sheet", render: renderSheet, sample };
