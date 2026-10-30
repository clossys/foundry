import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Gallery } from "./Gallery.js";

const images = [{ id: "one", label: "First image", media: <svg aria-label="First image" role="img" />, caption: "Image caption" }];
describe("Gallery proof composition", () => {
  it("requires authored lightbox labels and needs no labels for plain figures", () => {
    expect(() => renderToStaticMarkup(<Gallery label="Images" images={images} />)).toThrow(/authored labels/);
    expect(renderToStaticMarkup(<Gallery label="Images" images={images} lightbox={false} />)).toContain("figcaption");
  });
  it("opens the shared dialog with authored controls and returns focus", async () => {
    const user = userEvent.setup();
    render(<Gallery label="Images" images={images} labels={{ close: "Close image", enlarge: "Enlarge image" }} />);
    const trigger = screen.getByRole("button", { name: "Enlarge image First image" });
    await user.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "First image" });
    expect(within(dialog).getByText("Image caption")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Close image" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
