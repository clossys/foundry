import { forwardRef, type ReactNode, type Ref } from "react";
import { FileTrigger as AriaFileTrigger, type FileTriggerProps as AriaFileTriggerProps } from "react-aria-components";
import { Button } from "../button/index.js";

export interface FileTriggerProps extends Omit<AriaFileTriggerProps, "children"> {
  /** Visible name of the selected button that opens the file picker. */
  label: ReactNode;
}

export const FileTrigger = forwardRef(function FileTrigger(
  { label, ...props }: FileTriggerProps,
  ref: Ref<HTMLInputElement>,
) {
  return <AriaFileTrigger {...props} ref={ref}><Button>{label}</Button></AriaFileTrigger>;
});
