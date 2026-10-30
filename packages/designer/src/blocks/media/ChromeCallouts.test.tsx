import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChromeCallouts } from "./ChromeCallouts.js";

describe("ChromeCallouts", () => {
  it("renders every annotation as a list item in one named list", () => {
    render(<ChromeCallouts label="Workspace highlights" items={[{ id: "one", body: "Review queue" }, { id: "two", body: "Project history" }]} />);
    const list = screen.getByRole("list", { name: "Workspace highlights" });
    expect(list.tagName).toBe("UL");
    expect(within(list).getAllByRole("listitem").map(item => item.textContent)).toEqual(["Review queue", "Project history"]);
  });

  it("rejects an unnamed annotation list", () => {
    expect(() => ChromeCallouts({ label: " ", items: [{ id: "one", body: "Review queue" }] })).toThrow(/accessible name/);
  });

  it("omits an empty annotation list", () => {
    const { container } = render(<ChromeCallouts label="Workspace highlights" items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
