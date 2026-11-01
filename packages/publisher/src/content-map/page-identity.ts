/** Private migration identity rule, shared by the two authoring readers. */
export const PAGE_ID = /^page\.[a-z][a-z0-9-]*$/;
export function pageId(id: string): string {
  const value = `page.${id.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
  if (!PAGE_ID.test(value)) throw new TypeError(`${id}: Cannot derive a permanent page cell id`);
  return value;
}
