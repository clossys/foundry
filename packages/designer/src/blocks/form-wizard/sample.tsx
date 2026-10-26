import { TextField } from "../../components/TextField.js";
import type { FormWizardProps } from "../FormWizard.js";

export const formWizardSample: FormWizardProps = {
  steps: [
    { id: "workspace", label: "Workspace", content: <TextField label="Workspace name" defaultValue="Northwind" /> },
    { id: "team", label: "Team", content: <TextField label="Team name" defaultValue="Design" /> },
    { id: "review", label: "Review", content: <p className="m-0 text-body-s text-ink-secondary">Check the details before creating the workspace.</p> },
  ],
  currentStep: "team",
  onNext: () => {},
  onBack: () => {},
  review: <p className="m-0">Northwind, team Design</p>,
  labels: { steps: "Setup steps", back: "Back", next: "Continue", finish: "Finish", review: "Review", progress: (position, total) => `Step ${position} of ${total}` },
};
