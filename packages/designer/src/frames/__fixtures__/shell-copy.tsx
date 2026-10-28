/** Explicit legacy-language fixture for existing interaction/geometry tests. Never a production fallback. */
import type { ComponentType } from "react";
import labels from "./shell-copy.json" with { type: "json" };
import { ShellCopyProvider } from "../../components/Banner.copy-context.js";
import type { ShellCopyResolver } from "../../components/Banner.copy.js";
export const shellCopyFixtureResolver: ShellCopyResolver = ref => {
  const template = (labels as Readonly<Record<string, string>>)[ref.id];
  return template === undefined ? undefined : { ref, text: template.replace(/\{([a-zA-Z]+)\}/g, (match, key: string) => String(ref.values?.[key] ?? match)) };
};
export function withShellCopy<P extends object>(Component: ComponentType<P>, explicit = false) {
  return function ShellCopyFixture(props: P) {
    return <ShellCopyProvider resolver={shellCopyFixtureResolver}><Component {...(explicit ? { copyResolver: shellCopyFixtureResolver } : {})} {...props} /></ShellCopyProvider>;
  };
}
