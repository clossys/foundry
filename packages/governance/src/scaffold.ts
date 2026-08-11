import type { NewPackagePlan, NewPackagePlanInput, NewPackagePlanProfile, PackageScaffoldFile } from "./types.js";

const PACKAGE_NAME = /^@([a-z0-9][a-z0-9._-]*)\/([a-z0-9][a-z0-9._-]*)$/;
const VERSION = /^0\.1\.0$/;

function assertPlanInput(input: NewPackagePlanInput): { directory: string; version: string } {
  const match = PACKAGE_NAME.exec(input.name);
  if (!match) throw new Error("planNewPackage: name must be a scoped npm package name.");
  if (input.description.trim().length === 0) throw new Error("planNewPackage: description must be non-empty.");
  const version = input.version ?? "0.1.0";
  if (!VERSION.test(version)) throw new Error("planNewPackage: version must be the initial version 0.1.0.");
  const directory = input.directory ?? `packages/${match[2]}`;
  if (directory.startsWith("/") || directory.split("/").some((part) => part.length === 0 || part === "." || part === "..")) {
    throw new Error("planNewPackage: directory must be a non-empty relative path without traversal.");
  }
  return { directory, version };
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`planNewPackage: profile.${path} must be a non-empty string.`);
  }
  return value;
}

function requireRecord(value: unknown, path: string): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`planNewPackage: profile.${path} must be an object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function validateProfile(profile: NewPackagePlanProfile): void {
  const manifest = requireRecord(profile.manifest, "manifest");
  for (const field of ["name", "version", "description"]) {
    if (Object.prototype.hasOwnProperty.call(manifest, field)) {
      throw new Error(`planNewPackage: profile.manifest must not override ${field}.`);
    }
  }
  for (const field of ["author", "license", "homepage"]) requireString(manifest[field], `manifest.${field}`);
  const repository = requireRecord(manifest.repository, "manifest.repository");
  requireString(repository.type, "manifest.repository.type");
  requireString(repository.url, "manifest.repository.url");
  const bugs = manifest.bugs;
  if (typeof bugs === "string") requireString(bugs, "manifest.bugs");
  else requireString(requireRecord(bugs, "manifest.bugs").url, "manifest.bugs.url");
  requireRecord(manifest.engines, "manifest.engines");
  requireRecord(manifest.scripts, "manifest.scripts");
  const devDependencies = requireRecord(manifest.devDependencies, "manifest.devDependencies");
  if (Object.keys(devDependencies).length === 0) {
    throw new Error("planNewPackage: profile.manifest.devDependencies must not be empty.");
  }
  if (manifest.private !== true && manifest.private !== false) {
    throw new Error("planNewPackage: profile.manifest.private must be a boolean.");
  }
  if (manifest.private === false) {
    requireString(requireRecord(manifest.publishConfig, "manifest.publishConfig").registry, "manifest.publishConfig.registry");
  }
  for (const field of ["tsconfig", "sourceIndex", "sourceTest", "readme", "licenseText"] as const) {
    requireString(profile.files[field], `files.${field}`);
  }
  requireString(profile.files.testConfig.path, "files.testConfig.path");
  requireString(profile.files.testConfig.content, "files.testConfig.content");
  if (profile.files.testConfig.path.startsWith("/") || profile.files.testConfig.path.includes("..")) {
    throw new Error("planNewPackage: profile.files.testConfig.path must be a safe relative path.");
  }
  const date = requireString(profile.changelog.date, "changelog.date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00.000Z`))) {
    throw new Error("planNewPackage: profile.changelog.date must use YYYY-MM-DD.");
  }
  requireString(profile.changelog.initialEntry, "changelog.initialEntry");
}

function starterPlan(input: NewPackagePlanInput, directory: string, version: string): NewPackagePlan {
  const manifest = {
    name: input.name,
    version,
    private: true,
    description: input.description.trim(),
  };
  return {
    directory,
    readiness: "starter",
    requiredActions: [
      "Choose repository-specific build, test, and package-manager configuration.",
      "Choose package visibility, ownership, repository, and registry metadata.",
      "Supply the authoritative license text and a dated changelog entry.",
      "Add an active lifecycle entry and complete the owning repository's package-registration process.",
    ],
    files: [
      { path: "package.json", content: `${JSON.stringify(manifest, null, 2)}\n` },
      { path: "src/index.ts", content: "/** Package API proposal. Define reviewed exports here. */\nexport {};\n" },
      { path: "README.md", content: `# ${input.name}\n\n${input.description.trim()}\n\nThis is a starter plan, not a publishable package scaffold. The owning repository must supply its build, test, release, license, and lifecycle conventions before writing these files.\n` },
    ],
  };
}

function profiledPlan(input: NewPackagePlanInput, directory: string, version: string, profile: NewPackagePlanProfile): NewPackagePlan {
  validateProfile(profile);
  const { name: _name, version: _version, description: _description, ...profileManifest } = profile.manifest;
  const manifest = {
    name: input.name,
    version,
    description: input.description.trim(),
    ...profileManifest,
  };
  const files: readonly PackageScaffoldFile[] = [
    { path: "package.json", content: `${JSON.stringify(manifest, null, 2)}\n` },
    { path: "tsconfig.json", content: `${profile.files.tsconfig}\n` },
    profile.files.testConfig,
    { path: "src/index.ts", content: `${profile.files.sourceIndex}\n` },
    { path: "src/index.test.ts", content: `${profile.files.sourceTest}\n` },
    { path: "README.md", content: `${profile.files.readme}\n` },
    { path: "CHANGELOG.md", content: `# Changelog\n\n## [${version}] - ${profile.changelog.date}\n\n### Added\n\n- ${profile.changelog.initialEntry}\n` },
    { path: "LICENSE", content: `${profile.files.licenseText}\n` },
  ];
  return { directory, files, readiness: "profiled", requiredActions: [] };
}

/**
 * Plans an intentionally private starter, or a repository-profiled package,
 * without touching disk, Git, registries, credentials, or consumer
 * configuration. The caller reviews and writes the returned files through its
 * own change process. A starter is not publishable.
 */
export function planNewPackage(input: NewPackagePlanInput): NewPackagePlan {
  const { directory, version } = assertPlanInput(input);
  return input.profile ? profiledPlan(input, directory, version, input.profile) : starterPlan(input, directory, version);
}
