import { FormWizard } from "../../blocks/FormWizard.js";
import type { FormWizardStep } from "../../blocks/FormWizard.js";
import { ProgressBar } from "../../selected-components/ProgressBar.js";
import { actionsOf, isObject, noop, recordsOf, refuseUnmapped, requiredAnatomy, requireSlot, slotValue, stringField, type SectionInputs, type SectionRenderer } from "./group-c-content.js";

const LEAF = "sections.wizard";

/**
 * steps -> FormWizard.steps and currentStep (the step marked current, else the first); progress -> a registered
 * ProgressBar whose label template fills `{position}` and `{total}`; back -> onBack and its label; next -> onNext,
 * its label and its finish label; review -> the last step's review region. The step list label is the header channel's heading.
 */
export const wizardInputs: SectionInputs = { slots: ["steps", "progress", "back", "next", "review"], members: [] };

export const renderWizard: SectionRenderer = input => {
  refuseUnmapped(input, wizardInputs);
  const label = requiredAnatomy(input, LEAF, "heading");
  let current: string | undefined;
  const steps = recordsOf(LEAF, "steps", requireSlot(input, LEAF, "steps")).map((row, index): FormWizardStep => {
    const id = stringField(row, "id"), stepLabel = stringField(row, "label");
    if (!id || !stepLabel) throw new TypeError(`${LEAF}: step ${index} needs an id and a label`);
    if (row.current === true) {
      if (current) throw new TypeError(`${LEAF}: steps ${current} and ${id} are both current`);
      current = id;
    }
    return { id, label: stepLabel, content: stringField(row, "content") ?? null };
  });
  if (!steps.length) throw new TypeError(`${LEAF}: steps needs at least one step`);
  const [next] = actionsOf(LEAF, "next", requireSlot(input, LEAF, "next"), 1);
  const [back] = actionsOf(LEAF, "back", slotValue(input, "back"), 1);
  const nextValue = slotValue(input, "next");
  const finish = isObject(nextValue) ? stringField(nextValue, "finish") : undefined;
  const template = stringField(slotValue(input, "progress"), "label");
  const progressText = (position: number, total: number) => template ? template.replace("{position}", String(position)).replace("{total}", String(total)) : `${position} / ${total}`;
  const currentStep = current ?? steps[0]!.id, position = steps.findIndex(step => step.id === currentStep) + 1;
  const review = slotValue(input, "review");
  return (
    <FormWizard
      steps={steps}
      currentStep={currentStep}
      onNext={noop}
      onBack={back ? noop : undefined}
      progress={template ? <ProgressBar label={progressText(position, steps.length)} value={position} minValue={0} maxValue={steps.length} /> : undefined}
      review={stringField(review, "summary")}
      labels={{ steps: label, back: back?.label ?? "", next: next!.label, finish: finish ?? next!.label, review: stringField(review, "label") ?? "", progress: progressText }}
    />
  );
};
