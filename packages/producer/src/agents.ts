import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { errorMessage, isAbsent } from "./errors.js";

export const AGENT_PACKAGES = {
  director: ["@clossys/director"],
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
  readonly failures: readonly string[];

  constructor(kind: AgentKind, tried: readonly string[], failures: readonly string[] = []) {
    super(`Cannot resolve ${kind} agent. Tried: ${tried.join(", ")}${failures.length ? ` (${failures.join("; ")})` : ""}`);
    this.name = "AgentResolutionError";
    this.tried = [...tried];
    this.failures = [...failures];
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
    } catch (error) {
      // An absent manifest sends the lookup to the next Node location; an unreadable or
      // malformed one is a broken install and surfaces as itself.
      if (!isAbsent(error)) throw error;
    }
  }
  throw new Error(`Package unavailable: ${packageName}`);
}

export function resolveAgent(kind: AgentKind, resolver: AgentResolver = resolveInstalledPackage): ResolvedAgent {
  const tried = AGENT_PACKAGES[kind];
  const failures: string[] = [];
  for (const packageName of tried) {
    try {
      return { kind, packageName, packageRoot: resolver(packageName) };
    } catch (error) {
      // The first available candidate wins; every refusal is kept for the resolution error.
      failures.push(`${packageName}: ${errorMessage(error)}`);
    }
  }
  throw new AgentResolutionError(kind, tried, failures);
}
