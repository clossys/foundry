import type { ReactElement } from "react";

/** One plain "n of m chosen" line; the host label owns the words, figures stay tabular. */
export function BoardChosenSummary({ chosen, total, label, className }: { chosen: number; total: number; label: (chosen: number, total: number) => string; className?: string }): ReactElement {
  return <p data-studio-chosen-summary="" className={["break-words tabular-nums", className].filter(Boolean).join(" ")}>{label(chosen, total)}</p>;
}

/**
 * The label of an overview-tier action. Overview and compact layers take the full layer's width
 * (CanvasLodLayers), so a long "Open <board>" label wraps onto more lines inside the board instead
 * of Button's default one-line ellipsis; the control's min-height grows with it.
 */
export function WrappingLabel({ children }: { children: string }): ReactElement {
  return <span data-studio-wrapping-label="" className="min-w-0 whitespace-normal break-words">{children}</span>;
}

/** A leaf row label: the host's human name, then the leaf id in the mono face; the id alone when the host has no name. */
export function LeafLabel({ id, name }: { id: string; name?: string }): ReactElement {
  const human = name?.trim() ? name : undefined;
  return <span data-studio-leaf-label="" className="flex min-w-0 flex-col">
    {human ? <span className="break-words text-ink-primary">{human}</span> : null}
    <span data-studio-leaf-id="" className={human ? "break-words font-mono tabular-nums text-caption text-ink-secondary" : "break-words font-mono tabular-nums text-ink-primary"}>{id}</span>
  </span>;
}

/** Default words for the runtime-pending count; hosts override with StudioLabels.runtimePending. */
export const defaultRuntimePendingLabel = (count: number): string => `${count} runtime pending`;

/**
 * Quiet neutral count of statically eligible fills still awaiting runtime qualification: never the
 * error tone, never a pass. Nothing renders at zero; pending findings stay listed wherever findings are.
 */
export function RuntimePendingLine({ count, label = defaultRuntimePendingLabel, className }: { count: number; label?: (count: number) => string; className?: string }): ReactElement | null {
  return count > 0 ? <p data-studio-runtime-pending="" className={["break-words tabular-nums text-ink-secondary", className].filter(Boolean).join(" ")}>{label(count)}</p> : null;
}

/**
 * A compact board row in plain text: the host's human name (when known) as primary text, then the
 * leaf id and its chosen library id in the mono face as secondary text, or the not-chosen words.
 * Size is inherited so the line stays legible at the compact zoom.
 */
export function CompactLeafLine({ id, name, source, notChosen }: { id: string; name?: string; source?: string; notChosen: string }): ReactElement {
  const human = name?.trim() ? name : undefined;
  return <p data-studio-compact-leaf="" className="flex min-w-0 flex-col break-words">
    {human ? <span className="break-words text-ink-primary">{human}</span> : null}
    <span className="flex min-w-0 flex-wrap gap-x-sm">
      <span data-studio-leaf-id="" className={["break-words font-mono tabular-nums", human ? "text-ink-secondary" : "text-ink-primary"].join(" ")}>{id}</span>
      {source ? <span data-studio-compact-source="" className="break-words font-mono tabular-nums text-ink-secondary">{source}</span> : <span data-studio-compact-source="" className="break-words text-ink-muted">{notChosen}</span>}
    </span>
  </p>;
}
