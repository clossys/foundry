/**
 * The closed role hierarchy this package's authority model is built on.
 *
 * Ported unchanged from the donor's own suite: the hierarchy is supplied by
 * the consumer, never declared here, and every unknown or missing role fails
 * closed rather than being coerced to a default rank. A role this package
 * does not know is not a low-privilege role — it is a role no grant can be
 * checked against, which is the difference this whole package turns on.
 */
import { describe, expect, it } from "vitest";
import { defineRoleHierarchy, hasRoleAtLeast, resolveViewerRole, viewerHasAccess } from "./index.js";

describe("role hierarchy", () => {
  const hierarchy = defineRoleHierarchy(["viewer", "editor", "owner"]);

  it("evaluates roles by the configured ordering", () => {
    expect(hasRoleAtLeast("owner", "editor", hierarchy)).toBe(true);
    expect(hasRoleAtLeast("viewer", "editor", hierarchy)).toBe(false);
    expect(viewerHasAccess({ subjectId: "person", role: "editor" }, "viewer", hierarchy)).toBe(true);
  });

  it("fails closed for missing and unknown roles", () => {
    expect(hasRoleAtLeast("unknown", "viewer", hierarchy)).toBe(false);
    expect(hasRoleAtLeast("owner", "unknown", hierarchy)).toBe(false);
    expect(resolveViewerRole({ subjectId: "person", role: "unknown" }, hierarchy)).toBeUndefined();
    expect(viewerHasAccess(undefined, "viewer", hierarchy)).toBe(false);
    expect(viewerHasAccess({ subjectId: "person" }, "viewer", hierarchy)).toBe(false);
    expect(viewerHasAccess({ role: "owner" } as never, "viewer", hierarchy)).toBe(false);
    expect(viewerHasAccess({ subjectId: "", role: "owner" }, "viewer", hierarchy)).toBe(false);
  });
});
