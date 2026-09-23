import { isValidWebSurfaceDeclaration } from "./validate.js";
import type { WebSurfaceDeclaration, WebSurfaceDeclarationDefinition } from "./types.js";

/**
 * Creates a detached, defaulted web surface declaration after callers have
 * validated their own input. Refuses (throws) rather than defining an
 * invalid declaration -- the same contract `defineDeploymentConfiguration
 * Plan` already holds in `../configuration.ts`.
 */
export function defineWebSurfaceDeclaration(definition: WebSurfaceDeclarationDefinition): WebSurfaceDeclaration {
  if (!isValidWebSurfaceDeclaration(definition)) throw new TypeError("Invalid web surface declaration.");
  return {
    schemaVersion: definition.schemaVersion,
    domain: definition.domain.trim().toLowerCase().replace(/\.$/, ""),
    dnsProvider: definition.dnsProvider,
    records: definition.records.map((entry) => ({
      type: entry.type,
      name: entry.name,
      value: entry.value,
      ...(entry.priority === undefined ? {} : { priority: entry.priority }),
      proxied: entry.proxied ?? false,
    })),
    hostingProvider: definition.hostingProvider,
    hostingProject: definition.hostingProject,
    build: {
      command: definition.build.command,
      outputDirectory: definition.build.outputDirectory,
      applicationRoot: definition.build.applicationRoot,
    },
    environments: definition.environments.map((entry) => ({
      environment: entry.environment,
      hostname: entry.hostname.trim().toLowerCase().replace(/\.$/, ""),
      branch: entry.branch,
    })),
    routes: [...new Set(["/", ...(definition.routes ?? [])])],
  };
}
