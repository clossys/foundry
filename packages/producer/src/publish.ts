import { resolve } from "node:path";
import { resolveAgent } from "./agents.js";
import { loadConfig } from "./config/load.js";
import type { ProducerConfig, ProducerTarget } from "./config.js";
import type { AppLocalEmission, EmitAppLocalOptions } from "@clossys/publisher/app-local";

export interface PublishFinding { readonly kind: string; readonly path?: string; readonly message: string }
export class PublishVerdictError extends Error {
  readonly exitCode = 1;
  constructor(cause: unknown) { super(cause instanceof Error ? cause.message : String(cause)); this.name = "PublishVerdictError"; }
}
/** Public app-local package protocol. The Producer owns dispatch, not emission. */
export interface AppLocalEmitter {
  emitAppLocal(options: EmitAppLocalOptions): AppLocalEmission | Promise<AppLocalEmission>;
  writeAppLocal(directory: string, expected: AppLocalEmission): void | Promise<void>;
  verifyAppLocal(directory: string, expected: AppLocalEmission): readonly PublishFinding[] | Promise<readonly PublishFinding[]>;
}
export interface PublishDependencies {
  config?: (root: string) => Promise<ProducerConfig>;
  emitter?: () => Promise<AppLocalEmitter>;
}
export interface PublishResult {
  readonly exitCode: 0 | 1;
  readonly message: string;
  readonly target: string;
  readonly output: string;
  readonly findings: readonly PublishFinding[];
}

async function loadEmitter(): Promise<AppLocalEmitter> {
  const agent = resolveAgent("publisher");
  let api: Partial<AppLocalEmitter>;
  try { api = await import(`${agent.packageName}/app-local`); }
  catch (cause) { throw new Error(`Publisher app-local emitter is unavailable: ${cause instanceof Error ? cause.message : String(cause)}`); }
  for (const name of ["emitAppLocal", "writeAppLocal", "verifyAppLocal"] as const) {
    if (typeof api[name] !== "function") throw new Error(`Publisher app-local emitter is missing ${name}`);
  }
  return api as AppLocalEmitter;
}

/** Compile in memory first. Check mode never calls the writer. */
export async function publishTarget(
  options: { root: string; target: string; check?: boolean },
  dependencies: PublishDependencies = {},
): Promise<PublishResult> {
  const config = await (dependencies.config ?? loadConfig)(options.root);
  const preview = options.target === "preview";
  let target: ProducerTarget;
  if (Object.hasOwn(config.targets, options.target)) target = config.targets[options.target]!;
  else if (preview) {
    const candidates = Object.entries(config.targets).filter(([id, value]) => id !== "studio" && value.format === "web.page.responsive");
    if (candidates.length !== 1) throw new Error("Preview requires one web target or an explicit preview target");
    target = candidates[0]![1];
  } else throw new Error(`Unknown publish target: ${options.target}`);
  if (target.format !== "web.page.responsive") throw new Error("Publisher app-local currently supports web.page.responsive targets");
  const output = preview ? resolve(options.root, "clossys/.producer/preview", target.publication, "src/clossys") : resolve(options.root, target.app, "src", "clossys");
  const emitter = await (dependencies.emitter ?? loadEmitter)();
  try {
    const expected = await emitter.emitAppLocal({ root: options.root, target: { ...target, format: target.format }, outDir: output, ...(preview ? { destination: "producer-preview" as const } : {}) });
    if (!options.check) await emitter.writeAppLocal(output, expected);
    const findings = await emitter.verifyAppLocal(output, expected);
    if (!Array.isArray(findings)) throw new Error("Publisher verification did not return findings");
    return {
      exitCode: findings.length ? 1 : 0,
      message: findings.length ? `Publish check found ${findings.length} finding(s)` : `${options.check ? "Checked" : "Published"} target ${options.target}`,
      target: options.target, output, findings,
    };
  } catch (cause) { throw new PublishVerdictError(cause); }
}
