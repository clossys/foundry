const setStartDate = (_date: Parameters<NonNullable<React.ComponentProps<typeof DateField>["onChange"]>>[0]): void => {};

import { DateField } from "@clossys/designer/atoms";
import { CalendarDate } from "@internationalized/date";

function StartDateField() {
  return (
    <DateField
      label="Start date"
      description="When the plan begins."
      defaultValue={new CalendarDate(2024, 1, 15)}
      onChange={(date) => setStartDate(date)}
    />
  );
}

export default StartDateField;
