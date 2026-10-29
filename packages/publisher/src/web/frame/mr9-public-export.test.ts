import { expect, it } from "vitest";
import { projectSiteShellNavigation as publicProjection } from "./index.js";
import { projectSiteShellNavigation } from "./registered-navigation.js";
it("exports the canonical site navigation bridge through the existing public frame barrel", () => {
  expect(publicProjection).toBe(projectSiteShellNavigation);
});
