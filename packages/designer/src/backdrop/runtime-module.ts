import { BACKDROP_BUDGET_CEILING_BYTES } from "./contract.js";
import { checkConsumerArtContract, type StillBackdropArt } from "./consumer-art.js";

/** Consumer-owned executable decoration. The host resolves this key; it is never a network URL. */
export interface RuntimeBackdropResource {
  kind: "module";
  moduleRef: string;
  poster: StillBackdropArt;
  still: StillBackdropArt;
  /** Declared transferred bytes of the executable and its imported resources. */
  moduleBytes: number;
  /** Total declared transfer budget, including both fallback images. */
  budgetBytes: number;
}

export interface BackdropModuleInstance {
  setPaused(paused: boolean): void;
  destroy(): void;
}
export interface BackdropRuntimeModule {
  mount(element: HTMLElement, options: { paused: boolean; signal: AbortSignal }): BackdropModuleInstance | Promise<BackdropModuleInstance>;
}
/** Import functions are provided by the consumer's static module registry, never constructed from an untrusted string. */
export type BackdropModuleLoaders = Readonly<Record<string, () => Promise<BackdropRuntimeModule>>>;

const localPath = (value: unknown): value is string => typeof value === "string"
  && /^(?:\.\/|\/)[A-Za-z0-9_./-]+$/.test(value) && !value.startsWith("//")
  && !value.split("/").includes("..");
const positiveBytes = (value: unknown): value is number => typeof value === "number"
  && Number.isSafeInteger(value) && value > 0 && value <= BACKDROP_BUDGET_CEILING_BYTES;

function localStill(value: unknown): value is StillBackdropArt {
  if (!checkConsumerArtContract(value).ok) return false;
  const art = value as StillBackdropArt;
  return art.slot === "backdrop" && art.loading === "lazy"
    && (art.source.format === "svg" || localPath(art.source.src));
}

/** Offline declarations only: this does not measure network transfers or inspect consumer module code. */
export function checkRuntimeBackdrop(value: unknown): value is RuntimeBackdropResource {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const resource = value as RuntimeBackdropResource;
  return resource.kind === "module" && localPath(resource.moduleRef)
    && localStill(resource.poster) && localStill(resource.still)
    && positiveBytes(resource.moduleBytes) && positiveBytes(resource.budgetBytes)
    && resource.moduleBytes + resource.poster.bytes + resource.still.bytes <= resource.budgetBytes;
}
