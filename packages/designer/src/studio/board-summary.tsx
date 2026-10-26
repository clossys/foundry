import type { ReactElement } from "react";

/** One plain "n of m chosen" line; the host label owns the words, figures stay tabular. */
export function BoardChosenSummary({ chosen, total, label, className }: { chosen: number; total: number; label: (chosen: number, total: number) => string; className?: string }): ReactElement {
  return <p data-studio-chosen-summary="" className={["break-words tabular-nums", className].filter(Boolean).join(" ")}>{label(chosen, total)}</p>;
}

/** A leaf row label: the host's human name, then the leaf id in the mono face; the id alone when the host has no name. */
export function LeafLabel({ id, name }: { id: string; name?: string }): ReactElement {
  const human = name?.trim() ? name : undefined;
  return <span data-studio-leaf-label="" className="flex min-w-0 flex-col">
    {human ? <span className="break-words text-ink-primary">{human}</span> : null}
    <span data-studio-leaf-id="" className={human ? "break-words font-mono tabular-nums text-caption text-ink-secondary" : "break-words font-mono tabular-nums text-ink-primary"}>{id}</span>
  </span>;
}
