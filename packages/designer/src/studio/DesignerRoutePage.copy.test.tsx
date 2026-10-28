// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DesignerRoutePage } from "./DesignerRoutePage.js";
import type { DesignerRoutePageProps } from "./route-data.js";
import { StudioCopyProvider } from "./copy-context.js";
import { readStudioCopy, readStudioMessage, StudioCopyNeedsError, type StudioCopyBinding } from "./copy-binding.js";

afterEach(cleanup);
const copy: StudioCopyBinding = {
  locale: "ar",
  resolver: ref => ({ ref, text: `[[${ref.id}]]`, servedLocale: "ar", chain: ["ar"] }),
};
const serverData = {} as DesignerRoutePageProps["serverData"];
const wrapped = /^\[\[st\.[0123456789abcdefghjkmnpqrstvwxyz]{10}\]\]$/;

function assertWrapped(container: HTMLElement) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const text: string[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) if (node.textContent?.trim()) text.push(node.textContent.trim());
  expect(text.length).toBeGreaterThan(0);
  for (const value of text) expect(value).toMatch(wrapped);
  for (const element of container.querySelectorAll("[aria-label],[title],[placeholder]")) {
    for (const attr of ["aria-label", "title", "placeholder"]) {
      const value = element.getAttribute(attr); if (value) expect(value).toMatch(wrapped);
    }
  }
}

describe("route copy hand-roll", () => {
  it("renders the actual pending route banner through the explicit host resolver", () => {
    const { container } = render(<DesignerRoutePage copy={copy} serverData={serverData} initialSession={undefined} />);
    expect(container).toHaveTextContent("[[st.kbxw3bpcmt]]");
    assertWrapped(container);
  });

  it("renders the actual refused-data banner through the required host resolver", () => {
    const badSession = {} as NonNullable<DesignerRoutePageProps["initialSession"]>;
    const { container } = render(<StudioCopyProvider binding={copy}><DesignerRoutePage copy={copy} serverData={serverData} initialSession={badSession} /></StudioCopyProvider>);
    expect(container).toHaveTextContent("[[st.8gn31bm4k7]]");
    assertWrapped(container);
  });

  it("reports a Need when the host resolver or record is missing", () => {
    expect(() => readStudioCopy(undefined as unknown as StudioCopyBinding, { id: "st.kbxw3bpcmt" })).toThrow(StudioCopyNeedsError);
    expect(() => readStudioCopy({ ...copy, resolver: () => undefined }, { id: "st.kbxw3bpcmt" })).toThrow(StudioCopyNeedsError);
  });

  it("does not infer locale or override the Writer resolver's fallback decision", () => {
    const requests: unknown[] = [];
    const fallback: StudioCopyBinding = {
      locale: "fr",
      resolver(ref) { requests.push(ref); return { ref, text: "[[st.kbxw3bpcmt]]", servedLocale: "en", chain: ["fr", "en"] }; },
    };
    expect(readStudioCopy(fallback, { id: "st.kbxw3bpcmt" })).toBe("[[st.kbxw3bpcmt]]");
    expect(requests).toEqual([{ id: "st.kbxw3bpcmt", locale: "fr" }]);
  });

  it("refuses a resolver response for another record or request locale", () => {
    expect(() => readStudioCopy({ ...copy, resolver: ref => ({ ref: { ...ref, id: "st.0000000000" }, text: "[[st.0000000000]]", servedLocale: "ar" }) }, { id: "st.kbxw3bpcmt" })).toThrow(StudioCopyNeedsError);
    expect(() => readStudioCopy({ ...copy, resolver: ref => ({ ref: { ...ref, locale: "en" }, text: "[[st.kbxw3bpcmt]]", servedLocale: "en" }) }, { id: "st.kbxw3bpcmt" })).toThrow(StudioCopyNeedsError);
  });

  it("forwards authored reference arguments and runtime overrides without formatting them", () => {
    const requests: unknown[] = [];
    const binding: StudioCopyBinding = {
      ...copy,
      messages: { "fixture.message": { id: "st.kbxw3bpcmt", values: { count: 2, name: "fixture", enabled: true } } },
      resolver(ref) { requests.push(ref); return { ref, text: `[[${ref.id}]]`, servedLocale: "ar", chain: ["ar"] }; },
    };
    expect(readStudioMessage(binding, "fixture.message", { count: 3 })).toBe("[[st.kbxw3bpcmt]]");
    expect(requests).toEqual([{ id: "st.kbxw3bpcmt", locale: "ar", values: { count: 3, name: "fixture", enabled: true } }]);
    expect(binding.messages?.["fixture.message"].values?.count).toBe(2);
  });
});
