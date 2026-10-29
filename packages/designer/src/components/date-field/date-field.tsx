import { type ComponentProps, type ReactNode } from "react";
import { DateField as Root, TimeField as TimeRoot, DateInput, DateSegment, FieldError } from "react-aria-components";
import { Label } from "../_parts/rail-u1-label/index.js";
import { inputClasses } from "../_parts/rail-u1-input-classes/index.js";
type Props = Omit<ComponentProps<typeof Root>, "children"> & { label: ReactNode; errorMessage?: ReactNode; pickerContext?: boolean };
export function DateField({ label, errorMessage, pickerContext, ...props }: Props) {
 if (pickerContext) return <DateInput slot={props.slot} className={inputClasses}>{segment => <DateSegment segment={segment} />}</DateInput>;
 return <Root {...props}><Label>{label}</Label><DateInput className={inputClasses}>{segment => <DateSegment segment={segment} />}</DateInput><FieldError>{errorMessage}</FieldError></Root>;
}
export function TimeField({ label, errorMessage, ...props }: Omit<ComponentProps<typeof TimeRoot>, "children"> & { label: ReactNode; errorMessage?: ReactNode }) {
 return <TimeRoot {...props}><Label>{label}</Label><DateInput className={inputClasses}>{segment => <DateSegment segment={segment} />}</DateInput><FieldError>{errorMessage}</FieldError></TimeRoot>;
}
