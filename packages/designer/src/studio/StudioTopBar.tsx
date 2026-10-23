"use client";

import type { ReactElement } from "react";
import { Button } from "../atoms/Button.js";
import type { StudioLabels } from "./types.js";

export function StudioTopBar({ labels, pending, canSave, saving, onSave, onDiscard }: {
  labels: StudioLabels; pending: number; canSave: boolean; saving: boolean; onSave: () => void; onDiscard: () => void;
}): ReactElement {
  return (
    <div className="flex flex-wrap items-center justify-between gap-sm">
      <div aria-live="polite" data-studio-pending="" className="text-body text-ink-secondary">{labels.pending(pending)}</div>
      <div className="flex items-center gap-sm">
        <Button variant="secondary" size="sm" isDisabled={pending === 0 || saving} onPress={onDiscard}>{labels.discard}</Button>
        {canSave ? <Button size="sm" isDisabled={pending === 0} isPending={saving} onPress={onSave}>{labels.save}</Button> : null}
      </div>
    </div>
  );
}
