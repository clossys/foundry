// @vitest-environment jsdom
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import * as blocks from "./index.js";
import type { PageBarProps } from "./PageBar.js";
const labels = { breadcrumb: "Report trail", collapsedBreadcrumb: "Earlier levels", pageInfo: "Report information", pageActions: "Other actions" };
afterEach(() => vi.unstubAllGlobals());
it.each([true, false])("hydrates stable IDs and corrects glass support without recoverable errors (supported=%s)", async supported => {
  const PageBar = (blocks as typeof blocks & { PageBar: (props: PageBarProps) => React.ReactNode }).PageBar;
  expect(PageBar).toBeTypeOf("function");
  vi.stubGlobal("matchMedia", (media: string) => ({ matches: false, media, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("CSS", { supports: () => supported, escape: (value: string) => value });
  const props: PageBarProps = { root: { label: "Workspace", href: "/" }, labels, page: { title: "Quarterly report", description: "Revenue and usage for the last three months." } };
  const tree = <PageBar {...props} />;
  const markup = renderToString(tree);
  expect(markup).toContain("bg-surface-raised");
  const host = document.createElement("div"); host.innerHTML = markup; document.body.append(host);
  const id = within(host).getByRole("button", { name: labels.pageInfo }).id;
  const recoverable = vi.fn(); let root: ReturnType<typeof hydrateRoot> | undefined;
  try {
    await act(async () => { root = hydrateRoot(host, tree, { onRecoverableError: recoverable }); });
    expect(recoverable).not.toHaveBeenCalled();
    expect(within(host).getByRole("button", { name: labels.pageInfo })).toHaveAttribute("id", id);
    expect(host.querySelector("header")).toHaveClass(supported ? "bg-surface-glass" : "bg-surface-raised");
  } finally { await act(async () => root?.unmount()); host.remove(); }
});
