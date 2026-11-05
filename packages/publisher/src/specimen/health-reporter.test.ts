/**
 * The inline health reporter in a DOM window: the browser's benign ResizeObserver loop notice is
 * not an element error, and every other error still counts.
 */
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { specimenReporterScript } from "./health-reporter.js";

function page() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { runScripts: "outside-only", pretendToBeVisual: true });
  const script = specimenReporterScript({ element: "components.card/card", elementVersion: 1, kind: "visual", theme: "none:light", width: 480, preErrors: [] });
  dom.window.eval(script);
  const window = dom.window as unknown as Window & { __clossysSpecimen: { health(): { errors: { count: number; items: { source: string; message: string }[] } } } };
  const raise = (message: string, error?: Error) => window.dispatchEvent(new dom.window.ErrorEvent("error", { message, ...(error ? { error } : {}) }));
  return { window, raise, health: () => window.__clossysSpecimen.health() };
}

describe("specimen health reporter", () => {
  it("does not count the browser's ResizeObserver loop notice as an error", () => {
    const { raise, health } = page();
    raise("ResizeObserver loop completed with undelivered notifications.");
    raise("ResizeObserver loop limit exceeded");
    expect(health().errors.count).toBe(0);
  });

  it("still counts every other error, including one thrown with the same words", () => {
    const { raise, health } = page();
    raise("Uncaught TypeError: x is not a function");
    raise("ResizeObserver loop completed with undelivered notifications.", new Error("ResizeObserver loop completed with undelivered notifications."));
    raise("ResizeObserver loop completed with undelivered notifications. Also: boom");
    expect(health().errors.count).toBe(3);
    expect(health().errors.items.map(item => item.source)).toEqual(["error", "error", "error"]);
  });
});
