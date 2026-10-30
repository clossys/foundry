// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AppFrame } from "./AppFrame.js";
import { SHELL_COPY_REFS, type ShellCopyRef, type ShellCopyResolver } from "../components/Banner.copy.js";
import { SlotModule } from "../shell/index.js";

const pseudo: ShellCopyResolver = ref => ({ ref, text: `[[${ref.id}]]` });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function assertWrapped(root: Element) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) if (walker.currentNode.textContent?.trim()) expect(walker.currentNode.textContent).toMatch(/^(?:\[\[[^\]]+\]\])+$/);
}
it("renders AppFrame and FrameDock chrome with only pseudo-resolved words", () => {
  vi.stubGlobal("matchMedia", (media: string) => ({ media, matches: media !== "not all", addEventListener() {}, removeEventListener() {} }));
  const view = render(<AppFrame copyResolver={pseudo} brand={{ markSrc: "/mark.svg" }}
    navigation={{ tree: [] }} account={{ signedOutLabel: "[[host.account]]", sections: [] }}
    commands={{ heading: "[[host.commands]]", searchLabel: "[[host.search]]", closeLabel: "[[host.close]]", emptyMessage: "[[host.empty]]", triggerLabel: "[[host.trigger]]", groups: [] }}
    rightPanel={{ label: "[[host.panel]]", handleLabel: "[[host.resize]]", min: 100, max: 300, defaultValue: 200, children: <p>[[host.details]]</p> }}>
    <p>[[host.main]]</p><SlotModule slot="dock-tab" id="tools" label="[[host.tools]]"><p>[[host.tool-content]]</p></SlotModule>
  </AppFrame>);
  assertWrapped(view.container);
  expect(view.getByRole("link", { name: "[[st.z4jcxtzczb]]" })).toBeTruthy();
  const dock = view.container.querySelector('[data-application-frame-region="dock"]')!;
  fireEvent.click(within(dock as HTMLElement).getByRole("button", { name: "[[st.a2bvn2ep38]]" }));
  assertWrapped(view.container);
  expect(within(dock as HTMLElement).getByRole("button", { name: "[[st.322g37gnhz]]" })).toBeTruthy();
});
it("binds exactly the packet's 25 existing records without importing Writer at runtime or changing draft state", () => {
  const packet = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../../writer/src/catalog/records/admin-voice.r1.en.json"), "utf8"));
  const refs = Object.values(SHELL_COPY_REFS).flatMap(group => Object.values(group)) as ShellCopyRef[];
  expect(new Set(refs.map(ref => ref.id)).size).toBe(25);
  for (const ref of refs) expect(packet.records.find((record: { id: string }) => record.id === ref.id)).toMatchObject({ status: "draft" });
  expect(packet.activation).toBe("none");
});
