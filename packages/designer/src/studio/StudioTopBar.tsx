"use client";

import type { ReactElement, ReactNode } from "react";
import { Tabs } from "../atoms/Tabs.js";
import { TOKENS } from "../tokens/tokens.js";
import { Button } from "../atoms/Button.js";
import type { MatrixSummary } from "./matrix-model.js";
import type { StudioLabels } from "./types.js";

export function StudioTopBar({ labels, pending, canSave, saving, onSave, onDiscard, summary, scoreOpen, onScore, children }: {
  labels: StudioLabels; pending: number; canSave: boolean; saving: boolean; onSave: () => void; onDiscard: () => void;
  summary: MatrixSummary; scoreOpen: boolean; onScore: (target: HTMLElement) => void; children: ReactNode;
}): ReactElement {
  return <Tabs selectedKey="tokens">
    <header className="flex flex-wrap items-center justify-between gap-sm">
      <Tabs.List aria-label={labels.layers.label}>
        <Tabs.Tab id="tokens" onPress={event => onScore(event.target as HTMLElement)} aria-expanded={scoreOpen}>
          {labels.layers.tokens}
          <svg aria-hidden="true" viewBox="0 0 32 32" style={{ inlineSize: TOKENS["--spacing-2xl"]!.value, blockSize: TOKENS["--spacing-2xl"]!.value }}><circle cx="16" cy="16" r="12" fill="none" stroke="currentColor" strokeWidth="3" opacity="0.25" /><circle cx="16" cy="16" r="12" fill="none" stroke="currentColor" strokeWidth="3" pathLength="100" strokeDasharray="100" strokeDashoffset={100 - summary.percent} transform="rotate(-90 16 16)" /></svg>
          <span>{labels.progress(summary.decided, summary.total)}</span>
        </Tabs.Tab>
        {(["assets", "components", "sections", "frames"] as const).map(layer => <Tabs.Tab key={layer} id={layer} isDisabled>
          {labels.layers[layer]} <small>{labels.layers.disabled}</small>
        </Tabs.Tab>)}
      </Tabs.List>
      <div className="flex items-center gap-sm">
        <div aria-live="polite" data-studio-pending="" className="text-body text-ink-secondary">{labels.pending(pending)}</div>
        <Button variant="secondary" size="sm" isDisabled={pending === 0 || saving} onPress={onDiscard}>{labels.discard}</Button>
        {canSave ? <Button size="sm" isDisabled={pending === 0} isPending={saving} onPress={onSave}>{labels.save}</Button> : null}
      </div>
    </header>
    <Tabs.Panel id="tokens">{children}</Tabs.Panel>
    {(["assets", "components", "sections", "frames"] as const).map(layer => <Tabs.Panel key={layer} id={layer}>{labels.layers.disabled}</Tabs.Panel>)}
  </Tabs>;
}
