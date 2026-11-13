import type { LayerId } from "../../catalog-core/index.js";

export interface StudioOpenContextInput {
  projectPath: string;
  layer: LayerId;
  selectedId?: string;
  taskPrompt: string;
}
export interface StudioOpenContext extends StudioOpenContextInput { prompt: string }
/** Caller-supplied context only. No environment, storage, filesystem or network access. */
export function buildStudioOpenContext(input: StudioOpenContextInput): StudioOpenContext {
  return { ...input, prompt: [input.taskPrompt, `Project: ${input.projectPath}`, `Layer: ${input.layer}`, ...(input.selectedId ? [`Selected item: ${input.selectedId}`] : [])].join("\n") };
}
