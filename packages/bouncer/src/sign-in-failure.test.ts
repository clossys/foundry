import { isFrontDoorCopyId } from "@clossys/writer";
import { describe, expect, it } from "vitest";
import { CLERK_SIGN_IN_FAILURE_CODES } from "./providers/clerk/web/sign-in-failure-codes.js";
import {
  SIGN_IN_FAILURE_CLASSES,
  classifySignInFailure,
  signInFailureCopyId,
} from "./sign-in-failure.js";
import type { SignInFailureClass } from "./sign-in-failure.js";

const throwing = {
  get status(): number {
    throw new Error("unreadable");
  },
};

describe("rules", () => {
  it("lists the seven classes in order", () => {
    expect([...SIGN_IN_FAILURE_CLASSES]).toEqual([
      "credential",
      "notFound",
      "rateLimited",
      "locked",
      "network",
      "unavailable",
      "unknown",
    ]);
  });

  it("takes the first error code the table knows, then the top-level code", () => {
    const codes = CLERK_SIGN_IN_FAILURE_CODES;
    expect(
      classifySignInFailure(
        { status: 422, errors: [{ code: "x" }, { code: "form_password_incorrect" }] },
        { codes },
      ),
    ).toBe("credential");
    expect(classifySignInFailure({ code: "user_locked" }, { codes })).toBe("locked");
    expect(
      classifySignInFailure(
        { code: "user_locked", errors: [{ code: "form_password_incorrect" }] },
        { codes },
      ),
    ).toBe("credential");
  });

  it("lets a code win over the status", () => {
    expect(
      classifySignInFailure({ status: 429, code: "a" }, { codes: { a: "network" } }),
    ).toBe("network");
  });

  it("falls back to the status when no code matches", () => {
    expect(classifySignInFailure({ status: 429 })).toBe("rateLimited");
    expect(classifySignInFailure({ status: 423 })).toBe("locked");
    expect(classifySignInFailure({ status: 500 })).toBe("unavailable");
    expect(classifySignInFailure({ status: 503 })).toBe("unavailable");
    expect(classifySignInFailure({ status: 599 })).toBe("unavailable");
    expect(classifySignInFailure({ status: 429, code: "nope" }, { codes: {} })).toBe(
      "rateLimited",
    );
  });

  it("reads everything else as unknown", () => {
    expect(classifySignInFailure({ status: 401 })).toBe("unknown");
    expect(classifySignInFailure({ status: 404 })).toBe("unknown");
    expect(classifySignInFailure({ status: 600 })).toBe("unknown");
    expect(classifySignInFailure({ status: "429" })).toBe("unknown");
    expect(classifySignInFailure({})).toBe("unknown");
    expect(classifySignInFailure(null)).toBe("unknown");
    expect(classifySignInFailure(undefined)).toBe("unknown");
    expect(classifySignInFailure("429")).toBe("unknown");
    expect(classifySignInFailure(429)).toBe("unknown");
    expect(classifySignInFailure({ errors: "x" })).toBe("unknown");
    expect(classifySignInFailure({ errors: [null, 1, {}] })).toBe("unknown");
  });

  it("matches own keys of the table only", () => {
    const codes = CLERK_SIGN_IN_FAILURE_CODES;
    expect(classifySignInFailure({ code: "toString" }, { codes })).toBe("unknown");
    expect(classifySignInFailure({ code: "__proto__" }, { codes })).toBe("unknown");
    expect(classifySignInFailure({ errors: [{ code: "constructor" }] }, { codes })).toBe("unknown");
  });

  it("ignores a table value that is not a class other than unknown", () => {
    const codes = { a: "unknown", b: "bogus" } as never;
    expect(classifySignInFailure({ code: "a" }, { codes })).toBe("unknown");
    expect(classifySignInFailure({ code: "b", status: 429 }, { codes })).toBe("rateLimited");
  });

  it("reads a throwing getter as unknown", () => {
    expect(classifySignInFailure(throwing)).toBe("unknown");
    expect(
      classifySignInFailure({ get errors(): never { throw new Error("x"); } }, {
        codes: CLERK_SIGN_IN_FAILURE_CODES,
      }),
    ).toBe("unknown");
  });
});

