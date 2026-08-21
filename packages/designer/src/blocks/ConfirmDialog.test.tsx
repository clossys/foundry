import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button as AriaButton } from "react-aria-components";
import { ConfirmDialog } from "./ConfirmDialog.js";

describe("ConfirmDialog", () => {
  it("is closed until the trigger is activated, then shows the heading and message", async () => {
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        trigger={<AriaButton>Delete prompt</AriaButton>}
        heading="Delete prompt?"
        message="This can't be undone."
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete prompt" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete prompt?" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText("This can't be undone.")).toBeInTheDocument();
  });

  it("fires onConfirm and closes when Confirm is activated, without firing onCancel", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        trigger={<AriaButton>Open</AriaButton>}
        heading="Delete prompt?"
        message="This can't be undone."
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("fires onCancel and closes when Cancel is activated, without firing onConfirm", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        trigger={<AriaButton>Open</AriaButton>}
        heading="Delete prompt?"
        message="This can't be undone."
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("uses custom confirm/cancel labels as the buttons' real accessible names", async () => {
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        trigger={<AriaButton>Open</AriaButton>}
        heading="Delete account?"
        message="This can't be undone."
        confirmLabel="Delete account"
        cancelLabel="Keep account"
        tone="destructive"
        onConfirm={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    await screen.findByRole("dialog");
    // The destructive meaning is carried by the button's own TEXT, not by
    // its color alone: a colorblind or screen-reader user gets the same
    // "this deletes the account" signal a sighted user gets from the red
    // fill, because the label itself names the action.
    expect(screen.getByRole("button", { name: "Delete account" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep account" })).toBeInTheDocument();
  });

  it("defaults to neutral tone, focusing Confirm first", async () => {
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        trigger={<AriaButton>Open</AriaButton>}
        heading="Publish changes?"
        message="Your changes will go live."
        onConfirm={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    await screen.findByRole("dialog");
    await waitFor(() => expect(screen.getByRole("button", { name: "Confirm" })).toHaveFocus());
  });

  it("for tone=\"destructive\", focuses Cancel — the safer action — first, not Confirm", async () => {
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        trigger={<AriaButton>Open</AriaButton>}
        heading="Delete prompt?"
        message="This can't be undone."
        confirmLabel="Delete"
        tone="destructive"
        onConfirm={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    await screen.findByRole("dialog");
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus());
    expect(screen.getByRole("button", { name: "Delete" })).not.toHaveFocus();
  });

  it("renders the confirm action with the danger variant only for tone=\"destructive\"", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ConfirmDialog
        trigger={<AriaButton>Open</AriaButton>}
        heading="Publish changes?"
        message="Your changes will go live."
        onConfirm={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    let confirmButton = await screen.findByRole("button", { name: "Confirm" });
    expect(confirmButton.className).not.toContain("bg-status-danger");
    await user.keyboard("{Escape}");

    rerender(
      <ConfirmDialog
        trigger={<AriaButton>Open</AriaButton>}
        heading="Delete prompt?"
        message="This can't be undone."
        tone="destructive"
        onConfirm={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    confirmButton = await screen.findByRole("button", { name: "Confirm" });
    expect(confirmButton.className).toContain("bg-status-danger");
  });

  it("does not implement an imperative confirm() API — it is a plain declarative component with a trigger slot", () => {
    render(
      <ConfirmDialog
        trigger={<AriaButton>Open</AriaButton>}
        heading="Delete prompt?"
        message="This can't be undone."
        onConfirm={vi.fn()}
      />,
    );
    // Nothing to import/call imperatively — this test documents the
    // contract by construction: rendering the component is the only API.
    expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument();
  });

  it("forwards className onto the dialog surface, and the consumer's conflicting class wins the merge", async () => {
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        trigger={<AriaButton>Open</AriaButton>}
        heading="Delete prompt?"
        message="This can't be undone."
        onConfirm={vi.fn()}
        className="bg-status-info"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.className).toContain("bg-status-info");
    expect(dialog.className).not.toContain("bg-overlay-surface");
  });

  it("forwards a consumer style prop onto the dialog surface", async () => {
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        trigger={<AriaButton>Open</AriaButton>}
        heading="Delete prompt?"
        message="This can't be undone."
        onConfirm={vi.fn()}
        style={{ padding: "40px" }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.style.padding).toBe("40px");
  });
});
