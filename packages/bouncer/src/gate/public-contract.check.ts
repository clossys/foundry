import { createGatedHostGate, createReturnUrlResolver, createSignOutHandler } from "./index.js";
import type {
  GatePermissionAnswer,
  GatedHostGateOptions,
  HardenedGatedHostGateOptions,
  HardenedReturnUrlResolverOptions,
  ReturnUrlResolverOptions,
  SignOutContext,
  SignOutHandler,
  SignOutHandlerOptions,
} from "./index.js";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends (<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Assert<Condition extends true> = Condition;

type _PermissionAnswer = Assert<Equal<GatePermissionAnswer, "permitted" | "denied" | "unavailable">>;
type _HandlerShape = Assert<Equal<SignOutHandler, (request: Request) => Promise<Response>>>;
type _ContextCookies = Assert<Equal<SignOutContext["cookies"], ReadonlyMap<string, string> | undefined>>;

type Principal = { id: string };
const base = {
  origin: "https://app.example.test",
  signInPath: "/sign-in",
  notAuthorizedPath: "/not-authorized",
  protectedResourceMetadata: { authorization_servers: ["https://auth.example.test"] },
  resolvePrincipal: async () => ({ state: "signed-in", principal: { id: "p" } }) as const,
};

// The legacy gate keeps its two-valued permission and takes no hardened keys.
export const legacyGate = () =>
  createGatedHostGate<Principal>({ ...base, isPermitted: () => true } satisfies GatedHostGateOptions<Principal>);
export const legacyRefusesExclusions = () =>
  // @ts-expect-error Hardened-only keys need `hardened: true`.
  createGatedHostGate<Principal>({ ...base, isPermitted: () => true, excludedReturnPaths: ["/sign-out"] });
// A variable, not a fresh literal: excess-property checks do not apply, so only the `never` marker refuses it.
const legacyWithExclusions = { ...base, isPermitted: () => true, excludedReturnPaths: ["/sign-out"] };
export const legacyVariableRefusesExclusions = () =>
  // @ts-expect-error The legacy `excludedReturnPaths?: never` marker refuses a variable that carries one.
  createGatedHostGate<Principal>(legacyWithExclusions);
export const legacyRefusesTriState = () =>
  // @ts-expect-error Only the hardened gate accepts an "unavailable" answer.
  createGatedHostGate<Principal>({ ...base, isPermitted: () => "unavailable" as const });

// The hardened gate is an explicit opt-in.
export const hardenedGate = () =>
  createGatedHostGate<Principal>({
    ...base,
    hardened: true,
    isPermitted: (): GatePermissionAnswer => "unavailable",
    excludedReturnPaths: ["/sign-out"],
    returnFallbackPath: "/home",
  } satisfies HardenedGatedHostGateOptions<Principal>);

export const legacyResolver = () => createReturnUrlResolver({ origin: "https://app.example.test" } satisfies ReturnUrlResolverOptions);
export const legacyResolverRefusesExclusions = () =>
  // @ts-expect-error Exclusions need `hardened: true`.
  createReturnUrlResolver({ origin: "https://app.example.test", excludedPaths: ["/sign-out"] });
export const hardenedResolver = () =>
  createReturnUrlResolver({
    hardened: true,
    origin: "https://app.example.test",
    excludedPaths: ["/sign-out"],
    fallbackPath: "/",
  } satisfies HardenedReturnUrlResolverOptions);

const signOutOptions = {
  origin: "https://app.example.test",
  path: "/sign-out",
  confirmationPath: "/signed-out/confirm",
  cookies: [{ name: "__session", matchSuffixes: true }],
  signOut: async (context: SignOutContext) => {
    if (!context.isActive()) return;
  },
} satisfies SignOutHandlerOptions;

export const signOutHandler = (): SignOutHandler => createSignOutHandler(signOutOptions);
export const signOutNeedsConfirmation = () =>
  // @ts-expect-error A sign-out endpoint always names its GET confirmation page.
  createSignOutHandler({ origin: signOutOptions.origin, path: "/sign-out", cookies: signOutOptions.cookies, signOut: signOutOptions.signOut });
export const signOutTakesNoDynamicTarget = () =>
  createSignOutHandler({
    ...signOutOptions,
    // @ts-expect-error Return targets are fixed configuration, never read from the request.
    getRedirectTarget: () => "/",
  });
