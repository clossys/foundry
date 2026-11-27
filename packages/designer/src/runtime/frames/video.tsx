/**
 * frames.video runtime renderer: the real VideoFrame from JSON `stage` (the ordered scene texts,
 * one shown at a time) and `controls` (the Writer labels and the per-scene duration). The host's
 * `stage` panel replaces the JSON scenes with one scene section; the frame always starts paused.
 */
import type { ReactNode } from "react";
import type { RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";
import { VideoFrame, type VideoFrameProps } from "../../frames/VideoFrame.js";
import { runtimeValue, type SurfaceRendererEntry } from "../contract.js";
import { frameContent, type FrameInput, type FrameJson } from "./frame-content.js";

import { componentLeaf } from "../../runtime/component-leaf.js";

const SemanticContent = componentLeaf<typeof import("../../components/SemanticContent.js").SemanticContent>("components.semantic-content");

const read = frameContent("frames.video");

export function videoProps(input: Pick<FrameInput, "content" | "selection" | "host">): VideoFrameProps {
  read.only(input, ["stage", "controls"]);
  const controls = read.record(runtimeValue(input, "controls")) ?? read.fail("controls content is required");
  const stage = runtimeValue(input, "stage"), panel = input.host?.panels?.stage;
  const texts = Array.isArray(stage) ? stage.map((scene, index) => read.required(scene, `stage[${index}]`)) : [];
  const scenes = panel !== undefined ? [panel] : texts.length ? texts.map((text, index) => <SemanticContent as="section" key={index}><SemanticContent as="p">{text}</SemanticContent></SemanticContent>) : read.fail("stage scenes or the host stage panel are required");
  return {
    scenes,
    labels: { controls: read.required(controls.label, "controls.label"), play: read.required(controls.play, "controls.play"), pause: read.required(controls.pause, "controls.pause"), scrubber: read.required(controls.scrubber, "controls.scrubber") },
    sceneDuration: read.number(controls.sceneDuration, "controls.sceneDuration"),
  };
}

export function renderVideo(input: RuntimeRenderInput<ReactNode>): ReactNode {
  return <VideoFrame {...videoProps(input)} />;
}

function sample(dataset: Parameters<SurfaceRendererEntry["sample"]>[0]): FrameJson {
  const video = dataset.frames.video;
  return { stage: video.scenes, controls: { label: video.label, play: video.play, pause: video.pause, scrubber: video.scrubber, sceneDuration: video.sceneDuration } };
}

export const videoRenderer: SurfaceRendererEntry = { leaf: "frames.video", render: renderVideo, sample };
