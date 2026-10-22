import type { SectionedViewFaqItem, SectionedViewFaqSection } from "../../core/index.js";
const ref = { id: "example.copy" };
const row: SectionedViewFaqItem = { id: "question", question: ref, answer: ref };
const faq: SectionedViewFaqSection = { id: "questions", kind: "faq", heading: ref, layout: "split", items: [row, { ...row, id: "two" }, { ...row, id: "three" }, { ...row, id: "four" }] };
// @ts-expect-error The published spelling has question/answer, not catalog heading/description.
const renamed: SectionedViewFaqItem = { id: "question", heading: ref, description: ref };
// @ts-expect-error A question is a CopyRef, never a React trigger or raw string.
const raw: SectionedViewFaqItem = { ...row, question: "Question?" };
// @ts-expect-error An answer is required.
const missing: SectionedViewFaqItem = { id: "question", question: ref };
// @ts-expect-error The compatibility spelling cannot add item destinations.
const linked: SectionedViewFaqItem = { ...row, href: "/more" };
// @ts-expect-error Recipe configuration is private projection, not an extra authored FAQ axis.
const recipe: SectionedViewFaqSection = { ...faq, recipe: "faq" };
// @ts-expect-error The published layout vocabulary is still closed.
const grid: SectionedViewFaqSection = { ...faq, layout: "grid" };
void [faq, renamed, raw, missing, linked, recipe, grid];
