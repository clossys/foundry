import { inputCopy, INPUT_COPY_REFS, type InputCopyResolver } from "../_parts/rail-u1-copy/index.js";
import { type ComponentProps, type ReactNode } from "react";
import { SearchField as Root, FieldError, Text } from "react-aria-components";
import { InputGroup, InputGroupInput, InputGroupButton } from "../_parts/rail-u1-input-group/index.js";
import { Label } from "../_parts/rail-u1-label/index.js";
type Props = Omit<ComponentProps<typeof Root>, "children"> & { label: ReactNode; clearLabel?: string; copy?: InputCopyResolver; submitLabel?: string; placeholder?: string; description?: ReactNode; errorMessage?: ReactNode };
export function SearchField({ label, clearLabel, copy, submitLabel, placeholder, description, errorMessage, ...props }: Props) {
 const clear = inputCopy(copy, "searchClear", clearLabel);
 return <Root {...props}>{({ isEmpty }) => <><Label>{label}</Label><InputGroup><InputGroupInput placeholder={placeholder} />{!isEmpty ? <InputGroupButton slot="clear" aria-label={clear} data-copy-ref={INPUT_COPY_REFS.searchClear.id}>{clear}</InputGroupButton> : null}{submitLabel ? <InputGroupButton slot={null} onPress={() => props.onSubmit?.(props.value ?? "")}>{submitLabel}</InputGroupButton> : null}</InputGroup>{description ? <Text slot="description">{description}</Text> : null}<FieldError>{errorMessage}</FieldError></>}</Root>;
}
