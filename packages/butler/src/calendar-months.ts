/** Invalid calendar-helper input or a result outside the Date range. */
export class CalendarMonthsError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = "CalendarMonthsError";
  }
}

function timestamp(date: Date): number {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new CalendarMonthsError("Expected a valid Date");
  }
  return date.getTime();
}

/** Adds whole UTC calendar months, clamping the day and preserving time of day. */
export function addCalendarMonthsUtc(from: Date, months: number): Date {
  const fromTime = timestamp(from);
  if (!Number.isInteger(months) || months < 0) {
    throw new CalendarMonthsError("Months must be a finite non-negative integer");
  }

  const target = from.getUTCFullYear() * 12 + from.getUTCMonth() + months;
  const year = Math.floor(target / 12);
  const month = target - year * 12;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const lastDay = month === 1 ? (leapYear ? 29 : 28)
    : [3, 5, 8, 10].includes(month) ? 30 : 31;
  const result = new Date(fromTime);
  result.setUTCFullYear(year, month, Math.min(from.getUTCDate(), lastDay));
  if (!Number.isFinite(result.getTime())) {
    throw new CalendarMonthsError("Result is outside the supported Date range");
  }
  return result;
}

/** True when start <= now < end; empty and reversed windows contain no instant. */
export function isWithinWindow(start: Date, end: Date, now: Date): boolean {
  const startTime = timestamp(start);
  const endTime = timestamp(end);
  const nowTime = timestamp(now);
  return startTime <= nowTime && nowTime < endTime;
}
