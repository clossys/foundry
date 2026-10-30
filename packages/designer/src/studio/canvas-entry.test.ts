import { expect, it, vi } from "vitest";

// A generic board must stay usable when the application-specific sessions
// cannot load. Keep the canvas facade independent of those controllers.
vi.mock("./StudioProvider.js", () => { throw new Error("Studio session imported by generic canvas"); });
vi.mock("./WholeStudioProvider.js", () => { throw new Error("Whole Studio session imported by generic canvas"); });

it("loads the canvas facade without either Studio session controller", async () => {
  const { CanvasSurface, CanvasLod } = await import("./canvas.js");
  expect(typeof CanvasSurface).toBe("function");
  expect(typeof CanvasLod).toBe("function");
});
