import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Spinner } from "./Spinner.server.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("server Spinner", () => {
  it("exposes an accessible name via role='status' on the svg when a label is given", () => {
    render(<Spinner label="Loading prompts" />);
    const status = screen.getByRole("status", { name: "Loading prompts" });
    expect(status.tagName).toBe("svg");
  });

  it("keeps relationship attributes on the svg, which is the named status element", () => {
    render(
      <>
        <p id="why">Fetching your prompts</p>
        <Spinner label="Loading" aria-describedby="why" />
      </>,
    );
    const status = screen.getByRole("status", { name: "Loading" });
    expect(status).toHaveAttribute("aria-describedby", "why");
    expect(status).toHaveAccessibleDescription("Fetching your prompts");
  });

  it("is hidden from assistive tech and carries no role when purely decorative", () => {
    const { container } = render(<Spinner />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("forwards className, and the consumer's conflicting class wins the merge", () => {
    const { container } = render(<Spinner className="text-status-danger" />);
    const svg = container.querySelector("svg");
    expect(svg?.className.baseVal).toContain("text-status-danger");
    expect(svg?.className.baseVal).not.toContain("text-ink-secondary");
  });

  it("imports no react-aria-components, so it loads under the react-server condition", () => {
    const source = readFileSync(join(here, "Spinner.server.tsx"), "utf8");
    expect(source).not.toMatch(/from\s+["']react-aria-components["']/);
  });
});
