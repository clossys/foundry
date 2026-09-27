/**
 * `builder hosting install` (issue #1526).
 *
 * Checks that each declared private scope routes to its declared registry,
 * then runs a frozen install (`npm ci`). Credential values are written only
 * to the user-level config the caller supplies, which must sit outside the
 * repository, and are not copied into the child environment.
 */

import { isAbsolute, relative, resolve } from "node:path";
import type { HostingSurface } from "./declaration.js";
import { readScopeRoutes, registriesMatch } from "./declaration.js";
import type { BuildEnvironmentReport } from "./environment.js";
import { checkBuildEnvironmentNames, childEnvironment, installOmittedNames } from "./environment.js";

export const FROZEN_INSTALL_ARGS = ["ci"] as const;

export type HostingInstallCode =
  | "credential-rejected"
  | "credential-missing"
  | "scope-misrouted"
  | "frozen-install-failed"
  | "user-config-inside-repository";

export type FrozenInstallRequest = {
  readonly args: readonly ["ci"];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly userConfigPath?: string;
};

export type FrozenInstallStatus = "ok" | "auth-rejected" | "failed";

export type UserConfigHandle = {
  readonly path: string;
  restore(): void;
};

export type HostingInstallPorts = {
  readonly repositoryRoot: string;
  readonly routeFileText: string;
  readonly hasEnvironmentName: (name: string) => boolean;
  readonly readCredential: (name: string) => string;
  readonly parentEnvironment: Readonly<Record<string, string | undefined>>;
  readonly presentEnvironmentNames: readonly string[];
  readonly writeUserConfig: (body: string) => UserConfigHandle;
  readonly runFrozenInstall: (request: FrozenInstallRequest) => FrozenInstallStatus;
};

export type HostingInstallResult =
  | { readonly ok: true; readonly buildEnvironment: BuildEnvironmentReport }
  | { readonly ok: false; readonly code: HostingInstallCode; readonly message: string; readonly scope?: string };

export function installErrorMessage(code: Exclude<HostingInstallCode, "frozen-install-failed" | "user-config-inside-repository">, scope: string): string {
  switch (code) {
    case "credential-rejected":
      return `scope ${scope}: credential rejected`;
    case "credential-missing":
      return `scope ${scope}: credential missing`;
    case "scope-misrouted":
      return `scope ${scope}: mis-routed scope`;
  }
}

/** npm's auth failure, classified without forwarding npm's own text. */
export function classifyFrozenInstallOutput(status: number | null, stderr: string): FrozenInstallStatus {
  if (status === 0) return "ok";
  if (/\b401\b|E401|unauthorized/i.test(stderr)) return "auth-rejected";
  return "failed";
}

export function isOutsideRepository(filePath: string, repositoryRoot: string): boolean {
  const compared = relative(resolve(repositoryRoot), resolve(filePath));
  return compared.startsWith("..") || isAbsolute(compared);
}

function registryAuthLine(registry: string, credential: string): string {
  const url = new URL(registry);
  const path = url.pathname === "/" ? "/" : (url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`);
  return `//${url.host}${path}:_authToken=${credential}`;
}

function renderUserConfig(surface: HostingSurface, credentials: ReadonlyMap<string, string>): string {
  const lines: string[] = [];
  for (const entry of surface.privateScopes) {
    const credential = credentials.get(entry.credentialVariable);
    if (credential === undefined) continue;
    lines.push(`${entry.scope}:registry=${entry.registry}`);
    lines.push(registryAuthLine(entry.registry, credential));
  }
  return `${lines.join("\n")}\n`;
}

export function runHostingInstall(surface: HostingSurface, ports: HostingInstallPorts): HostingInstallResult {
  const routes = readScopeRoutes(ports.routeFileText);
  for (const entry of surface.privateScopes) {
    const routed = routes.get(entry.scope);
    if (routed === undefined || !registriesMatch(entry.registry, routed)) {
      return {
        ok: false,
        code: "scope-misrouted",
        scope: entry.scope,
        message: installErrorMessage("scope-misrouted", entry.scope),
      };
    }
    if (!ports.hasEnvironmentName(entry.credentialVariable)) {
      return {
        ok: false,
        code: "credential-missing",
        scope: entry.scope,
        message: installErrorMessage("credential-missing", entry.scope),
      };
    }
  }

  const buildEnvironment = checkBuildEnvironmentNames(surface.buildEnvironment, ports.presentEnvironmentNames);
  const env = childEnvironment(ports.parentEnvironment, installOmittedNames(surface.privateScopes.map((entry) => entry.credentialVariable)));

  if (surface.privateScopes.length === 0) {
    const status = ports.runFrozenInstall({ args: FROZEN_INSTALL_ARGS, cwd: ports.repositoryRoot, env });
    if (status === "ok") return { ok: true, buildEnvironment };
    return { ok: false, code: "frozen-install-failed", message: "frozen install failed" };
  }

  const credentials = new Map<string, string>();
  for (const entry of surface.privateScopes) {
    const value = ports.readCredential(entry.credentialVariable);
    if (value.length === 0) {
      return {
        ok: false,
        code: "credential-missing",
        scope: entry.scope,
        message: installErrorMessage("credential-missing", entry.scope),
      };
    }
    credentials.set(entry.credentialVariable, value);
  }

  const written = ports.writeUserConfig(renderUserConfig(surface, credentials));
  try {
    if (!isOutsideRepository(written.path, ports.repositoryRoot)) {
      return { ok: false, code: "user-config-inside-repository", message: "user config is inside the repository" };
    }
    const status = ports.runFrozenInstall({
      args: FROZEN_INSTALL_ARGS,
      cwd: ports.repositoryRoot,
      env: { ...env, npm_config_userconfig: written.path },
      userConfigPath: written.path,
    });
    if (status === "ok") return { ok: true, buildEnvironment };
    if (status === "auth-rejected") {
      const scope = surface.privateScopes[0]?.scope ?? "";
      return {
        ok: false,
        code: "credential-rejected",
        scope,
        message: surface.privateScopes.map((entry) => installErrorMessage("credential-rejected", entry.scope)).join("\n"),
      };
    }
    return { ok: false, code: "frozen-install-failed", message: "frozen install failed" };
  } finally {
    written.restore();
  }
}
