import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusMark } from "./StatusMark.js";
import type { StatusMarkTone } from "./StatusMark.js";

const TONES: StatusMarkTone[] = ["success", "warning", "danger", "info", "neutral"];

describe("StatusMark", () => {
  it("always renders its label as visible text", () => {
    render(<StatusMark tone="success">Received</StatusMark>);
    expect(screen.getByText("Received")).toBeVisible();
  });

  it("hides the dot from assistive tech, so only the label is announced", () => {
    const { container } = render(<StatusMark tone="danger">Outside limit</StatusMark>);
    const dot = container.querySelector("[aria-hidden='true']");
    expect(dot).not.toBeNull();
    expect(dot?.textContent).toBe("");
    expect(container.textContent).toBe("Outside limit");
  });

  it.each(TONES)("maps the %s tone to a status text colour and a matching dot", (tone) => {
    const { container } = render(<StatusMark tone={tone}>Label</StatusMark>);
    const root = container.firstElementChild as HTMLElement;
    const dot = root.querySelector("[aria-hidden='true']") as HTMLElement;
    expect(root).toHaveAttribute("data-tone", tone);
    if (tone === "neutral") {
      expect(root.className).toContain("text-ink-secondary");
      expect(dot.className).toContain("bg-ink-muted");
    } else {
      expect(root.className).toContain(`text-status-${tone}-text`);
      expect(dot.className).toContain(`bg-status-${tone}`);
    }
  });

  it("forwards className and other span attributes", () => {
    render(
      <StatusMark tone="info" className="text-caption" id="state">
        Due
      </StatusMark>,
    );
    const root = document.getElementById("state");
    expect(root?.className).toContain("text-caption");
    expect(root?.className).not.toContain("text-body-s");
  });
});
