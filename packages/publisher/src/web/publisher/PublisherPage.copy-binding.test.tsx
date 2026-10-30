// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { AppFrame } from "@clossys/designer/frames";
import { PublisherPage } from "./PublisherPage.js";
import { PUBLISHER_COPY_REFS, publisherCopy, type PublisherCopyResolver } from "./copy.js";
import { FIXTURE_BREAKPOINTS, FIXTURE_INSTANCE_LIBRARY, FIXTURE_INSTANCE_REGISTRIES } from "../instances/__fixtures__/standard-instances.js";
import { installFrameTestEnvironment } from "./__fixtures__/frame-test-environment.js";

const pseudo: PublisherCopyResolver = ref => ({ ref, text: `[[${ref.id}]]` });
afterEach(cleanup);
it("renders the empty Publisher page and leased header using only resolved Writer words", () => {
  installFrameTestEnvironment();
  const view = render(<AppFrame brand={{ markSrc: "/mark.svg" }}
    navigation={{ tree: [], label: "[[host.navigation]]", emptyMessage: "[[host.no-pages]]", openLabel: "[[host.open-nav]]", closeLabel: "[[host.close-nav]]" }}
    account={{ signedOutLabel: "[[host.account]]", sections: [] }} themeControl={null}
    commands={{ heading: "[[host.commands]]", searchLabel: "[[host.search]]", closeLabel: "[[host.close]]", emptyMessage: "[[host.empty]]", triggerLabel: "[[host.trigger]]", groups: [], shortcutEnabled: false }}
    skipLabel="[[host.skip]]" breadcrumbLabel="[[host.breadcrumb]]" collapsedBreadcrumbLabel="[[host.earlier]]" pageInfoLabel="[[host.info]]" pageActionsLabel="[[host.actions]]">
    <PublisherPage copyResolver={pseudo} instances={[]} library={FIXTURE_INSTANCE_LIBRARY} registries={FIXTURE_INSTANCE_REGISTRIES} breakpointValues={FIXTURE_BREAKPOINTS} designerHref="/designer" />
  </AppFrame>);
  const walker = document.createTreeWalker(view.container, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) if (walker.currentNode.textContent?.trim()) expect(walker.currentNode.textContent).toMatch(/^(?:\[\[[^\]]+\]\])+$/);
  expect(view.container.textContent).toContain("[[st.pee5f35tpk]]");
});
it("uses only the packet's 32 existing draft references and does not activate them", () => {
  const packet = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../../../writer/src/catalog/records/admin-voice.r1.en.json"), "utf8"));
  const refs = Object.values(PUBLISHER_COPY_REFS);
  expect(new Set(refs.map(ref => ref.id)).size).toBe(32);
  for (const ref of refs) expect(packet.records.find((record: { id: string }) => record.id === ref.id)).toMatchObject({ status: "draft" });
  expect(packet.activation).toBe("none");
  expect(() => publisherCopy(undefined, PUBLISHER_COPY_REFS.title)).toThrow(/resolver/);
  expect(() => publisherCopy(() => undefined, PUBLISHER_COPY_REFS.title)).toThrow(/unresolved/);
});
