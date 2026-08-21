import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button as AriaButton } from "react-aria-components";
import { Dialog } from "./Dialog.js";

function BasicDialog({ withExtraField = false }: { withExtraField?: boolean } = {}) {
  return (
    <Dialog trigger={<AriaButton>Open settings</AriaButton>}>
      <Dialog.Heading>Settings</Dialog.Heading>
      <p>Dialog body content.</p>
      <input aria-label="Name" defaultValue="Ada" />
      {withExtraField ? <input aria-label="Email" defaultValue="ada@example.com" /> : null}
      <AriaButton>Save</AriaButton>
    </Dialog>
  );
}

describe("Dialog", () => {
  it("is closed until the trigger is activated", () => {
    render(<BasicDialog />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens on click, rendering its content", async () => {
    const user = userEvent.setup();
    render(<BasicDialog />);
    await user.click(screen.getByRole("button", { name: "Open settings" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Dialog body content.")).toBeInTheDocument();
  });

  it("labels the dialog from its Dialog.Heading via aria-labelledby", async () => {
    const user = userEvent.setup();
    render(<BasicDialog />);
    await user.click(screen.getByRole("button", { name: "Open settings" }));
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    expect(dialog).toBeInTheDocument();
    const heading = screen.getByRole("heading", { name: "Settings" });
    expect(dialog).toHaveAttribute("aria-labelledby", heading.id);
  });

  it("moves focus into the dialog on open, and restores it to the trigger on close", async () => {
    const user = userEvent.setup();
    render(<BasicDialog />);
    const trigger = screen.getByRole("button", { name: "Open settings" });
    trigger.focus();
    await user.click(trigger);
    const dialog = await screen.findByRole("dialog");
    // Focus must have left the trigger and landed somewhere inside the dialog.
    expect(trigger).not.toHaveFocus();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(<BasicDialog />);
    await user.click(screen.getByRole("button", { name: "Open settings" }));
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("traps focus: Tab cycles only through elements inside the dialog", async () => {
    const user = userEvent.setup();
    render(<BasicDialog withExtraField />);
    await user.click(screen.getByRole("button", { name: "Open settings" }));
    await screen.findByRole("dialog");

    const nameField = screen.getByRole("textbox", { name: "Name" });
    const emailField = screen.getByRole("textbox", { name: "Email" });
    const saveButton = screen.getByRole("button", { name: "Save" });

    // Regardless of exactly which element gets initial focus, tabbing all
    // the way around the dialog's focusable set must land back on the
    // first one — it never escapes to something outside the dialog (there
    // is nothing else focusable in this test's document, so `document.body`
    // ever gaining focus would prove containment failed).
    const focusable = [nameField, emailField, saveButton];
    for (let i = 0; i < focusable.length + 1; i++) {
      await user.tab();
    }
    expect(focusable).toContain(document.activeElement);
    expect(document.activeElement).not.toBe(document.body);
  });

  it("does not close when isDismissable is false and the user presses Escape-adjacent outside interaction is unavailable, but Escape itself still works", async () => {
    const user = userEvent.setup();
    render(
      <Dialog trigger={<AriaButton>Open</AriaButton>} isDismissable={false}>
        <Dialog.Heading>Confirm</Dialog.Heading>
        <p>Are you sure?</p>
      </Dialog>,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    await screen.findByRole("dialog");
    // Escape must never be gated behind `isDismissable` — only outside-click
    // dismissal is.
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("supports a function child with an imperative close()", async () => {
    const user = userEvent.setup();
    render(
      <Dialog trigger={<AriaButton>Open</AriaButton>}>
        {({ close }) => (
          <>
            <Dialog.Heading>Confirm</Dialog.Heading>
            <AriaButton onPress={close}>Done</AriaButton>
          </>
        )}
      </Dialog>,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.click(await screen.findByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("forwards className onto the dialog surface, and the consumer's conflicting class wins the merge", async () => {
    const user = userEvent.setup();
    render(
      <Dialog trigger={<AriaButton>Open</AriaButton>} className="bg-status-danger">
        <Dialog.Heading>Title</Dialog.Heading>
      </Dialog>,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.className).toContain("bg-status-danger");
    expect(dialog.className).not.toContain("bg-overlay-surface");
  });

  it("forwards a consumer style prop onto the dialog surface, and the consumer's conflicting property wins the merge", async () => {
    const user = userEvent.setup();
    render(
      <Dialog trigger={<AriaButton>Open</AriaButton>} style={{ boxShadow: "none", padding: "40px" }}>
        <Dialog.Heading>Title</Dialog.Heading>
      </Dialog>,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.style.boxShadow).toBe("none");
    expect(dialog.style.padding).toBe("40px");
  });
});
