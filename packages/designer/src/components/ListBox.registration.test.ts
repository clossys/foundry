/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { loadBuildCatalog } from "../catalog-core/index.js";
import { loadCatalogBundles } from "../catalog-bundles.js";

it("registers ListBox as an additive draft with pinned shadcn aria Command provenance", () => {
  const catalog = loadBuildCatalog();
  expect(catalog.slots.find(slot => slot.id === "components.list-box")).toMatchObject({ status: "draft", contract: { root: "rac:ListBox" } });
  const document = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../catalog/fills/shadcn@aria/components.list-box.json"), "utf8"));
  expect(document.$extensions["com.clossys.fill"]).toMatchObject({ source: "shadcn@aria", slot: "components.list-box", status: "draft", pin: { commit: "daaf156ee00ed91cc7e6bdd937c1b4973152d141", sha256: "911e2d5972ca64ec2565b2c18281f0d9c0cb4d5caffa139dcd4eea2c853add11" } });
  expect(loadCatalogBundles().componentFills).toContainEqual(document);
});
