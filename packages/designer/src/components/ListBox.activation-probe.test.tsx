// DIAG-PROBE: temporary activation trace; remove after independent diagnosis.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { ListBox, ListBoxItem } from "./ListBox.js";

it("records peer link activation event order for diagnosis", async () => {
  const events: string[] = [];
  render(<ListBox aria-label="Choices" selectionMode="single" autoFocus="first">
    <ListBoxItem id="link" href="#destination" onPressStart={event => events.push("press:" + event.pointerType)}
      onAction={() => events.push("action")} render={(props) => <a {...props} onClickCapture={event => events.push("capture:" + event.nativeEvent.constructor.name)} />}>Destination</ListBoxItem>
  </ListBox>);
  screen.getByRole("option").addEventListener("click", () => events.push("native-click"));
  await userEvent.click(screen.getByRole("option"));
  expect(events).toMatchInlineSnapshot(`
    [
      "press:mouse",
      "capture:PointerEvent",
      "native-click",
      "action",
      "capture:MouseEvent",
      "native-click",
    ]
  `);
});
