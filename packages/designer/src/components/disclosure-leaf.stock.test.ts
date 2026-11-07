import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as components from "./index.js";
import * as root from "../index.js";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./preview-runtime/components/disclosure/accordion.js";

// R2F-26 D1: the disclosure leaf is the stock shadcn@aria Accordion; the Foundry Disclosure is gone.
describe("components.disclosure leaf source", () => {
  it("exports the stock Accordion parts and no Foundry Disclosure", () => {
    expect("Disclosure" in components).toBe(false);
    expect("Disclosure" in root).toBe(false);
    expect([components.Accordion, components.AccordionItem, components.AccordionTrigger, components.AccordionContent]).toEqual([Accordion, AccordionItem, AccordionTrigger, AccordionContent]);
  });

  it("leaves no Foundry Disclosure module behind", () => {
    expect(existsSync(new URL("./Disclosure.tsx", import.meta.url))).toBe(false);
  });
});
