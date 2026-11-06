// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { ReactElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";

afterEach(cleanup);

/**
 * The navigation toggles select a complete look before `cx`, because tailwind-merge is an optional
 * peer: with it absent nothing resolves a class conflict. On the inverse plate the toggle must drop
 * the ink the ghost look adds over the colourless outline look, read from the component itself.
 */
let ghostInk: string[] = [];
let toggles: Record<string, (tone?: "inverse") => ReactElement> = {};
let warning: ReturnType<typeof vi.spyOn>;
beforeAll(async () => {
  vi.resetModules();
  vi.doMock("tailwind-merge", () => { throw Object.assign(new Error("absent optional peer"), { code: "ERR_MODULE_NOT_FOUND" }); });
  warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const { buttonLinkClassName } = await import("../../components/button-classes.js");
  const { NavDisclosure } = await import("../../shell/NavDisclosure.js");
  const { FrameNavDisclosure } = await import("./FrameNavDisclosure.client.js");
  const outline = buttonLinkClassName("outline", "sm").split(" ");
  ghostInk = buttonLinkClassName("ghost", "sm").split(" ").filter(token => token.startsWith("text-") && !outline.includes(token));
  toggles = {
    frame: tone => <FrameNavDisclosure aria-label="Primary" triggerLabel="Menu" closeLabel="Close" tone={tone}><a href="/a">A</a></FrameNavDisclosure>,
    shell: tone => <NavDisclosure aria-label="Primary" triggerLabel="Menu" tone={tone}><a href="/a">A</a></NavDisclosure>,
  };
});
afterAll(() => { warning.mockRestore(); vi.doUnmock("tailwind-merge"); vi.resetModules(); });

it("reads a ghost ink from the component", () => {
  expect(ghostInk.length).toBeGreaterThan(0);
});

it.each(["frame", "shell"])("drops the ghost ink from an inverse %s navigation toggle and keeps it on the base ground", name => {
  render(toggles[name]!());
  for (const token of ghostInk) expect(screen.getByRole("button", { name: "Menu" })).toHaveClass(token);
  cleanup();
  render(toggles[name]!("inverse"));
  for (const token of ghostInk) expect(screen.getByRole("button", { name: "Menu" })).not.toHaveClass(token);
});
