import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as components from "./index.js";
import * as root from "../index.js";
import { LinkButton } from "./preview-runtime/components/button/button.js";

// R2F-25 D1: the link leaf is the stock shadcn@aria LinkButton; the Foundry Link is gone.
describe("components.link leaf source", () => {
  it("exports the stock LinkButton and no Foundry Link", () => {
    expect("Link" in components).toBe(false);
    expect("Link" in root).toBe(false);
    expect(components.LinkButton).toBe(LinkButton);
  });

  it("leaves no Foundry Link module behind", () => {
    for (const file of ["Link.tsx", "Link.client.tsx", "Link.server.tsx", "Link.styles.ts", "Link.types.ts"])
      expect(existsSync(new URL(`./${file}`, import.meta.url))).toBe(false);
  });
});
