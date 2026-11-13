"use client";
import { OpenWithActions, type StudioActionsProps as ContextActionsProps } from "../blocks/library-board/OpenWithActions.js";
import { buildStudioOpenContext } from "./open-context.js";
import { useStudioSession } from "./StudioProvider.js";
import { useWholeStudio } from "./WholeStudioProvider.js";
export type { StudioOpenTarget, StudioLaunchResult, StudioActionNotice } from "../blocks/library-board/OpenWithActions.js";
export interface StudioActionsProps extends Omit<ContextActionsProps, "promptContext"> { promptContext?: ContextActionsProps["promptContext"] }
export function StudioActions(props: StudioActionsProps) {
  const state = useStudioSession(), whole = useWholeStudio();
  const context = props.promptContext ?? buildStudioOpenContext({ projectPath: props.projectPath, taskPrompt: props.taskPrompt, layer: whole?.layer ?? state.layer, selectedId: whole && whole.layer !== "themes" && whole.layer !== "assets" ? whole.leaf : state.catalog.slots.find(slot => slot.id === state.slotId && slot.layer === state.layer)?.id ?? state.catalog.slots.find(slot => slot.layer === state.layer)?.id });
  return <OpenWithActions {...props} promptContext={context} />;
}
