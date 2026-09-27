/**
 * Vercel adapter for the package hosting commands (issue #1526).
 *
 * A hosting config calls these commands directly. `ignoreCommand` is
 * `builder hosting should-build`, whose exit 1 continues the build.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const builderPackageVersion = (JSON.parse(
  readFileSync(require.resolve("../../../package.json"), "utf8"),
) as { version: string }).version;

const ID = /^[a-z][a-z0-9-]{0,63}$/;

function npxBuilderHosting(subcommand: "install" | "should-build", surfaceId: string): string {
  return `npx @clossys/builder@${builderPackageVersion} hosting ${subcommand} --surface ${surfaceId}`;
}

export type VercelHostingCommands = {
  readonly installCommand: string;
  readonly ignoreCommand: string;
};

export function vercelHostingCommands(surfaceId: string): VercelHostingCommands {
  if (!ID.test(surfaceId)) throw new TypeError("surface id must be a lowercase stable identifier");
  return {
    installCommand: npxBuilderHosting("install", surfaceId),
    ignoreCommand: npxBuilderHosting("should-build", surfaceId),
  };
}
