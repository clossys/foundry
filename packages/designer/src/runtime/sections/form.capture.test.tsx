// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { runtimeHash, type RuntimeJson, type RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";
import { ANATOMY_CONTENT_KEY } from "./group-c-content.js";
import { renderForm } from "./form.js";

afterEach(cleanup);

const fields = [
  { id: "email", kind: "email", label: "Email" },
  { id: "topic", kind: "select", label: "Topic", placeholder: "Choose a topic", options: [{ id: "general", label: "General" }] },
  { id: "company", kind: "combo-box", label: "Company", placeholder: "Choose a company", options: [{ id: "example", label: "Example" }] },
  { id: "permission", kind: "checkbox", label: "Permission to reply" },
];
function input(sectionHost?: Readonly<Record<string, unknown>>): RuntimeRenderInput<ReactNode> {
  const values: Record<string, RuntimeJson> = { fields, submit: { label: "Send request" }, [ANATOMY_CONTENT_KEY]: { heading: "Contact" } };
  return {
    fill: { leaf: "sections.form", slots: ["fields", "submit", "error-summary"], members: [] },
    selection: { leaf: "sections.form", members: [] },
    content: Object.fromEntries(Object.entries(values).map(([slot, value]) => [slot, { value, hash: runtimeHash(value) }])),
    ...(sectionHost ? { sectionHost } : {}),
  } as unknown as RuntimeRenderInput<ReactNode>;
}

describe("native capture form", () => {
  it.each(["/contact/submit", "https://example.invalid/contact/submit"])("posts named fields to the consumer endpoint %s", handlerUrl => {
    render(<>{renderForm(input({ capture: { handlerUrl } }))}</>);
    const form = screen.getByRole("form", { name: "Contact" }) as HTMLFormElement;
    expect(form).toHaveAttribute("action", handlerUrl);
    expect(form).toHaveAttribute("method", "post");
    fireEvent.change(screen.getByRole("textbox", { name: "Email" }), { target: { value: "reader@example.invalid" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Permission to reply" }));
    const data = new FormData(form);
    expect(data.get("email")).toBe("reader@example.invalid");
    expect(data.get("permission")).not.toBeNull();
    for (const field of fields) expect(form.querySelector(`[name="${field.id}"]`)).not.toBeNull();
    expect(screen.getByRole("button", { name: "Send request" })).toHaveAttribute("type", "submit");
  });

  it("preserves the existing unbound form without submission names or an action", () => {
    render(<>{renderForm(input())}</>);
    const form = screen.getByRole("form", { name: "Contact" });
    expect(form).not.toHaveAttribute("action");
    expect(form).not.toHaveAttribute("method");
    for (const field of fields) expect(form.querySelector(`[name="${field.id}"]`)).toBeNull();
  });

  it.each(["", "//example.invalid/post", "javascript:alert(1)", "data:text/plain,test", "http://example.invalid/post", "https:example.invalid", "https://user:pass@example.invalid/post", "/post#fragment", "/post path", "/\\example.invalid"])("refuses an unsafe or ambiguous endpoint %j", handlerUrl => {
    expect(() => renderForm(input({ capture: { handlerUrl } }))).toThrow(/handlerUrl/);
  });

  it.each([null, undefined, {}, { handlerUrl: "/post", consent: true }])("refuses a present malformed capture binding %j", capture => {
    expect(() => renderForm(input({ capture }))).toThrow(/capture/);
  });
});
