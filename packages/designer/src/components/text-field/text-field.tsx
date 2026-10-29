import { type ComponentProps, type ReactNode } from "react";
import { TextField as Root, Text, FieldError } from "react-aria-components";
import { Input } from "../_parts/rail-u1-input/index.js";
import { Textarea } from "../_parts/rail-u1-textarea/index.js";
import { Label } from "../_parts/rail-u1-label/index.js";
type Props = Omit<ComponentProps<typeof Root>, "children"> & { label: ReactNode; description?: ReactNode; errorMessage?: ReactNode; line?: "single-line" | "multiline"; size?: "md"; placeholder?: string };
export function TextField({ label, description, errorMessage, line = "single-line", size = "md", placeholder, ...props }: Props) {
  return <Root {...props} data-size={size}><Label>{label}</Label>{line === "multiline" ? <Textarea placeholder={placeholder} /> : <Input placeholder={placeholder} />}{description ? <Text slot="description">{description}</Text> : null}<FieldError>{errorMessage}</FieldError></Root>;
}
