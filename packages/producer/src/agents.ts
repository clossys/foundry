import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

export const AGENT_PACKAGES = {
  director: ["@clossys/director", "@clossys/strategist"],
  designer: ["@clossys/designer"],
  writer: ["@clossys/writer"],
  publisher: ["@clossys/publisher"],
} as const;

export type AgentKind = keyof typeof AGENT_PACKAGES;
export type AgentResolver = (packageName: string) => string;
export interface ResolvedAgent {
  kind: AgentKind;
  packageName: string;
  packageRoot: string;
}

export class AgentResolutionError extends Error {
  readonly exitCode = 2;
  readonly tried: readonly string[];

  constructor(kind: AgentKind, tried: readonly string[]) {
    super(`Cannot resolve ${kind} agent. Tried: ${tried.join(", ")}`);
    this.name = "AgentResolutionError";
    this.tried = [...tried];
  }
}

const producerRequire = createRequire(import.meta.url);

function resolveInstalledPackage(packageName: string): string {
  // Agents can expose only import subpaths, so their bare name and manifest
  // need not be exported. Use Producer's Node lookup paths without loading code.
  for (const searchPath of producerRequire.resolve.paths(packageName) ?? []) {
    const packageRoot = join(searchPath, packageName);
    try {
      const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
      if (manifest.name === packageName) return realpathSync(packageRoot);
    } catch {
      // Continue to the next Node package lookup location.
    }
  }
  throw new Error(`Package unavailable: ${packageName}`);
}

export function resolveAgent(kind: AgentKind, resolver: AgentResolver = resolveInstalledPackage): ResolvedAgent {
  const tried = AGENT_PACKAGES[kind];
  for (const packageName of tried) {
    try {
      return { kind, packageName, packageRoot: resolver(packageName) };
    } catch {
      // The first available candidate wins; no agent code is imported here.
    }
  }
  throw new AgentResolutionError(kind, tried);
}
