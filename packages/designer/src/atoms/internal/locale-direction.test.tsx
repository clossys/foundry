import { render, screen } from "@testing-library/react";
import { I18nProvider } from "react-aria-components";
import { describe, expect, it } from "vitest";
import { useLocaleDirection } from "./locale-direction.js";

function Probe() {
  return <output>{useLocaleDirection()}</output>;
}

describe("useLocaleDirection", () => {
  it.each([
    ["ar", "rtl"],
    ["he", "rtl"],
    ["en", "ltr"],
  ])("returns the I18nProvider %s direction (mutant: constant ltr)", (locale, direction) => {
    render(<I18nProvider locale={locale}><Probe /></I18nProvider>);
    expect(screen.getByRole("status")).toHaveTextContent(direction);
  });
});
