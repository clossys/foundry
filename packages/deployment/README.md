# @vespeneventures/deployment

Dependency-free deployment surface contracts and read-only provider inspection
adapters. The root entrypoint has no I/O. Provider adapters use caller-injected
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
| `validateDeploymentManifest` | Reports structural contract findings without throwing for malformed values. |
| `normalizeDeploymentManifest` / `serializeDeploymentManifest` | Produces deterministic deployment artifacts. |
| `evaluateDeploymentHealth` | Summarizes normalized `DeploymentObservation` values into a `DeploymentHealthSummary`. |
| `DEPLOYMENT_ENVIRONMENTS` | The supported `DeploymentEnvironment` vocabulary. |
| `isValidDeploymentManifest` | A boolean companion to `validateDeploymentManifest`. |
| `DeploymentManifest` / `DeploymentManifestDefinition` | The normalized and authoring manifest shapes. |
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
