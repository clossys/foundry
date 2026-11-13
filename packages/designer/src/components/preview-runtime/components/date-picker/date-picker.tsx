import { forwardRef, type ReactElement, type ReactNode, type Ref, type RefAttributes } from "react";
import {
  DatePicker as AriaDatePicker,
  DateRangePicker as AriaDateRangePicker,
  Group, Dialog, Label, Text, FieldError,
  type DateValue, type DatePickerProps as AriaDatePickerProps,
  type DateRangePickerProps as AriaDateRangePickerProps,
  type DatePickerRenderProps, type DateRangePickerRenderProps, type ValidationResult,
} from "react-aria-components";
import { Icon } from "../../../index.js";
import { glyphs } from "../../adapters/glyphs.js";
import { DateField } from "../date-field/index.js";
import { Popover } from "../popover/index.js";
import { Calendar } from "../calendar/index.js";

type Content<State> = (state: State & { defaultChildren: ReactNode }) => ReactNode;
type Naming = {
  label: ReactNode;
  triggerLabel: string;
  description?: ReactNode;
  errorMessage?: ReactNode | ((validation: ValidationResult) => ReactNode);
};
export interface DatePickerProps<T extends DateValue = DateValue>
  extends Omit<AriaDatePickerProps<T>, "children">, Naming {
  children?: Content<DatePickerRenderProps>;
}
export interface DateRangePickerProps<T extends DateValue = DateValue>
  extends Omit<AriaDateRangePickerProps<T>, "children">, Naming {
  startLabel: ReactNode;
  endLabel: ReactNode;
  children?: Content<DateRangePickerRenderProps>;
}

export const DatePicker = forwardRef(function DatePicker<T extends DateValue>(
  { label, triggerLabel, description, errorMessage, children, ...props }: DatePickerProps<T>,
  ref: Ref<HTMLDivElement>,
) {
  const content = <>
    <Label>{label}</Label>
    <Group className="flex items-center">
      <DateField label={null} pickerTrigger={{ label: triggerLabel, children: <Icon glyph={glyphs["assets.icon-date"]} decorative /> }} />
    </Group>
    {description ? <Text slot="description">{description}</Text> : null}
    <FieldError>{errorMessage}</FieldError>
    <Popover><Dialog><Calendar selection="single" /></Dialog></Popover>
  </>;
  return <AriaDatePicker {...props} ref={ref}>{state => children ? children({ ...state, defaultChildren: content }) : content}</AriaDatePicker>;
}) as <T extends DateValue = DateValue>(props: DatePickerProps<T> & RefAttributes<HTMLDivElement>) => ReactElement;

export const DateRangePicker = forwardRef(function DateRangePicker<T extends DateValue>(
  { label, startLabel, endLabel, triggerLabel, description, errorMessage, children, ...props }: DateRangePickerProps<T>,
  ref: Ref<HTMLDivElement>,
) {
  const content = <>
    <Label>{label}</Label>
    <Group className="flex items-center">
      <DateField label={startLabel} slot="start" />
      <DateField label={endLabel} slot="end" pickerTrigger={{ label: triggerLabel, children: <Icon glyph={glyphs["assets.icon-date"]} decorative /> }} />
    </Group>
    {description ? <Text slot="description">{description}</Text> : null}
    <FieldError>{errorMessage}</FieldError>
    <Popover><Dialog><Calendar selection="range" /></Dialog></Popover>
  </>;
  return <AriaDateRangePicker {...props} ref={ref}>{state => children ? children({ ...state, defaultChildren: content }) : content}</AriaDateRangePicker>;
}) as <T extends DateValue = DateValue>(props: DateRangePickerProps<T> & RefAttributes<HTMLDivElement>) => ReactElement;
