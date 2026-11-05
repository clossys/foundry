import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { SectionRenderInput } from "./group-b-support.js";
import { renderRecordDetail } from "./record-detail.js";
import { renderDataTable } from "./data-table.js";
import { renderChat } from "./chat.js";
import { CHAT_LABEL_KEYS } from "./copy-ports.js";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function input(leaf: string, values: Record<string, unknown>, sectionHost?: Record<string, unknown>): SectionRenderInput {
  return { fill: { leaf }, selection: { leaf, members: [] }, cell: { state: "default" }, content: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value }])), sectionHost, slots: {} } as unknown as SectionRenderInput;
}
const chatCopy = () => ({ label: "W1 conversation", placeholder: "W1 placeholder", labels: Object.fromEntries(CHAT_LABEL_KEYS.map(key => [key, `W1 ${key}`])) });
it("renders only the bound record title and fields, never specimen copy", () => {
  const value = input("sections.record-detail", { fields: [{ label: "Wrong specimen", value: "Wrong value" }], actions: [{ id: "inspect", label: "W1 inspect" }] }, { recordDetail: { title: "Bound item", fields: [{ label: "W1 key", value: "Selected value" }], actionsLabel: "W1 actions" } });
  const html = renderToStaticMarkup(renderRecordDetail(value));
  expect(html).toContain("Bound item"); expect(html).toContain("Selected value"); expect(html).toContain("W1 actions");
  expect(html).not.toMatch(/Order #?1042|Wrong specimen|Wrong value/);
});
it("renders both empty-table strings from the explicit copy port", () => {
  const value = input("sections.data-table", { columns: [{ id: "name", label: "W1 name" }], rows: [] }, { tableCopy: { label: "W1 records", emptyTitle: "W1 empty title", emptyDescription: "W1 empty body", paginationLabel: "W1 pages" } });
  const html = renderToStaticMarkup(renderDataTable(value));
  expect(html).toContain("W1 empty title"); expect(html).toContain("W1 empty body"); expect(html).not.toContain("No orders yet");
});
it("refuses each absent selected-runtime copy port", () => {
  expect(() => renderRecordDetail(input("sections.record-detail", { fields: [] }))).toThrow(/recordDetail host port/);
  expect(() => renderToStaticMarkup(renderDataTable(input("sections.data-table", { rows: [], columns: [] })))).toThrow(/tableCopy host port/);
  expect(() => renderChat(input("sections.chat", { parts: [], composer: {} }))).toThrow(/chatCopy host port/);
});
it.each(CHAT_LABEL_KEYS)("refuses a missing chat %s before legacy defaults can run", key => {
  const copy = chatCopy(); delete copy.labels[key];
  expect(() => renderChat(input("sections.chat", { parts: [], composer: {} }, { chatCopy: copy }))).toThrow(new RegExp(`chatCopy.labels.${key}`));
});
it("renders host chat labels and code copy states without English defaults", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const value = input("sections.chat", { parts: [{ id: "one", role: "assistant", content: "```\nconst value = 1;\n```" }], composer: {} }, { chatCopy: chatCopy() });
  render(renderChat(value));
  expect(screen.getByRole("region", { name: "W1 conversation" })).toBeTruthy();
  expect(screen.getByPlaceholderText("W1 placeholder")).toBeTruthy();
  const button = screen.getByRole("button", { name: "W1 copyCodeLabel" });
  fireEvent.click(button); expect(await screen.findByText("W1 copiedLabel")).toBeTruthy();
  writeText.mockRejectedValue(new Error("unavailable")); fireEvent.click(button);
  expect(await screen.findByText("W1 copyUnavailableLabel")).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/Copy code|Copy unavailable|Start a conversation/);
});
