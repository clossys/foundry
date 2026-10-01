/**
 * Response helpers shared by gated hosts.
 *
 * A gated host serves nothing to the public, so every response it sends
 * carries the same few rules: a robots tag, `no-store` on authentication,
 * redirect and error responses, a deny-all `robots.txt`, a `/health` route and
 * a 503 with `Retry-After`. These helpers state those rules once. They use
 * Fetch globals only and import no framework or provider.
 *
 * `/robots.txt` and `/health` must be public routes of whatever proxy gates
 * the host. A 401 or a redirect there hides the deny-all rule and fails
 * monitors.
 */

/** The `X-Robots-Tag` value every gated-host response carries. */
export const GATED_HOST_ROBOTS_TAG = "noindex, nofollow";

/** The deny-all `robots.txt` body of a gated host. */
export const GATED_HOST_ROBOTS_TXT = "User-agent: *\nDisallow: /";

const NO_STORE = "no-store";
const DEFAULT_RETRY_AFTER_SECONDS = 30;

/** Options for {@link applyGatedHostHeaders}. */
export interface GatedHostHeaderOptions {
  /** Force `Cache-Control: no-store` on a response whose status would not, such as a sign-in page. */
  readonly noStore?: boolean;
}

/** Options for {@link createServiceUnavailableResponse}. */
export interface ServiceUnavailableOptions {
  /** `Retry-After` in whole seconds. Defaults to 30. A negative or non-integer value throws `TypeError`. */
  readonly retryAfterSeconds?: number;
}

function mustNotBeStored(status: number, options: GatedHostHeaderOptions | undefined): boolean {
  return (
    options?.noStore === true ||
    (status >= 300 && status <= 399) ||
    status === 401 ||
    status === 403 ||
    status === 503
  );
}

/**
 * Sets the gated-host headers on `response` in place and returns it.
 *
 * `X-Robots-Tag` is always set, never appended, so the header reads exactly
 * {@link GATED_HOST_ROBOTS_TAG}. `Cache-Control` is set to `no-store` for a
 * status of 300-399, 401, 403 or 503, or when `options.noStore` is true, and
 * is otherwise left as it was. The response's headers must be mutable, which
 * excludes the result of `Response.redirect()`.
 */
export function applyGatedHostHeaders(response: Response, options?: GatedHostHeaderOptions): Response {
  response.headers.set("X-Robots-Tag", GATED_HOST_ROBOTS_TAG);
  if (mustNotBeStored(response.status, options)) {
    response.headers.set("Cache-Control", NO_STORE);
  }
  return response;
}

/**
 * Returns a route handler that answers `200` with a deny-all `robots.txt`
 * (`text/plain; charset=utf-8`) and the robots tag. Each call builds a fresh
 * response, so its body is readable every time.
 */
export function createRobotsTxtRoute(): () => Response {
  return () =>
    applyGatedHostHeaders(
      new Response(GATED_HOST_ROBOTS_TXT, {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      }),
    );
}

/**
 * Returns a route handler that answers `200` with `{"status":"ok"}`,
 * `no-store` and the robots tag. It takes no options and probes nothing: a
 * 200 says the host is serving, not that anything behind it is healthy.
 */
export function createHealthRoute(): () => Response {
  return () =>
    applyGatedHostHeaders(
      new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
      { noStore: true },
    );
}

/**
 * Builds a `503` with `{"error":"unavailable"}`, a `Retry-After` of
 * `retryAfterSeconds` (default 30), `no-store` and the robots tag.
 *
 * @throws {TypeError} when `retryAfterSeconds` is not a non-negative integer.
 */
export function createServiceUnavailableResponse(options?: ServiceUnavailableOptions): Response {
  const retryAfterSeconds = options?.retryAfterSeconds ?? DEFAULT_RETRY_AFTER_SECONDS;
  if (!Number.isInteger(retryAfterSeconds) || retryAfterSeconds < 0) {
    throw new TypeError("retryAfterSeconds must be a non-negative integer");
  }
  return applyGatedHostHeaders(
    new Response(JSON.stringify({ error: "unavailable" }), {
      status: 503,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfterSeconds),
      },
    }),
  );
}
