import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CaptureView } from "./CaptureView.js";

/** Every `var(` call in `source`, found by balanced parentheses so a nested `var()` in a fallback stays inside its outer call. */
function varCalls(source: string): string[] {
  const calls: string[] = [];
  for (let at = source.indexOf("var("); at !== -1; at = source.indexOf("var(", at + 1)) {
    let depth = 0;
    for (let i = at + 3; i < source.length; i++) {
      if (source[i] === "(") depth++;
      else if (source[i] === ")" && --depth === 0) {
        calls.push(source.slice(at, i + 1));
        break;
      }
    }
  }
  return calls;
}

describe("varCalls scanner", () => {
  it("flags a raw length in a fallback nested inside min()", () => {
    expect(hasRawLengthFallback("var(--a, min(var(--b), 2rem))")).toBe(true);
    expect(hasRawLengthFallback("var(--a, min(var(--b), none))")).toBe(false);
  });
});

const RAW_LENGTH = /(^|[\s,(])-?(\d+(\.\d*)?|\.\d+)(px|rem|em|vw|vh|dvh|ch|%)/;

/** True when the fallback of any `var(` call in `source`, however deeply nested, carries a raw length literal. */
function hasRawLengthFallback(source: string): boolean {
  return varCalls(source).some((call) => {
    const commaAt = call.indexOf(",");
    return commaAt !== -1 && RAW_LENGTH.test(call.slice(commaAt + 1, -1));
  });
}

describe("CaptureView", () => {
  it("keeps an error summary before the consumer form and exposes the documented focus target", () => {
    const html = renderToStaticMarkup(
      <CaptureView brand="Acme" heading="Keep in touch" errorSummaryId="capture-errors" errorSummary="Please correct the form." form={<form id="capture-form">Fields</form>} />,
    );
    expect(html).toContain('id="capture-errors" role="alert" tabindex="-1"');
    expect(html.indexOf("Please correct the form.")).toBeLessThan(html.indexOf('id="capture-form"'));
    expect(html).toContain('<h1 class="text-h1');
    const cardAt = html.indexOf("rounded-control");
    expect(cardAt).toBeGreaterThan(html.indexOf("<h1"));
    expect(cardAt).toBeLessThan(html.indexOf('id="capture-form"'));
  });

  it("replaces form and errors in place with a polite submitted state", () => {
    const html = renderToStaticMarkup(
      <CaptureView brand="Acme" heading="Keep in touch" errorSummaryId="capture-errors" errorSummary="Old error" form="Old form" submitted="Thanks — we received it." />,
    );
    expect(html).toContain('<section role="status" aria-live="polite">Thanks — we received it.</section>');
    expect(html).not.toContain("Old form");
    expect(html).not.toContain("Old error");
  });

  it("names the form region Capture form unless formLabel is passed", () => {
    const defaults = renderToStaticMarkup(<CaptureView brand="Acme" heading="Keep in touch" form="Fields" />);
    expect(defaults).toContain('aria-label="Capture form"');
    const custom = renderToStaticMarkup(<CaptureView brand="Acme" heading="Keep in touch" form="Fields" formLabel="Formulario" />);
    expect(custom).toContain('aria-label="Formulario"');
    expect(custom).not.toContain("Capture form");
  });

  it("fails closed when the form-state or error-focus contract is incomplete", () => {
    expect(() => renderToStaticMarkup(<CaptureView brand="Acme" heading="Keep in touch" />)).toThrow(/requires form/);
    expect(() => renderToStaticMarkup(<CaptureView brand="Acme" heading="Keep in touch" form="Fields" errorSummary="Invalid" />)).toThrow(/errorSummary and errorSummaryId together/);
    expect(() => renderToStaticMarkup(<CaptureView brand="Acme" heading="Keep in touch" form="Fields" errorSummary="Invalid" errorSummaryId="  " />)).toThrow(/non-whitespace/);
  });

  it("recognises a raw length in a var() fallback, including a leading-dot or nested one", () => {
    expect(hasRawLengthFallback("var(--a, .5rem)")).toBe(true);
    expect(hasRawLengthFallback("var(--a, 0.5rem)")).toBe(true);
    expect(hasRawLengthFallback("var(--a, var(--b, 48rem))")).toBe(true);
    expect(hasRawLengthFallback("var(--a, none)")).toBe(false);
    expect(hasRawLengthFallback("var(--a, var(--b, none))")).toBe(false);
  });

  it("carries no raw length literal in a var() fallback", () => {
    const source = readFileSync(new URL("./CaptureView.tsx", import.meta.url), "utf8");
    expect(varCalls(source).length).toBeGreaterThan(0);
    expect(hasRawLengthFallback(source)).toBe(false);
    const html = renderToStaticMarkup(<CaptureView brand="Acme" heading="Keep in touch" form="Fields" />);
    const mainTag = html.slice(html.indexOf("<main"), html.indexOf(">", html.indexOf("<main")) + 1);
    expect(mainTag).toContain("max-width:var(--ui-width-prose-max, none)");
  });
});
