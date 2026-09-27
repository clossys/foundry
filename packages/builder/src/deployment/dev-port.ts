/**
 * Each deployment surface record can declare `localPort`. The surface's dev
 * script is checked against that port (issue #1529, v0).
 */

import type { DeploymentFinding } from "./types.js";

function record(findings: DeploymentFinding[], rule: string, message: string, path?: string): void {
  findings.push({ rule, severity: "error", message, ...(path === undefined ? {} : { path }) });
}

/** Port flags a dev script uses to bind: `--port 4321`, `--port=4321`, `-p 4321`. */
export function devScriptPorts(script: string): readonly number[] {
  const ports: number[] = [];
  const flags = /(?:^|\s)(?:--port(?:=|\s+)|-p(?:=|\s+)?)(\d+)/g;
  for (const match of script.matchAll(flags)) {
    const digits = match[1];
    if (digits === undefined) continue;
    ports.push(Number(digits));
  }
  return ports;
}

export function checkDeploymentSurfaceDevPort(
  surface: { readonly localPort?: unknown; readonly devScript?: unknown },
  path = "surface",
): readonly DeploymentFinding[] {
  const findings: DeploymentFinding[] = [];
  const hasPort = surface.localPort !== undefined;
  const hasScript = surface.devScript !== undefined;
  if (!hasPort && !hasScript) return findings;

  if (hasPort && (typeof surface.localPort !== "number" || !Number.isInteger(surface.localPort) || surface.localPort < 1 || surface.localPort > 65535)) {
    record(findings, "local-port", "localPort must be an integer from 1 through 65535.", `${path}.localPort`);
  }
  if (hasPort && !hasScript) record(findings, "dev-script", "devScript must be declared when localPort is set.", `${path}.devScript`);
  if (hasScript && !hasPort) record(findings, "local-port", "localPort must be declared when devScript is set.", `${path}.localPort`);
  if (hasScript && (typeof surface.devScript !== "string" || surface.devScript.trim().length === 0 || surface.devScript.length > 1_000 || /[\r\n\0]/.test(surface.devScript))) {
    record(findings, "dev-script", "devScript must be a non-empty single-line command.", `${path}.devScript`);
    return findings;
  }
  if (typeof surface.localPort !== "number" || typeof surface.devScript !== "string") return findings;
  if (!Number.isInteger(surface.localPort) || surface.localPort < 1 || surface.localPort > 65535) return findings;

  const ports = devScriptPorts(surface.devScript);
  if (ports.length === 0 || ports.some((port) => port !== surface.localPort)) {
    record(findings, "dev-script-port", "devScript must pass localPort.", `${path}.devScript`);
  }
  return findings;
}
