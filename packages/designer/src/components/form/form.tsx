import { type ComponentProps } from "react";
import { Form as Root } from "react-aria-components";
import { FieldGroup, FieldSet } from "../field/index.js";
export function Form({ children, ...props }: ComponentProps<typeof Root>) {
 return <Root {...props}><FieldSet><FieldGroup>{children}</FieldGroup></FieldSet></Root>;
}
