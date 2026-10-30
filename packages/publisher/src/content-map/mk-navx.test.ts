import { expect, it } from "vitest";
import { publicSiteContentMap } from "./__fixtures__/public-site.js";
import { checkContentMap } from "./check.js";
import { projectNavigation } from "./projections.js";
import { projectSiteShellNavigation } from "../web/frame/registered-navigation.js";
import type { ContentMap } from "./contract.js";
import type { CopyRef, CopyResolver } from "@clossys/writer";

function map(): ContentMap {
  const value = publicSiteContentMap();
  return { ...value, entries: value.entries.map(entry => entry.id === "home" ? { ...entry, group: "navigation", alternates: [
    { locale: "en", entryId: "home", label: "English" }, { locale: "fr", entryId: "guide", label: "Français" },
  ] } : entry.id === "guide" ? { ...entry, featured: true, description: "Featured guide" } : entry) };
}

it("projects alternates from the active route's real mapped entries and preserves checked grouping metadata", () => {
  const value = map();
  expect(checkContentMap(value)).toEqual([]);
  const projected = projectNavigation(value, "home");
  expect(projected.alternates).toEqual([{ locale: "en", href: "/", label: "English", isCurrent: true }, { locale: "fr", href: "/guide", label: "Français", isCurrent: false }]);
  expect(projected.tree[0]?.children?.find(entry => entry.id === "home")?.group).toBe("navigation");
});

it("refuses unknown extension keys, duplicate locales, missing alternate routes and missing column groups", () => {
  const value = map();
  const change = (patch: object) => ({ ...value, entries: value.entries.map(entry => entry.id === "home" ? { ...entry, ...patch } : entry) });
  for (const patch of [{ extra: true }, { group: "missing" }, { featured: "yes" }, { alternates: [{ locale: "en", entryId: "home", label: "English" }, { locale: "EN", entryId: "guide", label: "Duplicate" }] }, { alternates: [{ locale: "en", entryId: "home", label: "English" }, { locale: "fr", entryId: "missing", label: "Français" }] }]) {
    expect(checkContentMap(change(patch)).length).toBeGreaterThan(0);
  }
});

it("binds mega columns, featured copy and locale names to actual Writer references without invented routes", () => {
  const value = map();
  const words: Record<string, string> = Object.fromEntries(value.entries.map(entry => [entry.id, entry.title]));
  Object.assign(words, { language: "Language", en: "English", fr: "Français", description: "Featured guide" });
  const refs: Record<string, CopyRef> = Object.fromEntries(Object.keys(words).map(id => [id, { id }]));
  const resolveCopy: CopyResolver = ref => words[ref.id] ? { ref, text: words[ref.id]!, recordId: "example-record", revision: "1", locale: "en", entryId: ref.id, source: { kind: "consumer", reference: "example-fixture" } } : undefined;
  const result = projectSiteShellNavigation(value, { activeId: "home", header: { label: refs.navigation!, entryIds: ["navigation"], mega: true }, footerGroupIds: [], entryCopyRefs: refs, descriptionCopyRefs: { guide: refs.description! }, locale: { label: refs.language!, copyRefs: { en: refs.en!, fr: refs.fr! } }, resolveCopy });
  expect(result.nav.mega?.[0]?.columns[0]?.links[0]?.href).toBe("/");
  expect(result.nav.mega?.[0]?.featured).toEqual({ href: "/guide", label: refs.guide, description: refs.description });
  expect(result.locale?.links[1]).toEqual({ href: "/guide", locale: "fr", isCurrent: false, label: refs.fr });
});
