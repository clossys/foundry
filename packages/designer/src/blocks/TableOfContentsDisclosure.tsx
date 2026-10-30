import type { ComponentType, ReactNode } from "react";
import { componentLeaf } from "../runtime/component-leaf.js";

const Accordion = componentLeaf<ComponentType<{ children: ReactNode; defaultExpandedKeys: readonly string[] }>>("components.disclosure");
const AccordionItem = componentLeaf<ComponentType<{ children: ReactNode; id: string }>>("components.disclosure", "AccordionItem");
const AccordionTrigger = componentLeaf<ComponentType<{ children: ReactNode }>>("components.disclosure", "AccordionTrigger");
const AccordionContent = componentLeaf<ComponentType<{ children: ReactNode }>>("components.disclosure", "AccordionContent");

/** The selected disclosure leaf supplies its actual shadcn Accordion sub-parts. */
export function TableOfContentsDisclosure({ id, title, children }: { id: string; title: ReactNode; children: ReactNode }) {
  return <Accordion defaultExpandedKeys={[id]}><AccordionItem id={id}><AccordionTrigger>{title}</AccordionTrigger><AccordionContent>{children}</AccordionContent></AccordionItem></Accordion>;
}
