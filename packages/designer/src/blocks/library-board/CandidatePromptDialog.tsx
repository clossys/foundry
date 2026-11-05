"use client";
import { useState, type ReactNode } from "react";

import { OpenWithActions } from "./OpenWithActions.js";
import { candidatePrompt, type CandidatePromptData } from "./candidate-prompt.js";
import type { LayerId } from "../../catalog-core/index.js";
import type { CandidateWorkflow, LibraryBoardLabels, PendingCandidate } from "./types.js";
import { componentLeaf } from "../../runtime/component-leaf.js";

const Button = componentLeaf<typeof import("../../components/Button.js").Button>("components.button");
const Dialog = componentLeaf<typeof import("../../components/preview-runtime/components/dialog/dialog.js").Dialog>("components.dialog");
const DialogTrigger = componentLeaf<typeof import("../../components/preview-runtime/components/dialog/dialog.js").DialogTrigger>("components.dialog", "DialogTrigger");
const DialogHeader = componentLeaf<typeof import("../../components/preview-runtime/components/dialog/dialog.js").DialogHeader>("components.dialog", "DialogHeader");
const DialogTitle = componentLeaf<typeof import("../../components/preview-runtime/components/dialog/dialog.js").DialogTitle>("components.dialog", "DialogTitle");
const DialogDescription = componentLeaf<typeof import("../../components/preview-runtime/components/dialog/dialog.js").DialogDescription>("components.dialog", "DialogDescription");
const SemanticContent = componentLeaf<typeof import("../../components/SemanticContent.js").SemanticContent>("components.semantic-content");

/** The prompt is data to copy, within the selected dialog's scrolling region. */
const PROMPT_CODE = "block min-h-0 shrink overflow-auto whitespace-pre-wrap break-words rounded-control border border-overlay-border bg-surface-sunken p-md font-mono text-code-block text-ink-primary";
/** The actions stay reachable while the dialog scrolls: a footer pinned to the dialog's bottom edge, across its padding. */
const PROMPT_ACTIONS = "sticky bottom-0 prompt-actions-bleed flex flex-wrap items-center justify-end gap-sm border-t border-overlay-border bg-overlay-surface px-lg pt-md pb-lg";

/** Prompt section: native Dialog, read-only code, copy/open actions and an explicit host check seam. */
export function CandidatePromptDialog({ trigger, data, labels, workflow }: { trigger: ReactNode; data: CandidatePromptData; labels: LibraryBoardLabels; workflow?: CandidateWorkflow }) {
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<readonly PendingCandidate[]>([]);
  const [checking, setChecking] = useState(false);
  const prompt = candidatePrompt(labels.board.promptInstruction, data);
  const copy = async () => {
    try { await navigator.clipboard.writeText(prompt); setNotice(labels.board.copied); }
    catch { setNotice(labels.board.copyFailed); }
  };
  const check = async () => {
    setNotice(""); setPending([]);
    if (!workflow?.checkCandidates) { setNotice(labels.board.candidatesUnavailable); return; }
    setChecking(true);
    try { const result = await workflow.checkCandidates(data.slot.id);
      if (result.status === "checked") { const candidates = result.candidates.filter(candidate => candidate.slot === data.slot.id); setPending(candidates); setNotice(candidates.length ? labels.board.pendingSelection : labels.board.noNewCandidates); }
      else setNotice(result.status === "unavailable" ? labels.board.candidatesUnavailable : labels.board.candidatesFailed);
    } catch { setNotice(labels.board.candidatesFailed); }
    finally { setChecking(false); }
  };
  return <DialogTrigger>{trigger}<Dialog className="max-w-full">{({ close }) => <>
    <DialogHeader><DialogTitle>{labels.board.promptTitle}</DialogTitle>
    <DialogDescription data-prompt-summary="" className="text-body-s text-ink-secondary">{data.board.label} · {data.slot.label} <SemanticContent as="span" className="font-mono">{data.slot.id}</SemanticContent></DialogDescription></DialogHeader>
    <SemanticContent as="code" data-prompt-code="" tabIndex={0} className={PROMPT_CODE}>{prompt}</SemanticContent>
    {notice ? <SemanticContent as="p" role="status">{notice}</SemanticContent> : null}
    {pending.length ? <SemanticContent as="ul">{pending.map(candidate => <SemanticContent as="li" key={candidate.id} data-pending-candidate={candidate.id}>{candidate.label} · {labels.board.pendingSelection}</SemanticContent>)}</SemanticContent> : null}
    <SemanticContent as="div" data-dialog-actions="" className={PROMPT_ACTIONS}>
      <Button variant="ghost" onPress={close}>{labels.board.close}</Button>
      <Button variant="secondary" isDisabled={checking} onPress={() => { void check(); }}>{checking ? labels.board.checking : labels.board.checkCandidates}</Button>
      {workflow?.actions ? <OpenWithActions {...workflow.actions} taskPrompt={prompt} promptContext={{ projectPath: workflow.actions.projectPath, taskPrompt: prompt, prompt, layer: data.slot.id.split(".")[0] as LayerId, selectedId: data.slot.id }} /> : null}
      <Button onPress={() => { void copy(); }}>{labels.board.copy}</Button>
    </SemanticContent>
  </>}</Dialog></DialogTrigger>;
}
