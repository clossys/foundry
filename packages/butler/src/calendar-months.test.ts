import { describe, expect, it } from "vitest";
import { addCalendarMonthsUtc, CalendarMonthsError, isWithinWindow } from "./index.js";

describe("addCalendarMonthsUtc", () => {
  it.each([
    ["2026-08-31", 6, "2027-02-28"],
    ["2023-08-31", 6, "2024-02-29"],
    ["2024-02-29", 6, "2024-08-29"],
    ["2026-01-31", 1, "2026-02-28"],
  ])("clamps %s + %i months to %s", (start, months, end) => {
    const from = new Date(`${start}T13:14:15.678Z`);
    expect(addCalendarMonthsUtc(from, months).toISOString()).toBe(`${end}T13:14:15.678Z`);
    expect(from.toISOString()).toBe(`${start}T13:14:15.678Z`);
  });

  it("returns a fresh date for zero months", () => {
    const from = new Date("2026-01-31T00:00:00.000Z");
    const result = addCalendarMonthsUtc(from, 0);
    expect(result.getTime()).toBe(from.getTime());
    expect(result).not.toBe(from);
  });

  it("preserves years below 100", () => {
    expect(addCalendarMonthsUtc(new Date("0099-12-31T01:02:03.004Z"), 2).toISOString())
      .toBe("0100-02-28T01:02:03.004Z");
  });

  it.each([-1, 0.5, NaN, Infinity, -Infinity])("rejects invalid month count %s", (months) => {
    expect(() => addCalendarMonthsUtc(new Date("2026-01-01Z"), months)).toThrow(CalendarMonthsError);
  });

  it("rejects invalid dates and unrepresentable results", () => {
    expect(() => addCalendarMonthsUtc(new Date(NaN), 1)).toThrow(CalendarMonthsError);
    expect(() => addCalendarMonthsUtc(new Date(8640000000000000), 1)).toThrow(CalendarMonthsError);
    expect(() => addCalendarMonthsUtc(new Date(0), Number.MAX_VALUE)).toThrow(CalendarMonthsError);
  });
});

describe("isWithinWindow", () => {
  const start = new Date("2026-01-01T00:00:00.000Z");
  const end = new Date("2026-02-01T00:00:00.000Z");

  it("includes start and excludes end", () => {
    expect(isWithinWindow(start, end, start)).toBe(true);
    expect(isWithinWindow(start, end, new Date(end.getTime() - 1))).toBe(true);
    expect(isWithinWindow(start, end, end)).toBe(false);
    expect(isWithinWindow(start, end, new Date(start.getTime() - 1))).toBe(false);
    expect(isWithinWindow(start, end, new Date(end.getTime() + 1))).toBe(false);
  });

  it("treats empty and reversed windows as empty", () => {
    expect(isWithinWindow(start, start, start)).toBe(false);
    expect(isWithinWindow(end, start, start)).toBe(false);
  });

  it.each([0, 1, 2])("rejects an invalid date in argument %i", (position) => {
    const dates = [start, end, start] as [Date, Date, Date];
    dates[position] = new Date(NaN);
    expect(() => isWithinWindow(...dates)).toThrow(CalendarMonthsError);
  });
});
