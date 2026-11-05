import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Chip } from "./Chip.js";

describe("Chip", () => {
  it("renders its label", () => {
    render(<Chip>Engineering</Chip>);
    expect(screen.getByText("Engineering")).toBeInTheDocument();
  });

  it("renders no remove control when onRemove is omitted", () => {
    render(<Chip>Engineering</Chip>);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders a remove control with an accessible name identifying WHICH chip it removes", () => {
    render(
      <Chip onRemove={vi.fn()} removeLabel="Remove Engineering">
        Engineering
      </Chip>,
    );
    expect(screen.getByRole("button", { name: "Remove Engineering" })).toBeInTheDocument();
  });

  it("distinguishes several chips' remove controls by their own accessible names", () => {
    render(
      <>
        <Chip onRemove={vi.fn()} removeLabel="Remove Engineering">
          Engineering
        </Chip>
        <Chip onRemove={vi.fn()} removeLabel="Remove Design">
          Design
        </Chip>
      </>,
    );
    expect(screen.getByRole("button", { name: "Remove Engineering" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Design" })).toBeInTheDocument();
  });

  it("fires onRemove for the correct chip when its remove control is pressed", async () => {
    const removeEngineering = vi.fn();
    const removeDesign = vi.fn();
    const user = userEvent.setup();
    render(
      <>
        <Chip onRemove={removeEngineering} removeLabel="Remove Engineering">
          Engineering
        </Chip>
        <Chip onRemove={removeDesign} removeLabel="Remove Design">
          Design
        </Chip>
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Remove Design" }));
    expect(removeDesign).toHaveBeenCalledTimes(1);
    expect(removeEngineering).not.toHaveBeenCalled();
  });

  it("fires onRemove on keyboard activation (Enter) of the remove control", async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();
    render(
      <Chip onRemove={onRemove} removeLabel="Remove Engineering">
        Engineering
      </Chip>,
    );
    const removeButton = screen.getByRole("button", { name: "Remove Engineering" });
    removeButton.focus();
    await user.keyboard("{Enter}");
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("forwards className, and the consumer's conflicting class wins the merge", () => {
    render(<Chip className="bg-status-danger-tint">Engineering</Chip>);
    const chip = screen.getByText("Engineering").parentElement as HTMLElement;
    expect(chip.className).toContain("bg-status-danger-tint");
    expect(chip.className).not.toContain("bg-surface-sunken");
  });

  it("forwards a consumer style prop, and the consumer's conflicting property wins the merge", () => {
    render(
      <Chip isDisabled style={{ opacity: 0.42, marginTop: "8px" }}>
        Engineering
      </Chip>,
    );
    const chip = screen.getByText("Engineering").parentElement as HTMLElement;
    expect(chip.style.opacity).toBe("0.42");
    expect(chip.style.marginTop).toBe("8px");
  });

  it("disabled: the remove control is disabled and does not fire onRemove", async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();
    render(
      <Chip onRemove={onRemove} removeLabel="Remove Engineering" isDisabled>
        Engineering
      </Chip>,
    );
    const removeButton = screen.getByRole("button", { name: "Remove Engineering" });
    expect(removeButton).toBeDisabled();
    await user.click(removeButton);
    expect(onRemove).not.toHaveBeenCalled();
  });
});
