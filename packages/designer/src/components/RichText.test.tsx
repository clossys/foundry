import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { Editor } from "@tiptap/react";
import { RichText } from "./RichText.js";
import { richTextDocument, richTextExtensions } from "./rich-text/schema.js";
import { loadCatalogBundles } from "../catalog-bundles.js";
import { loadComponentRegistry } from "../catalog-core/component-registry.js";

afterEach(cleanup);

describe("RichText document specimens", () => {
  it("renders Markdown headings, marks, lists, code and navigation during SSR", () => {
    const html = renderToStaticMarkup(<RichText readOnly value={'# Strategy\n\nA **clear** [promise](https://example.com).\n\n- First\n- Second\n\n`inline`\n\n```ts\nconst ready = true\n```'} />);
    expect(html).toMatch(/<h1\b[^>]*>Strategy<\/h1>/);
    expect(html).toContain("<strong>clear</strong>");
    expect(html).toContain('href="https://example.com"');
    expect(html).toMatch(/<ul\b/);
    expect(html).toContain('data-slot="rich-text-code"');
    expect(html).toContain("const ready = true");
    expect(html).not.toMatch(/contenteditable|role="textbox"|<button|<textarea|<input/i);
    expect(html).toContain('data-ds-leaf="components.rich-text"');
  });

  it("renders JSON callouts and badges with the same schema and keeps every element in its leaf", () => {
    const value = { type: "doc", content: [{ type: "callout", content: [{ type: "paragraph", content: [{ type: "text", text: "Draft", marks: [{ type: "badge" }] }] }] }] };
    const { container } = render(<RichText value={value} readOnly aria-label="Strategy passage" />);
    expect(container.querySelector('[data-slot="rich-text-callout"]')).toHaveTextContent("Draft");
    expect(container.querySelector('[data-slot="rich-text-badge"]')).toHaveTextContent("Draft");
    for (const element of container.querySelectorAll("*")) expect(element.closest("[data-ds-leaf]")).not.toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("composes a named Designer table for Markdown tables", async () => {
    const { rerender } = render(<RichText value={'| Goal | State |\n| --- | --- |\n| Read | Ready |'} readOnly />);
    expect(await screen.findByRole("table", { name: "Document table" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Goal" })).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).toBeNull();
    rerender(<RichText readOnly value={{ type: "doc", content: [{ type: "table", content: [
      { type: "tableRow", content: [{ type: "tableHeader", attrs: { colspan: 2 }, content: [{ type: "paragraph", content: [{ type: "text", text: "Merged heading" }] }] }] },
      { type: "tableRow", content: [{ type: "tableCell", attrs: { rowspan: 2 }, content: [{ type: "paragraph", content: [{ type: "text", text: "Spanning value" }] }] }, { type: "tableCell", content: [{ type: "paragraph" }] }] },
      { type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph" }] }] },
    ] }] }} />);
    expect(screen.getByRole("columnheader", { name: "Merged heading" })).toHaveAttribute("colspan", "2");
    expect(screen.getByRole("cell", { name: "Spanning value" })).toHaveAttribute("rowspan", "2");
  });

  it("escapes content and refuses active URI schemes supplied through JSON", () => {
    const html = renderToStaticMarkup(<RichText value={{ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "<script>unsafe</script>", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] }] }} />);
    expect(html).toContain("&lt;script&gt;unsafe&lt;/script&gt;");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<script>");
  });

  it("updates controlled read-only values without firing change callbacks or creating an editor", () => {
    const onChange = vi.fn();
    const { rerender, container } = render(<RichText value="Before" readOnly onChange={onChange} />);
    rerender(<RichText value="**After**" readOnly onChange={onChange} />);
    expect(container.querySelector("strong")).toHaveTextContent("After");
    expect(container.querySelector("[contenteditable]")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("renders its built Markdown/JSON component in Node without a browser DOM", () => {
    const script = `import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import {RichText} from './dist/components/RichText.js'; console.log(renderToStaticMarkup(React.createElement(RichText,{readOnly:true,value:'# Server document'}))); console.log(renderToStaticMarkup(React.createElement(RichText,{readOnly:true,value:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'JSON passage'}]}]}})));`;
    const html = execFileSync(process.execPath, ["--input-type=module", "-e", script], { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    expect(html).toMatch(/<h1\b[^>]*>Server document<\/h1>/);
    expect(html).toContain("JSON passage");
    expect(html).not.toMatch(/contenteditable|role="textbox"/);
  });

  it("uses the real editable engine and returns JSON while synchronizing external changes silently", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<RichText value="# Before" readOnly={false} onChange={onChange} aria-label="Draft passage" />);
    const textbox = await screen.findByRole("textbox", { name: "Draft passage" });
    expect(textbox).toHaveAttribute("contenteditable", "true");
    expect(screen.getByRole("heading", { level: 1, name: "Before" })).toHaveClass("text-h1");
    rerender(<RichText value="After" readOnly={false} onChange={onChange} aria-label="Draft passage" />);
    await waitFor(() => expect(textbox).toHaveTextContent("After"));
    expect(onChange).not.toHaveBeenCalled();
    textbox.querySelector("p")!.textContent = "Edited";
    fireEvent.input(textbox);
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.lastCall?.[0]).toMatchObject({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Edited" }] }] });
  });

  it("retains ProseMirror editing transactions and read-only transaction gating", () => {
    const editor = new Editor({ extensions: richTextExtensions, content: richTextDocument("Hello"), editable: true });
    try {
      expect(editor.commands.insertContentAt(6, " world")).toBe(true);
      expect(editor.getText()).toBe("Hello world");
      editor.setEditable(false);
      expect(editor.isEditable).toBe(false);
      expect(editor.view.dom).toHaveAttribute("contenteditable", "false");
    } finally { editor.destroy(); }
  });

  it("renders editable marks and nodes through Designer document parts", async () => {
    const value = { type: "doc", content: [
      { type: "paragraph", content: [
        { type: "text", text: "Reference", marks: [{ type: "link", attrs: { href: "https://example.com" } }] },
        { type: "text", text: "Snippet", marks: [{ type: "code" }] },
        { type: "text", text: "Draft", marks: [{ type: "badge" }] },
      ] },
      { type: "codeBlock", content: [{ type: "text", text: "const ready = true" }] },
      { type: "callout", content: [{ type: "paragraph", content: [{ type: "text", text: "Note" }] }] },
      ...richTextDocument('| Goal | State |\n| --- | --- |\n| Read | Ready |').content!,
    ] };
    const onChange = vi.fn();
    const { container } = render(<RichText value={value} readOnly={false} onChange={onChange} aria-label="Rich draft" />);
    await screen.findByRole("textbox", { name: "Rich draft" });
    await waitFor(() => expect(container.querySelector('[data-slot="rich-text-badge"]')).toHaveTextContent("Draft"));
    expect(container.querySelector('[data-slot="rich-text-link"]')).toHaveAttribute("href", "https://example.com");
    expect(container.querySelectorAll('[data-slot="rich-text-code"]')).toHaveLength(2);
    expect(container.querySelector('[data-slot="rich-text-callout"]')).toHaveTextContent("Note");
    const table = screen.getByRole("table", { name: "Document table" });
    expect(table).toHaveAttribute("data-slot", "rich-text-table");
    expect(table.querySelector("tbody > tr > th")).toHaveTextContent("Goal");
    const paragraph = container.querySelector('[data-slot="rich-text-callout"] p')!;
    paragraph.textContent = "Edited note";
    fireEvent.input(paragraph);
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(JSON.stringify(onChange.mock.lastCall?.[0])).toContain("Edited note");
  });

  it("ships CSS for the prose classes actually rendered, with token-bound heading sizes", () => {
    const { container } = render(<RichText value={'# Heading\n\nParagraph\n\n> Quote\n\n- Item\n\n1. Ordered\n\n```ts\nconst ready = true\n```\n\n---'} />);
    const css = readFileSync(resolve(process.cwd(), "styles/compiled.css"), "utf8");
    for (const element of container.querySelectorAll("*")) for (const name of element.classList) {
      const selector = "." + name.replace(/[^a-zA-Z0-9_-]/g, character => "\\" + character);
      expect(css, `rendered prose class ${name}`).toContain(selector);
    }
    expect(screen.getByRole("heading", { level: 1 })).toHaveClass("text-h1");
    expect(css).toContain("var(--text-h1");
  });

  it("registers one selectable package candidate and records the per-component Aria gap", () => {
    expect(loadComponentRegistry().slots.find(slot => slot.id === "components.rich-text")).toBeDefined();
    const candidates = loadCatalogBundles().componentFills.filter(doc => Object.values(doc.components)[0]?.slot === "components.rich-text");
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.$extensions["com.clossys.fill"].source).toBe("shadcn@aria");
    expect(Object.values(candidates[0]!.components)[0]?.impl).toEqual({ kind: "package", module: "@clossys/designer/components", export: "RichText" });
  });
});
