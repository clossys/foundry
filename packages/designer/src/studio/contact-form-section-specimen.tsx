import type { ReactNode } from "react";
import type { RuntimeJson, RuntimeRenderInput } from "../catalog-core/runtime-ports.js";
import { renderForm } from "../runtime/sections/form.js";

/** Synthetic copy only; the host supplies checked RuntimeContent and its live submit port. */
export const contactFormSpecimenContent = {
  header: { heading: "Contact form" },
  fields: [
    { id: "contact-email", kind: "email", label: "Email field", placeholder: "Email placeholder" },
    { id: "contact-message", kind: "textarea", label: "Message field", placeholder: "Message placeholder" },
  ],
  submit: { label: "Submit action" },
  success: { message: "Success message" },
  error: { message: "Error message" },
} satisfies Readonly<Record<string, RuntimeJson>>;

export const contactFormSpecimenIdentity = {
  sourceLeaf: "sections.form",
  member: "form.contact",
  specimenLeaf: "sections.specimen-section-viewports",
} as const;

/** Descriptor-bound surface port for the registered Studio section viewport specimen. */
export function bindContactFormSpecimen(input: RuntimeRenderInput<ReactNode>) {
  const selected = input.profile.surfaces?.fills["sections.form"];
  const descriptorHash = input.fill.surface?.descriptorHash;
  if (input.fill.leaf !== "sections.form" || input.selection.leaf !== "sections.form" || !input.selection.members.includes("form.contact") ||
      !selected || !descriptorHash || descriptorHash !== selected.descriptorHash) {
    throw new Error("NEED sections.form: matching selected contact surface descriptor");
  }
  if (typeof input.sectionHost?.onSubmit !== "function") {
    throw new Error("NEED sections.form: consumer sectionHost.onSubmit");
  }
  return {
    descriptorHash,
    states: ["default"] as const,
    render: ({ width, state }: { readonly width: number; readonly state: string }): ReactNode => {
      if (!Number.isFinite(width) || width < 1 || state !== "default") {
        throw new Error("NEED sections.form: registered default viewport case");
      }
      return renderForm({ ...input, cell: { ...input.cell, width, state } });
    },
  };
}
