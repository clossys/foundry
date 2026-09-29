import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CaptureView } from "./CaptureView.js";

/** Length units a consumer token-purity gate treats as a raw length literal. */
const RAW_LENGTH_UNIT = /^(?:\d+(?:\.\d+)?)(?:px|rem|em|vw|vh|dvh|ch|%)/;

/**
 * Fallback text of every `var(` call in `source`. A fallback is the text
 * after the first comma that is not nested inside another call.
 */
function varFallbacks(source: string): string[] {
  const fallbacks: string[] = [];
  let from = 0;
  while (from < source.length) {
    const start = source.indexOf("var(", from);
    if (start < 0) break;
    const open = start + 3;
    let depth = 0;
    let close = -1;
    for (let i = open; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === "(") depth += 1;
      else if (ch === ")") {
        depth -= 1;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    if (close < 0) break;
    const args = source.slice(open + 1, close);
    let depthInArgs = 0;
    let comma = -1;
    for (let i = 0; i < args.length; i += 1) {
      const ch = args[i];
      if (ch === "(") depthInArgs += 1;
      else if (ch === ")") depthInArgs -= 1;
      else if (ch === "," && depthInArgs === 0) {
        comma = i;
        break;
      }
    }
    if (comma >= 0) fallbacks.push(args.slice(comma + 1).trim());
    from = start + 4;
  }
  return fallbacks;
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

  it("carries no raw length literal in a var() fallback", () => {
    const source = readFileSync(new URL("./CaptureView.tsx", import.meta.url), "utf8");
    for (const fallback of varFallbacks(source)) {
      expect(fallback).not.toMatch(RAW_LENGTH_UNIT);
    }

    const html = renderToStaticMarkup(<CaptureView brand="Acme" heading="Keep in touch" form="Fields" />);
    const mainStart = html.indexOf("<main");
    const mainOpen = html.slice(mainStart, html.indexOf(">", mainStart) + 1);
    expect(mainOpen).toContain("max-width:var(--ui-width-prose-max)");
  });

  it("fails closed when the form-state or error-focus contract is incomplete", () => {
    expect(() => renderToStaticMarkup(<CaptureView brand="Acme" heading="Keep in touch" />)).toThrow(/requires form/);
    expect(() => renderToStaticMarkup(<CaptureView brand="Acme" heading="Keep in touch" form="Fields" errorSummary="Invalid" />)).toThrow(/errorSummary and errorSummaryId together/);
    expect(() => renderToStaticMarkup(<CaptureView brand="Acme" heading="Keep in touch" form="Fields" errorSummary="Invalid" errorSummaryId="  " />)).toThrow(/non-whitespace/);
  });
});
