import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConsentBanner } from "./ConsentBanner.js";
import { Link } from "../components/Link.js";

describe("MR-7b consent section composition", () => {
  it("builds its content anatomy through SemanticContent rather than native JSX", () => {
    const source = readFileSync(resolve(import.meta.dirname, "ConsentBanner.tsx"), "utf8");
    expect(source).toContain('from "../components/SemanticContent.js"');
    expect(source).not.toMatch(/<\/?(?:section|div|h2|span|p|a|button|input)\b/);
    expect(source).not.toMatch(/[A-Za-z]+Label\s*=\s*["']/);
  });

  it("preserves host-resolved copy, live feedback and independent equal choices", async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn(), onReject = vi.fn();
    render(<ConsentBanner presentation="card" selectedChoice="denied"
      title="Host title" body="Host body" acceptLabel="Host accept" rejectLabel="Host reject"
      status="Host status" privacyLink={<Link href="/privacy">Host policy</Link>}
      onAccept={onAccept} onReject={onReject} />);
    expect(screen.getByRole("region", { name: "Host title" })).toContainElement(screen.getByRole("status"));
    expect(screen.getByRole("status")).toHaveTextContent("Host status");
    expect(screen.getByRole("link", { name: "Host policy" })).toHaveAttribute("href", "/privacy");
    const accept = screen.getByRole("button", { name: "Host accept" });
    const reject = screen.getByRole("button", { name: "Host reject" });
    expect(accept.className).toBe(reject.className);
    expect(reject).toHaveAttribute("aria-pressed", "true");
    expect(reject.querySelector('[data-consent-selected][aria-hidden="true"]')).not.toBeNull();
    await user.click(reject);
    expect(onReject).toHaveBeenCalledExactlyOnceWith();
    expect(onAccept).not.toHaveBeenCalled();
    await user.click(accept);
    expect(onAccept).toHaveBeenCalledExactlyOnceWith();
  });
});
