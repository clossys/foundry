import { resolve } from "node:path";

export const designerDogfoodUsage = "usage: check-designer-dogfood.mjs --admin-root SOURCE [--admin-root SOURCE]... [--root ADDITIONAL_SOURCE]...";

/** Required consumers cannot be replaced by a caller's narrower diagnostic root. */
export function designerDogfoodScopes(args, repoRoot, cwd = process.cwd()) {
  const adminShell = [], additional = [];
  for (let index = 0; index < args.length; index++) {
    const flag = args[index], value = args[index + 1];
    if (!["--root", "--admin-root"].includes(flag) || !value || value.startsWith("--")) throw new Error(designerDogfoodUsage);
    (flag === "--admin-root" ? adminShell : additional).push(resolve(cwd, value));
    index++;
  }
  if (!adminShell.length) throw new Error("Admin shell source scope is required. " + designerDogfoodUsage);
  return {
    studio: [resolve(repoRoot, "packages/designer/src/studio")],
    publisher: [resolve(repoRoot, "packages/publisher/src/web/publisher/PublisherPage.tsx")],
    adminShell: [...new Set(adminShell)].sort(),
    additional: [...new Set(additional)].sort(),
  };
}

/** The exact roots passed to the scanner, including every required consumer scope. */
export function designerDogfoodRoots(scopes) {
  return [...new Set(Object.values(scopes).flat())];
}
