import { describe, expect, it } from "vitest";
import type { RuntimeJson } from "../../catalog-core/runtime-ports.js";
import { siteFooterProps } from "./site-footer.js";
import { SiteFooter, type SiteFooterLegalProps } from "../../shell/SiteFooter.js";
import { marketingFooterContent, marketingFooterSpecimen } from "../../studio/__fixtures__/marketing-footer.js";
import { isValidElement } from "react";
const input = (values: Readonly<Record<string, RuntimeJson>> = marketingFooterContent) => ({
 content: Object.fromEntries(Object.entries(values).map(([slot, value]) => [slot, { value }])), selection: { members: [] },
}) as Parameters<typeof siteFooterProps>[0];
const legalProps = (values = marketingFooterContent) => {
 const node = siteFooterProps(input(values)).secondary;
 if (!isValidElement<SiteFooterLegalProps>(node)) throw new Error("Missing legal composition");
 return node.props;
};
describe("registered marketing footer content", () => {
 it("maps the concrete frame specimen to the native legal composition and fixed consent fragment", () => {
  const node = siteFooterProps(input()).secondary;
  expect(isValidElement(node) && node.type).toBe(SiteFooter.Legal);
  expect(legalProps()).toMatchObject({ entity: "ExampleCo", linksLabel: "Legal and privacy", links: [
   { href: "/accessibility", label: "Accessibility" }, { href: "/privacy", label: "Privacy" },
   { href: "/terms", label: "Terms" }, { href: "#privacy-choices", label: "Privacy choices" },
  ] });
  expect(marketingFooterSpecimen).toMatchObject({ leaf: "frames.site-footer", specimen: "sections.specimen-frame-viewports", native: { leaf: "components.button", part: "LinkButton" } });
 });
 it.each(["javascript:alert(1)", " /privacy", "https://example.com/#%70rivacy-choices", "#PRIVACY-CHOICES"])("refuses unsafe or reserved generic destinations: %s", href => {
  expect(() => siteFooterProps(input({ ...marketingFooterContent, links: [{ href, label: "Privacy" }] }))).toThrow(/safe destination|reserved control/);
 });
 it("refuses malformed content, unknown fields and arbitrary privacy-control destinations", () => {
  for (const values of [ { columns: [null] }, { columns: [{ heading: "Company", links: [null] }] },
   { links: [{ label: "Privacy", href: "/privacy" }] },
   { legal: { entity: "ExampleCo", privacyChoices: { label: "Privacy choices", href: "/other" } } },
   { legal: { entity: "ExampleCo", privacyChoices: { label: "" } } }, { social: [] } ]) {
   expect(() => siteFooterProps(input(values))).toThrow(/frames.site-footer:/);
  }
 });
 it("retains the five-link cap including the dedicated privacy control", () => {
  const props = legalProps({ ...marketingFooterContent, links: Array.from({ length: 3 }, (_, index) => ({ label: "Legal", href: `/legal-${index}` })) } as unknown as typeof marketingFooterContent);
  expect(() => SiteFooter.Legal(props)).toThrow(expect.objectContaining({ code: "footer-link-limit" }));
 });
});
