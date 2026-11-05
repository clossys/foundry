// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";
import { specimenDataset } from "../../studio/specimen-dataset.js";
import { authShellRenderer } from "./auth-shell.js";

afterEach(cleanup);

function input(options: { content?: Record<string, unknown>; members?: string[]; main?: ReactNode[]; slots?: Record<string, ReactNode[]> } = {}): RuntimeRenderInput<ReactNode> {
  const values = options.content ?? authShellRenderer.sample(specimenDataset);
  return {
    fill: { leaf: "frames.auth-shell" },
    selection: { leaf: "frames.auth-shell", members: options.members ?? [] },
    content: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value }])),
    slots: options.slots ?? { main: options.main ?? [<section key="body"><h1>Check your account</h1></section>] },
  } as unknown as RuntimeRenderInput<ReactNode>;
}

describe("frames.auth-shell renderer", () => {
  it("draws the real frame using host main content and shared specimen copy", () => {
    render(<>{authShellRenderer.render(input())}</>);
    expect(screen.getByRole("main")).toContainElement(screen.getByRole("heading", { name: "Check your account" }));
    expect(screen.getByRole("link", { name: specimenDataset.frames.app.skipLabel })).toHaveAttribute("href", "#main-content");
    expect(authShellRenderer.sample(specimenDataset)).toEqual({ "skip-link": specimenDataset.frames.app.skipLabel });
  });

  it("refuses missing main content, blank skip copy and unsupported inputs", () => {
    expect(() => authShellRenderer.render(input({ main: [] }))).toThrow(/main slot is required/);
    expect(() => authShellRenderer.render(input({ content: {} }))).toThrow(/skip-link/);
    expect(() => authShellRenderer.render(input({ content: { "skip-link": " " } }))).toThrow(/skip-link/);
    expect(() => authShellRenderer.render(input({ content: { "skip-link": "Skip", header: "Other" } }))).toThrow(/header content/);
    expect(() => authShellRenderer.render(input({ members: ["chrome.full"] }))).toThrow(/members/);
    expect(() => authShellRenderer.render(input({ slots: { main: ["Body"], sidebar: ["Other"] } }))).toThrow(/sidebar slot/);
  });
});
