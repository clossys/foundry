"use client";
import { Badge } from "../components/Badge.js";
import { Button } from "../components/Button.js";
import type { StudioValueEditPort } from "./StudioProvider.js";
import type { EditFeedbackState } from "./EditFeedback.js";
import type { StudioLabels } from "./types.js";
type StatusState = Pick<StudioValueEditPort, "status" | "canUndo" | "canRedo" | "undo" | "redo"> & EditFeedbackState;
export function StudioStatus({ state, labels }: { state?: StatusState; labels: StudioLabels }) {
  const failedLeaf = state?.edits.find(edit => edit.status === "failed" || edit.status === "conflict")?.leaf ?? state?.historyFailure?.leaf;
  return <div className="flex flex-wrap items-center gap-sm">
    <Button variant="secondary" size="sm" isDisabled={!state?.canUndo} onPress={() => state?.undo()}>{labels.autosave.undo}</Button>
    <Button variant="secondary" size="sm" isDisabled={!state?.canRedo} onPress={() => state?.redo()}>{labels.autosave.redo}</Button>
    <div aria-live="polite" aria-atomic="true" data-studio-save-status={state?.status ?? "saved"}><Badge>{state?.status === "saving" ? labels.autosave.saving : state?.status === "not-saved" ? labels.autosave.notSaved : labels.autosave.saved}</Badge></div>
    {state?.status === "not-saved" && failedLeaf ? <Button variant="ghost" size="sm" onPress={() => state.retry(failedLeaf)}>{labels.autosave.retry}</Button> : null}
  </div>;
}
