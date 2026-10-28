// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { RuntimeJson, RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";
import { specimenDataset } from "../../studio/specimen-dataset.js";
import { errorMessageInputs, errorMessageRenderer } from "./error-message.js";

afterEach(cleanup);
const values: Record<string, RuntimeJson> = { status: "404", title: "Page not found", description: "Use the home page to continue.", actions: [{ label: "Go home", href: "/" }] };
function input(content = values, members: readonly string[] = ["kind.not-found"], sectionHost?: RuntimeRenderInput<ReactNode>["sectionHost"]): RuntimeRenderInput<ReactNode> {
  return {
    fill: { leaf: errorMessageRenderer.leaf, ...errorMessageInputs }, selection: { leaf: errorMessageRenderer.leaf, members },
    content: Object.fromEntries(Object.entries(content).map(([key, value]) => [key, { value }])), ...(sectionHost ? { sectionHost } : {}),
  } as unknown as RuntimeRenderInput<ReactNode>;
}

describe("private error-message section", () => {
  it("renders a public or admin 404 with one primary recovery link and no frame landmarks", () => {
    const { container } = render(<>{errorMessageRenderer.render(input())}</>);
    expect(screen.getByRole("heading", { level: 1, name: "404" })).toHaveAttribute("dir", "auto");
    expect(screen.getByRole("heading", { level: 2, name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go home" })).toHaveAttribute("href", "/");
    expect(container.querySelector('[data-ds-leaf="sections.error-message"]')).toHaveAttribute("data-message-kind", "not-found");
    expect(container.querySelector('[data-ds-leaf="sections.error-state"]')).toHaveAttribute("data-error-kind", "not-found");
    expect(container.querySelector("main,header,footer,html,body")).toBeNull();
  });

  it.each(["error", "global-error"])("renders %s with a consumer retry and authored reference", kind => {
    const onAction = vi.fn();
    render(<>{errorMessageRenderer.render(input({ status: "500", title: "Something went wrong", description: "Try the operation again.", reference: "Support reference: issue-12", actions: [{ label: "Retry operation", action: "retry" }] }, [`kind.${kind}`], { onAction }))}</>);
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.getByText("Support reference: issue-12")).toHaveAttribute("dir", "auto");
    fireEvent.click(screen.getByRole("button", { name: "Retry operation" }));
    expect(onAction.mock.calls).toEqual([["retry"]]);
  });

  it("renders shared sample and permits a host-authored state with no recovery control", () => {
    const markup = renderToStaticMarkup(<>{errorMessageRenderer.render(input({ ...errorMessageRenderer.sample(specimenDataset) }, ["kind.error"]))}</>);
    expect(markup).toContain("This page did not load");
    expect(markup).toContain('href="#status"');
    const { container } = render(<>{errorMessageRenderer.render(input({ status: "500", title: "Unavailable", description: "Contact support." }, ["kind.global-error"]))}</>);
    expect(container.querySelector("button,a")).toBeNull();
  });

  it.each(["status", "title", "description"])("requires nonblank %s", key => {
    const missing = { ...values }; delete missing[key];
    expect(() => errorMessageRenderer.render(input(missing))).toThrow(key);
    expect(() => errorMessageRenderer.render(input({ ...values, [key]: "" }))).toThrow(key);
  });

  it("refuses framework errors, unknown host data and unsupported selections", () => {
    expect(() => errorMessageRenderer.render(input({ ...values, error: { message: "Internal detail", digest: "internal" } }))).toThrow(/error/);
    expect(() => errorMessageRenderer.render(input({ ...values, reference: { digest: "internal" } }))).toThrow(/reference/);
    expect(() => errorMessageRenderer.render(input(values, ["kind.not-found"], { error: new Error("private") }))).toThrow(/sectionHost/);
    expect(() => errorMessageRenderer.render(input(values, ["kind.forbidden"])) ).toThrow(/member/);
    expect(() => errorMessageRenderer.render(input(values, ["kind.error", "kind.global-error"])) ).toThrow(/more than one kind/);
    expect(() => errorMessageRenderer.render(input({ ...values, actions: [{ label: "Retry", action: "retry" }] }))).toThrow(/sectionHost.onAction/);
    expect(() => errorMessageRenderer.render(input({ ...values, actions: [{ label: "Home", href: "/" }, { label: "Help", href: "/help" }] }))).toThrow(/between 1 and 1/);
  });
});
