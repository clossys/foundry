// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Banner } from "./Banner.js";
import { Banner as ServerBanner } from "./Banner.server.js";
import { ShellCopyProvider } from "./Banner.copy-context.js";
import { resolveShellCopy, SHELL_COPY_REFS, type ShellCopyResolver } from "./Banner.copy.js";

const pseudo: ShellCopyResolver = ref => ({ ref, text: `[[${ref.id}]]` });
afterEach(cleanup);
it("renders dismiss copy through the host resolver in client and server banners", () => {
  const onDismiss = vi.fn();
  const { container } = render(<ShellCopyProvider resolver={pseudo}><Banner onDismiss={onDismiss}>[[host.message]]</Banner><ServerBanner copyResolver={pseudo} onDismiss={onDismiss}>[[host.message]]</ServerBanner></ShellCopyProvider>);
  expect([...container.querySelectorAll("button")].map(node => node.getAttribute("aria-label"))).toEqual([`[[${SHELL_COPY_REFS.banner.dismiss.id}]]`, `[[${SHELL_COPY_REFS.banner.dismiss.id}]]`]);
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) expect(walker.currentNode.textContent?.trim()).toMatch(/^(?:\[\[[^\]]+\]\])+$/);
  fireEvent.click(container.querySelector("button")!); expect(onDismiss).toHaveBeenCalledTimes(1);
});
it("refuses missing, mismatched, blank and non-finite resolutions without English fallback", () => {
  expect(() => resolveShellCopy(undefined, SHELL_COPY_REFS.banner.dismiss)).toThrow(/resolver/);
  expect(() => resolveShellCopy(() => undefined, SHELL_COPY_REFS.banner.dismiss)).toThrow(/unresolved/);
  expect(() => resolveShellCopy(() => ({ ref: { id: "wrong" }, text: "Wrong" }), SHELL_COPY_REFS.banner.dismiss)).toThrow(/unresolved/);
  expect(() => resolveShellCopy(ref => ({ ref, text: " " }), SHELL_COPY_REFS.banner.dismiss)).toThrow(/unresolved/);
  expect(() => resolveShellCopy(pseudo, SHELL_COPY_REFS.commands.results, { count: Infinity })).toThrow(/values/);
});
