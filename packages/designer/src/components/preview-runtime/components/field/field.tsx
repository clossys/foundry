"use client"

import * as React from "react"
import {
  FieldError as AriaFieldError,
  FieldErrorContext,
  Provider,
  Text,
  type FieldErrorProps,
  type TextProps,
} from "react-aria-components"

import {
  Field as StockField,
  FieldContent as StockFieldContent,
  FieldDescription as StockFieldDescription,
  FieldError as StockFieldError,
  FieldGroup as StockFieldGroup,
  FieldLabel as StockFieldLabel,
  FieldLegend as StockFieldLegend,
  FieldSeparator as StockFieldSeparator,
  FieldSet as StockFieldSet,
  FieldTitle as StockFieldTitle,
} from "./stock/field.js"

function Field({
  isInvalid,
  isDisabled,
  isRequired,
  ...props
}: React.ComponentProps<typeof StockField> & {
  isInvalid?: boolean
  isDisabled?: boolean
  isRequired?: boolean
}) {
  const field = (
    <StockField
      data-invalid={isInvalid || undefined}
      data-disabled={isDisabled || undefined}
      data-required={isRequired || undefined}
      {...props}
    />
  )
  if (!isInvalid) return field
  // A standalone invalid Field gives its FieldError the context a RAC field would.
  const validation = {
    isInvalid: true,
    validationErrors: [],
    validationDetails: { badInput: false, customError: true, patternMismatch: false, rangeOverflow: false, rangeUnderflow: false, stepMismatch: false, tooLong: false, tooShort: false, typeMismatch: false, valid: false, valueMissing: false },
  }
  return <Provider values={[[FieldErrorContext, validation]]}>{field}</Provider>
}

function FieldSet(props: React.ComponentProps<typeof StockFieldSet>) {
  return <StockFieldSet {...props} />
}

function FieldLegend(props: React.ComponentProps<typeof StockFieldLegend>) {
  return <StockFieldLegend {...props} />
}

function FieldGroup(props: React.ComponentProps<typeof StockFieldGroup>) {
  return <StockFieldGroup {...props} />
}

function FieldContent(props: React.ComponentProps<typeof StockFieldContent>) {
  return <StockFieldContent {...props} />
}

function FieldLabel(props: React.ComponentProps<typeof StockFieldLabel>) {
  return <StockFieldLabel {...props} />
}

function FieldTitle(props: React.ComponentProps<typeof StockFieldTitle>) {
  return <StockFieldTitle {...props} />
}

function FieldSeparator(props: React.ComponentProps<typeof StockFieldSeparator>) {
  return <StockFieldSeparator {...props} />
}

function FieldDescription(props: Omit<TextProps, "slot" | "elementType" | "render">) {
  return <Text {...props} slot="description" elementType="p" render={domProps => <StockFieldDescription {...domProps} />} />
}

function FieldError(props: Omit<FieldErrorProps, "elementType" | "render">) {
  return <AriaFieldError {...props} elementType="div" render={domProps => <StockFieldError {...domProps} />} />
}

export {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldTitle,
}
