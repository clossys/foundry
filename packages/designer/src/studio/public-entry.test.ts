import { expect, it } from "vitest";
import * as studio from "./index.js";
import { DesignerRoutePage } from "./route.js";

it("exposes the current Studio and native route without the retired complete-page API", () => {
  expect(typeof studio.Studio).toBe("function");
  expect(typeof DesignerRoutePage).toBe("function");
  expect(studio).not.toHaveProperty("DesignerPage");
  expect(studio).not.toHaveProperty("SystemCanvas");
});
