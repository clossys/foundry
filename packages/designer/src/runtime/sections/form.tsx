import { Form } from "../../blocks/Form.js";
import type { FormError } from "../../blocks/Form.js";
import { Button } from "../../components/Button.js";
import { Checkbox } from "../../components/Checkbox.js";
import { ComboBox } from "../../components/ComboBox.js";
import { Select } from "../../components/Select.js";
import { TextField } from "../../components/TextField.js";
import { actionsOf, anatomyOf, isObject, recordsOf, refuseUnmapped, requireSlot, slotValue, stringField, type RuntimeObject, type SectionInputs, type SectionRenderer } from "./group-c-content.js";

const LEAF = "sections.form";
const TEXT_TYPES = ["text", "email", "tel", "url", "password", "search"] as const;

/**
 * fields -> Form.children (each field a registered TextField, Select, ComboBox or Checkbox); submit -> Form.actions
 * (a submit Button); error-summary -> Form.errors and errorSummaryMessage.
 */
export const formInputs: SectionInputs = { slots: ["fields", "submit", "error-summary"], members: [] };

interface FieldRow { readonly id: string; readonly kind: string; readonly label: string; readonly placeholder?: string; readonly description?: string; readonly options: readonly { id: string; label: string }[] }

function fieldOf(row: RuntimeObject, index: number): FieldRow {
  const id = stringField(row, "id"), label = stringField(row, "label");
  if (!id || !label) throw new TypeError(`${LEAF}: field ${index} needs an id and a label`);
  const options = recordsOf(LEAF, "fields", row.options ?? []).map(option => {
    const optionId = stringField(option, "id"), optionLabel = stringField(option, "label");
    if (!optionId || !optionLabel) throw new TypeError(`${LEAF}: field ${id} has an option without an id and a label`);
    return { id: optionId, label: optionLabel };
  });
  const placeholder = stringField(row, "placeholder"), description = stringField(row, "description");
  return { id, kind: stringField(row, "kind") ?? "text", label, options, ...(placeholder ? { placeholder } : {}), ...(description ? { description } : {}) };
}

export const renderForm: SectionRenderer = input => {
  refuseUnmapped(input, formInputs);
  const fields = recordsOf(LEAF, "fields", requireSlot(input, LEAF, "fields")).map(fieldOf);
  const [submit] = actionsOf(LEAF, "submit", requireSlot(input, LEAF, "submit"), 1);
  const summary = slotValue(input, "error-summary");
  const errors: FormError[] = recordsOf(LEAF, "error-summary", isObject(summary) ? summary.errors : undefined).map((row, index) => {
    const fieldId = stringField(row, "fieldId"), message = stringField(row, "message");
    if (!fieldId || !message) throw new TypeError(`${LEAF}: error ${index} needs a fieldId and a message`);
    return { fieldId, message };
  });
  const summaryMessage = stringField(summary, "message");
  const { heading } = anatomyOf(input);
  const children = fields.map(field => {
    if (field.kind === "select") return <Select key={field.id} id={field.id} label={field.label} placeholder={field.placeholder} description={field.description} options={field.options} />;
    if (field.kind === "combo-box") return <ComboBox key={field.id} id={field.id} label={field.label} placeholder={field.placeholder} description={field.description} options={field.options} />;
    if (field.kind === "checkbox") return <Checkbox key={field.id} id={field.id}>{field.label}</Checkbox>;
    if (!(TEXT_TYPES as readonly string[]).includes(field.kind)) throw new TypeError(`${LEAF}: field ${field.id} kind ${field.kind} has no registered component`);
    return <TextField key={field.id} id={field.id} type={field.kind} label={field.label} placeholder={field.placeholder} description={field.description} />;
  });
  return (
    <Form
      heading={heading}
      errors={errors.length ? errors : undefined}
      errorSummaryMessage={summaryMessage ? () => summaryMessage : undefined}
      actions={<Button type="submit" variant="primary">{submit!.label}</Button>}
    >
      {children}
    </Form>
  );
};
