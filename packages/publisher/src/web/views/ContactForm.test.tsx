// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { execFileSync } from "node:child_process";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CopyResolver } from "@clossys/writer";
import * as web from "../index.js";
import * as server from "../server.js";
import * as client from "../client.js";
import { checkFrontDoor } from "../../testing/index.js";
import type { ContactViewCopy, ContactViewProps } from "./ContactView.js";
import type { ContactResult } from "../contact/types.js";
import { ContactForm as ServerContactForm } from "./ContactForm.server.js";

afterEach(cleanup);
const keys = ["heading", "description", "topicLabel", "topicPlaceholder", "nameLabel", "emailLabel", "phoneLabel", "messageLabel", "submit", "submitting", "errorSummary", "topicRequired", "nameRequired", "emailRequired", "emailInvalid", "messageRequired", "sentHeading", "sentBody", "failureLabel", "invalid", "rateLimited", "unavailable"] as const;
const copy = Object.fromEntries(keys.map(key => [key, { id: key }])) as unknown as ContactViewCopy;
const resolveCopyId: CopyResolver = (ref) => ref.id === "UNRESOLVED-SENTINEL" ? undefined : ({ ref, text: `${ref.id.toUpperCase()}-SENTINEL`, recordId: "fixture", revision: "1", locale: "en", source: { kind: "consumer", reference: "fixture" }, entryId: ref.id });
const topics = [{ id: "general", label: { id: "general" } }];
const formProps = (overrides: Partial<ContactViewProps> = {}) => ({ copy, resolveCopyId, topics, initialTopic: "general", onSubmit: vi.fn(async (): Promise<ContactResult> => ({ status: "accepted" })), ...overrides });
const shell: web.SiteShellInput = { brand: { assetId: "mark", label: { id: "brand" }, size: "md", variant: "mark" }, skipLink: { id: "skip" }, footer: { legal: { entity: { id: "entity" }, links: [] } } };
const resolveAsset = () => ({ type: "image", src: "/mark.svg", width: 48, height: 48, alt: "MARK-SENTINEL" });
function page(props = formProps(), entry = web) {
  const Frame = entry.SiteFrame;
  const Capture = entry.CaptureView;
  return <Frame shell={shell} resolveCopy={resolveCopyId} resolveAsset={resolveAsset}><Capture heading="HEADING-SENTINEL" description="DESCRIPTION-SENTINEL" formLabel="FORM-SENTINEL" form={<client.ContactForm {...props} />} /></Frame>;
}
async function fill() {
  const u = userEvent.setup();
  await u.type(screen.getByRole("textbox", { name: /NAMELABEL/ }), "Example Person");
  await u.type(screen.getByRole("textbox", { name: /EMAILLABEL/ }), "person@example.com");
  await u.type(screen.getByRole("textbox", { name: /PHONELABEL/ }), "555 0100");
  await u.type(screen.getByRole("textbox", { name: /MESSAGELABEL/ }), "Example message.");
  return u;
}
const submit = () => screen.getByRole("button", { name: /SUBMIT-SENTINEL|SUBMITTING-SENTINEL/ });

