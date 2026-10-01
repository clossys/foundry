/**
 * Front-door conformance kit, HTTP half.
 *
 * `checkFrontDoorHttp` sends cookie-less GET requests to a host's handler and
 * returns every way its responses break the gated-host rules. A consumer runs
 * it from its own test, so a host that drifts from the rules fails there and
 * not in production. `assertFrontDoorHttp` throws one `Error` listing every
 * violation.
 *
 * Every expected value comes from `./host-responses.js` and
 * `./security-headers.js`. This module restates none of them. It uses Fetch
 * globals only: no test runner, browser, framework or network call, and the
 * handler is called in process. A handler that throws is a `handler-threw`
 * violation, not a throw.
 */
import {
  GATED_HOST_ROBOTS_TAG,
  GATED_HOST_ROBOTS_TXT,
  createHealthRoute,
  createServiceUnavailableResponse,
} from "./host-responses.js";
import { createSiteSecurityHeaders } from "./security-headers.js";
import type { SiteSecurityHeaders } from "./security-headers.js";

/** The rule a {@link FrontDoorViolation} breaks. */
export type FrontDoorRule =
  | "robots-tag"
  | "no-store"
  | "robots-txt"
  | "health"
  | "service-unavailable"
  | "security-headers"
  | "sign-in-status"
  | "boundary-status"
  | "handler-threw";

/** One way one route breaks one rule. */
export interface FrontDoorViolation {
  /** The requested path, or `serviceUnavailable` for the consumer's 503 response. */
  readonly route: string;
  readonly rule: FrontDoorRule;
  readonly message: string;
}

/** What {@link checkFrontDoorHttp} requests. */
export interface FrontDoorHttpConfig {
  /** Absolute base URL the requests are built against. */
  readonly origin: string;
  /** Sign-in routes: a status below 400, `no-store`, the production security headers and the robots tag. */
  readonly signInPaths?: readonly string[];
  /** Gated routes requested with no cookie: a redirect with a `Location`, 401 or 403 that is `no-store` and carries the robots tag. */
  readonly boundaryPaths?: readonly string[];
  /** Defaults to `/robots.txt`. */
  readonly robotsPath?: string;
  /** Defaults to `/health`. */
  readonly healthPath?: string;
  /** The consumer's own 503 response. */
  readonly serviceUnavailable?: () => Response | Promise<Response>;
}

type FrontDoorHandle = (request: Request) => Response | Promise<Response>;

const NO_STORE = "no-store";
const REDIRECT_STATUSES: readonly number[] = [301, 302, 303, 307, 308];
const SERVICE_UNAVAILABLE_ROUTE = "serviceUnavailable";
const SECURITY_HEADER_NAMES = ["Strict-Transport-Security", "Referrer-Policy", "Permissions-Policy"] as const;

function describeValue(value: string | null): string {
  return value === null ? "missing" : JSON.stringify(value);
}

function productionSecurityHeaders(): SiteSecurityHeaders {
  const production = createSiteSecurityHeaders({ script: { mode: "nonce", nonce: "n" } }).production;
  if (!production.ok) {
    throw new Error("front-door conformance: the production security-headers baseline was refused");
  }
  return production.headers;
}

function robotsTagViolations(route: string, response: Response): FrontDoorViolation[] {
  const value = response.headers.get("X-Robots-Tag");
  return value === GATED_HOST_ROBOTS_TAG
    ? []
    : [{ route, rule: "robots-tag", message: `X-Robots-Tag is ${describeValue(value)}, expected ${JSON.stringify(GATED_HOST_ROBOTS_TAG)}` }];
}

function noStoreViolations(route: string, response: Response): FrontDoorViolation[] {
  const value = response.headers.get("Cache-Control");
  const tokens = value === null ? [] : value.split(",").map((token) => token.trim().toLowerCase());
  return tokens.includes(NO_STORE)
    ? []
    : [{ route, rule: "no-store", message: `Cache-Control is ${describeValue(value)}, expected the ${JSON.stringify(NO_STORE)} directive` }];
}

function signInViolations(route: string, response: Response): FrontDoorViolation[] {
  const expected = productionSecurityHeaders();
  const violations = [...robotsTagViolations(route, response), ...noStoreViolations(route, response)];
  if (response.status >= 400) {
    violations.push({ route, rule: "sign-in-status", message: `status is ${response.status}, expected a status below 400` });
  }
  for (const name of SECURITY_HEADER_NAMES) {
    const value = response.headers.get(name);
    if (value !== expected[name]) {
      violations.push({
        route,
        rule: "security-headers",
        message: `${name} is ${describeValue(value)}, expected ${JSON.stringify(expected[name])}`,
      });
    }
  }
  const policy = response.headers.get("Content-Security-Policy");
  if (policy === null || policy.trim() === "") {
    violations.push({ route, rule: "security-headers", message: "Content-Security-Policy is missing or empty" });
  }
  return violations;
}

