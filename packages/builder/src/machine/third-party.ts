import { join } from "node:path";
import type { SkillScope } from "@vespeneventures/controller/conventions";
import {
  MACHINE_DECLARATION_SCHEMA_VERSION,
  THIRD_PARTY_DECLARATION_FILENAME,
} from "./types.js";
import type {
  DiscoveryPort,
  ThirdPartySkillsDeclaration,
  ThirdPartySkillsResult,
} from "./types.js";

/**
 * The third-party-scoped skill source of truth.
 *
 * The concrete case this exists for: one vendored skill belonging to no
 * account, with no account workspace to live in. Every skill this resolves
 * is tagged `scope: THIRD_PARTY_SCOPE` — a value drawn directly from
 * `@vespeneventures/controller/conventions`'s own `SkillScope` union, never a
 * second literal this module invented. If that union ever drops
 * `"third-party"`, `THIRD_PARTY_SCOPE`'s assignment stops compiling — this is
 * the reuse enforced at the type level, not merely by convention.
 *
 * Shaped identically to `discovery.ts`'s ternary for the same reason: a root
 * that cannot be resolved or read is `indeterminate` with no skills at all; a
 * declaration that exists but is malformed, or names a skill this root
 * cannot actually find on disk, is `indeterminate` rather than a silently
 * shorter skill list. There is no per-skill partial success here — one
 * unreadable declared skill makes the whole source of truth indeterminate,
 * because a caller composing a machine from an indeterminate source must
 * never install the skills that DID resolve while quietly dropping the one
 * that didn't.
 */

export const THIRD_PARTY_SCOPE: SkillScope = "third-party";

export const THIRD_PARTY_ROOT_ENV_VAR = "BUILDER_MACHINE_THIRD_PARTY_SKILLS_ROOT";

/** Same shape as `resolveWorkspacesRoot` in `discovery.ts` — see that function's doc comment. */
export function resolveThirdPartyRoot(options: {
  readonly root?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
}): string | undefined {
  if (options.root !== undefined && options.root !== "") return options.root;
  const fromEnv = options.env?.[THIRD_PARTY_ROOT_ENV_VAR];
  return fromEnv !== undefined && fromEnv !== "" ? fromEnv : undefined;
}

function parseDeclaration(raw: unknown): ThirdPartySkillsDeclaration | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const record = raw as Record<string, unknown>;
  if (record.schemaVersion !== MACHINE_DECLARATION_SCHEMA_VERSION) return undefined;
  if (!Array.isArray(record.skills) || !record.skills.every((entry) => typeof entry === "string")) {
    return undefined;
  }
  const skills = record.skills as string[];
  if (skills.some((name) => name.trim() === "")) return undefined;
  if (new Set(skills).size !== skills.length) return undefined;
  return { schemaVersion: MACHINE_DECLARATION_SCHEMA_VERSION, skills };
}

/**
 * Load the third-party skill source of truth from `root`. `root` is always
 * caller- or environment-supplied — see `resolveThirdPartyRoot` — never a
 * default this module invents.
 */
export function loadThirdPartySkills(
  port: DiscoveryPort,
  options: { readonly root: string | undefined },
): ThirdPartySkillsResult {
  if (options.root === undefined) {
    return {
      verdict: "indeterminate",
      root: undefined,
      reason: "root-not-declared",
      detail: `No third-party skills root was supplied and ${THIRD_PARTY_ROOT_ENV_VAR} is not set.`,
      skills: [],
    };
  }

  const rootEntries = port.readdir(options.root);
  if (rootEntries === undefined) {
    return {
      verdict: "indeterminate",
      root: options.root,
      reason: "root-unreadable",
      detail: `${options.root}: could not be listed`,
      skills: [],
    };
  }

  const declarationPath = join(options.root, THIRD_PARTY_DECLARATION_FILENAME);
  const raw = port.readTextFile(declarationPath);
  if (raw === undefined) {
    return {
      verdict: "indeterminate",
      root: options.root,
      reason: "declaration-unreadable",
      detail: `${declarationPath}: could not be read as text`,
      skills: [],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      verdict: "indeterminate",
      root: options.root,
      reason: "declaration-malformed",
      detail: `${declarationPath}: ${(error as Error).message}`,
      skills: [],
    };
  }

  const declaration = parseDeclaration(parsed);
  if (declaration === undefined) {
    return {
      verdict: "indeterminate",
      root: options.root,
      reason: "declaration-invalid-schema",
      detail: `${declarationPath}: must declare schemaVersion ${MACHINE_DECLARATION_SCHEMA_VERSION} and a skills array of unique, non-empty strings`,
      skills: [],
    };
  }

  const onDisk = new Set(rootEntries);
  const missing = declaration.skills.filter((name) => !onDisk.has(name));
  if (missing.length > 0) {
    return {
      verdict: "indeterminate",
      root: options.root,
      reason: "declared-skill-missing-on-disk",
      detail: `${declarationPath} declares ${missing.join(", ")}, which ${missing.length === 1 ? "does" : "do"} not exist under ${options.root}`,
      skills: [],
    };
  }

  return {
    verdict: "satisfied",
    root: options.root,
    skills: [...declaration.skills].sort().map((name) => ({ name, scope: THIRD_PARTY_SCOPE })),
  };
}
