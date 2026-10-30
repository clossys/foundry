// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import type { RuntimeJson, RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";
import { specimenDataset } from "../../studio/specimen-dataset.js";
import { legalProseInputs, legalProseRenderer } from "./legal-prose.js";
import { surfaceRuntimeCallbacks, surfaceRendererId } from "../index.js";

afterEach(cleanup);
const values = {
  heading: "Privacy",
  revision: { label: "Last revised", value: "15 January 2026" },
  body: [{ kind: "paragraph", text: "Host-authored introduction." }, { kind: "heading", text: "Your information" }, { kind: "list", items: ["First item", "Second item"] }],
};
function input(content: Readonly<Record<string, RuntimeJson>> = values): RuntimeRenderInput<ReactNode> {
  return { fill: { leaf: legalProseRenderer.leaf, slots: legalProseInputs.slots, members: [] }, selection: { leaf: legalProseRenderer.leaf, members: [] }, content: Object.fromEntries(Object.entries(content).map(([key, value]) => [key, { value }])) } as unknown as RuntimeRenderInput<ReactNode>;
}

describe("legal prose runtime binding", () => {
  it("renders host headings, revision copy and structured prose through existing blocks", () => {
    const { container } = render(<>{legalProseRenderer.render(input())}</>);
    expect(screen.getByRole("heading", { level: 2, name: "Privacy" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Your information" })).toHaveAttribute("dir", "auto");
    expect(screen.getByText("Last revised")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(container.querySelector('[data-ds-leaf="sections.legal-prose"]')).toHaveAttribute("data-designer-requires-section-frame");
    expect(container.querySelector("article")).toHaveAttribute("data-ds-leaf", "sections.article");
  });
  it("renders an authored revision date as native time through the public block", () => {
    const renderRegistered = surfaceRuntimeCallbacks(["sections.legal-prose"])[surfaceRendererId("sections.legal-prose")]!;
    expect(renderRegistered).toBe(legalProseRenderer.render);
    const { container } = render(<>{renderRegistered(input({ ...values, revision: { ...values.revision, dateTime: "2026-01-15" } }))}</>);
    expect(container.querySelector("time")).toHaveAttribute("dateTime", "2026-01-15");
    expect(container.querySelector("time")).toHaveTextContent("15 January 2026");
    expect(container.querySelectorAll("article")).toHaveLength(1);
  });
  it("preserves revision display copy without inferring a date", () => {
    const { container } = render(<>{legalProseRenderer.render(input())}</>);
    expect(container.querySelector("time")).toBeNull();
    expect(container).toHaveTextContent("Last revised 15 January 2026");
  });
  it("rejects malformed authored revision dates", () => {
    for (const dateTime of ["", "15 January 2026", "2026-02-30", 20260115]) {
      expect(() => renderToStaticMarkup(<>{legalProseRenderer.render(input({ ...values, revision: { ...values.revision, dateTime } }))}</>)).toThrow(/revision.dateTime/);
    }
  });
  it("supports a short host placeholder and deterministic specimen content without a revision", () => {
    render(<>{legalProseRenderer.render(input({ heading: "Terms", body: [{ kind: "paragraph", text: "Terms will be provided here." }] }))}</>);
    expect(screen.getByText("Terms will be provided here.")).toBeInTheDocument();
    expect(legalProseRenderer.sample(specimenDataset)).toEqual(legalProseRenderer.sample(specimenDataset));
    expect(() => renderToStaticMarkup(<>{legalProseRenderer.render(input(legalProseRenderer.sample(specimenDataset)))}</>)).not.toThrow();
  });
  it("escapes authored markup and refuses unsafe, malformed or undeclared content", () => {
    const markup = renderToStaticMarkup(<>{legalProseRenderer.render(input({ heading: "Privacy", body: [{ kind: "paragraph", text: "<script>alert(1)</script>" }] }))}</>);
    expect(markup).toContain("&lt;script&gt;");
    expect(markup).not.toContain("<script>");
    for (const content of [
      { ...values, body: [{ kind: "html", html: "<p>Unsafe</p>" }] },
      { ...values, body: [{ kind: "paragraph", text: "Text", html: "<p>Extra</p>" }] },
      { ...values, body: [] },
      { ...values, revision: { value: "Draft" } },
      { body: values.body },
      { ...values, extra: "Unmapped" },
    ]) expect(() => legalProseRenderer.render(input(content))).toThrow(/sections.legal-prose/);
    const foreign = input();
    expect(() => legalProseRenderer.render({ ...foreign, selection: { ...foreign.selection, leaf: "sections.article" } })).toThrow(/renderer received/);
    expect(() => legalProseRenderer.render({ ...foreign, selection: { ...foreign.selection, members: ["layout.split"] } })).toThrow(/member/);
  });
});
