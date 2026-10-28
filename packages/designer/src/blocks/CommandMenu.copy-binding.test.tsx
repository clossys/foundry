// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ShellCopyProvider } from "../components/Banner.copy-context.js";
import { CommandMenu } from "./CommandMenu.js";

afterEach(cleanup);
it("passes the numeric result count to Writer and renders only resolved host copy", () => {
  const resolver = vi.fn(ref => ({ ref, text: `[[${ref.id}]]` }));
  render(<ShellCopyProvider resolver={resolver}><CommandMenu isOpen onOpenChange={() => {}} query="" onQueryChange={() => {}} groups={[]} heading="[[host.heading]]" searchLabel="[[host.search]]" closeLabel="[[host.close]]" emptyMessage="[[host.empty]]" /></ShellCopyProvider>);
  expect(resolver).toHaveBeenCalledWith(expect.objectContaining({ id: "st.s079k1p1qj", values: { count: 0 } }));
  const walker = document.createTreeWalker(document.querySelector('[role="dialog"]')!, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) if (walker.currentNode.textContent?.trim()) expect(walker.currentNode.textContent).toMatch(/^(?:\[\[[^\]]+\]\])+$/);
});
