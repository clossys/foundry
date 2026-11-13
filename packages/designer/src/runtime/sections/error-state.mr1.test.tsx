// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { errorMessageRenderer, errorMessageInputs } from "./error-message.js";
import type { RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";
import type { ReactNode } from "react";
afterEach(cleanup);
describe("MR-1 not-found state", () => {
  it("renders the 404 code inside registered ErrorState anatomy", () => {
    const content = {status:"404",title:"Unavailable page",description:"Choose another destination."};
    const input: RuntimeRenderInput<ReactNode> = {
      fill: {leaf:errorMessageRenderer.leaf, ...errorMessageInputs},
      selection: {leaf:errorMessageRenderer.leaf,members:["kind.not-found"]},
      content:Object.fromEntries(Object.entries(content).map(([key,value])=>[key,{value}])),
    } as RuntimeRenderInput<ReactNode>;
    render(<>{errorMessageRenderer.render(input)}</>);
    expect(screen.getByText("404").closest('[data-ds-leaf="sections.error-state"]')).toHaveAttribute("data-error-kind","not-found");
    expect(screen.getByText("404").tagName).not.toBe("H1");
  });
});
