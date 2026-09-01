import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CaptureView } from "./CaptureView.js";

describe("CaptureView", () => {
  it("keeps an error summary before the consumer form and exposes the documented focus target", () => {
    const html = renderToStaticMarkup(
      <CaptureView brand="Acme" heading="Keep in touch" errorSummaryId="capture-errors" errorSummary="Please correct the form." form={<form id="capture-form">Fields</form>} />,
    );
    expect(html).toContain('id="capture-errors" role="alert" tabindex="-1"');
    expect(html.indexOf("Please correct the form.")).toBeLessThan(html.indexOf('id="capture-form"'));
    expect(html).toContain('<h1 class="text-h1');
  });

  it("replaces form and errors in place with a polite submitted state", () => {
    const html = renderToStaticMarkup(
      <CaptureView brand="Acme" heading="Keep in touch" errorSummaryId="capture-errors" errorSummary="Old error" form="Old form" submitted="Thanks — we received it." />,
    );
    expect(html).toContain('<section role="status" aria-live="polite">Thanks — we received it.</section>');
    expect(html).not.toContain("Old form");
    expect(html).not.toContain("Old error");
  });

  it("fails closed when the form-state or error-focus contract is incomplete", () => {
    expect(() => renderToStaticMarkup(<CaptureView brand="Acme" heading="Keep in touch" />)).toThrow(/requires form/);
    expect(() => renderToStaticMarkup(<CaptureView brand="Acme" heading="Keep in touch" form="Fields" errorSummary="Invalid" />)).toThrow(/errorSummary and errorSummaryId together/);
  });
});