describe("ContactForm extraction", () => {
  it("uses end actions for the contact CTA", () => {
    render(page());
    expect(submit().parentElement).toHaveAttribute("data-actions-layout", "end");
  });

  it("exports the client form from the same entries as the other forms", () => {
    expect(typeof web.ContactForm).toBe("function");
    expect(typeof server.ContactForm).toBe("function");
    expect(client.ContactForm).toBe(web.ContactForm);
  });
  it("renders POST before hydration so contact values stay out of the URL", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(page());
    const form = host.querySelector("form")!;
    expect(form).toHaveAttribute("method", "post");
    expect(form.method).toBe("post");
    expect(form).not.toHaveAttribute("action");
  });
  it("keeps method and action fixed even when passed through untyped caller props", () => {
    const host = document.createElement("div");
    const attempted = { ...formProps(), method: "get", action: "/other" };
    host.innerHTML = renderToStaticMarkup(<client.ContactForm {...attempted} />);
    const form = host.querySelector("form")!;
    expect(form).toHaveAttribute("method", "post");
    expect(form).not.toHaveAttribute("action");
  });
  it("renders a framed CaptureView with one frame-owned main and one h1, passing checkFrontDoor", () => {
    const { container } = render(page());
    expect(container.querySelectorAll("main")).toHaveLength(1);
    expect(container.querySelector("main")).toHaveAttribute("id", web.SITE_MAIN_ID);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelectorAll("form")).toHaveLength(1);
    expect(container.querySelectorAll(".rounded-control.bg-surface-raised.p-lg")).toHaveLength(1);
    expect(checkFrontDoor({ surfaces: [{ surface: "contact", title: { page: "HEADING-SENTINEL", brand: "BRAND-SENTINEL" }, render: () => page() }] })).toEqual([]);
    expect(renderToStaticMarkup(page())).toBe(renderToStaticMarkup(page(formProps(), server)));
  });
  it("keeps the honeypot inaccessible and sends the handler's fields under its configured name", async () => {
    const props = formProps({ honeypotField: "url" });
    const { container } = render(page(props));
    const hp = container.querySelector<HTMLInputElement>('input[name="url"]')!;
    expect(hp).toHaveAttribute("tabindex", "-1");
    expect(hp).toHaveAttribute("autocomplete", "off");
    expect(hp.parentElement).toHaveAttribute("aria-hidden", "true");
    const u = await fill();
    fireEvent.change(hp, { target: { value: "BOT-SENTINEL" } });
    await u.click(submit());
    await waitFor(() => expect(props.onSubmit).toHaveBeenCalledExactlyOnceWith({ topic: "general", name: "Example Person", email: "person@example.com", phone: "555 0100", message: "Example message.", url: "BOT-SENTINEL" }));
    const heading = await screen.findByRole("heading", { name: "SENTHEADING-SENTINEL" });
    expect(heading).toHaveFocus();
    expect(heading).toHaveAttribute("tabindex", "-1");
    expect(heading.closest('[role="status"]')).not.toBeNull();
    expect(container.querySelector("form")).toBeNull();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
  it.each(["invalid", "rate-limited", "unavailable"] as const)("keeps values, one alert and submit focus on %s", async status => {
    const result: ContactResult = status === "invalid" ? { status, fields: [{ field: "email", code: "malformed" }] } : { status };
    render(page(formProps({ onSubmit: async () => result })));
    const u = await fill();
    await u.click(submit());
    expect(await screen.findByRole("alert")).toHaveTextContent(status === "rate-limited" ? "RATELIMITED-SENTINEL" : `${status.toUpperCase()}-SENTINEL`);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent("FAILURELABEL-SENTINEL");
    await waitFor(() => expect(submit()).toHaveFocus());
    expect(screen.getByRole("textbox", { name: /NAMELABEL/ })).toHaveValue("Example Person");
    expect(screen.getByRole("textbox", { name: /EMAILLABEL/ })).toHaveValue("person@example.com");
    expect(screen.getByRole("textbox", { name: /PHONELABEL/ })).toHaveValue("555 0100");
    expect(screen.getByRole("textbox", { name: /MESSAGELABEL/ })).toHaveValue("Example message.");
    await u.clear(screen.getByRole("textbox", { name: /EMAILLABEL/ }));
    await u.click(submit());
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent("ERRORSUMMARY-SENTINEL");
    expect(screen.getByRole("textbox", { name: /EMAILLABEL/ })).toHaveFocus();
    const link = screen.getByText("EMAILREQUIRED-SENTINEL", { selector: "a" });
    expect(link).toHaveAttribute("href", `#${screen.getByRole("textbox", { name: /EMAILLABEL/ }).id}`);
  });
  it("refuses invalid client input before calling the handler", async () => {
    const props = formProps({ initialTopic: "unknown" });
    render(page(props));
    await userEvent.setup().click(submit());
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /TOPICLABEL/ })).toHaveFocus();
    expect(screen.getByRole("alert")).toHaveTextContent("ERRORSUMMARY-SENTINEL");
  });
  it.each(["topic", "name", "email", "message"] as const)("refuses missing %s with a linked summary and sends nothing", async field => {
    const props = formProps(field === "topic" ? { initialTopic: "unknown" } : {});
    render(page(props));
    const u = await fill();
    if (field !== "topic") await u.clear(screen.getByRole("textbox", { name: new RegExp(`${field.toUpperCase()}LABEL`) }));
    await u.click(submit());
    expect(props.onSubmit).not.toHaveBeenCalled();
    const control = field === "topic" ? screen.getByRole("button", { name: /TOPICLABEL/ }) : screen.getByRole("textbox", { name: new RegExp(`${field.toUpperCase()}LABEL`) });
    expect(control).toHaveFocus();
    expect(screen.getByText(`${field.toUpperCase()}REQUIRED-SENTINEL`, { selector: "a" })).toHaveAttribute("href", `#${control.id}`);
  });
  it("refuses a malformed email before calling the handler", async () => {
    const props = formProps();
    render(page(props));
    const u = await fill();
    await u.clear(screen.getByRole("textbox", { name: /EMAILLABEL/ }));
    await u.type(screen.getByRole("textbox", { name: /EMAILLABEL/ }), "malformed");
    await u.click(submit());
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("EMAILINVALID-SENTINEL", { selector: "a" })).toBeInTheDocument();
  });
  it("uses caller copy only and has no frame landmarks or heading of its own", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<web.ContactForm {...formProps()} />);
    expect(host.querySelector("main, header, footer, h1")).toBeNull();
    expect(host.textContent?.replace(/[A-Z0-9-]*SENTINEL/g, "").replace(/[^A-Za-z]/g, "")).toBe("");
  });
  it.each([
    ["empty topics", { topics: [] }, /at least one topic/],
    ["non-kebab topic", { topics: [{ id: "PRIVATE-SENTINEL", label: { id: "general" } }] }, /topics\[0\]\.id to be kebab-case/],
    ["duplicate topic", { topics: [...topics, ...topics] }, /topics\[1\]\.id to be unique/],
    ["honeypot collision", { honeypotField: "email" }, /honeypotField/],
    ["malformed honeypot", { honeypotField: "1bad" }, /honeypotField/],
    ["unknown preview", { devPreview: "PRIVATE-SENTINEL" as never }, /devPreview/],
  ] as const)("refuses %s without echoing caller data", (_label, overrides, message) => {
    const attempt = () => renderToStaticMarkup(<web.ContactForm {...formProps(overrides)} />);
    expect(attempt).toThrow(message);
    expect(attempt).not.toThrow(/PRIVATE-SENTINEL/);
  });
  it.each(keys.filter(key => key !== "heading" && key !== "description"))("refuses unresolved %s copy before submission", key => {
    const attempt = () => renderToStaticMarkup(<web.ContactForm {...formProps({ copy: { ...copy, [key]: { id: "UNRESOLVED-SENTINEL" } } })} />);
    expect(attempt).toThrow(new RegExp(`copy\\.${key}`));
    expect(attempt).not.toThrow(/UNRESOLVED-SENTINEL/);
  });
  it("refuses unresolved topic copy without echoing its id", () => {
    const attempt = () => renderToStaticMarkup(<web.ContactForm {...formProps({ topics: [{ id: "general", label: { id: "UNRESOLVED-SENTINEL" } }] })} />);
    expect(attempt).toThrow(/topics\[0\]\.label/);
    expect(attempt).not.toThrow(/UNRESOLVED-SENTINEL/);
  });
  it.each([undefined, { status: "unknown" }, "unexpected"])("maps an unknown result %s to unavailable", async result => {
    render(page(formProps({ onSubmit: (async () => result) as ContactViewProps["onSubmit"] })));
    const u = await fill();
    await u.click(submit());
    expect(await screen.findByRole("alert")).toHaveTextContent("UNAVAILABLE-SENTINEL");
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("maps a rejection to unavailable", async () => {
    render(page(formProps({ onSubmit: async () => { throw new Error("PRIVATE-SENTINEL"); } })));
    const u = await fill();
    await u.click(submit());
    expect(await screen.findByRole("alert")).toHaveTextContent("UNAVAILABLE-SENTINEL");
    expect(screen.queryByText("PRIVATE-SENTINEL")).toBeNull();
  });
  it.each(["idle", "submitting", "accepted", "invalid", "rate-limited", "unavailable"] as const)("keeps %s preview inert", async devPreview => {
    const props = formProps({ devPreview });
    const { container } = render(page(props));
    expect(document.body).toHaveFocus();
    const form = container.querySelector("form");
    if (form) {
      await fill();
      fireEvent.submit(form);
      expect(screen.queryByText("ERRORSUMMARY-SENTINEL")).toBeNull();
    }
    expect(props.onSubmit).not.toHaveBeenCalled();
  });
  it("requires a client boundary under react-server", () => {
    expect(() => ServerContactForm(formProps())).toThrow(/client component/);
    expect(execFileSync(process.execPath, ["--conditions=react-server", "--input-type=module", "-e", `
      import { ContactForm } from "@clossys/publisher/web";
      try { ContactForm({}); } catch (error) {
        if (error.reason !== "wrong-channel") throw error;
        process.stdout.write(error.reason);
      }
    `], { encoding: "utf8" })).toBe("wrong-channel");
  });
});
