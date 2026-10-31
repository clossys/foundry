import { describe, expect, it } from "vitest";
import { buildStudioOpenContext } from "./open-context.js";
import { studioOpenHrefs } from "./open-targets.js";
const input = { projectPath: "/workspace/example & project", layer: "themes" as const, selectedId: "themes.background", taskPrompt: "Inspect & explain # current selection" };
describe("consumer-supplied Open in context", () => {
  it("builds the same bounded context without reading environment or changing the input", () => {
    const before = structuredClone(input);
    const context = buildStudioOpenContext(input);
    expect(context.prompt).toBe("Inspect & explain # current selection\nProject: /workspace/example & project\nLayer: tokens\nSelected item: themes.background");
    expect(buildStudioOpenContext(input)).toEqual(context); expect(input).toEqual(before);
    expect(buildStudioOpenContext({ ...input, selectedId: undefined }).prompt).not.toContain("Selected item:");
  });
  it("encodes the documented Claude Code and Codex prompt and project parameters separately", () => {
    const context = buildStudioOpenContext(input);
    for (const [href, promptKey, pathKey, protocol, host] of [
      [studioOpenHrefs.claude(context), "q", "folder", "claude:", "code"],
      [studioOpenHrefs.codex(context), "prompt", "path", "codex:", "new"],
    ]) {
      const url = new URL(href!);
      expect(url.protocol).toBe(protocol); expect(url.hostname).toBe(host);
      expect(url.searchParams.get(promptKey!)).toBe(context.prompt); expect(url.searchParams.get(pathKey!)).toBe(input.projectPath);
      expect([...url.searchParams.keys()]).toHaveLength(2);
    }
  });
  it("puts Cursor context into the prompt only and refuses a URL beyond its documented 10000 character limit", () => {
    const context = buildStudioOpenContext(input); const url = new URL(studioOpenHrefs.cursor(context)!);
    expect(url.protocol).toBe("cursor:"); expect(url.hostname).toBe("anysphere.cursor-deeplink"); expect(url.pathname).toBe("/prompt");
    expect([...url.searchParams.keys()]).toEqual(["text"]); expect(url.searchParams.get("text")).toBe(context.prompt);
    expect(studioOpenHrefs.cursor({ ...context, prompt: "x".repeat(10_000) })).toBeUndefined();
  });
});
