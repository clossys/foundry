import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AssetExemptions, engineExemption } from "./AssetExemptions.js";
import type { Finding } from "../catalog-core/types.js";
afterEach(cleanup);
const finding: Finding = { code: "A5", severity: "notice", rule: "contrast", subject: "assets.lockup.logotype", message: "exempt: logotype, original registered artwork" };
it("keeps an engine logotype exemption visible and distinct from pass, in plain words with the subject id in mono", () => {
  const {container} = render(<AssetExemptions findings={[finding]} />);
  const status = screen.getByRole("status");
  expect(status).toHaveTextContent("Logotype exemption: original registered artwork");
  expect(status.textContent).not.toContain("exempt: logotype,");
  const id = status.querySelector("[data-studio-asset-subject-id]")!;
  expect(id).toHaveTextContent(finding.subject);
  expect(id).toHaveClass("font-mono", "text-ink-secondary");
  expect(container.querySelector('[data-studio-asset-verdict="exempt"]')).toHaveAttribute("data-studio-asset-subject", finding.subject);
  expect(container.querySelector('[data-studio-asset-verdict="exempt"]')).toHaveAttribute("data-studio-asset-exemption", "logotype");
  expect(container.textContent).not.toMatch(/pass|satisfied/i);
});
it("uses host words for the exemption without dropping the kind or reason", () => {
  render(<AssetExemptions findings={[finding]} label={(kind, reason) => `Exempt ${kind}: ${reason}`} />);
  expect(screen.getByRole("status")).toHaveTextContent("Exempt logotype: original registered artwork");
  expect(engineExemption(finding.message)).toEqual({ kind: "logotype", reason: "original registered artwork" });
});
it("does not turn failed, unrelated or incomplete notices into exemptions", () => {
  const findings: Finding[] = [{...finding,severity:"error"}, {...finding,code:"C9"}, {...finding,message:"exempt: mark, wrong kind"}, {...finding,message:"exempt: logotype, "}];
  const {container} = render(<AssetExemptions findings={findings}/>);
  expect(container).toBeEmptyDOMElement();
});