describe("Clerk table", () => {
  it("maps each verified code to its class", () => {
    expect(CLERK_SIGN_IN_FAILURE_CODES).toEqual({
      form_password_incorrect: "credential",
      form_code_incorrect: "credential",
      form_identifier_not_found: "notFound",
      user_locked: "locked",
    });
    for (const [code, failureClass] of Object.entries(CLERK_SIGN_IN_FAILURE_CODES)) {
      expect(classifySignInFailure({ code }, { codes: CLERK_SIGN_IN_FAILURE_CODES })).toBe(
        failureClass,
      );
    }
  });

  it("has four keys", () => {
    expect(Object.keys(CLERK_SIGN_IN_FAILURE_CODES)).toHaveLength(4);
  });
});

describe("account existence", () => {
  const codes = CLERK_SIGN_IN_FAILURE_CODES;

  it("keeps notFound by default and hides it as credential on request", () => {
    expect(classifySignInFailure({ code: "form_identifier_not_found" }, { codes })).toBe("notFound");
    expect(
      classifySignInFailure(
        { code: "form_identifier_not_found" },
        { codes, hideAccountExistence: true },
      ),
    ).toBe("credential");
    expect(
      classifySignInFailure(
        { code: "form_identifier_not_found" },
        { codes, hideAccountExistence: false },
      ),
    ).toBe("notFound");
  });

  it("hides locked as rateLimited, from a code or a status", () => {
    expect(classifySignInFailure({ code: "user_locked" }, { codes })).toBe("locked");
    expect(
      classifySignInFailure({ code: "user_locked" }, { codes, hideAccountExistence: true }),
    ).toBe("rateLimited");
    expect(classifySignInFailure({ status: 423 }, { hideAccountExistence: true })).toBe(
      "rateLimited",
    );
  });

  it("leaves the other classes alone", () => {
    expect(
      classifySignInFailure({ code: "form_password_incorrect" }, { codes, hideAccountExistence: true }),
    ).toBe("credential");
    expect(classifySignInFailure({ status: 503 }, { hideAccountExistence: true })).toBe(
      "unavailable",
    );
    expect(classifySignInFailure({ status: 404 }, { hideAccountExistence: true })).toBe("unknown");
  });
});

describe("ids exist in Writer", () => {
  it("maps every class and factor to a Writer copy id", () => {
    const seen = new Map<string, SignInFailureClass>();
    for (const failureClass of SIGN_IN_FAILURE_CLASSES) {
      for (const factor of [undefined, "password", "code"] as const) {
        const id = signInFailureCopyId(failureClass, factor ? { factor } : undefined);
        expect(isFrontDoorCopyId(id), `${failureClass}/${factor ?? "default"} -> ${id}`).toBe(true);
        seen.set(id, failureClass);
      }
    }
    expect(seen.size).toBe(6);
  });

  it("returns the specified id for each class", () => {
    expect(signInFailureCopyId("credential")).toBe("front-door.password.notice");
    expect(signInFailureCopyId("credential", { factor: "password" })).toBe("front-door.password.notice");
    expect(signInFailureCopyId("credential", { factor: "code" })).toBe("front-door.code.notice");
    expect(signInFailureCopyId("notFound")).toBe("front-door.identifier-not-found.notice");
    expect(signInFailureCopyId("rateLimited")).toBe("front-door.rate-limited.notice");
    expect(signInFailureCopyId("locked")).toBe("front-door.locked.notice");
    expect(signInFailureCopyId("network")).toBe("front-door.unavailable.notice");
    expect(signInFailureCopyId("unavailable")).toBe("front-door.unavailable.notice");
    expect(signInFailureCopyId("unknown")).toBe("front-door.unavailable.notice");
  });

  it("applies the factor to the credential class only", () => {
    expect(signInFailureCopyId("locked", { factor: "code" })).toBe("front-door.locked.notice");
  });
});

describe("never carries provider text", () => {
  it("returns a class and an id, whatever the failure says", () => {
    const failure = {
      status: 422,
      message: "No account for ada@example.test",
      errors: [{ code: "form_identifier_not_found", longMessage: "ada@example.test not found" }],
    };
    const failureClass = classifySignInFailure(failure, { codes: CLERK_SIGN_IN_FAILURE_CODES });
    expect(SIGN_IN_FAILURE_CLASSES).toContain(failureClass);
    expect(signInFailureCopyId(failureClass)).not.toContain("example.test");
  });
});
