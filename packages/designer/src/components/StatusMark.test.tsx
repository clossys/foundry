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

  it("hides the mark from assistive tech, so only the label is announced", () => {
    const { container } = render(<StatusMark tone="danger">Outside limit</StatusMark>);
    const mark = container.querySelector("[aria-hidden='true']");
    expect(mark).not.toBeNull();
    expect(mark).toHaveAttribute("focusable", "false");
    expect(mark?.textContent).toBe("");
    expect(container.textContent).toBe("Outside limit");
  });

  it.each(TONES)("maps the %s tone to a status text colour and a matching mark colour", (tone) => {
    const { container } = render(<StatusMark tone={tone}>Label</StatusMark>);
    const root = container.firstElementChild as HTMLElement;
    const mark = root.querySelector("[data-part='mark']") as SVGElement;
    expect(root).toHaveAttribute("data-tone", tone);
    if (tone === "neutral") {
      expect(root.className).toContain("text-ink-secondary");
      expect(mark.getAttribute("class")).toContain("fill-ink-muted");
    } else {
      expect(root.className).toContain(`text-status-${tone}-text`);
      expect(mark.getAttribute("class")).toContain(`fill-status-${tone}`);
    }
  });

  it("gives every tone its own shape, so the tones stay apart without colour", () => {
    const shapes = TONES.map((tone) => {
      const { container } = render(<StatusMark tone={tone}>Label</StatusMark>);
      return container.querySelector("[data-part='mark']")?.getAttribute("data-shape");
    });
    expect(shapes).toEqual(["circle", "triangle", "diamond", "open-circle", "dash"]);
    expect(new Set(shapes).size).toBe(TONES.length);
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
