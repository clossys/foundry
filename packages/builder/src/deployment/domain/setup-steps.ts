import type { WebSurfaceDeclaration } from "./types.js";

/**
 * Deterministically renders the exact configuration a coding agent reviews
 * and applies through the provider CLIs -- see #1187's governing "who does
 * what" split: this package states, in full, what should exist; the agent
 * is the one that runs `wrangler`/`vercel`/`gh` with the human's approval.
 * Performs no I/O, authentication, or provider call of any kind, the same
 * discipline `renderVercelConfiguration`'s own `repositorySetup` array
 * already holds in `../vercel/configuration.ts`.
 */
export function renderWebSurfaceSetupSteps(declaration: WebSurfaceDeclaration): readonly string[] {
  const steps: string[] = [`Create ${declaration.records.length} DNS record(s) for ${declaration.domain} with ${declaration.dnsProvider}:`];
  for (const record of declaration.records) {
    const name = record.name === "@" ? declaration.domain : `${record.name}.${declaration.domain}`;
    const priority = record.priority === undefined ? "" : ` (priority ${record.priority})`;
    const proxied = record.proxied ? " (proxied)" : "";
    steps.push(`  - ${record.type} ${name} -> ${record.value}${priority}${proxied}`);
  }
  steps.push(
    `Create or link hosting project "${declaration.hostingProject}" on ${declaration.hostingProvider}, ` +
      `with its application root set to "${declaration.build.applicationRoot}".`,
    `Set the build command to "${declaration.build.command}" and the output directory to "${declaration.build.outputDirectory}".`,
  );
  for (const environment of declaration.environments) {
    steps.push(`Bind the "${environment.environment}" environment to branch "${environment.branch}", serving ${environment.hostname}.`);
  }
  steps.push("Review every value above before applying it; this function does not authenticate, call a provider API, or change anything live.");
  return steps;
}
