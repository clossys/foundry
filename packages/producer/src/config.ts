export interface ProducerTarget {
  readonly app: string;
  readonly format: string;
  readonly publication: string;
}

export interface ProducerConfig {
  readonly id: string;
  readonly archetype: string;
  readonly locales: { readonly default: string; readonly supported: readonly string[] };
  readonly targets: Readonly<Record<string, ProducerTarget>>;
  readonly studio?: { readonly port: number };
  readonly agents?: readonly ("director" | "designer" | "writer" | "publisher")[];
}

export class ConfigError extends Error {
  readonly exitCode = 2;
  constructor(message: string) { super(message); this.name = "ConfigError"; }
}

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === "string" && /^[a-z][a-z0-9-]*$/.test(value);
const locale = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(value);
function fail(message: string): never { throw new ConfigError(message); }
function keys(value: unknown, permitted: readonly string[], label: string): asserts value is Record<string, unknown> {
  if (!record(value)) fail(`${label} must be an object`);
  for (const key of Object.keys(value)) if (!permitted.includes(key)) fail(`Unknown ${label} key: ${key}`);
}

/** The public helper validates data; filesystem validation belongs to loadConfig. */
export function defineConfig<T extends ProducerConfig>(value: T): T {
  validateConfig(value); return value;
}

export function validateConfig(value: unknown): asserts value is ProducerConfig {
  keys(value, ["id", "archetype", "locales", "targets", "studio", "agents"], "config");
  if (!id(value.id) || !id(value.archetype)) fail("Config id and archetype must be lowercase kebab-case identities");
  keys(value.locales, ["default", "supported"], "locales");
  const supported = value.locales.supported;
  if (!locale(value.locales.default) || !Array.isArray(supported) || !supported.length || supported.some(item => !locale(item)) || new Set(supported).size !== supported.length || !supported.includes(value.locales.default)) fail("Locales must declare a supported default and unique locale identities");
  if (!record(value.targets) || !Object.keys(value.targets).length) fail("Config requires at least one target");
  for (const [name, target] of Object.entries(value.targets)) {
    if (!id(name) || ["constructor", "prototype", "__proto__"].includes(name)) fail("Invalid target identity");
    keys(target, ["app", "format", "publication"], `target ${name}`);
    if (typeof target.app !== "string" || (!/^apps\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(target.app) && !(name === "studio" && target.app === "packages/producer/studio"))) fail(`Target ${name} app must name an apps/* directory`);
    if (!["web.page.responsive", "deck.16x9"].includes(target.format as string)) fail(`Target ${name} has an unsupported format`);
    if (typeof target.publication !== "string" || !/^[a-z][a-z0-9.-]*$/.test(target.publication) || target.publication.includes("..")) fail(`Target ${name} requires a publication identity`);
  }
  if (value.studio !== undefined) {
    keys(value.studio, ["port"], "studio");
    if (!Number.isInteger(value.studio.port) || Number(value.studio.port) < 0 || Number(value.studio.port) > 65535) fail("Studio port must be an integer from 0 to 65535");
  }
  if (value.agents !== undefined && (!Array.isArray(value.agents) || value.agents.some(agent => !["director", "designer", "writer", "publisher"].includes(agent)) || new Set(value.agents).size !== value.agents.length)) fail("Agents must name unique supported agents");
}
