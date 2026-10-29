// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import * as blocks from "./index.js";
import * as serverBlocks from "./server.js";
import { SemanticContent } from "../components/SemanticContent.js";

afterEach(cleanup);
const fill = () => JSON.parse(readFileSync(new URL("../catalog/fills/foundry/sections.legal-prose.json", import.meta.url), "utf8"));

it("binds legal-prose to its own public block rather than the general content section", () => {
  const source = fill(), meta = source.$extensions["com.clossys.fill"], legal = source.sections["legal-prose"];
  expect(meta.pin.export).toBe("./blocks#LegalProse");
  expect(meta.sourceAddress).toBe("./blocks#LegalProse");
  expect(legal.impl).toEqual({ kind: "package", module: "@clossys/designer/blocks", export: "LegalProse" });
  expect(legal.slotMap).toEqual({ heading: "./blocks#LegalProse.heading", revision: "./blocks#LegalProse.revision", body: "./blocks#LegalProse.children" });
  expect("LegalProse" in blocks).toBe(true);
  expect("LegalProse" in serverBlocks).toBe(true);
});

it("renders the authored revision as machine-readable time and keeps rich prose semantic", async () => {
  const { LegalProse } = await import("./LegalProse.js");
  const { container } = render(<LegalProse heading="Sample privacy" revision={{ label: "Sample revision", value: "15 January 2026", dateTime: "2026-01-15" }}>
    <SemanticContent as="p">Sample paragraph with <SemanticContent as="strong">authored emphasis</SemanticContent>.</SemanticContent>
    <SemanticContent as="h3">Sample details</SemanticContent>
    <SemanticContent as="ul"><SemanticContent as="li">Sample item.</SemanticContent></SemanticContent>
  </LegalProse>);
  expect(screen.getByRole("heading", { level: 2, name: "Sample privacy" })).toBeInTheDocument();
  expect(container.querySelector("time")).toHaveAttribute("dateTime", "2026-01-15");
  expect(container.querySelector("time")).toHaveTextContent("15 January 2026");
  expect(container.querySelector('[data-ds-leaf="sections.legal-prose"]')).toHaveAttribute("data-ds-fill", "foundry/sections.legal-prose");
  expect(container.querySelector("article strong")).toHaveTextContent("authored emphasis");
  expect(container.querySelectorAll("li")).toHaveLength(1);
});

it("requires an actual calendar date without inferring one from display copy", async () => {
  const { LegalProse } = await import("./LegalProse.js");
  for (const dateTime of ["", "15 January 2026", "2026-02-30", "2026-13-01"]) {
    expect(() => render(<LegalProse heading="Sample terms" revision={{ label: "Revision", value: "Host text", dateTime }}>Sample body</LegalProse>)).toThrow(/revision.dateTime/);
  }
  const { container } = render(<LegalProse heading="Sample about">Sample body</LegalProse>);
  expect(container.querySelector("time")).toBeNull();
  expect(container.textContent).toBe("Sample aboutSample body");
});
