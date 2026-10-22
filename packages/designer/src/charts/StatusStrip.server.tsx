import { StatusView } from "./internal/signature-views.js";
import type { StatusStripProps } from "./internal/signature-types.js";

/** Static server rendering of status intervals, patterns and the native table. */
export function StatusStrip(props: StatusStripProps) {
  return <StatusView props={props} />;
}
