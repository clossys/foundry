/**
 * frames.inspector runtime renderer: the real InspectorFrame from JSON `content` (labels,
 * width bounds, optional body text) and the selected presentation member. The panel body is the
 * host's `content` panel when supplied; otherwise the JSON body text.
 */
import type { ReactNode } from "react";
import type { RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";
import { InspectorFrame, type InspectorFrameProps } from "../../frames/InspectorFrame.js";
import { runtimeMember, runtimeValue, type SurfaceRendererEntry } from "../contract.js";
import { frameContent, type FrameInput, type FrameJson } from "./frame-content.js";

import { componentLeaf } from "../../runtime/component-leaf.js";

const SemanticContent = componentLeaf<typeof import("../../components/SemanticContent.js").SemanticContent>("components.semantic-content");

const read = frameContent("frames.inspector");

export function inspectorProps(input: Pick<FrameInput, "content" | "selection" | "host">): InspectorFrameProps {
  read.only(input, ["content"]);
  const content = read.record(runtimeValue(input, "content")) ?? read.fail("content is required");
  const body = input.host?.panels?.content ?? <SemanticContent as="p">{read.text(content.body) ?? read.fail("content.body or the host content panel is required")}</SemanticContent>;
  const presentation = runtimeMember<"docked" | "collapsed" | "overlay">(input, "presentation", "docked");
  return {
    label: read.required(content.label, "content.label"), handleLabel: read.required(content.handleLabel, "content.handleLabel"),
    openLabel: read.required(content.openLabel, "content.openLabel"), closeLabel: read.required(content.closeLabel, "content.closeLabel"),
    min: read.number(content.min, "content.min"), max: read.number(content.max, "content.max"), defaultValue: read.number(content.defaultValue, "content.defaultValue"),
    ...(content.step === undefined ? {} : { step: read.number(content.step, "content.step") }),
    presentation: presentation === "overlay" ? "overlay" : "docked",
    ...(presentation === "collapsed" ? { defaultCollapsed: true } : {}),
    children: body,
  };
}

export function renderInspector(input: RuntimeRenderInput<ReactNode>): ReactNode {
  return <InspectorFrame {...inspectorProps(input)} />;
}

function sample(dataset: Parameters<SurfaceRendererEntry["sample"]>[0]): FrameJson {
  return { content: dataset.frames.inspector };
}

export const inspectorRenderer: SurfaceRendererEntry = { leaf: "frames.inspector", render: renderInspector, sample };
