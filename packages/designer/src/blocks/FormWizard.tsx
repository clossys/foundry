import type { ReactNode } from "react";
import { Button } from "../components/Button.js";
import { ProgressBar } from "../components/ProgressBar.js";
import { cx } from "../components/internal/cx.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
/** Section root provenance (D1): the selected Foundry fill this block is. */
const SECTION_STAMP = dsAttrs("sections", "sections.wizard", "foundry/sections.wizard");

export interface FormWizardStep {
  readonly id: string;
  readonly label: string;
  /** The step's own fields; values and validation stay host-owned. */
  readonly content: ReactNode;
}
export interface FormWizardLabels {
  steps: string;
  back: string;
  next: string;
  finish: string;
  review: string;
  progress: (position: number, total: number) => string;
}
export interface FormWizardProps {
  steps: readonly FormWizardStep[];
  /** Controlled current step id. */
  currentStep: string;
  onNext: () => void;
  onBack?: () => void;
  /** Replaces the default progress bar. */
  progress?: ReactNode;
  /** Summary shown on the last step, above the finish action. */
  review?: ReactNode;
  isNextDisabled?: boolean;
  labels: FormWizardLabels;
  className?: string;
}

/** A multi-step form: ordered steps, the current step's fields, progress and back/next actions. */
export function FormWizard({ steps, currentStep, onNext, onBack, progress, review, isNextDisabled, labels, className }: FormWizardProps) {
  const index = steps.findIndex(step => step.id === currentStep);
  if (index < 0) throw new TypeError(`FormWizard: unknown step ${currentStep}.`);
  const position = index + 1, last = position === steps.length;
  return <div {...SECTION_STAMP} className={cx("flex min-w-0 flex-col gap-lg text-body text-ink-primary", className)}>
    <ol aria-label={labels.steps} className="m-0 flex list-none flex-wrap gap-md p-0">
      {steps.map((step, stepIndex) => <li key={step.id} aria-current={stepIndex === index ? "step" : undefined}
        className={cx("inline-flex items-center gap-xs text-body-s", stepIndex === index ? "font-medium text-ink-primary" : "text-ink-secondary")}>
        <span aria-hidden="true" className="tabular-nums">{stepIndex + 1}.</span>{step.label}
      </li>)}
    </ol>
    {progress ?? <ProgressBar label={labels.progress(position, steps.length)} value={position} minValue={0} maxValue={steps.length} valueLabel={labels.progress(position, steps.length)} />}
    <div className="flex min-w-0 flex-col gap-md">{steps[index]!.content}</div>
    {last && review ? <div role="region" aria-label={labels.review} className="rounded-surface border border-line-base bg-surface-raised p-md">{review}</div> : null}
    <div className="flex flex-wrap items-center justify-between gap-sm border-t border-line-base pt-md">
      {index > 0 && onBack ? <Button variant="secondary" onPress={onBack}>{labels.back}</Button> : <span aria-hidden="true" />}
      <Button variant="primary" isDisabled={isNextDisabled} onPress={onNext}>{last ? labels.finish : labels.next}</Button>
    </div>
  </div>;
}
