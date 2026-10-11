import { TopicList, type TopicListGroup, type TopicListProps } from "../index.js";
const groups: TopicListGroup[] = [];
export const grouped: TopicListProps = { groups, headingLevel: 4 };
export const flat: TopicListProps = { items: [], columns: 1 };
export const element = <TopicList groups={groups} />;
// @ts-expect-error exactly one form
export const both: TopicListProps = { groups, items: [] };
// @ts-expect-error one form is required
export const neither: TopicListProps = {};
// @ts-expect-error grouped layout derives from count
export const columns: TopicListProps = { groups, columns: 2 };
// @ts-expect-error group labels are only h3 or h4
export const level: TopicListProps = { groups, headingLevel: 2 };
// @ts-expect-error headingLevel applies to groups only
export const flatLevel: TopicListProps = { items: [], headingLevel: 3 };
export const groupedEvents: TopicListProps = { groups, onClick(event) {
  const element: HTMLDivElement = event.currentTarget;
  const typed: 0 extends (1 & typeof event.currentTarget) ? true : false = false;
  void element; void typed;
} };
export const flatEvents: TopicListProps = { items: [], onClick(event) {
  const element: HTMLUListElement = event.currentTarget;
  const typed: 0 extends (1 & typeof event.currentTarget) ? true : false = false;
  void element; void typed;
} };
