import type { GlobalErrorDocumentErrorViewProps, GlobalErrorDocumentFramedProps } from "./GlobalErrorDocument.js";
import type { StatusViewProps } from "./StatusView.js";

type Reference = NonNullable<StatusViewProps["reference"]>;
const reference: Reference = { label: "Error", value: "abc" };
const framedReference: GlobalErrorDocumentFramedProps["reference"] = reference;
// @ts-expect-error A diagnostic reference requires caller copy for its label.
const missingLabel: Reference = { value: "abc" };
// @ts-expect-error The value is plain text, not JSX.
const markupValue: Reference = { label: "Error", value: <em>abc</em> };
// @ts-expect-error The reference shape has no arbitrary slots.
const extraSlot: Reference = { label: "Error", value: "abc", children: "extra" };
// @ts-expect-error Structured references require the framed document shape.
const legacyReference: GlobalErrorDocumentErrorViewProps["reference"] = reference;
void [framedReference, missingLabel, markupValue, extraSlot, legacyReference];
