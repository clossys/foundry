"use client";
import { useState, type ReactNode } from "react";
import { Button } from "../../components/Button.js";
import { Dialog } from "../../components/Dialog.js";
import { OpenWithActions } from "./OpenWithActions.js";
import { candidatePrompt, type CandidatePromptData } from "./candidate-prompt.js";
import type { LayerId } from "../../catalog-core/index.js";
import type { CandidateWorkflow, LibraryBoardLabels, PendingCandidate } from "./types.js";

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
  return <Dialog trigger={trigger} size="lg">{({ close }) => <>
    <Dialog.Heading>{labels.board.promptTitle}</Dialog.Heading>
    <pre className="whitespace-pre-wrap break-words text-body-s"><code>{prompt}</code></pre>
    <div className="flex flex-wrap items-center gap-sm">
      <Button onPress={() => { void copy(); }}>{labels.board.copy}</Button>
      {workflow?.actions ? <OpenWithActions {...workflow.actions} taskPrompt={prompt} promptContext={{ projectPath: workflow.actions.projectPath, taskPrompt: prompt, prompt, layer: data.slot.id.split(".")[0] as LayerId, selectedId: data.slot.id }} /> : null}
      <Button isDisabled={checking} onPress={() => { void check(); }}>{checking ? labels.board.checking : labels.board.checkCandidates}</Button>
      <Button onPress={close}>{labels.board.close}</Button>
    </div>
    {notice ? <p role="status">{notice}</p> : null}
    {pending.length ? <ul>{pending.map(candidate => <li key={candidate.id} data-pending-candidate={candidate.id}>{candidate.label} · {labels.board.pendingSelection}</li>)}</ul> : null}
  </>}</Dialog>;
}
