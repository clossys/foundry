# `@vespeneventures/web-auth-clerk`

A small Next.js adapter for Clerk authentication. It keeps browser-safe React
code separate from server-only middleware and route factories, and it relies on
`@vespeneventures/auth` for redirect policy instead of accepting redirect input
verbatim.

## Install

```bash
npm install @vespeneventures/web-auth-clerk @clerk/nextjs next react react-dom
```

The package is ESM-only and requires Node.js 20 or later, Clerk 7, Next.js 16,
and React 19. The Clerk, Next.js, and React packages are peer dependencies so
the application retains control of its framework versions.

## Client setup

The root export and `./client` are browser-safe. They do not import
`@clerk/nextjs/server`.

```tsx
import { AuthProvider } from "@vespeneventures/web-auth-clerk";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}
```

`AuthProvider` mounts `ClerkProvider`. When `NEXT_PUBLIC_DEV_NO_AUTH=1` outside
production and no publishable key exists, it renders the child subtree without
Clerk. This keyless path is intended for static rendering and isolated tests;
components that call Clerk hooks still require a real provider. Production
ignores the bypass flag unconditionally.

`ClerkSignInBlock` supplies a minimal hosted sign-in surface without depending
on another component library:

```tsx
import { ClerkSignInBlock } from "@vespeneventures/web-auth-clerk/client";

export default function SignInPage() {
  return (
    <ClerkSignInBlock
      heading="Sign in"
      subtitle="Use your account to continue."
      redirect_url="/app"
    />
  );
}
```

## Server setup

Import server code only from `./server`.

```ts
import { createSiteProxy } from "@vespeneventures/web-auth-clerk/server";

export const proxy = createSiteProxy({
  protectedRoutes: ["/app(.*)", "/account(.*)"],
});
```

`protectedRoutes` protects only the named routes. `publicRoutes` instead uses a
deny-by-default policy: everything not named public calls Clerk's
`auth.protect()`. The two modes are mutually exclusive at compile time and at
runtime. The default policy permits only `/sign-in` and `/sign-up` and protects
everything else within the application's Next.js matcher.

Create a sign-in page with a fixed local destination:

```ts
import { createClerkSignInPage } from "@vespeneventures/web-auth-clerk/server";

export default createClerkSignInPage({
  redirectUrl: "/app",
  signedInRedirect: "/app",
});
```

To honor a search parameter, also provide `redirectOrigin`. The factory then
uses `@vespeneventures/auth` to reject malformed, cross-origin, protocol-relative,
credential-bearing, and unsafe-scheme targets.

```ts
export default createClerkSignInPage({
  redirectUrl: "/app",
  redirectFromSearchParam: "returnTo",
  redirectOrigin: "https://app.example.test",
});
```

Sign out by revoking the active Clerk session before clearing application
cookies and redirecting:

```ts
import { createSignOutRoute } from "@vespeneventures/web-auth-clerk/server";

export const GET = createSignOutRoute({
  extraCookiesToClear: ["app-preference"],
  redirectTo: "/",
  getRedirectTarget(request) {
    return new URL(request.url).searchParams.get("returnTo");
  },
});
```

The request origin is trusted automatically. Additional absolute redirect
origins require an exact entry in `allowedRedirectOrigins`.

## API

### Root and `./client`

| Export | Purpose |
| --- | --- |
| `AuthProvider` | Mount Clerk for a client subtree, with a production-proof development bypass. |
| `AuthProviderProps` | Props accepted by `AuthProvider`. |
| `ClerkSignInBlock` | Render Clerk's hosted sign-in component with optional heading and cross-link copy. |
| `ClerkSignInProps` | Props accepted by `ClerkSignInBlock`. |
| `CLERK_APPEARANCE` | Small CSS-variable-based Clerk appearance preset. |
| `humaniseClerkError` | Select a safe readable message from a Clerk-shaped error. |

### `./server`

| Export | Purpose |
| --- | --- |
| `createSiteProxy` | Build a Clerk-backed Next.js proxy with one explicit route-policy direction. |
| `createClerkMiddleware` | Compatibility alias for `createSiteProxy`. |
| `SiteProxyConfig` | Route policy, Clerk options, and response hooks. |
| `ClerkMiddlewareOptionsCallback` | Per-request Clerk middleware options callback. |
| `devAuthBypassEnabled` | Check the non-production development bypass. |
| `devAuthBypassIsKeyless` | Check whether the bypass is active without a publishable key. |
| `AuthEnvironment` | Injectable environment shape used by the bypass helpers. |
| `createClerkSignInPage` | Build a server-rendered Clerk sign-in page with strict redirect handling. |
| `ClerkSignInPageOptions` | Sign-in page presentation and redirect policy. |
| `createRedirectRoute` | Build a permanent redirect route for a fixed local path. |
| `createSignOutRoute` | Revoke the active session, clear named cookies, and redirect safely. |
| `SignOutRouteOptions` | Sign-out cleanup and redirect policy. |

## Security boundary

- This package does not verify Clerk webhooks. Use
  `@vespeneventures/auth-clerk` for raw-body signature verification and event
  mapping.
- Route protection runs only where the application's Next.js matcher invokes
  the proxy. Keep authorization checks close to protected data and actions.
- The development bypass never activates when `NODE_ENV` is `production`.
- Dynamic redirects are rejected unless they resolve to an explicitly allowed
  HTTP or HTTPS origin.
- `humaniseClerkError` returns one selected message and never serializes the
  whole provider error object.

## Licence

MIT.
