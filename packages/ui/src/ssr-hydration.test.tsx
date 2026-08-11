import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./atoms/Button.js";
import { PageHeader } from "./blocks/PageHeader.js";
import { Shell } from "./shell/Shell.js";

describe("SSR and hydration", () => {
  it("renders and hydrates reusable components without a recoverable mismatch", async () => {
    const tree = (
      <Shell>
        <Shell.Header>Shared chrome</Shell.Header>
        <Shell.Main>
          <PageHeader title="Resolved title" actions={<Button>Continue</Button>} />
        </Shell.Main>
      </Shell>
    );
    const serverHtml = renderToString(tree);
    const container = document.createElement("div");
    container.innerHTML = serverHtml;
    document.body.append(container);
    const onRecoverableError = vi.fn();

    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(container, tree, { onRecoverableError });
      await Promise.resolve();
    });

    expect(container.querySelector("main")?.id).toBe("ui-shell-main");
    expect(container.querySelector("button")?.textContent).toBe("Continue");
    expect(onRecoverableError).not.toHaveBeenCalled();

    await act(async () => root?.unmount());
    container.remove();
  });
});
