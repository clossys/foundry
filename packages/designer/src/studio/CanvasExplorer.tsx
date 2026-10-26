"use client";
import type { ReactNode } from "react";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { Menu } from "../components/Menu.js";
import { SearchField } from "../components/SearchField.js";
import { Tooltip } from "../components/Tooltip.js";
import type { CanvasFilter } from "./canvas-model.js";
import type { StudioLabels } from "./types.js";
const FILTERS: readonly CanvasFilter[] = ["all", "pending", "warnings", "differs"];
/** Explorer section assembles search, filter Menu, native Tree, and library evidence. */
export function CanvasExplorer({ labels, query, onQuery, filter, onFilter, libraries, children }: {
  labels: StudioLabels; query: string; onQuery(value: string): void; filter: CanvasFilter; onFilter(value: CanvasFilter): void;
  libraries: readonly { id: string; available: boolean }[]; children: ReactNode;
}) {
  return <Card variant="plate" data-studio-panel="explorer" className="grid grid-cols-2 items-start gap-md p-md">
    <section className="min-w-0"><SearchField label={<span className="sr-only">{labels.canvas.search}</span>} placeholder={labels.canvas.search} value={query} onChange={onQuery} />
      <Menu trigger={<Button variant="ghost" size="sm">{labels.canvas.filters[filter]}</Button>}>
        {FILTERS.map(key => <Menu.Item key={key} id={key} onAction={() => onFilter(key)}>{labels.canvas.filters[key]}</Menu.Item>)}
      </Menu>
      {children}
    </section>
    <section aria-label={labels.matrix.libraries} className="flex min-w-0 flex-col items-start gap-xs">
      {libraries.map(library => library.available ? <span key={library.id} className="text-body-s">{library.id}</span> : <Tooltip key={library.id} trigger={<Button variant="ghost" size="sm">{library.id}</Button>}>{labels.canvas.noCandidatesInBoard}</Tooltip>)}
    </section>
  </Card>;
}
