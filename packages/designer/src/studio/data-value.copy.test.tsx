// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { StudioDataValue } from "./data-value.js";
import { readStudioCopy, type StudioCopyBinding } from "./copy-binding.js";

afterEach(cleanup);
it("hand-roll distinguishes resolved copy from explicit raw identifier and JSON data", () => {
  const copy: StudioCopyBinding = { locale: "en", resolver: ref => ({ ref, text: `[[${ref.id}]]`, servedLocale: "en", chain: ["en"] }) };
  const { container } = render(<section>
    <h2>{readStudioCopy(copy, { id: "st.1vc3bb7pw7" })}</h2>
    <StudioDataValue kind="identifier" value="components.example" />
    <StudioDataValue kind="json" value={{ count: 2 }} />
  </section>);
  const data = container.querySelectorAll("[data-studio-data-value]");
  expect([...data].map(node => node.textContent)).toEqual(["components.example", '{"count":2}']);
  expect([...data].map(node => node.getAttribute("data-studio-data-kind"))).toEqual(["identifier", "json"]);
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const text: string[] = []; let node: Node | null;
  while ((node = walker.nextNode())) if (node.textContent?.trim() && !node.parentElement?.closest("[data-studio-data-value]")) text.push(node.textContent.trim());
  expect(text).toEqual(["[[st.1vc3bb7pw7]]"]);
});
