import type { ReactElement } from "react";
import type { Mode, Resolved } from "../catalog-core/types.js";
import { Card, CardContent } from "../components/preview-runtime/components/card/card.js";
import { SemanticContent } from "../components/SemanticContent.js";
import { BACKDROP_GRAPHIC_PATTERNS, BACKDROP_GRAPHIC_SLOT, backdropGraphicFromResolved, type BackdropGraphicPattern } from "../catalog-assets/backdrop-graphic.js";

export interface BackdropGraphicSpecimenLabels {
  readonly title: string;
  readonly patterns: Readonly<Record<BackdropGraphicPattern, string>>;
  readonly modes: Readonly<Record<Mode, string>>;
}
/** Leaf chrome from Designer; all copy is required from the Writer/host and all paint from resolved consumer tokens. */
export function A276BackdropGraphicSpecimen({ resolved, labels }: { resolved: Resolved; labels: BackdropGraphicSpecimenLabels }): ReactElement {
  return <div data-layer="assets" data-asset-specimen="backdrop-graphic" data-asset-slot={BACKDROP_GRAPHIC_SLOT} className="flex max-w-full flex-col gap-sm">
    <SemanticContent as="span" className="text-caption text-ink-secondary">{labels.title}</SemanticContent>
    <div className="grid grid-cols-2 gap-sm">
      {BACKDROP_GRAPHIC_PATTERNS.flatMap(pattern => (["light", "dark"] as const).map(mode => <Card key={`${pattern}-${mode}`}><CardContent className="flex flex-col gap-xs p-sm">
        <span aria-hidden="true" data-backdrop-pattern={pattern} data-specimen-theme={mode} className="block h-3xl w-full overflow-hidden rounded-control" style={backdropGraphicFromResolved(pattern, resolved, mode).style} />
        <SemanticContent as="span" className="text-caption text-ink-secondary">{labels.patterns[pattern]} · {labels.modes[mode]}</SemanticContent>
      </CardContent></Card>))}
    </div>
  </div>;
}
/** Dispatcher contribution: match this native slot and pass the selected consumer profile plus Writer labels. */
export const a276BackdropGraphicSpecimenContribution = { slot: BACKDROP_GRAPHIC_SLOT, render: A276BackdropGraphicSpecimen } as const;
