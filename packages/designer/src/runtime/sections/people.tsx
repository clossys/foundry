/** sections.people: PeopleGrid person records (name, role, initials, optional link). */
import type { ReactNode } from "react";
import { PeopleGrid } from "../../blocks/PeopleGrid.js";
import { list, object, optionalText, readSectionContent, required, text, type SectionRenderInput, type SectionRendererInputs } from "./group-a-content.js";

export const peopleInputs: SectionRendererInputs = { slots: ["people"], members: [] };

export function renderPeopleSection(input: SectionRenderInput): ReactNode {
  const content = readSectionContent(input, "sections.people", peopleInputs);
  const people = list(content, required(content, "people"), "people").map((row, index) => {
    const person = object(content, row, `people.${index}`);
    return {
      id: text(content, person.id, `people.${index}.id`),
      name: text(content, person.name, `people.${index}.name`),
      role: optionalText(content, person.role, `people.${index}.role`),
      initials: text(content, person.initials, `people.${index}.initials`),
      href: optionalText(content, person.href, `people.${index}.href`),
    };
  });
  return <PeopleGrid people={people} />;
}
