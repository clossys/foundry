import { describe, expect, it } from "vitest";
import { readStudioMessage, StudioCopyNeedsError, type StudioCopyBinding } from "./copy-binding.js";

describe("Studio copy host binding", () => {
  it("names the missing host binding instead of failing on a property read", () => {
    const read = () => readStudioMessage(undefined as unknown as StudioCopyBinding, "studio.usage.title");
    expect(read).toThrow(StudioCopyNeedsError);
    expect(read).toThrow("studio.copy.binding");
  });
});
