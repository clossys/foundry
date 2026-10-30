import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { renderRecordDetail } from "./record-detail.js";
import type { SectionRenderInput } from "./group-b-support.js";

it("keeps both authored record actions in the compact existing Menu", async () => {
  const input = { sectionHost: { recordDetail: { title: "Publication", fields: [{ label: "Name", value: "Publication" }], actionsLabel: "Actions" } }, content: {
    actions: { value: [{ id: "edit", label: "Edit" }, { id: "duplicate", label: "Duplicate" }] },
    fields: { value: [{ label: "Name", value: "Publication" }] },
  }, cell: { state: "default" } } as unknown as SectionRenderInput;
  const view = render(<>{renderRecordDetail(input)}</>);
  const compact = view.container.querySelector<HTMLElement>("[data-detail-actions-compact]")!;
  expect(compact).not.toBeNull();
  // jsdom cannot evaluate the container query; the measured layout test covers the switch.
  compact.style.display = "inline-flex";
  view.container.querySelector<HTMLElement>("[data-detail-actions-wide]")!.style.display = "none";
  await userEvent.click(within(compact).getByRole("button", { name: "Actions" }));
  const menu = screen.getByRole("menu");
  expect(within(menu).getAllByRole("menuitem").map(item => item.textContent)).toEqual(["Edit", "Duplicate"]);
  await userEvent.click(within(menu).getByRole("menuitem", { name: "Duplicate" }));
  expect(screen.queryByRole("menu")).toBeNull();
});
