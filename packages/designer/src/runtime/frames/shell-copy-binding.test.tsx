// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { ShellCopyProvider } from "../../components/Banner.copy-context.js";
import { renderAppShell } from "./app-shell.js";
import { DocumentFrame } from "./document.js";
import type { RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";
import type { ReactNode } from "react";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("inherits the host resolver through the existing app-shell runtime boundary", () => {
  vi.stubGlobal("matchMedia", (media: string) => ({ media, matches: true, addEventListener() {}, removeEventListener() {} }));
  const content = {
    sidebar: { brand: { markSrc: "/mark.svg" }, tree: [], account: { signedOutLabel: "[[host.account]]", sections: [] } },
    command: { heading: "[[host.commands]]", searchLabel: "[[host.search]]", closeLabel: "[[host.close]]", emptyMessage: "[[host.empty]]", triggerLabel: "[[host.trigger]]", groups: [] },
  };
  const input = { path: "frame", fill: { leaf: "frames.app-shell" }, selection: { leaf: "frames.app-shell", fill: "foundry/frames.app-shell", members: [], config: null, content: {} },
    content: Object.fromEntries(Object.entries(content).map(([key, value]) => [key, { value, reference: { kind: "region", ref: key }, hash: "sha256:0" }])), slots: { main: [<p key="main">[[host.main]]</p>] }, cell: { theme: "light", state: "default", width: 1280 }, profile: {}, locale: "en" } as unknown as RuntimeRenderInput<ReactNode>;
  const view = render(<ShellCopyProvider resolver={ref => ({ ref, text: `[[${ref.id}]]` })}>{renderAppShell(input)}</ShellCopyProvider>);
  const walker = document.createTreeWalker(view.container, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) if (walker.currentNode.textContent?.trim()) expect(walker.currentNode.textContent).toMatch(/^(?:\[\[[^\]]+\]\])+$/);
});
it("keeps document title and body entirely host-resolved rather than inventing a title record", () => {
  const html = renderToStaticMarkup(<DocumentFrame lang="en" dir="ltr" variant="page" title="[[host.title]]"><main>[[host.body]]</main></DocumentFrame>);
  const document = new DOMParser().parseFromString(html, "text/html");
  expect(document.title).toBe("[[host.title]]");
  expect(document.body.textContent).toBe("[[host.body]]");
});
