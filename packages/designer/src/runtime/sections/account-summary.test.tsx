// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import type { RuntimeJson, RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";
import { specimenDataset } from "../../studio/specimen-dataset.js";
import { accountSummaryInputs, accountSummaryRenderer } from "./account-summary.js";

afterEach(cleanup);
const values = {
  heading: "Your account",
  identity: { name: "Sample Member", nameLabel: "Name", email: "member@example.com", emailLabel: "Email" },
  rows: [{ label: "Workspace", value: "Sample workspace" }],
  actions: [{ label: "Manage preferences", href: "/account/preferences" }],
};
function input(content: Readonly<Record<string, RuntimeJson>> = values): RuntimeRenderInput<ReactNode> {
  return { fill: { leaf: accountSummaryRenderer.leaf, slots: accountSummaryInputs.slots, members: [] }, selection: { leaf: accountSummaryRenderer.leaf, members: [] }, content: Object.fromEntries(Object.entries(content).map(([key, value]) => [key, { value }])) } as unknown as RuntimeRenderInput<ReactNode>;
}

describe("private own-account summary composition", () => {
  it("renders consumer identity and rows as a description list with registered avatar and links", () => {
    const { container } = render(<>{accountSummaryRenderer.render(input())}</>);
    expect(screen.getByRole("heading", { level: 2, name: values.heading })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: values.identity.name })).toBeInTheDocument();
    expect(screen.getByText(values.identity.email)).toHaveAttribute("dir", "auto");
    expect(container.querySelectorAll("dt")).toHaveLength(3);
    expect(container.querySelectorAll("dd")).toHaveLength(3);
    expect(screen.getByRole("link", { name: "Manage preferences" })).toHaveAttribute("href", "/account/preferences");
    expect(container.querySelector("section")).toHaveAttribute("data-ds-leaf", "sections.account-summary");
    expect(container.querySelector("section")).toHaveAttribute("data-designer-requires-section-frame");
    expect(container.querySelector("form,input,button")).toBeNull();
  });
  it("supports an account with identity only and a host image", () => {
    render(<>{accountSummaryRenderer.render(input({ heading: values.heading, identity: { ...values.identity, avatar: "/images/member.png" } }))}</>);
    expect(screen.getByRole("img", { name: values.identity.name })).toHaveAttribute("src", "/images/member.png");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(() => renderToStaticMarkup(<>{accountSummaryRenderer.render(input(accountSummaryRenderer.sample(specimenDataset)))}</>)).not.toThrow();
  });
  it("escapes consumer data and refuses foreign slots, members, destinations and malformed records", () => {
    const markup = renderToStaticMarkup(<>{accountSummaryRenderer.render(input({ ...values, rows: [{ label: "Note", value: "<script>unsafe</script>" }] }))}</>);
    expect(markup).toContain("&lt;script&gt;");
    expect(markup).not.toContain("<script>");
    for (const content of [
      { heading: values.heading },
      { ...values, identity: { ...values.identity, name: "" } },
      { ...values, identity: { ...values.identity, session: "Hidden" } },
      { ...values, rows: [{ label: "Workspace" }] },
      { ...values, actions: [{ label: "Unsafe", href: "javascript:alert(1)" }] },
      { ...values, actions: [{ label: "Unsafe", href: "//example.com/account" }] },
      { ...values, actions: [{ label: "Unsafe", href: "/\\example.com/account" }] },
      { ...values, actions: [{ label: "Manage", href: "/account", onPress: "noop" }] },
      { ...values, extra: "Unmapped" },
    ]) expect(() => accountSummaryRenderer.render(input(content))).toThrow(/sections.account-summary/);
    const foreign = input();
    expect(() => accountSummaryRenderer.render({ ...foreign, selection: { ...foreign.selection, leaf: "sections.record-detail" } })).toThrow(/renderer received/);
    expect(() => accountSummaryRenderer.render({ ...foreign, selection: { ...foreign.selection, members: ["mode.edit"] } })).toThrow(/member/);
  });
});