function boundaryViolations(route: string, response: Response): FrontDoorViolation[] {
  const { status } = response;
  const violations = [...robotsTagViolations(route, response), ...noStoreViolations(route, response)];
  if (REDIRECT_STATUSES.includes(status)) {
    if (response.headers.get("Location") === null) {
      violations.push({ route, rule: "boundary-status", message: `status ${status} is a redirect with no Location` });
    }
  } else if (status !== 401 && status !== 403) {
    violations.push({
      route,
      rule: "boundary-status",
      message: `status is ${status}, expected a redirect (301, 302, 303, 307 or 308) with a Location, 401 or 403`,
    });
  }
  return violations;
}

async function robotsViolations(route: string, response: Response): Promise<FrontDoorViolation[]> {
  const violations = robotsTagViolations(route, response);
  const body = await response.text();
  if (response.status !== 200 || body !== GATED_HOST_ROBOTS_TXT) {
    violations.push({
      route,
      rule: "robots-txt",
      message: `status ${response.status} with body ${JSON.stringify(body)}, expected 200 with the gated-host robots body`,
    });
  }
  return violations;
}

async function healthViolations(route: string, response: Response): Promise<FrontDoorViolation[]> {
  const expected = createHealthRoute()();
  const expectedBody = await expected.text();
  const violations = robotsTagViolations(route, response);
  const body = await response.text();
  if (response.status !== expected.status || body !== expectedBody) {
    violations.push({
      route,
      rule: "health",
      message: `status ${response.status} with body ${JSON.stringify(body)}, expected status ${expected.status} with body ${JSON.stringify(expectedBody)}`,
    });
  }
  return violations;
}

async function serviceUnavailableViolations(route: string, response: Response): Promise<FrontDoorViolation[]> {
  const expected = createServiceUnavailableResponse();
  const expectedBody = await expected.text();
  const violations = [...robotsTagViolations(route, response), ...noStoreViolations(route, response)];
  const body = await response.text();
  if (response.status !== expected.status) {
    violations.push({
      route,
      rule: "service-unavailable",
      message: `status is ${response.status}, expected ${expected.status}`,
    });
  }
  const retryAfter = response.headers.get("Retry-After");
  if (retryAfter === null || !/^\d+$/.test(retryAfter)) {
    violations.push({
      route,
      rule: "service-unavailable",
      message: `Retry-After is ${describeValue(retryAfter)}, expected a non-negative integer`,
    });
  }
  if (body !== expectedBody) {
    violations.push({
      route,
      rule: "service-unavailable",
      message: `body is ${JSON.stringify(body)}, expected ${JSON.stringify(expectedBody)}`,
    });
  }
  return violations;
}

async function guarded(
  route: string,
  respond: () => Response | Promise<Response>,
  judge: (route: string, response: Response) => FrontDoorViolation[] | Promise<FrontDoorViolation[]>,
): Promise<FrontDoorViolation[]> {
  try {
    return await judge(route, await respond());
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return [{ route, rule: "handler-threw", message: `the handler threw: ${reason}` }];
  }
}

/**
 * Requests each configured route once, with a GET and no cookie, and returns
 * every violation, in request order: sign-in paths, boundary paths, the
 * robots path, the health path, then `serviceUnavailable`. An empty array is
 * a conforming host. A redirect is read as returned, never followed.
 *
 * @throws {TypeError} when `config.origin` is not an absolute URL.
 */
export async function checkFrontDoorHttp(
  config: FrontDoorHttpConfig,
  handle: FrontDoorHandle,
): Promise<readonly FrontDoorViolation[]> {
  const base = new URL(config.origin);
  const request = (path: string) => () => handle(new Request(new URL(path, base), { method: "GET", redirect: "manual" }));
  const robotsPath = config.robotsPath ?? "/robots.txt";
  const healthPath = config.healthPath ?? "/health";
  const checks: Promise<FrontDoorViolation[]>[] = [
    ...(config.signInPaths ?? []).map((path) => guarded(path, request(path), signInViolations)),
    ...(config.boundaryPaths ?? []).map((path) => guarded(path, request(path), boundaryViolations)),
    guarded(robotsPath, request(robotsPath), robotsViolations),
    guarded(healthPath, request(healthPath), healthViolations),
  ];
  if (config.serviceUnavailable) {
    checks.push(guarded(SERVICE_UNAVAILABLE_ROUTE, config.serviceUnavailable, serviceUnavailableViolations));
  }
  return Object.freeze((await Promise.all(checks)).flat());
}

/**
 * Runs {@link checkFrontDoorHttp} and throws one `Error` whose message lists
 * every violation as `route [rule]: message`, one per line.
 */
export async function assertFrontDoorHttp(config: FrontDoorHttpConfig, handle: FrontDoorHandle): Promise<void> {
  const violations = await checkFrontDoorHttp(config, handle);
  if (violations.length === 0) return;
  const lines = violations.map((violation) => `${violation.route} [${violation.rule}]: ${violation.message}`);
  throw new Error(`front door violates ${violations.length} rule(s):\n${lines.join("\n")}`);
}
