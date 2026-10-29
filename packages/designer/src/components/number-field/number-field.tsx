import { inputCopy, INPUT_COPY_REFS, type InputCopyResolver } from "../_parts/rail-u1-copy/index.js";
import { type ComponentProps, type ReactNode } from "react";
import { NumberField as Root, Text, FieldError } from "react-aria-components";
import { InputGroup, InputGroupInput, InputGroupButton } from "../_parts/rail-u1-input-group/index.js";
import { Label } from "../_parts/rail-u1-label/index.js";
type Props = Omit<ComponentProps<typeof Root>, "children"> & { label: ReactNode; incrementLabel?: string; decrementLabel?: string; copy?: InputCopyResolver; description?: ReactNode; errorMessage?: ReactNode };
export function NumberField({ label, incrementLabel, decrementLabel, copy, description, errorMessage, ...props }: Props) {
 const values = { fieldLabel: typeof label === "string" ? label : "" };
 const increment = inputCopy(copy, "numberIncrement", incrementLabel, values), decrement = inputCopy(copy, "numberDecrement", decrementLabel, values);
 return <Root {...props}><Label>{label}</Label><InputGroup><InputGroupButton slot="decrement" aria-label={decrement} data-copy-ref={INPUT_COPY_REFS.numberDecrement.id}>{decrement}</InputGroupButton><InputGroupInput /><InputGroupButton slot="increment" aria-label={increment} data-copy-ref={INPUT_COPY_REFS.numberIncrement.id}>{increment}</InputGroupButton></InputGroup>{description ? <Text slot="description">{description}</Text> : null}<FieldError>{errorMessage}</FieldError></Root>;
}
