import { expect, it } from "vitest";
import { normaliseStudioUrl, resolverFromPlacements } from "./url.js";
import { testPlacements } from "./__fixtures__/system.js";
const resolver = resolverFromPlacements(testPlacements);
it.each([
  ["", "", "", ""], ["?layer=components", "", "?layer=components", ""],
  ["", "#studio-layer=components", "?layer=components", ""],
  ["?node=components.button", "", "?layer=components&node=components.button", ""],
  ["?layer=components&l1=components/actions", "", "?layer=components&node=components/actions", ""],
  ["?layer=unknown", "", "", ""], ["?node=unknown", "", "", ""], ["?layer=components&other=unknown", "", "", ""],
])("normalises %s %s", (search, hash, next, fragment) => {
  const result = normaliseStudioUrl({search, hash}, resolver);
  expect(result.search).toBe(next); expect(result.hash).toBe(fragment);
  expect(normaliseStudioUrl(result, resolver).changed).toBe(false);
});
