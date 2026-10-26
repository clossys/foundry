import { expect, it } from "vitest";
import { visibleFrameNotices, type AppFrameNotice } from "./frame-notices.js";
it("keeps at most three messages by severity, newest nearest the stage", () => {
  const notices: AppFrameNotice[] = [{ id: "old", severity: "info", text: "old" }, { id: "warning", severity: "warning", text: "warning" }, { id: "error", severity: "error", text: "error" }, { id: "new", severity: "success", text: "new" }];
  expect(visibleFrameNotices(notices, new Set()).map(item => item.id)).toEqual(["error", "warning", "new"]);
  expect(visibleFrameNotices(notices, new Set(["error", "warning"])).map(item => item.id)).toEqual(["error", "new", "old"]);
});
it("refuses ambiguous message ids", () => expect(() => visibleFrameNotices([{ id: "x", severity: "info", text: "a" }, { id: "x", severity: "error", text: "b" }], new Set())).toThrow());
