import { expect, expectTypeOf, it } from "vitest";
import * as frames from "./index.js";
import type { FrameNoticeApi } from "./index.js";

it("exports the page notice hook and its API type from the frames entry", () => {
  expect(typeof frames.useFrameNotice).toBe("function");
  expectTypeOf<FrameNoticeApi>().toHaveProperty("toast");
});
