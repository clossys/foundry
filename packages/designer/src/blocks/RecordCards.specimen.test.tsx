import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RecordCards } from "./RecordCards.js";
import { Link } from "../components/Link.js";
import { Button } from "../components/Button.js";

describe("RecordCards specimen content", () => {
  it("renders a rich body outside paragraphs and honors declared full, half and third spans", () => {
    const { container, rerender } = render(<RecordCards records={[
      { id: "copy", title: "Copy", span: "full", body: <section aria-label="Native copy"><h2>Find your next idea</h2><p>Read the complete passage.</p></section> },
      { id: "half", title: "Half", span: "half" },
      { id: "third", title: "Third", span: "third" },
    ]} />);
    const body = screen.getByRole("region", { name: "Native copy" });
    expect(body.closest("p")).toBeNull();
    expect(container.querySelector('[data-record-id="copy"]')).toHaveClass("desktop:col-span-6");
    expect(container.querySelector('[data-record-id="half"]')).toHaveClass("desktop:col-span-3");
    expect(container.querySelector('[data-record-id="third"]')).toHaveClass("desktop:col-span-2");
    rerender(<RecordCards layout="list" records={[{ id: "copy", title: "Copy", span: "full", body: <section aria-label="Native copy">Full passage</section> }]} />);
    expect(container.querySelector('[data-record-id="copy"]')).not.toHaveClass("desktop:col-span-6");
  });

  it("keeps title selection separate from the specimen's native action", async () => {
    const select = vi.fn(), action = vi.fn();
    const { container } = render(<RecordCards records={[{ id: "copy", selected: true, title: <Link href="#copy" onPress={select}>Copy</Link>, body: <Button onPress={action}>Explore ideas</Button> }]} />);
    await userEvent.click(screen.getByRole("button", { name: "Explore ideas" }));
    expect(action).toHaveBeenCalledOnce();
    expect(select).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("link", { name: "Copy" }));
    expect(select).toHaveBeenCalledOnce();
    expect(container.querySelector('[data-record-id="copy"]')).toHaveAttribute("data-selected", "true");
  });
});
