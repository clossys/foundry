import { describe, expect, it, vi } from "vitest";
import { createClerkSignInHandlers } from "./sign-in-handlers.js";
import type { ClerkSignInProvider, ClerkSignInResource } from "./sign-in-handlers.js";

const OK = { status: "ok" };
const UNAVAILABLE = { status: "unavailable" };
const NEEDS_CODE = { status: "needsCode" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fake() {
  const complete = (): ClerkSignInResource => ({ ...resource, status: "complete", createdSessionId: "session-fixture" });
  const resource: { -readonly [Key in keyof ClerkSignInResource]: ClerkSignInResource[Key] } = {
    status: "needs_first_factor",
    supportedFirstFactors: [{ strategy: "password" }],
    supportedSecondFactors: [],
    createdSessionId: null,
    attemptFirstFactor: vi.fn(async () => complete()),
    prepareSecondFactor: vi.fn(async () => resource),
    attemptSecondFactor: vi.fn(async () => complete()),
  };
  const provider = {
    create: vi.fn(async (_params: { identifier: string }) => resource),
    setActive: vi.fn(async (_params: { session: string }) => {}),
    isCurrent: vi.fn(() => true),
  } satisfies ClerkSignInProvider;
  const handlers = createClerkSignInHandlers(provider);
  return { resource, provider, handlers, complete };
}

function calls(f: ReturnType<typeof fake>) {
  return [f.provider.create, f.resource.attemptFirstFactor, f.resource.prepareSecondFactor,
    f.resource.attemptSecondFactor, f.provider.setActive].map(method => vi.mocked(method).mock.calls.length);
}

async function passwordStep(f: ReturnType<typeof fake>) {
  expect(await f.handlers.identify("identifier-fixture")).toEqual(OK);
}

async function codeStep(f: ReturnType<typeof fake>, strategy = "email_code", status = "needs_second_factor") {
  f.resource.supportedSecondFactors = [{ strategy, emailAddressId: "address-fixture", phoneNumberId: "phone-fixture" }];
  vi.mocked(f.resource.attemptFirstFactor).mockResolvedValue({ ...f.resource, status });
  await passwordStep(f);
  expect(await f.handlers.verify("password-fixture")).toEqual(NEEDS_CODE);
}

describe("Clerk sign-in handlers", () => {
  it("activates a password-only session once", async () => {
    const f = fake();
    await passwordStep(f);
    expect(await f.handlers.verify("password-fixture")).toEqual(OK);
    // Check input forwarding without rendering inputs in a failing assertion.
    expect(f.provider.create.mock.calls[0]?.[0].identifier === "identifier-fixture").toBe(true);
    expect(vi.mocked(f.resource.attemptFirstFactor).mock.calls[0]?.[0].password === "password-fixture").toBe(true);
    expect(vi.mocked(f.resource.attemptFirstFactor).mock.calls[0]?.[0].strategy).toBe("password");
    expect(vi.mocked(f.provider.setActive).mock.calls.length).toBe(1);
    expect(f.provider.setActive.mock.calls[0]?.[0].session === "session-fixture").toBe(true);
    expect(await f.handlers.verify("password-fixture")).toEqual(UNAVAILABLE);
    expect(await f.handlers.verifyCode("code-fixture")).toEqual(UNAVAILABLE);
    expect(vi.mocked(f.provider.setActive).mock.calls.length).toBe(1);
  });

  it.each(["needs_second_factor", "needs_client_trust"])("prepares email codes for %s, resends, then activates", async status => {
    const f = fake();
    await codeStep(f, "email_code", status);
    expect(vi.mocked(f.resource.prepareSecondFactor).mock.calls[0]?.[0].strategy).toBe("email_code");
    expect(vi.mocked(f.resource.prepareSecondFactor).mock.calls[0]?.[0].emailAddressId === "address-fixture").toBe(true);
    expect(f.handlers.canResendCode()).toBe(true);
    expect(await f.handlers.resendCode()).toEqual(OK);
    expect(vi.mocked(f.resource.prepareSecondFactor).mock.calls.length).toBe(2);
    expect(await f.handlers.verifyCode("code-fixture")).toEqual(OK);
    expect(vi.mocked(f.resource.attemptSecondFactor).mock.calls[0]?.[0].strategy).toBe("email_code");
    expect(vi.mocked(f.resource.attemptSecondFactor).mock.calls[0]?.[0].code === "code-fixture").toBe(true);
    expect(vi.mocked(f.provider.setActive).mock.calls.length).toBe(1);
    expect(f.handlers.canResendCode()).toBe(false);
  });

  it("prepares and resends phone codes", async () => {
    const f = fake();
    await codeStep(f, "phone_code");
    expect(vi.mocked(f.resource.prepareSecondFactor).mock.calls[0]?.[0].strategy).toBe("phone_code");
    expect(vi.mocked(f.resource.prepareSecondFactor).mock.calls[0]?.[0].phoneNumberId === "phone-fixture").toBe(true);
    expect(await f.handlers.resendCode()).toEqual(OK);
    expect(await f.handlers.verifyCode("code-fixture")).toEqual(OK);
    expect(vi.mocked(f.resource.prepareSecondFactor).mock.calls.length).toBe(2);
  });

  it.each(["totp", "backup_code"])("uses %s without prepare or resend", async strategy => {
    const f = fake();
    await codeStep(f, strategy);
    expect(f.handlers.canResendCode()).toBe(false);
    expect(vi.mocked(f.resource.prepareSecondFactor).mock.calls.length).toBe(0);
    expect(await f.handlers.verifyCode("code-fixture")).toEqual(OK);
    expect(vi.mocked(f.resource.attemptSecondFactor).mock.calls[0]?.[0].strategy).toBe(strategy);
  });

  it("refuses resend for an authenticator and requires identify afterward", async () => {
    const f = fake();
    await codeStep(f, "totp");
    const before = calls(f);
    expect(await f.handlers.resendCode()).toEqual(UNAVAILABLE);
    expect(await f.handlers.verifyCode("code-fixture")).toEqual(UNAVAILABLE);
    expect(calls(f)).toEqual(before);
    await passwordStep(f);
  });

  it.each([
    [["backup_code", "email_code", "phone_code", "totp"], "totp"],
    [["backup_code", "email_code", "phone_code"], "phone_code"],
    [["backup_code", "email_code"], "email_code"],
    [["backup_code"], "backup_code"],
  ])("prefers totp, then phone_code, then email_code, then backup_code (%j)", async (strategies, expected) => {
    const f = fake();
    f.resource.supportedSecondFactors = [
      { strategy: "email_link" }, { strategy: "email_code" }, { strategy: "phone_code", phoneNumberId: "" },
      ...strategies.map(strategy => ({ strategy, emailAddressId: "address-fixture", phoneNumberId: "phone-fixture" })),
    ];
    vi.mocked(f.resource.attemptFirstFactor).mockResolvedValue({ ...f.resource, status: "needs_second_factor" });
    await passwordStep(f);
    expect(await f.handlers.verify("password-fixture")).toEqual(NEEDS_CODE);
    expect(await f.handlers.verifyCode("code-fixture")).toEqual(OK);
    expect(vi.mocked(f.resource.attemptSecondFactor).mock.calls[0]?.[0].strategy).toBe(expected);
    const prepared = vi.mocked(f.resource.prepareSecondFactor).mock.calls.map(([params]) => params.strategy);
    expect(prepared).toEqual(expected === "phone_code" || expected === "email_code" ? [expected] : []);
  });

  it.each([null, [], [{ strategy: "email_code" }], [{ strategy: "phone_code" }], [{ strategy: "email_link" }]])(
    "refuses unsupported or incomplete second factors (%j)", async factors => {
      const f = fake();
      vi.mocked(f.resource.attemptFirstFactor).mockResolvedValue({ ...f.resource,
        status: "needs_second_factor", supportedSecondFactors: factors });
      await passwordStep(f);
      expect(await f.handlers.verify("password-fixture")).toEqual(UNAVAILABLE);
      expect(vi.mocked(f.resource.prepareSecondFactor).mock.calls.length).toBe(0);
      expect(vi.mocked(f.provider.setActive).mock.calls.length).toBe(0);
    },
  );

  it("never allows needsCode from identify", async () => {
    const f = fake();
    f.resource.status = "needs_second_factor";
    f.resource.supportedSecondFactors = [{ strategy: "totp" }];
    expect(await f.handlers.identify("identifier-fixture")).toEqual(UNAVAILABLE);
    expect(await f.handlers.verify("password-fixture")).toEqual(UNAVAILABLE);
    expect(calls(f)).toEqual([1, 0, 0, 0, 0]);
  });

  it.each([null, [], [{ strategy: "email_code" }]])("requires a password first factor (%j)", async factors => {
    const f = fake();
    f.resource.supportedFirstFactors = factors;
    expect(await f.handlers.identify("identifier-fixture")).toEqual(UNAVAILABLE);
    expect(calls(f)).toEqual([1, 0, 0, 0, 0]);
  });

  it("makes no Clerk calls out of phase", async () => {
    const f = fake();
    expect(await f.handlers.verify("password-fixture")).toEqual(UNAVAILABLE);
    expect(await f.handlers.verifyCode("code-fixture")).toEqual(UNAVAILABLE);
    expect(await f.handlers.resendCode()).toEqual(UNAVAILABLE);
    expect(calls(f)).toEqual([0, 0, 0, 0, 0]);
    await passwordStep(f);
    expect(await f.handlers.verifyCode("code-fixture")).toEqual(UNAVAILABLE);
    expect(await f.handlers.verify("password-fixture")).toEqual(UNAVAILABLE);
    expect(calls(f)).toEqual([1, 0, 0, 0, 0]);
  });

  it("refuses a call during a pending operation", async () => {
    const f = fake();
    await passwordStep(f);
    const pending = deferred<ClerkSignInResource>();
    vi.mocked(f.resource.attemptFirstFactor).mockReturnValueOnce(pending.promise);
    const first = f.handlers.verify("password-fixture");
    expect(await f.handlers.verify("password-fixture")).toEqual(UNAVAILABLE);
    expect(vi.mocked(f.resource.attemptFirstFactor).mock.calls.length).toBe(1);
    pending.resolve(f.complete());
    await first;
    expect(await f.handlers.verify("password-fixture")).toEqual(UNAVAILABLE);
  });

  it("a new identify invalidates pending verification on the same owner", async () => {
    const f = fake();
    const owner = {};
    const first = createClerkSignInHandlers({ ...f.provider, operationOwner: owner });
    const second = createClerkSignInHandlers({ ...f.provider, operationOwner: owner });
    expect(await first.identify("identifier-fixture")).toEqual(OK);
    const pending = deferred<ClerkSignInResource>();
    vi.mocked(f.resource.attemptFirstFactor).mockReturnValueOnce(pending.promise);
    const verifying = first.verify("password-fixture");
    expect(await second.identify("identifier-fixture")).toEqual(UNAVAILABLE);
    expect(vi.mocked(f.provider.create).mock.calls.length).toBe(1);
    pending.resolve(f.complete());
    expect(await verifying).toEqual(UNAVAILABLE);
    expect(vi.mocked(f.provider.setActive).mock.calls.length).toBe(0);
    expect(await second.identify("identifier-fixture")).toEqual(OK);
    expect(await second.verify("password-fixture")).toEqual(OK);
  });

  it("invalidates idle handler sets with a shared owner", async () => {
    const f = fake();
    const owner = {};
    const first = createClerkSignInHandlers({ ...f.provider, operationOwner: owner });
    const second = createClerkSignInHandlers({ ...f.provider, operationOwner: owner });
    await first.identify("identifier-fixture");
    await second.identify("identifier-fixture");
    expect(await first.verify("password-fixture")).toEqual(UNAVAILABLE);
    expect(vi.mocked(f.resource.attemptFirstFactor).mock.calls.length).toBe(0);
    expect(await first.identify("identifier-fixture")).toEqual(OK);
    expect(await second.verify("password-fixture")).toEqual(UNAVAILABLE);
  });

  it("shares serialization and epochs when the provider is the default owner", async () => {
    const f = fake();
    const other = createClerkSignInHandlers(f.provider);
    const pending = deferred<ClerkSignInResource>();
    f.provider.create.mockReturnValueOnce(pending.promise);
    const first = f.handlers.identify("identifier-fixture");
    expect(await other.identify("identifier-fixture")).toEqual(UNAVAILABLE);
    expect(vi.mocked(f.provider.create).mock.calls.length).toBe(1);
    pending.resolve(f.resource);
    expect(await first).toEqual(UNAVAILABLE);
  });

  it("allows independent owners to run concurrently", async () => {
    const f = fake();
    const g = fake();
    const pending = deferred<ClerkSignInResource>();
    f.provider.create.mockReturnValueOnce(pending.promise);
    const first = f.handlers.identify("identifier-fixture");
    await passwordStep(g);
    expect(await g.handlers.verify("password-fixture")).toEqual(OK);
    pending.resolve(f.resource);
    expect(await first).toEqual(OK);
  });

  it("checks isCurrent before setActive", async () => {
    const f = fake();
    await passwordStep(f);
    // The resource becomes obsolete as the completed session is read, after
    // the check following attemptFirstFactor but before activation.
    const complete = f.complete();
    Object.defineProperty(complete, "createdSessionId", { get() {
      f.provider.isCurrent.mockReturnValue(false);
      return "session-fixture";
    } });
    vi.mocked(f.resource.attemptFirstFactor).mockResolvedValueOnce(complete);
    expect(await f.handlers.verify("password-fixture")).toEqual(UNAVAILABLE);
    expect(vi.mocked(f.provider.setActive).mock.calls.length).toBe(0);
  });

  it.each(["abort", "stale"])("%s before identify calls no provider method", async kind => {
    const f = fake();
    const controller = new AbortController();
    if (kind === "abort") controller.abort();
    else f.provider.isCurrent.mockReturnValue(false);
    const handlers = createClerkSignInHandlers({ ...f.provider, signal: controller.signal });
    expect(await handlers.identify("identifier-fixture")).toEqual(UNAVAILABLE);
    expect(calls(f)).toEqual([0, 0, 0, 0, 0]);
  });

  it.each(["abort", "stale"])("%s during password verification stops preparation", async kind => {
    const f = fake();
    const controller = new AbortController();
    const handlers = createClerkSignInHandlers({ ...f.provider, signal: controller.signal });
    await handlers.identify("identifier-fixture");
    const pending = deferred<ClerkSignInResource>();
    vi.mocked(f.resource.attemptFirstFactor).mockReturnValueOnce(pending.promise);
    const verifying = handlers.verify("password-fixture");
    if (kind === "abort") controller.abort();
    else f.provider.isCurrent.mockReturnValue(false);
    pending.resolve({ ...f.resource, status: "needs_second_factor",
      supportedSecondFactors: [{ strategy: "email_code", emailAddressId: "address-fixture" }] });
    expect(await verifying).toEqual(UNAVAILABLE);
    expect(vi.mocked(f.resource.prepareSecondFactor).mock.calls.length).toBe(0);
    expect(vi.mocked(f.provider.setActive).mock.calls.length).toBe(0);
  });

  it.each(["create", "prepare", "code", "resend", "activate"])("checks currency after awaiting %s", async operation => {
    const f = fake();
    let action: () => Promise<unknown>;
    const pending = deferred<ClerkSignInResource>();
    if (operation === "create") {
      f.provider.create.mockReturnValueOnce(pending.promise);
      action = () => f.handlers.identify("identifier-fixture");
    } else if (operation === "activate") {
      await passwordStep(f);
      f.provider.setActive.mockImplementationOnce(async () => { await pending.promise; });
      action = () => f.handlers.verify("password-fixture");
    } else {
      if (operation === "prepare") {
        await passwordStep(f);
        vi.mocked(f.resource.attemptFirstFactor).mockResolvedValue({ ...f.resource,
          status: "needs_second_factor", supportedSecondFactors: [{ strategy: "email_code", emailAddressId: "address-fixture" }] });
        vi.mocked(f.resource.prepareSecondFactor).mockReturnValueOnce(pending.promise);
        action = () => f.handlers.verify("password-fixture");
      } else {
        await codeStep(f);
        if (operation === "code") {
          vi.mocked(f.resource.attemptSecondFactor).mockReturnValueOnce(pending.promise);
          action = () => f.handlers.verifyCode("code-fixture");
        } else {
          vi.mocked(f.resource.prepareSecondFactor).mockReturnValueOnce(pending.promise);
          action = () => f.handlers.resendCode();
        }
      }
    }
    const result = action();
    // Allow the second awaited call (prepare or activate) to begin.
    await Promise.resolve();
    await Promise.resolve();
    f.provider.isCurrent.mockReturnValue(false);
    pending.resolve(operation === "code" ? f.complete() : f.resource);
    expect(await result).toEqual(UNAVAILABLE);
    expect(f.handlers.canResendCode()).toBe(false);
    if (operation !== "activate") expect(vi.mocked(f.provider.setActive).mock.calls.length).toBe(0);
  });

  it.each([null, ""])("refuses complete without a session id (%j)", async session => {
    const f = fake();
    await passwordStep(f);
    vi.mocked(f.resource.attemptFirstFactor).mockResolvedValueOnce({ ...f.resource, status: "complete", createdSessionId: session });
    expect(await f.handlers.verify("password-fixture")).toEqual(UNAVAILABLE);
    expect(vi.mocked(f.provider.setActive).mock.calls.length).toBe(0);
  });

  it("setActive rejection is never ok and activation is not retried", async () => {
    const f = fake();
    await passwordStep(f);
    f.provider.setActive.mockRejectedValueOnce({ code: "clerk_offline" });
    expect(await f.handlers.verify("password-fixture")).toEqual({ status: "network" });
    expect(await f.handlers.verify("password-fixture")).toEqual(UNAVAILABLE);
    expect(vi.mocked(f.provider.setActive).mock.calls.length).toBe(1);
  });

  const failures = [
    ["form_password_incorrect", "credential"], ["form_identifier_not_found", "notFound"],
    ["user_locked", "locked"], ["clerk_offline", "network"],
    [undefined, "rateLimited", 429], [undefined, "unavailable", 503],
    ["unrecognised", "unavailable"],
  ] as const;

  it.each(failures)("classifies rejection %s without exposing provider text", async (code, expected, status) => {
    const f = fake();
    const failure = { code, status, message: "provider detail fixture", identifier: "identifier-fixture", secret: "password-fixture" };
    f.provider.create.mockRejectedValueOnce(failure);
    const result = await f.handlers.identify("identifier-fixture");
    // Boolean assertions keep provider text and inputs out of failure logs,
    // including the deliberately unsafe message-return mutation.
    expect(result.status === expected).toBe(true);
    expect(Object.keys(result).join(",") === "status").toBe(true);
  });

  it.each(["password", "code"])("classifies rejection from %s", async operation => {
    const f = fake();
    const failure = { errors: [{ code: "form_code_incorrect" }], message: "provider detail fixture" };
    let result;
    if (operation === "password") {
      await passwordStep(f);
      vi.mocked(f.resource.attemptFirstFactor).mockRejectedValueOnce(failure);
      result = await f.handlers.verify("password-fixture");
    } else {
      await codeStep(f);
      vi.mocked(f.resource.attemptSecondFactor).mockRejectedValueOnce(failure);
      result = await f.handlers.verifyCode("code-fixture");
    }
    expect(result.status === "credential").toBe(true);
    expect(Object.keys(result).join(",") === "status").toBe(true);
    expect(vi.mocked(f.provider.setActive).mock.calls.length).toBe(0);
  });

  it.each([
    ["prepare", "form_param_format_invalid"], ["resend", "form_param_format_invalid"],
    ["prepare", "form_identifier_not_found"], ["resend", "form_identifier_not_found"],
  ])("never answers a %s rejection %s as credential or notFound", async (operation, code) => {
    const f = fake();
    const failure = { errors: [{ code }], message: "provider detail fixture" };
    if (operation === "prepare") {
      await passwordStep(f);
      vi.mocked(f.resource.attemptFirstFactor).mockResolvedValueOnce({ ...f.resource, status: "needs_second_factor",
        supportedSecondFactors: [{ strategy: "email_code", emailAddressId: "address-fixture" }] });
    } else {
      await codeStep(f);
    }
    vi.mocked(f.resource.prepareSecondFactor).mockRejectedValueOnce(failure);
    const result = operation === "prepare" ? await f.handlers.verify("password-fixture") : await f.handlers.resendCode();
    expect(result).toEqual(UNAVAILABLE);
    expect(f.handlers.canResendCode()).toBe(false);
    expect(await f.handlers.verifyCode("code-fixture")).toEqual(UNAVAILABLE);
    expect(vi.mocked(f.resource.attemptSecondFactor).mock.calls.length).toBe(0);
    expect(vi.mocked(f.provider.setActive).mock.calls.length).toBe(0);
  });

  it.each([
    ["clerk_offline", undefined], [undefined, 429],
  ])("moves to the code step with resend after a recoverable send failure (%s, %s)", async (code, status) => {
    const f = fake();
    await passwordStep(f);
    vi.mocked(f.resource.attemptFirstFactor).mockResolvedValueOnce({ ...f.resource, status: "needs_second_factor",
      supportedSecondFactors: [{ strategy: "email_code", emailAddressId: "address-fixture" }] });
    vi.mocked(f.resource.prepareSecondFactor).mockRejectedValueOnce({ code, status, message: "provider detail fixture" });
    expect(await f.handlers.verify("password-fixture")).toEqual(NEEDS_CODE);
    expect(f.handlers.canResendCode()).toBe(true);
    expect(await f.handlers.resendCode()).toEqual(OK);
    expect(vi.mocked(f.resource.prepareSecondFactor).mock.calls.length).toBe(2);
    expect(await f.handlers.verifyCode("code-fixture")).toEqual(OK);
    expect(vi.mocked(f.resource.attemptFirstFactor).mock.calls.length).toBe(1);
    expect(vi.mocked(f.provider.setActive).mock.calls.length).toBe(1);
  });

  it("keeps the code step and resend after a recoverable resend failure", async () => {
    const f = fake();
    await codeStep(f);
    vi.mocked(f.resource.prepareSecondFactor).mockRejectedValueOnce({ code: "clerk_offline" });
    expect(await f.handlers.resendCode()).toEqual({ status: "network" });
    expect(f.handlers.canResendCode()).toBe(true);
    expect(await f.handlers.resendCode()).toEqual(OK);
    expect(await f.handlers.verifyCode("code-fixture")).toEqual(OK);
  });

  it.each(["user_locked", "form_identifier_not_found", "unrecognised"])("requires identify after terminal failure %s", async code => {
    const f = fake();
    await passwordStep(f);
    vi.mocked(f.resource.attemptFirstFactor).mockRejectedValueOnce({ code });
    await f.handlers.verify("password-fixture");
    const before = calls(f);
    expect(await f.handlers.verify("password-fixture")).toEqual(UNAVAILABLE);
    expect(await f.handlers.verifyCode("code-fixture")).toEqual(UNAVAILABLE);
    expect(await f.handlers.resendCode()).toEqual(UNAVAILABLE);
    expect(calls(f)).toEqual(before);
    await passwordStep(f);
  });

  it.each(["form_password_incorrect", "clerk_offline"])("allows retry after recoverable rejection %s", async code => {
    const f = fake();
    await passwordStep(f);
    vi.mocked(f.resource.attemptFirstFactor).mockRejectedValueOnce({ code });
    await f.handlers.verify("password-fixture");
    expect(await f.handlers.verify("password-fixture")).toEqual(OK);
    expect(vi.mocked(f.provider.setActive).mock.calls.length).toBe(1);
  });

  it("reads a stale rejection as unavailable", async () => {
    const f = fake();
    const pending = deferred<ClerkSignInResource>();
    f.provider.create.mockReturnValueOnce(pending.promise);
    const identifying = f.handlers.identify("identifier-fixture");
    f.provider.isCurrent.mockReturnValue(false);
    pending.reject({ code: "user_locked", message: "provider detail fixture" });
    expect(await identifying).toEqual(UNAVAILABLE);
  });

  it("ignores a result from an older revision", async () => {
    const f = fake();
    await passwordStep(f);
    const pending = deferred<ClerkSignInResource>();
    vi.mocked(f.resource.attemptFirstFactor).mockReturnValueOnce(pending.promise);
    const verifying = f.handlers.verify("password-fixture");
    // Refused while busy, so the flow moves to a new revision without identify.
    expect(await f.handlers.verifyCode("code-fixture")).toEqual(UNAVAILABLE);
    pending.resolve(f.complete());
    expect(await verifying).toEqual(UNAVAILABLE);
    expect(vi.mocked(f.provider.setActive).mock.calls.length).toBe(0);
  });

  it("treats a throwing isCurrent as not current", async () => {
    const f = fake();
    f.provider.isCurrent.mockImplementation(() => { throw new Error("isCurrent fixture"); });
    expect(await f.handlers.identify("identifier-fixture")).toEqual(UNAVAILABLE);
    expect(f.handlers.canResendCode()).toBe(false);
    expect(calls(f)).toEqual([0, 0, 0, 0, 0]);
  });

  it("treats a truthy non-boolean isCurrent as not current", async () => {
    const f = fake();
    f.provider.isCurrent.mockReturnValue(1 as unknown as boolean);
    expect(await f.handlers.identify("identifier-fixture")).toEqual(UNAVAILABLE);
    expect(calls(f)).toEqual([0, 0, 0, 0, 0]);
  });

  it("canResendCode is pure and makes no Clerk calls", async () => {
    const f = fake();
    expect(f.handlers.canResendCode()).toBe(false);
    await codeStep(f);
    const before = calls(f);
    expect(f.handlers.canResendCode()).toBe(true);
    expect(f.handlers.canResendCode()).toBe(true);
    expect(calls(f)).toEqual(before);
    f.provider.isCurrent.mockReturnValue(false);
    expect(f.handlers.canResendCode()).toBe(false);
    expect(calls(f)).toEqual(before);
  });
});


describe("Clerk sign-in auth rule regressions", () => {
  it.each(["code", "activated"])("makes no out-of-phase Clerk calls after reaching %s", async step => {
    const f = fake();
    if (step === "code") await codeStep(f);
    else {
      await passwordStep(f);
      expect(await f.handlers.verify("password-fixture")).toEqual(OK);
    }
    const before = calls(f);
    const result = await f.handlers.verify("password-fixture");
    expect(vi.mocked(f.resource.attemptFirstFactor).mock.calls.length).toBe(1);
    expect(result).toEqual(UNAVAILABLE);
    expect(await f.handlers.verifyCode("code-fixture")).toEqual(UNAVAILABLE);
    expect(await f.handlers.resendCode()).toEqual(UNAVAILABLE);
    expect(calls(f)).toEqual(before);
  });

  it.each([
    ["network", "identify"], ["rateLimited", "identify"],
    ["network", "abort"], ["rateLimited", "abort"],
  ])("rejects a swallowed %s send failure after %s invalidates the operation", async (failureClass, invalidation) => {
    const f = fake();
    const owner = {};
    const controller = new AbortController();
    const handlers = createClerkSignInHandlers({ ...f.provider, operationOwner: owner, signal: controller.signal });
    const other = createClerkSignInHandlers({ ...f.provider, operationOwner: owner });
    expect(await handlers.identify("identifier-fixture")).toEqual(OK);
    vi.mocked(f.resource.attemptFirstFactor).mockResolvedValueOnce({ ...f.resource,
      status: "needs_second_factor", supportedSecondFactors: [{ strategy: "email_code", emailAddressId: "address-fixture" }] });
    const sending = deferred<ClerkSignInResource>();
    const started = deferred<void>();
    vi.mocked(f.resource.prepareSecondFactor).mockImplementationOnce(() => {
      started.resolve(undefined);
      return sending.promise;
    });
    const verifying = handlers.verify("password-fixture");
    await started.promise;
    if (invalidation === "identify") expect(await other.identify("identifier-fixture")).toEqual(UNAVAILABLE);
    else controller.abort();
    sending.reject(failureClass === "network" ? { code: "clerk_offline" } : { status: 429 });
    expect(await verifying).toEqual(UNAVAILABLE);
    expect(handlers.canResendCode()).toBe(false);
    expect(calls(f)).toEqual([1, 1, 1, 0, 0]);
  });

  it("does not activate a non-complete code result carrying a session id", async () => {
    const f = fake();
    await codeStep(f, "totp");
    vi.mocked(f.resource.attemptSecondFactor).mockResolvedValueOnce({ ...f.complete(), status: "needs_second_factor" });
    const result = await f.handlers.verifyCode("code-fixture");
    expect(vi.mocked(f.provider.setActive).mock.calls.length).toBe(0);
    expect(result).toEqual(UNAVAILABLE);
    expect(calls(f)).toEqual([1, 1, 0, 1, 0]);
  });

  it("keeps the shared-owner lock after a refused second caller until the first settles", async () => {
    const f = fake();
    const thirdProvider = fake();
    const owner = {};
    const first = createClerkSignInHandlers({ ...f.provider, operationOwner: owner });
    const second = createClerkSignInHandlers({ ...f.provider, operationOwner: owner });
    const third = createClerkSignInHandlers({ ...thirdProvider.provider, operationOwner: owner });
    expect(await first.identify("identifier-fixture")).toEqual(OK);
    const pending = deferred<ClerkSignInResource>();
    vi.mocked(f.resource.attemptFirstFactor).mockReturnValueOnce(pending.promise);
    const verifying = first.verify("password-fixture");
    try {
      expect(await second.identify("identifier-fixture")).toEqual(UNAVAILABLE);
      const thirdResult = third.identify("identifier-fixture");
      // Measure the third caller before the first provider operation settles.
      expect(calls(thirdProvider)).toEqual([0, 0, 0, 0, 0]);
      expect(await thirdResult).toEqual(UNAVAILABLE);
      expect(calls(f)).toEqual([1, 1, 0, 0, 0]);
    } finally {
      pending.resolve(f.complete());
      await verifying;
    }
    expect(vi.mocked(f.provider.setActive).mock.calls.length).toBe(0);
    expect(await third.identify("identifier-fixture")).toEqual(OK);
    expect(calls(thirdProvider)).toEqual([1, 0, 0, 0, 0]);
  });

  it("does not activate a complete create result before password verification", async () => {
    const f = fake();
    f.provider.create.mockResolvedValueOnce(f.complete());
    const result = await f.handlers.identify("identifier-fixture");
    expect(vi.mocked(f.provider.setActive).mock.calls.length).toBe(0);
    expect(result).toEqual(UNAVAILABLE);
    expect(calls(f)).toEqual([1, 0, 0, 0, 0]);
  });

  it("does not repeat the first factor when verify is called during the code step", async () => {
    const f = fake();
    await codeStep(f, "totp");
    const before = calls(f);
    const result = await f.handlers.verify("password-fixture");
    expect(vi.mocked(f.resource.attemptFirstFactor).mock.calls.length).toBe(1);
    expect(result).toEqual(UNAVAILABLE);
    expect(calls(f)).toEqual(before);
  });
});
