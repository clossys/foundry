// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ShellCopyProvider } from "../components/Banner.copy-context.js";
import { ThemeToggle } from "./ThemeToggle.js";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("resolves option names, group names and the change announcement through the host", () => {
  const resolver = vi.fn(ref => ({ ref, text: `[[${ref.id}]]` }));
  const view = render(<ShellCopyProvider resolver={resolver}><ThemeToggle preference="system" onPreferenceChange={() => {}} /></ShellCopyProvider>);
  fireEvent.click(view.getAllByRole("radio")[1]!);
  expect(resolver).toHaveBeenCalledWith(expect.objectContaining({ id: "st.ghrssyygxh", values: { theme: "[[st.3gsnmmts41]]" } }));
  for (const node of view.container.querySelectorAll("[aria-label]")) expect(node.getAttribute("aria-label")).toMatch(/^\[\[st\./);
  const walker = document.createTreeWalker(view.container, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) if (walker.currentNode.textContent?.trim()) expect(walker.currentNode.textContent).toMatch(/^(?:\[\[[^\]]+\]\])+$/);
});
