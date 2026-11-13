import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { createPortal } from "react-dom";
import { afterEach, expect, it, vi } from "vitest";
import { SiteHeader } from "../../shell/SiteHeader.js";
import { LinkButton as Link } from "../../components/preview-runtime/components/button/button.js";
import { ConsentBanner } from "../../blocks/ConsentBanner.js";
import { FrameNavDisclosure } from "./FrameNavDisclosure.client.js";
import { NavLinks } from "./NavLinks.js";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

// REQ-0010: a host notice (the consent banner) opened while the mobile menu Sheet
// is live must be reachable and focusable; the Sheet stays open behind it. The
// seam: the banner root is a React Aria top layer, and the host mounts it at the
// document body (a portal), outside the tree the live modal hides.
function Host() {
  const [notice, setNotice] = useState(false);
  return <>
    <SiteHeader surface="glass" brand={<Link href="#home">Home</Link>} nav={
      <FrameNavDisclosure trigger="icon" aria-label="Primary" triggerLabel="Menu" closeLabel="Close navigation">
        <NavLinks links={[{ href: "#privacy-choices", label: "Privacy choices" }, { href: "#help", label: "Help" }]} actions={[]} />
      </FrameNavDisclosure>
    } />
    <button type="button" hidden data-testid="open-notice" onClick={() => setNotice(true)} />
    {notice ? createPortal(<ConsentBanner title="Privacy choices" body="Choose" acceptLabel="Accept" rejectLabel="Reject" onAccept={() => setNotice(false)} onReject={() => setNotice(false)} />, document.body) : null}
  </>;
}

it("admits a host notice mounted over the live menu Sheet into focus and the accessibility tree", async () => {
  const user = userEvent.setup();
  render(<Host />);
  await user.click(screen.getByRole("button", { name: "Menu" }));
  const sheet = await screen.findByRole("dialog", { name: "Primary" });
  const opener = screen.getByRole("link", { name: "Privacy choices" });
  act(() => opener.focus());
  act(() => { fireEvent.click(screen.getByTestId("open-notice")); });
  const notice = document.querySelector<HTMLElement>("[data-consent-banner]")!;
  expect(notice).not.toBeNull();
  expect(notice.closest("[aria-hidden='true'], [inert]")).toBeNull();
  notice.setAttribute("tabindex", "-1");
  act(() => notice.focus());
  expect(notice).toHaveFocus();
  expect(screen.getByRole("region", { name: "Privacy choices" })).toBe(notice);
  await user.click(screen.getByRole("button", { name: "Reject" }));
  expect(document.querySelector("[data-consent-banner]")).toBeNull();
  act(() => opener.focus());
  expect(opener).toHaveFocus();
  expect(screen.getByRole("dialog", { name: "Primary" })).toBe(sheet);
});
