import { describe, expect, it } from "vitest";
import {
  PUBLISHER_TREES, loadDefaults, loadDesignerCatalog, placedLeaves, slotContract,
  type LayoutSlot, type PageOption, type PageSlot,
} from "../catalog/ia/tree.js";
import { checkPageOption, inlineCopyFindings, type LayoutContract, type PageOptionContent } from "./page-sections-instance.js";

const designer = loadDesignerCatalog();
const defaults = loadDefaults();
const clone = <T>(value: T): T => structuredClone(value);
const pageIds = placedLeaves(PUBLISHER_TREES).filter(leaf => leaf.l0 === "directory" && !leaf.parked).map(leaf => leaf.id);
const home = () => clone(defaults.get("page.home/starter-v1.json")!.content as unknown as PageOption);
const check = (pageId: string, content: PageOptionContent) => {
  const page = slotContract(pageId) as PageSlot;
  const layout = slotContract(String(content.layout)) as LayoutSlot | undefined;
  return checkPageOption(pageId, content, page, layout as LayoutContract | undefined, designer);
};
const checks = (findings: { check: string }[]) => [...new Set(findings.map(finding => finding.check))];

describe("page option checks on the starter pages", () => {
  it("every one of the 21 starter page defaults passes (20 + page.deck, build-0027)", () => {
    expect(pageIds).toHaveLength(21);
    for (const id of pageIds) {
      const option = defaults.get(`${id}/starter-v1.json`);
      expect(option, id).toBeDefined();
      expect(check(id, option!.content as PageOptionContent), id).toEqual([]);
    }
  });

  it("each section carries a unique instance key (role), and the record key is <page>.<role>", () => {
    for (const id of pageIds) {
      const sections = (defaults.get(`${id}/starter-v1.json`)!.content as unknown as PageOption).sections;
      const roles = sections.map(section => section.role);
      expect(new Set(roles).size, id).toBe(roles.length);
    }
    expect(home().sections.map(section => section.copy)).toContain("writer/sections.hero.copy#home.hero");
  });

  it("one section kind may appear twice under two instance keys", () => {
    const layout: LayoutContract = { frame: "designer/frames.site-shell", roles: {
      questions: { kinds: ["designer/sections.faq"], required: true }, more: { kinds: ["designer/sections.faq"], required: false } } };
    const content: PageOptionContent = {
      path: "/help", layout: "publisher/layout.help",
      sections: [
        { role: "questions", use: "designer/sections.faq", copy: "writer/sections.faq.copy#help.questions" },
        { role: "more", use: "designer/sections.faq", copy: "writer/sections.faq.copy#help.more" },
      ],
      meta: { copy: "writer/page.help.meta#help.meta", indexing: "index" },
    };
    const page = { layouts: ["publisher/layout.help"], records: { pattern: "help.<role>", meta: "writer/page.help.meta#help.meta" } };
    expect(checkPageOption("page.help", content, page, layout, designer)).toEqual([]);
  });
});

describe("mutations that must die", () => {
  it("two sections with the same instance key fail page.instance-key", () => {
    const option = home();
    option.sections.push({ ...option.sections[0]! });
    const findings = check("page.home", option as unknown as PageOptionContent);
    expect(findings).toContainEqual({ check: "page.instance-key", message: "page.home: instance key hero appears twice; each section on a page has its own role" });
  });

  it("a section with no instance key fails", () => {
    const option = home();
    delete (option.sections[1] as { role?: string }).role;
    expect(checks(check("page.home", option as unknown as PageOptionContent))).toContain("page.instance-key");
  });

  it("a page naming a retired Designer section fails page.unit-resolves", () => {
    const retiredSection = [...designer.retired].filter(id => id.startsWith("sections.")).sort()[0]!;
    const option = clone(defaults.get("page.terms/starter-v1.json")!.content as unknown as PageOption);
    option.sections.find(section => section.role === "body")!.use = `designer/${retiredSection}`;
    expect(check("page.terms", option as unknown as PageOptionContent))
      .toContainEqual({ check: "page.unit-resolves", message: `page.terms: body places retired designer/${retiredSection}` });
  });

  it("a page naming a section the Designer catalog does not have fails", () => {
    const option = home();
    option.sections[0]!.use = "designer/sections.hero-banner";
    expect(checks(check("page.home", option as unknown as PageOptionContent))).toContain("page.unit-resolves");
  });

  it("literal copy text in a page record fails page.no-inline-copy", () => {
    const literal = home();
    literal.sections[0]!.copy = "Close your books by the 5th";
    expect(checks(check("page.home", literal as unknown as PageOptionContent))).toEqual(["page.no-inline-copy"]);

    const field = home() as unknown as PageOptionContent & { sections: Record<string, unknown>[] };
    field.sections[0]!.heading = "Close your books by the 5th";
    expect(checks(check("page.home", field))).toEqual(["page.no-inline-copy"]);

    const title = { ...home(), title: "Home" } as unknown as PageOptionContent;
    expect(checks(inlineCopyFindings(title))).toEqual(["page.no-inline-copy"]);

    const variant = home();
    variant.sections[0]!.variant = { layout: "Big bold hero" };
    expect(checks(check("page.home", variant as unknown as PageOptionContent))).toEqual(["page.no-inline-copy"]);
  });

  it("a style value in a page record fails page.no-style", () => {
    const option = home() as unknown as PageOptionContent & { sections: Record<string, unknown>[] };
    option.sections[0]!.className = "bg-black text-white";
    expect(checks(check("page.home", option))).toEqual(["page.no-style"]);
  });

  it("a section kind the role does not allow, a missing required role and a wrong record key fail", () => {
    const kind = home();
    kind.sections[0]!.use = "designer/sections.page-header";
    kind.sections[0]!.copy = "writer/sections.page-header.copy#home.hero";
    expect(checks(check("page.home", kind as unknown as PageOptionContent))).toEqual(["page.role-allowed"]);

    const missing = home();
    missing.sections = missing.sections.filter(section => section.role !== "closing");
    expect(check("page.home", missing as unknown as PageOptionContent))
      .toEqual([{ check: "page.required-roles", message: "page.home: required role closing is not placed" }]);

    const key = home();
    key.sections[0]!.copy = "writer/sections.hero.copy#about.hero";
    expect(checks(check("page.home", key as unknown as PageOptionContent))).toEqual(["page.record-key"]);
  });

  it("a layout the page slot does not allow fails page.layout-allowed", () => {
    const option = { ...home(), layout: "publisher/layout.pricing" };
    expect(checks(check("page.home", option as unknown as PageOptionContent))).toContain("page.layout-allowed");
  });

  it("a link to a path instead of a page id fails", () => {
    const option = home();
    option.sections[0]!.links = { "actions.primary": "/pricing" };
    expect(checks(check("page.home", option as unknown as PageOptionContent))).toEqual(["page.no-inline-copy"]);
  });
});
