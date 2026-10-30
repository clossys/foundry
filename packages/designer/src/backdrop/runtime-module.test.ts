import { expect, it } from "vitest";
import slots from "../catalog/slots/assets.json" with { type: "json" };
import ia from "../catalog/ia/assets.json" with { type: "json" };
import amendments from "../catalog/ia/assets.draft-leaf-amendments.json" with { type: "json" };
import sections from "../catalog/slots/sections.json" with { type: "json" };
import passages from "../../../writer/src/catalog/slots/passages.json" with { type: "json" };

it("registers assets.backdrop as a draft consumer rules resource after the icon-set amendment", () => {
  const slot = slots.find(candidate => candidate.id === "assets.backdrop");
  expect(slot).toMatchObject({ status: "draft", contract: { kind: "asset", valueKind: "rules", members: { mode: "open" } } });
  expect(amendments.addedLeafIds).toContain("assets.backdrop");
  expect(amendments.addedLeafIds.indexOf("assets.backdrop")).toBeGreaterThan(amendments.addedLeafIds.indexOf("assets.icon-set"));
  const resources = ia.nodes.find(node => node.id === "imagery")?.children.find(node => node.id === "imagery-resources");
  expect(resources?.leaves).toContain("assets.backdrop");
});

it("keeps all new Hero and media control copy in matching Writer passage fields", () => {
  for (const id of ["sections.hero", "sections.media"]) {
    const section = sections.find(row => row.id === id)!;
    const passage = passages.find(row => row.contract.sectionId === id)!;
    expect(passage.contract.copy).toEqual(section.contract.copy);
  }
  const hero = sections.find(row => row.id === "sections.hero")!;
  expect(hero.contract.copy.fields.map(field => field.key)).toEqual(expect.arrayContaining(["backdrop.labels.pause", "backdrop.labels.resume"]));
  const media = sections.find(row => row.id === "sections.media")!;
  expect(media.contract.copy.fields.map(field => field.key)).toContain("figure.media.passage.play");
  expect(media.contract.copy.fields.find(field => field.key === "figure.media.title")?.required).toBe(true);
});
