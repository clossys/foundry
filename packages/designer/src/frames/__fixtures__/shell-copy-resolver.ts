/** Explicit legacy-language Writer resolver for tests. Pure: no React context, so other packages' test hosts can reuse it. Never a production fallback. */
import labels from "./shell-copy.json" with { type: "json" };
import type { ShellCopyResolver } from "../../components/Banner.copy.js";
export const shellCopyFixtureResolver: ShellCopyResolver = ref => {
  const template = (labels as Readonly<Record<string, string>>)[ref.id];
  return template === undefined ? undefined : { ref, text: template.replace(/\{([a-zA-Z]+)\}/g, (match, key: string) => String(ref.values?.[key] ?? match)) };
};
