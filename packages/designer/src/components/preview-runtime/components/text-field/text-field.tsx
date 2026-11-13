"use client"

import * as React from "react"
import {
  TextField as AriaTextField,
  type TextFieldProps as AriaTextFieldProps,
  type ValidationResult,
} from "react-aria-components"

import { Field, FieldDescription, FieldError, FieldLabel } from "../field/index.js"
import { Input } from "./stock/input.js"
import { Textarea as StockTextarea } from "./stock/textarea.js"

type FieldCopyProps = Omit<AriaTextFieldProps, "children" | "className" | "render"> & {
  /** Visible label; null only when an external label names the control. */
  label: React.ReactNode
  placeholder?: string
  description?: React.ReactNode
  errorMessage?: React.ReactNode | ((validation: ValidationResult) => React.ReactNode)
  className?: string
}

function TextField({
  label,
  placeholder,
  description,
  errorMessage,
  className,
  inputClassName,
  ...props
}: FieldCopyProps & { inputClassName?: string }) {
  return (
    <AriaTextField {...props} className={className} render={domProps => <Field {...domProps} />}>
      {label != null ? <FieldLabel>{label}</FieldLabel> : null}
      <Input placeholder={placeholder} className={inputClassName} />
      {description != null ? <FieldDescription>{description}</FieldDescription> : null}
      <FieldError>{errorMessage}</FieldError>
    </AriaTextField>
  )
}

function Textarea({
  label,
  placeholder,
  description,
  errorMessage,
  className,
  rows,
  textareaClassName,
  ...props
}: FieldCopyProps & { rows?: number; textareaClassName?: string }) {
  return (
    <AriaTextField {...props} className={className} render={domProps => <Field {...domProps} />}>
      {label != null ? <FieldLabel>{label}</FieldLabel> : null}
      <StockTextarea placeholder={placeholder} rows={rows} className={textareaClassName} />
      {description != null ? <FieldDescription>{description}</FieldDescription> : null}
      <FieldError>{errorMessage}</FieldError>
    </AriaTextField>
  )
}

export { TextField, Textarea }
