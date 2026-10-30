import { Form } from "../../blocks/Form.js";
import type { FormError, FormProps } from "../../blocks/Form.js";
import { Button } from "../../components/Button.js";
import { Banner } from "../../components/Banner.js";
import { Checkbox } from "../../components/Checkbox.js";
import { ComboBox } from "../../components/ComboBox.js";
import { Select } from "../../components/Select.js";
import { TextField } from "../../components/TextField.js";
import { Textarea } from "../../components/Textarea.js";
import { actionsOf, anatomyOf, isObject, recordsOf, refuseUnmapped, requireSlot, slotValue, stringField, textOf, type RuntimeObject, type SectionInputs, type SectionRenderer } from "./group-c-content.js";

const LEAF = "sections.form";
const TEXT_TYPES = ["text", "email", "tel", "url", "password", "search"] as const;

/**
 * fields -> Form.children (each field a registered TextField, Select, ComboBox or Checkbox); submit -> Form.actions
 * (a submit Button); error-summary -> Form.errors and errorSummaryMessage.
 */
export const formInputs: SectionInputs = { slots: ["fields", "submit", "error-summary", "success", "error", "honeypot", "turnstile"], members: ["form.contact"] };

interface FieldRow { readonly id: string; readonly kind: string; readonly label: string; readonly placeholder?: string; readonly description?: string; readonly error?: string; readonly options: readonly { id: string; label: string }[] }

function fieldOf(row: RuntimeObject, index: number): FieldRow {
  const id = stringField(row, "id"), label = stringField(row, "label");
  if (!id || !label) throw new TypeError(`${LEAF}: field ${index} needs an id and a label`);
  const options = recordsOf(LEAF, "fields", row.options ?? []).map(option => {
    const optionId = stringField(option, "id"), optionLabel = stringField(option, "label");
    if (!optionId || !optionLabel) throw new TypeError(`${LEAF}: field ${id} has an option without an id and a label`);
    return { id: optionId, label: optionLabel };
  });
  const placeholder = stringField(row, "placeholder"), description = stringField(row, "description"), error = stringField(row, "error");
  return { id, kind: stringField(row, "kind") ?? "text", label, options, ...(placeholder ? { placeholder } : {}), ...(description ? { description } : {}), ...(error ? { error } : {}) };
}

export const renderForm: SectionRenderer = input => {
  refuseUnmapped(input, formInputs);
  const contact = input.selection.members.includes("form.contact");
  const host = input.sectionHost;
  if (contact && typeof host?.onSubmit !== "function") {
    throw new TypeError(`${LEAF}: form.contact requires sectionHost.onSubmit from the consumer`);
  }
  if (contact && host?.onSubmitError !== undefined && typeof host.onSubmitError !== "function") {
    throw new TypeError(`${LEAF}: sectionHost.onSubmitError must be a function`);
  }
  const stateMessage = (slot: "success" | "error") => {
    const value = slotValue(input, slot);
    return stringField(value, "message") ?? textOf(value);
  };
  const success = stateMessage("success"), error = stateMessage("error");
  if (contact && (!success || !error)) {
    throw new TypeError(`${LEAF}: form.contact requires success.message and error.message copy`);
  }
  const fields = recordsOf(LEAF, "fields", requireSlot(input, LEAF, "fields")).map(fieldOf);
  const [submit] = actionsOf(LEAF, "submit", requireSlot(input, LEAF, "submit"), 1);
  const summary = slotValue(input, "error-summary");
  const errors: FormError[] = recordsOf(LEAF, "error-summary", isObject(summary) ? summary.items : undefined).map((row, index) => {
    const fieldId = stringField(row, "fieldId"), message = stringField(row, "message");
    if (!fieldId || !message) throw new TypeError(`${LEAF}: error ${index} needs a fieldId and a message`);
    return { fieldId, message };
  });
  const summaryMessage = stringField(summary, "heading");
  const { heading } = anatomyOf(input);
  const children = fields.map(field => {
    const name = contact ? field.id : undefined;
    const validation = { isInvalid: field.error ? true : undefined, errorMessage: field.error };
    if (field.kind === "select") return <Select key={field.id} id={field.id} name={name} label={field.label} placeholder={field.placeholder ?? ""} description={field.description} options={field.options} {...validation} />;
    if (field.kind === "combo-box") return <ComboBox key={field.id} id={field.id} name={name} label={field.label} triggerLabel={field.label} placeholder={field.placeholder} description={field.description} options={field.options} {...validation} />;
    if (field.kind === "checkbox") {
      if (field.error) throw new TypeError(`${LEAF}: field ${field.id} NEED registered checkbox error presentation; supply the error-summary slot`);
      return <Checkbox key={field.id} id={field.id} name={name}>{field.label}</Checkbox>;
    }
    if (field.kind === "textarea") return <Textarea key={field.id} id={field.id} name={name} label={field.label} placeholder={field.placeholder} description={field.description} {...validation} />;
    if (!(TEXT_TYPES as readonly string[]).includes(field.kind)) throw new TypeError(`${LEAF}: field ${field.id} kind ${field.kind} has no registered component`);
    return <TextField key={field.id} id={field.id} name={name} type={field.kind} label={field.label} placeholder={field.placeholder} description={field.description} {...validation} />;
  });
  return (
    <Form
      composition={contact ? "contact" : undefined}
      onSubmit={contact ? host!.onSubmit as FormProps["onSubmit"] : undefined}
      onSubmitError={contact ? host?.onSubmitError as FormProps["onSubmitError"] : undefined}
      submitSuccess={contact ? <Banner variant="success">{success}</Banner> : undefined}
      submitError={contact ? <Banner variant="danger">{error}</Banner> : undefined}
      honeypot={contact ? host?.honeypot as FormProps["honeypot"] : undefined}
      turnstile={contact ? host?.turnstile as FormProps["turnstile"] : undefined}
      heading={heading}
      errors={errors.length ? errors : undefined}
      errorSummaryMessage={summaryMessage ? () => summaryMessage : undefined}
      actions={<Button type="submit" variant="primary">{submit!.label}</Button>}
    >
      {children}
      {contact ? host?.consent as FormProps["children"] : null}
    </Form>
  );
};
