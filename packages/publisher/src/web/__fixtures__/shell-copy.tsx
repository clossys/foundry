/** Test-only Writer host for Designer shells rendered by Publisher views. Reuses the Designer test labels; never a production fallback. */
import { createElement, type ReactElement, type ReactNode } from "react";
import { ShellCopyProvider, type ShellCopyResolver } from "@clossys/designer/frames";
import labels from "../../../../designer/src/frames/__fixtures__/shell-copy.json" with { type: "json" };

export const shellCopyFixtureResolver: ShellCopyResolver = ref => {
  const template = (labels as Readonly<Record<string, string>>)[ref.id];
  return template === undefined ? undefined : { ref, text: template.replace(/\{([a-zA-Z]+)\}/g, (match, key: string) => String(ref.values?.[key] ?? match)) };
};
/** Supplies the fixture Writer resolver; pass as a testing-library `wrapper` or wrap a tree. */
export function ShellCopyTestHost({ children }: { children?: ReactNode }) {
  return <ShellCopyProvider resolver={shellCopyFixtureResolver}>{children}</ShellCopyProvider>;
}
/** Wrap a testing-library `render` so every render and rerender sits inside the test Writer host. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function hostedRender<R extends (ui: ReactElement, options?: any) => unknown>(render: R): R {
  return ((ui: ReactElement, options?: object) => render(ui, { wrapper: ShellCopyTestHost, ...options })) as R;
}
/** Wrap a react-dom/server renderer (renderToStaticMarkup, renderToString) the same way. */
export function hostedMarkup(render: (node: ReactNode) => string): (node: ReactNode) => string {
  return node => render(createElement(ShellCopyTestHost, null, node));
}
