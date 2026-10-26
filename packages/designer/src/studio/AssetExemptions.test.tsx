import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AssetExemptions } from "./AssetExemptions.js";
import type { Finding } from "../catalog-core/types.js";
afterEach(cleanup);
const finding: Finding = { code: "A5", severity: "notice", rule: "contrast", subject: "assets.lockup.logotype", message: "exempt: logotype, original registered artwork" };
it("keeps an engine logotype exemption visible and distinct from pass", () => {
  const {container} = render(<AssetExemptions findings={[finding]} />);
  expect(screen.getByRole("status")).toHaveTextContent("exempt: logotype, original registered artwork");
  expect(container.querySelector('[data-studio-asset-verdict="exempt"]')).toHaveAttribute("data-studio-asset-subject", finding.subject);
  expect(container.textContent).not.toMatch(/pass|satisfied/i);
});
it("does not turn failed, unrelated or incomplete notices into exemptions", () => {
  const findings: Finding[] = [{...finding,severity:"error"}, {...finding,code:"C9"}, {...finding,message:"exempt: mark, wrong kind"}, {...finding,message:"exempt: logotype, "}];
  const {container} = render(<AssetExemptions findings={findings}/>);
  expect(container).toBeEmptyDOMElement();
});
