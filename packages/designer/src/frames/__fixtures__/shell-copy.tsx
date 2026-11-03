/** Explicit legacy-language fixture for existing interaction/geometry tests. Never a production fallback. */
import { createElement, type ComponentType, type ReactElement, type ReactNode } from "react";
import { ShellCopyProvider } from "../../components/Banner.copy-context.js";
import { shellCopyFixtureResolver } from "./shell-copy-resolver.js";
export { shellCopyFixtureResolver };
/** Test host that supplies the fixture Writer resolver; pass as a testing-library `wrapper` or wrap a tree. */
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
export function withShellCopy<P extends object>(Component: ComponentType<P>, explicit = false) {
  return function ShellCopyFixture(props: P) {
    return <ShellCopyProvider resolver={shellCopyFixtureResolver}><Component {...(explicit ? { copyResolver: shellCopyFixtureResolver } : {})} {...props} /></ShellCopyProvider>;
  };
}
