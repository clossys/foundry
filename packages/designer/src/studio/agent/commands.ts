/** Agent actions use permanent leaf identities; placement is presentation data only. */
export function changeCommandFor(leaf: string): string | undefined {
  return /^(themes|assets|components|sections|frames)\.[a-z0-9-]+$/.exec(leaf)?.[0] === leaf
    ? `designer-library reselect --root <library> --leaf ${leaf} --source <source-id>` : undefined;
}
export const DESIGNER_AGENT_COMMANDS = Object.freeze([
  "designer-library reselect --root <library> --leaf <leaf-id> --source <source-id> [--write] [--json]",
  "designer-library generate-starter --root <library> --leaf <leaf-id> [--write] [--json]",
  "designer-library select --root <library> --starter <shadcn-base|custom> [--write]",
  "designer-library capture --root <library> --driver <module> --out <dir> [--leaf <leaf-id>]",
] as const);
