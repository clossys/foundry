import { type ComponentProps, type ReactNode, useId } from "react";
import { TextField, Text, FieldError } from "react-aria-components";
import { Field as Layout, FieldLabel, FieldDescription, FieldError as ErrorContent, FieldGroup as LayoutGroup, FieldSet as LayoutSet } from "../_parts/rail-u1-field/index.js";
export function FieldGroup(props: ComponentProps<typeof LayoutGroup>) { return <LayoutGroup {...props} />; }
export function FieldSet(props: ComponentProps<typeof LayoutSet>) { return <LayoutSet {...props} />; }
type Props = { label: ReactNode; description?: ReactNode; errorMessage?: ReactNode; children: ReactNode | ((props: { id: string; disabled?: boolean; "aria-invalid"?: boolean; "aria-required"?: boolean }) => ReactNode); isRequired?: boolean; isInvalid?: boolean; isDisabled?: boolean };
export function Field({ label, description, errorMessage, children, ...props }: Props) {
  const id = useId();
  return <TextField {...props} id={id} validationBehavior="aria"><Layout data-invalid={props.isInvalid} data-disabled={props.isDisabled}>
    <FieldLabel htmlFor={id}>{label}</FieldLabel>
    {typeof children === "function" ? children({ id, disabled: props.isDisabled, "aria-invalid": props.isInvalid, "aria-required": props.isRequired }) : children}
    {description ? <Text slot="description"><FieldDescription>{description}</FieldDescription></Text> : null}
    <FieldError><ErrorContent>{errorMessage}</ErrorContent></FieldError>
  </Layout></TextField>;
}
