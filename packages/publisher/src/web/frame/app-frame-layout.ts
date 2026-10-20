import { TOKENS } from "@clossys/designer/tokens";

/** Shared technical threshold for AppFrame navigation and contextual sheets. */
export const APP_FRAME_WIDE_QUERY = `(min-width: ${TOKENS["--breakpoint-tablet"]!.value})`;

/** Local specimen routing keys, not labels or messages. */
export const APP_FRAME_SPECIMEN_COMMAND_IDS = {
  group: "destinations", overview: "overview", projects: "projects", tasks: "tasks",
} as const;

/** Resolve the one main landmark and its skip destination from the same ID. */
export function appFrameMainId(authored: string | undefined, generated: string): string {
  return authored ?? generated + "-main";
}
