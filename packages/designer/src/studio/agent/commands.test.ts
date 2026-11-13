// @vitest-environment node
import { expect, it } from "vitest";
import { changeCommandFor, DESIGNER_AGENT_COMMANDS } from "./commands.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
it("uses only permanent leaf IDs in agent instructions", () => {
  for (const layer of ["themes", "assets", "components", "sections", "frames"]) expect(changeCommandFor(`${layer}.example-leaf`)).toBe(`designer-library reselect --root <library> --leaf ${layer}.example-leaf --source <source-id>`);
  for (const id of ["foo/bar", "themes.group.leaf", "components.A", "themes.a\n"]) expect(changeCommandFor(id)).toBeUndefined();
  expect(DESIGNER_AGENT_COMMANDS).toHaveLength(4);
  const docs = readFileSync(fileURLToPath(new URL("../../../skill/library-commands.md", import.meta.url)), "utf8");
  for (const command of DESIGNER_AGENT_COMMANDS) expect(docs).toContain(command);
});
