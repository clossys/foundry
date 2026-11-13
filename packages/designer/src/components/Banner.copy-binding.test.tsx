import { expect, it } from "vitest";
import { resolveShellCopy, SHELL_COPY_REFS, type ShellCopyResolver } from "./Banner.copy.js";

const pseudo: ShellCopyResolver = ref => ({ ref, text: `[[${ref.id}]]` });
it("refuses missing, mismatched, blank and non-finite resolutions without English fallback", () => {
  expect(() => resolveShellCopy(undefined, SHELL_COPY_REFS.banner.dismiss)).toThrow(/resolver/);
  expect(() => resolveShellCopy(() => undefined, SHELL_COPY_REFS.banner.dismiss)).toThrow(/unresolved/);
  expect(() => resolveShellCopy(() => ({ ref: { id: "wrong" }, text: "Wrong" }), SHELL_COPY_REFS.banner.dismiss)).toThrow(/unresolved/);
  expect(() => resolveShellCopy(ref => ({ ref, text: " " }), SHELL_COPY_REFS.banner.dismiss)).toThrow(/unresolved/);
  expect(() => resolveShellCopy(pseudo, SHELL_COPY_REFS.commands.results, { count: Infinity })).toThrow(/values/);
});
