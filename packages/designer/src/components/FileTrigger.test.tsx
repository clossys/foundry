import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button as AriaButton } from "react-aria-components";
import { FileTrigger } from "./FileTrigger.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("FileTrigger", () => {
  it("renders the trigger element exactly as given", () => {
    render(
      <FileTrigger>
        <AriaButton>Upload files</AriaButton>
      </FileTrigger>,
    );
    expect(screen.getByRole("button", { name: "Upload files" })).toBeInTheDocument();
  });

  it("opens the OS file picker (clicks the hidden input) when the trigger is pressed", async () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    const user = userEvent.setup();
    render(
      <FileTrigger>
        <AriaButton>Upload files</AriaButton>
      </FileTrigger>,
    );
    await user.click(screen.getByRole("button", { name: "Upload files" }));
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it("wires acceptedFileTypes onto the hidden input's accept attribute", () => {
    const { container } = render(
      <FileTrigger acceptedFileTypes={["image/png", "image/jpeg"]}>
        <AriaButton>Upload photo</AriaButton>
      </FileTrigger>,
    );
    const input = container.querySelector("input[type='file']") as HTMLInputElement;
    expect(input).toHaveAttribute("accept", "image/png,image/jpeg");
  });

  it("wires allowsMultiple onto the hidden input's multiple attribute", () => {
    const { container } = render(
      <FileTrigger allowsMultiple>
        <AriaButton>Upload files</AriaButton>
      </FileTrigger>,
    );
    const input = container.querySelector("input[type='file']") as HTMLInputElement;
    expect(input).toHaveAttribute("multiple");
  });

  it("does not set multiple by default", () => {
    const { container } = render(
      <FileTrigger>
        <AriaButton>Upload files</AriaButton>
      </FileTrigger>,
    );
    const input = container.querySelector("input[type='file']") as HTMLInputElement;
    expect(input).not.toHaveAttribute("multiple");
  });

  it("calls onSelect with the chosen FileList when a file is picked", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <FileTrigger onSelect={onSelect}>
        <AriaButton>Upload files</AriaButton>
      </FileTrigger>,
    );
    const input = container.querySelector("input[type='file']") as HTMLInputElement;
    const file = new File(["hello"], "hello.txt", { type: "text/plain" });
    await user.upload(input, file);
    expect(onSelect).toHaveBeenCalledTimes(1);
    const files = onSelect.mock.calls[0]?.[0] as FileList;
    expect(files).toHaveLength(1);
    expect(files[0]?.name).toBe("hello.txt");
  });

  it("disabled trigger: a disabled child Button never opens the file picker", async () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    const user = userEvent.setup();
    render(
      <FileTrigger>
        <AriaButton isDisabled>Upload files</AriaButton>
      </FileTrigger>,
    );
    const trigger = screen.getByRole("button", { name: "Upload files" });
    expect(trigger).toBeDisabled();
    await user.click(trigger);
    expect(clickSpy).not.toHaveBeenCalled();
  });
});
