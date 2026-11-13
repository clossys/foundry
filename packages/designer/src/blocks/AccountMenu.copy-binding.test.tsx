// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { AccountMenu } from "./AccountMenu.js";

afterEach(cleanup);
it("keeps account identity and entries entirely host-resolved, with no invented account copy", async () => {
  const view = render(<AccountMenu actor={{ name: "[[host.name]]", image: "/avatar.png", secondaryText: "[[host.role]]" }} contextLabel="[[host.context]]"
    sections={[{ id: "account", label: "[[host.section]]", entries: [{ id: "profile", kind: "link", label: "[[host.profile]]", href: "/profile" }] }]} />);
  await userEvent.click(view.getByRole("button", { name: "[[host.name]]" }));
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) if (walker.currentNode.textContent?.trim()) expect(walker.currentNode.textContent).toMatch(/^(?:\[\[[^\]]+\]\])+$/);
});
