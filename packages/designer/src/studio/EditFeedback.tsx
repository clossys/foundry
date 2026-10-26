"use client";
import { Banner } from "../components/Banner.js";
import { Button } from "../components/Button.js";
import type { LeafEdit } from "./edit-session.js";
import type { StudioLabels, StudioWriteResult } from "./types.js";
export interface EditFeedbackState {
  readonly edits: readonly Pick<LeafEdit<unknown>, "leaf" | "status" | "failure">[];
  readonly historyFailure?: { readonly leaf: string; readonly failure: Exclude<StudioWriteResult<{ message: string }>, { ok: true }> };
  retry(leaf: string, keepMine?: boolean): void;
  takeTheirs(leaf: string): void;
}
/** The failure belongs to a leaf; this never replaces the page or discards its edited value. */
export function EditFeedback({ leaf, state, labels }: { leaf: string; state: EditFeedbackState; labels: StudioLabels }) {
  const edit = state.edits.find(edit => edit.leaf === leaf && (edit.status === "failed" || edit.status === "conflict"));
  const failure = edit?.failure ?? (state.historyFailure?.leaf === leaf ? state.historyFailure.failure : undefined);
  if (!failure) return null;
  return <Banner variant="danger" data-studio-edit-error={leaf}>
    <span>{failure.reason === "conflict" ? labels.autosave.changedElsewhere : labels.saveFailed[failure.reason]}</span>
    {failure.findings?.map((finding, index) => <span key={index}>{finding.message}</span>)}
    {failure.reason === "conflict" ? <><Button size="sm" onPress={() => state.retry(leaf, true)}>{labels.autosave.keepMine}</Button><Button size="sm" onPress={() => state.takeTheirs(leaf)}>{labels.autosave.takeTheirs}</Button></>
      : <Button size="sm" onPress={() => state.retry(leaf)}>{labels.autosave.retry}</Button>}
  </Banner>;
}
