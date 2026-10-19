// @vitest-environment node
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import * as blocks from "./index.js";

describe("CommandMenu closed SSR", () => {
  it("renders exact empty closed bytes without accessing client platform or registering shortcuts", () => {
    const CommandMenu = (blocks as any).CommandMenu ?? (() => null);
    const useShortcut = (blocks as any).useCommandMenuShortcut ?? (() => {});
    const onOpen = vi.fn();
    function Host() {
      useShortcut({ onOpen });
      return <CommandMenu heading="Commands" searchLabel="Search" closeLabel="Close" emptyMessage="No commands"
        groups={[]} isOpen={false} onOpenChange={vi.fn()} query="" onQueryChange={vi.fn()} />;
    }
    expect((blocks as any).CommandMenu).toBeTypeOf("function");
    expect(renderToString(<Host />)).toBe("");
    expect(onOpen).not.toHaveBeenCalled();
  });
});
