// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ShellCopyProvider } from "../components/Banner.copy-context.js";
import { AppNavigation } from "./AppNavigation.js";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("binds navigation, empty and disclosure wording without formatting English in Designer", () => {
  vi.stubGlobal("matchMedia", (media: string) => ({ media, matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("CSS", { escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, character => `\\${character}`) });
  const resolver = vi.fn(ref => ({ ref, text: `[[${ref.id}]]` }));
  const view = render(<ShellCopyProvider resolver={resolver}><AppNavigation tree={[]} /></ShellCopyProvider>);
  expect(view.getByRole("navigation").getAttribute("aria-label")).toBe("[[st.jecfnpr6a1]]");
  const walker = document.createTreeWalker(view.container, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) if (walker.currentNode.textContent?.trim()) expect(walker.currentNode.textContent).toMatch(/^(?:\[\[[^\]]+\]\])+$/);
  expect(resolver).toHaveBeenCalledWith(expect.objectContaining({ id: "st.sqsqn2s9v0" }));
  view.rerender(<ShellCopyProvider resolver={resolver}><AppNavigation tree={[{ id: "group", label: "[[host.group]]", children: [{ id: "page", label: "[[host.page]]", href: "/page" }] }]} /></ShellCopyProvider>);
  fireEvent.click(view.getByRole("button", { name: "[[st.e85mfcrpb6]]" }));
  expect(resolver).toHaveBeenCalledWith(expect.objectContaining({ id: "st.g7hbg5n2bs", values: { name: "[[host.group]]" } }));
});
