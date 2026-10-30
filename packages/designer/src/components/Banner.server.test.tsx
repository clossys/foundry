import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Banner as ShellFixtureBanner } from "./Banner.server.js";
import { withShellCopy } from "../frames/__fixtures__/shell-copy.js";
const Banner = withShellCopy(ShellFixtureBanner, true);



const here = dirname(fileURLToPath(import.meta.url));

describe("server Banner", () => {
  it("follows severity: danger is an assertive alert, the rest polite status regions", () => {
    const { rerender } = render(<Banner variant="danger">Broke.</Banner>);
    expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "assertive");
    rerender(<Banner>Heads up.</Banner>);
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });

  it("renders no dismiss control without onDismiss, and a native button with it", async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    const { rerender, container } = render(<Banner>None.</Banner>);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    rerender(<Banner onDismiss={onDismiss} dismissLabel="Hide this update">Some.</Banner>);
    const button = screen.getByRole("button", { name: "Hide this update" });
    expect(button.tagName).toBe("BUTTON");
    expect(container.querySelector("[data-rac]")).toBeNull();
    await user.click(button);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("imports no react-aria-components, so it loads under the react-server condition", () => {
    const source = readFileSync(join(here, "Banner.server.tsx"), "utf8");
    expect(source).not.toMatch(/from\s+["']react-aria-components["']/);
  });
});
