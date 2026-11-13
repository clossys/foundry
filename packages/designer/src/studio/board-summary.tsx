import type { ReactElement } from "react";

/** Default words for the runtime-pending count; hosts override with StudioLabels.runtimePending. */
export const defaultRuntimePendingLabel = (count: number): string => `${count} runtime pending`;

/**
 * Quiet neutral count of statically eligible fills still awaiting runtime qualification: never the
 * error tone, never a pass. Nothing renders at zero; pending findings stay listed wherever findings are.
 */
export function RuntimePendingLine({ count, label = defaultRuntimePendingLabel, className }: { count: number; label?: (count: number) => string; className?: string }): ReactElement | null {
  return count > 0 ? <p data-studio-runtime-pending="" className={["break-words tabular-nums text-ink-secondary", className].filter(Boolean).join(" ")}>{label(count)}</p> : null;
}
