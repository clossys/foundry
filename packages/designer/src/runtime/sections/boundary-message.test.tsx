// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { RuntimeJson, RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";
import { specimenDataset } from "../../studio/specimen-dataset.js";
import { boundaryMessageInputs, boundaryMessageRenderer } from "./boundary-message.js";

afterEach(cleanup);
const values: Record<string, RuntimeJson> = { status: "Access paused", title: "Sign-in is unavailable", description: "Contact your administrator.", actions: [{ label: "Contact support", href: "/help" }], notes: "Reference: session paused." };
function input(content = values, members: readonly string[] = ["kind.sign-in-unavailable"], sectionHost?: RuntimeRenderInput<ReactNode>["sectionHost"]): RuntimeRenderInput<ReactNode> {
  return {
    fill: { leaf: boundaryMessageRenderer.leaf, ...boundaryMessageInputs }, selection: { leaf: boundaryMessageRenderer.leaf, members },
    content: Object.fromEntries(Object.entries(content).map(([key, value]) => [key, { value }])), ...(sectionHost ? { sectionHost } : {}),
  } as unknown as RuntimeRenderInput<ReactNode>;
}

describe("private boundary-message section", () => {
  it.each(["sign-in-unavailable", "not-authorized", "service-unavailable"])("renders host-authored %s content inside an existing frame", kind => {
    const { container } = render(<>{boundaryMessageRenderer.render(input(values, [`kind.${kind}`]))}</>);
    expect(screen.getByRole("heading", { level: 1, name: "Access paused" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Sign-in is unavailable" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Contact support" })).toHaveAttribute("href", "/help");
    expect(screen.getByText("Reference: session paused.")).toHaveAttribute("dir", "auto");
    expect(container.querySelector('[data-ds-leaf="sections.boundary-message"]')).toHaveAttribute("data-boundary-kind", kind);
    expect(container.querySelector('[data-ds-leaf="sections.empty-state"]')).not.toBeNull();
    expect(container.querySelector("main,header,footer,html,body")).toBeNull();
    expect(container.querySelector("form")).toBeNull();
  });

  it("dispatches confirm and cancel by id only when pressed, and reflects host pending state", () => {
    const onAction = vi.fn();
    const confirmation = { status: "Sign out?", title: "End this session", description: "You can sign in again later.", actions: [{ label: "Confirm sign out", action: "confirm-sign-out" }, { label: "Keep working", action: "cancel-sign-out" }] };
    const { rerender } = render(<>{boundaryMessageRenderer.render(input(confirmation, ["kind.sign-out-confirm"], { onAction }))}</>);
    expect(onAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm sign out" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep working" }));
    expect(onAction.mock.calls).toEqual([["confirm-sign-out"], ["cancel-sign-out"]]);
    rerender(<>{boundaryMessageRenderer.render(input(confirmation, ["kind.sign-out-confirm"], { onAction, pending: true }))}</>);
    expect(screen.getByRole("button", { name: "Confirm sign out" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Keep working" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm sign out" }));
    expect(onAction).toHaveBeenCalledTimes(2);
  });

  it("has no invented action or notes and renders shared dataset sample without live commands", () => {
    const { container } = render(<>{boundaryMessageRenderer.render(input({ status: "403", title: "Access denied", description: "Ask your administrator." }))}</>);
    expect(container.querySelector("a,button")).toBeNull();
    expect(container.textContent).toBe("403Access deniedAsk your administrator.");
    expect(renderToStaticMarkup(<>{boundaryMessageRenderer.render(input({ ...boundaryMessageRenderer.sample(specimenDataset) }))}</>)).toContain("Check service status");
  });

  it.each(["status", "title", "description"])("refuses missing or blank %s copy", key => {
    const missing = { ...values }; delete missing[key];
    expect(() => boundaryMessageRenderer.render(input(missing))).toThrow(key);
    expect(() => boundaryMessageRenderer.render(input({ ...values, [key]: " " }))).toThrow(key);
  });

  it("refuses unsupported or conflicting kinds, foreign leaves, unmapped slots and unbound actions", () => {
    expect(() => boundaryMessageRenderer.render(input(values, ["kind.signed-up"])) ).toThrow(/member/);
    expect(() => boundaryMessageRenderer.render(input(values, ["kind.not-authorized", "kind.service-unavailable"])) ).toThrow(/more than one kind/);
    const foreign = input();
    expect(() => boundaryMessageRenderer.render({ ...foreign, selection: { ...foreign.selection, leaf: "sections.error-message" } })).toThrow(/renderer received/);
    expect(() => boundaryMessageRenderer.render(input({ ...values, password: "not a field" }))).toThrow(/password/);
    expect(() => boundaryMessageRenderer.render(input({ ...values, actions: [{ label: "Confirm", action: "confirm" }] }))).toThrow(/sectionHost.onAction/);
    expect(() => boundaryMessageRenderer.render(input(values, ["kind.sign-out-confirm"])) ).toThrow(/confirm and cancel/);
  });

  it.each([
    { actions: [{ href: "/help" }] },
    { actions: [{ label: "Help", href: "/help", action: "help" }] },
    { actions: [{ label: "Help", href: "/help", onPress: "unsafe" }] },
    { actions: [{ label: "Help", href: "/help" }, { label: "Next", href: "/next" }, { label: "Extra", href: "/extra" }] },
    { actions: [] },
  ])("refuses malformed actions $actions", ({ actions }) => {
    expect(() => boundaryMessageRenderer.render(input({ ...values, actions }))).toThrow();
  });
});
