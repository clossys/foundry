# @vespeneventures/deployment

Dependency-free deployment surface contracts and read-only provider inspection
adapters, plus deterministic provider-configuration planning. The root entrypoint has no I/O. Provider adapters use caller-injected
`fetch` and obtain a bearer token only at inspection time; they never read a
secret store or process environment, and they make GET requests only.

```bash
npm install @vespeneventures/deployment
```

## Deployment surfaces

```ts
import {
  defineDeploymentManifest,
  evaluateDeploymentHealth,
  validateDeploymentManifest,
} from "@vespeneventures/deployment";

const manifest = defineDeploymentManifest({
  schemaVersion: "1",
  surfaces: [{
    id: "web",
    provider: "vercel",
    environment: "production",
    health: { kind: "http", url: "https://example.com/health" },
  }],
});

if (validateDeploymentManifest(manifest).length > 0) throw new Error("Invalid manifest");

const health = evaluateDeploymentHealth([
  { surfaceId: "web", status: "healthy" },
]);
```

Surface IDs and provider identifiers are stable lowercase identifiers. HTTP
health URLs must be HTTPS and cannot contain credentials, a query, or a
fragment. `defineDeploymentManifest` detaches its result but does not certify
input: use `validateDeploymentManifest` before accepting external authoring
input.

## Provider configuration planning

The configuration planner maps a previously validated manifest to explicit
static-site build, output, routing, and environment-variable-name requirements.
It does not render application artifacts, write files, read environment
variables or secret stores, authenticate, call provider APIs, apply provider
configuration, or trigger deployments. The repository reviews and writes the
returned artifact, then owns its CI and provider workflow.

```ts
import {
  defineDeploymentConfigurationPlan,
  defineDeploymentManifest,
  validateDeploymentConfigurationPlan,
} from "@vespeneventures/deployment";
import { renderVercelConfiguration } from "@vespeneventures/deployment/vercel";
import { renderRenderConfiguration } from "@vespeneventures/deployment/render";

const manifest = defineDeploymentManifest({
  schemaVersion: "1",
  surfaces: [
    { id: "web", provider: "vercel", environment: "production", health: { kind: "http", url: "https://example.com/health" } },
    { id: "docs", provider: "render", environment: "production", health: { kind: "http", url: "https://docs.example.com/health" } },
  ],
});

const definition = {
  manifest,
  requirements: [
    {
      surfaceId: "web",
      build: { command: "pnpm build:web", outputDirectory: "apps/web/dist" },
      routing: [{ source: "/*", destination: "/index.html" }],
      requiredEnvironmentVariables: ["PUBLIC_API_URL"],
    },
    {
      surfaceId: "docs",
      build: { command: "pnpm build:docs", outputDirectory: "apps/docs/dist" },
    },
  ],
};

if (validateDeploymentConfigurationPlan(definition).length > 0) throw new Error("Invalid configuration plan");
const plan = defineDeploymentConfigurationPlan(definition);
const vercel = renderVercelConfiguration(plan); // { path: "vercel.json", content, repositorySetup, ... }
const render = renderRenderConfiguration(plan); // { path: "render.yaml", content, repositorySetup, ... }
```

The Vercel renderer supports one Vercel surface per plan, because a repository
has one root `vercel.json`; make a plan per Vercel project when a repository
contains more than one. The Render renderer produces a static-site Blueprint
for every Render surface in the plan. Routes are internal rewrites only and
retain the author-provided order. `requiredEnvironmentVariables` accepts only
uppercase variable names, never values; returned `repositorySetup` steps tell
the caller where to configure those names without committing their values.

`renderVercelConfiguration` and `renderRenderConfiguration` are deliberate
subpath exports. They generate text only: callers review and write
`vercel.json` or `render.yaml` themselves. Vercel supports build, output, and
rewrite settings in `vercel.json`, while Render Blueprints use static `web`
services with `runtime: static`, `staticPublishPath`, and rewrite routes. See
the [Vercel configuration documentation](https://vercel.com/docs/project-configuration/vercel-json)
and [Render Blueprint reference](https://render.com/docs/blueprint-spec) before
applying generated artifacts.

## Vercel inspection

```ts
import { createVercelInspector } from "@vespeneventures/deployment/vercel";

const inspector = createVercelInspector({
  fetch,
  getBearerToken: async () => tokenFromYourSecretBoundary(),
});

const report = await inspector.inspect({
  project: "web",
  expectedDomains: ["www.example.com"],
});
```

The Vercel adapter reads project existence, the latest production deployment
state, and caller-supplied expected-domain outcomes. It intentionally does not
request environment settings or return project IDs, deployment URLs, raw
provider payloads, headers, or credential material.

## Render inspection

```ts
import { createRenderInspector } from "@vespeneventures/deployment/render";

const inspector = createRenderInspector({
  fetch,
  getBearerToken: async () => tokenFromYourSecretBoundary(),
});

const report = await inspector.inspect({
  service: "srv-example",
  expectedDomains: ["app.example.com"],
});
```

The Render adapter reads service existence, the most recent deployment state,
documented service suspension state, and caller-supplied expected-domain
outcomes. It does not request environment settings, return raw payloads, or
mutate provider state.

## API

| Export | Purpose |
| --- | --- |
| `defineDeploymentManifest` | Creates a detached manifest with explicit HTTP status defaults. |
| `defineDeploymentConfigurationPlan` | Creates a detached plan from a validated manifest and explicit non-secret requirements. |
| `validateDeploymentConfigurationPlan` | Reports invalid build, output, routing, surface coverage, and variable-name requirements. |
| `validateDeploymentManifest` | Reports structural contract findings without throwing for malformed values. |
| `normalizeDeploymentManifest` / `serializeDeploymentManifest` | Produces deterministic deployment artifacts. |
| `evaluateDeploymentHealth` | Summarizes normalized `DeploymentObservation` values into a `DeploymentHealthSummary`. |
| `DEPLOYMENT_ENVIRONMENTS` | The supported `DeploymentEnvironment` vocabulary. |
| `isValidDeploymentManifest` | A boolean companion to `validateDeploymentManifest`. |
| `isValidDeploymentConfigurationPlan` | A boolean companion to `validateDeploymentConfigurationPlan`. |
| `DeploymentManifest` / `DeploymentManifestDefinition` | The normalized and authoring manifest shapes. |
| `DeploymentConfigurationPlan` / `DeploymentConfigurationPlanDefinition` | The normalized and authoring configuration-plan shapes. |
| `DeploymentConfigurationRequirement` / `DeploymentConfigurationRequirementDefinition` | One surface's explicit build, output, routing, and variable-name requirements. |
| `DeploymentBuildRequirement` / `DeploymentBuildRequirementDefinition` | A non-secret build command and relative static output directory. |
| `DeploymentRoutingRequirement` / `DeploymentRoutingRequirementDefinition` | An ordered internal rewrite source and destination. |
| `DeploymentConfigurationArtifact` | A generated text artifact, its path, variable names, and review-first setup guidance. |
| `DeploymentSurface` / `DeploymentSurfaceDefinition` | A deployment surface and its authoring input shape. |
| `DeploymentHealthCheck` / `DeploymentHealthCheckDefinition` | A normalized or authoring HTTP health check. |
| `DeploymentHealthStatus` / `DeploymentFinding` | Health status and validation-finding types. |

The Vercel and Render adapters are separate package subpaths documented above:
`@vespeneventures/deployment/vercel` exports `createVercelInspector`, and
`@vespeneventures/deployment/render` exports `createRenderInspector`.

## Requirements

Node 20+, ESM, and no runtime dependencies.

## Licence

MIT
