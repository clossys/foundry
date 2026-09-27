/**
 * Vercel adapter for the package hosting commands (issue #1526).
 *
 * A hosting config calls these commands directly. `ignoreCommand` is
 * `builder hosting should-build`, whose exit 1 continues the build.
 */

const ID = /^[a-z][a-z0-9-]{0,63}$/;

export type VercelHostingCommands = {
  readonly installCommand: string;
  readonly ignoreCommand: string;
};

export function vercelHostingCommands(surfaceId: string): VercelHostingCommands {
  if (!ID.test(surfaceId)) throw new TypeError("surface id must be a lowercase stable identifier");
  return {
    installCommand: `builder hosting install --surface ${surfaceId}`,
    ignoreCommand: `builder hosting should-build --surface ${surfaceId}`,
  };
}
