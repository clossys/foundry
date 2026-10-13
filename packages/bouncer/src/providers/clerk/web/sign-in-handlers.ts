import { classifySignInFailure } from "../../../sign-in-failure.js";
import type { SignInFailureClass } from "../../../sign-in-failure.js";
import { CLERK_SIGN_IN_FAILURE_CODES } from "./sign-in-failure-codes.js";

/** A handler answer contains only a status, never provider text or inputs. */
export type ClerkSignInResult =
  | { status: "ok" }
  | { status: "needsCode" }
  | { status: Exclude<SignInFailureClass, "unknown"> };

/** The factor fields read from Clerk; other provider fields are ignored. */
export interface ClerkSignInFactor {
  readonly strategy: string;
  readonly emailAddressId?: string;
  readonly phoneNumberId?: string;
}

/** Message factors must carry the destination id needed to prepare a code. */
export type ClerkSignInCodeFactor =
  | { strategy: "totp" | "backup_code" }
  | { strategy: "email_code"; emailAddressId: string }
  | { strategy: "phone_code"; phoneNumberId: string };

/** The structural portion of a Clerk SignIn resource used by the handlers. */
export interface ClerkSignInResource {
  readonly status: string | null;
  readonly supportedFirstFactors?: ReadonlyArray<ClerkSignInFactor> | null;
  readonly supportedSecondFactors?: ReadonlyArray<ClerkSignInFactor> | null;
  readonly createdSessionId?: string | null;
  readonly attemptFirstFactor: (params: { strategy: "password"; password: string }) => Promise<ClerkSignInResource>;
  readonly prepareSecondFactor: (params:
    | { strategy: "email_code"; emailAddressId: string }
    | { strategy: "phone_code"; phoneNumberId: string }
  ) => Promise<ClerkSignInResource>;
  readonly attemptSecondFactor: (params: {
    strategy: ClerkSignInCodeFactor["strategy"];
    code: string;
  }) => Promise<ClerkSignInResource>;
}

/** Pass bound methods, plus a currency predicate for the current screen. */
export interface ClerkSignInProvider {
  readonly create: (params: { identifier: string }) => Promise<ClerkSignInResource>;
  readonly setActive: (params: { session: string }) => Promise<unknown>;
  readonly isCurrent: () => boolean;
  readonly signal?: AbortSignal;
  /** Share the Clerk instance across handler sets. Defaults to provider. */
  readonly operationOwner?: object;
}

/** Fits Publisher SignInForm's four handlers without importing Publisher. */
export interface ClerkSignInHandlers {
  readonly identify: (identifier: string) => Promise<ClerkSignInResult>;
  readonly verify: (secret: string) => Promise<ClerkSignInResult>;
  readonly verifyCode: (code: string) => Promise<ClerkSignInResult>;
  readonly resendCode: () => Promise<ClerkSignInResult>;
  /** Pure capability query; hide the resend control when it returns false. */
  readonly canResendCode: () => boolean;
}

interface OwnerState {
  epoch: number;
  busy: boolean;
}

const owners = new WeakMap<object, OwnerState>();
const cancelled = Symbol("unavailable");
type Phase = "identify" | "password" | "code" | "done";

function selectCodeFactor(resource: ClerkSignInResource): ClerkSignInCodeFactor | undefined {
  for (const factor of resource.supportedSecondFactors ?? []) {
    switch (factor.strategy) {
      case "totp":
      case "backup_code":
        return { strategy: factor.strategy };
      case "email_code":
        if (factor.emailAddressId) return { strategy: "email_code", emailAddressId: factor.emailAddressId };
        break;
      case "phone_code":
        if (factor.phoneNumberId) return { strategy: "phone_code", phoneNumberId: factor.phoneNumberId };
        break;
    }
  }
  return undefined;
}

function isMessageFactor(factor: ClerkSignInCodeFactor | undefined): factor is
  Extract<ClerkSignInCodeFactor, { strategy: "email_code" | "phone_code" }> {
  return factor?.strategy === "email_code" || factor?.strategy === "phone_code";
}

/**
 * Drives one password sign-in flow. Each identify starts a new owner-wide
 * epoch, even when another operation is pending. The old operation keeps its
 * lock until it settles, but cannot prepare a factor or activate a session.
 */
