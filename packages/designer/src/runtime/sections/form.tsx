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

/** Consumer-owned native submission for a capture page; no delivery handler lives here. */
export interface FormCaptureSectionHost {
  readonly capture: { readonly handlerUrl: string };
}

function captureAction(host: Readonly<Record<string, unknown>> | undefined): string | undefined {
  if (!host || !Object.prototype.hasOwnProperty.call(host, "capture")) return undefined;
  const capture = host.capture;
  if (!capture || typeof capture !== "object" || Array.isArray(capture) || Object.keys(capture).some(key => key !== "handlerUrl")) {
    throw new TypeError(`${LEAF}: capture needs a consumer handlerUrl`);
  }
  const handlerUrl = (capture as Partial<FormCaptureSectionHost["capture"]>).handlerUrl;
  if (typeof handlerUrl !== "string" || !handlerUrl || /[\s\\\u0000-\u001f\u007f]/u.test(handlerUrl)) {
    throw new TypeError(`${LEAF}: capture handlerUrl must be a root-relative or HTTPS URL`);
  }
  if (handlerUrl.startsWith("/") && !handlerUrl.startsWith("//") && !handlerUrl.includes("#")) return handlerUrl;
  try {
    const url = new URL(handlerUrl);
    if (/^https:\/\//i.test(handlerUrl) && url.protocol === "https:" && url.hostname && !url.username && !url.password && !url.hash) return handlerUrl;
  } catch { /* Refuse malformed consumer URLs below. */ }
  throw new TypeError(`${LEAF}: capture handlerUrl must be a root-relative or HTTPS URL`);
}

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
  const action = captureAction(input.sectionHost);
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
    const name = action === undefined ? undefined : field.id;
    if (field.kind === "select") return <Select key={field.id} id={field.id} name={name} label={field.label} placeholder={field.placeholder} description={field.description} options={field.options} />;
    if (field.kind === "combo-box") return <ComboBox key={field.id} id={field.id} name={name} label={field.label} placeholder={field.placeholder} description={field.description} options={field.options} />;
    if (field.kind === "checkbox") return <Checkbox key={field.id} id={field.id} name={name}>{field.label}</Checkbox>;
    if (!(TEXT_TYPES as readonly string[]).includes(field.kind)) throw new TypeError(`${LEAF}: field ${field.id} kind ${field.kind} has no registered component`);
    return <TextField key={field.id} id={field.id} name={name} type={field.kind} label={field.label} placeholder={field.placeholder} description={field.description} />;
  });
  return (
    <Form
      action={action}
      method={action === undefined ? undefined : "post"}
      heading={heading}
      errors={errors.length ? errors : undefined}
      errorSummaryMessage={summaryMessage ? () => summaryMessage : undefined}
      actions={<Button type="submit" variant="primary">{submit!.label}</Button>}
    >
      {children}
    </Form>
  );
};
