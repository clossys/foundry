import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { AccountMenu } from "./AccountMenu.js";

it.each([false, true])("hydrates a truthful trigger and opens by keyboard (collapsed=%s)", async collapsed => {
  const tree = <AccountMenu actor={{ name: "Jordan Vale" }} collapsed={collapsed}
    sections={[{ id: "account", entries: [{ id: "profile", kind: "link", label: "Profile", href: "/profile" }] }]} />;
  const host = document.createElement("div");
  host.innerHTML = renderToString(tree);
  document.body.append(host);
  const button = within(host).getByRole("button", { name: "Jordan Vale" });
  expect(button).toHaveAttribute("aria-haspopup", "true");
  expect(button).toHaveAttribute("aria-expanded", "false");
  expect(within(host).queryByRole("menu")).toBeNull();
  const onRecoverableError = vi.fn();
  let root: ReturnType<typeof hydrateRoot> | undefined;
  try {
    await act(async () => { root = hydrateRoot(host, tree, { onRecoverableError }); });
    expect(within(host).getByRole("button", { name: "Jordan Vale" })).toBe(button);
    expect(onRecoverableError).not.toHaveBeenCalled();
    button.focus();
    await userEvent.setup().keyboard("{ArrowDown}");
    expect(await within(document.body).findByRole("menu", { name: "Jordan Vale" })).toBeInTheDocument();
  } finally {
    await act(async () => root?.unmount());
    host.remove();
  }
});