export function createClerkSignInHandlers(provider: ClerkSignInProvider): ClerkSignInHandlers {
  const owner = provider.operationOwner ?? provider;
  let state = owners.get(owner);
  if (!state) {
    state = { epoch: 0, busy: false };
    owners.set(owner, state);
  }
  const ownerState = state;
  let epoch = ownerState.epoch;
  let revision = 0;
  let phase: Phase = "identify";
  let resource: ClerkSignInResource | undefined;
  let codeFactor: ClerkSignInCodeFactor | undefined;
  let activationAttempted = false;

  function current(expectedEpoch = epoch, expectedRevision = revision): boolean {
    try {
      return ownerState.epoch === expectedEpoch && revision === expectedRevision
        && !provider.signal?.aborted && provider.isCurrent() !== false;
    } catch {
      return false;
    }
  }

  function unavailable(): ClerkSignInResult {
    revision += 1;
    phase = "identify";
    resource = undefined;
    codeFactor = undefined;
    return { status: "unavailable" };
  }

  async function run(
    expectedPhase: Phase,
    operation: (call: <T>(method: () => Promise<T>) => Promise<T>) => Promise<ClerkSignInResult>,
  ): Promise<ClerkSignInResult> {
    if (ownerState.busy || phase !== expectedPhase || !current()) return unavailable();
    ownerState.busy = true;
    const operationEpoch = epoch;
    const operationRevision = revision;
    const stillCurrent = () => current(operationEpoch, operationRevision);
    async function call<T>(method: () => Promise<T>): Promise<T> {
      if (!stillCurrent()) throw cancelled;
      const value = await method();
      if (!stillCurrent()) throw cancelled;
      return value;
    }
    try {
      const result = await operation(call);
      if (!stillCurrent() || result.status === "unavailable") return unavailable();
      return result;
    } catch (failure: unknown) {
      if (!stillCurrent()) return unavailable();
      const failureClass = classifySignInFailure(failure, { codes: CLERK_SIGN_IN_FAILURE_CODES });
      if (failureClass === "unknown" || failureClass === "unavailable") return unavailable();
      if (failureClass === "locked" || failureClass === "notFound") {
        phase = "identify";
        resource = undefined;
        codeFactor = undefined;
      }
      return { status: failureClass };
    } finally {
      ownerState.busy = false;
    }
  }

  async function activate(
    completed: ClerkSignInResource,
    call: <T>(method: () => Promise<T>) => Promise<T>,
  ): Promise<ClerkSignInResult> {
    const session = completed.createdSessionId;
    if (completed.status !== "complete" || !session || activationAttempted) return { status: "unavailable" };
    activationAttempted = true;
    phase = "done";
    await call(() => provider.setActive({ session }));
    return { status: "ok" };
  }

  return {
    identify(identifier) {
      epoch = ++ownerState.epoch;
      revision += 1;
      phase = "identify";
      resource = undefined;
      codeFactor = undefined;
      activationAttempted = false;
      return run("identify", async call => {
        const created = await call(() => provider.create({ identifier }));
        if (created.status !== "needs_first_factor"
          || !created.supportedFirstFactors?.some(factor => factor.strategy === "password")) {
          return { status: "unavailable" };
        }
        resource = created;
        phase = "password";
        return { status: "ok" };
      });
    },

    verify(secret) {
      return run("password", async call => {
        const first = await call(() => resource!.attemptFirstFactor({ strategy: "password", password: secret }));
        if (first.status === "complete") return activate(first, call);
        if (first.status !== "needs_second_factor" && first.status !== "needs_client_trust") {
          return { status: "unavailable" };
        }
        const selected = selectCodeFactor(first);
        if (!selected) return { status: "unavailable" };
        // Retain this resource even if preparation is rejected recoverably.
        resource = first;
        if (isMessageFactor(selected)) resource = await call(() => first.prepareSecondFactor(selected));
        codeFactor = selected;
        phase = "code";
        return { status: "needsCode" };
      });
    },

    verifyCode(code) {
      return run("code", async call => {
        const completed = await call(() => resource!.attemptSecondFactor({ strategy: codeFactor!.strategy, code }));
        return activate(completed, call);
      });
    },

    resendCode() {
      return run("code", async call => {
        const selected = codeFactor;
        if (!isMessageFactor(selected)) return { status: "unavailable" };
        resource = await call(() => resource!.prepareSecondFactor(selected));
        return { status: "ok" };
      });
    },

    canResendCode() {
      return current() && !ownerState.busy && phase === "code" && isMessageFactor(codeFactor);
    },
  };
}
