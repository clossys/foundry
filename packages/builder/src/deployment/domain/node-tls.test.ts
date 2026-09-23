import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createNodeTlsProbe } from "./node-tls.js";
import type { NodeTlsConnect } from "./node-tls.js";

type FakeSocket = EventEmitter & { getPeerCertificate: () => unknown; destroy: () => void };

function fakeSocket(cert: unknown): FakeSocket {
  const socket = new EventEmitter() as FakeSocket;
  socket.getPeerCertificate = () => cert;
  socket.destroy = vi.fn();
  return socket;
}

function connectResolvingWith(cert: unknown): NodeTlsConnect {
  return ((_options: unknown, callback?: () => void) => {
    const socket = fakeSocket(cert);
    queueMicrotask(() => callback?.());
    return socket as unknown as ReturnType<NodeTlsConnect>;
  }) as unknown as NodeTlsConnect;
}

function connectEmitting(event: "error" | "timeout", error?: { message: string; code?: string }): NodeTlsConnect {
  return (() => {
    const socket = fakeSocket(undefined);
    queueMicrotask(() => {
      if (event === "timeout") { socket.emit("timeout"); return; }
      const err = Object.assign(new Error(error?.message ?? ""), error?.code === undefined ? {} : { code: error.code });
      socket.emit("error", err);
    });
    return socket as unknown as ReturnType<NodeTlsConnect>;
  }) as unknown as NodeTlsConnect;
}

const validCert = { valid_to: "Jan 1 2099 00:00:00 GMT" };

describe("createNodeTlsProbe", () => {
  it("reports a trusted certificate's real notAfter on a successful handshake", async () => {
    const probe = createNodeTlsProbe({ connect: connectResolvingWith(validCert) });
    const observation = await probe("example.com");
    expect(observation).toEqual({ kind: "trusted", notAfter: new Date(validCert.valid_to).toISOString() });
  });

  it("falls back to the epoch when the certificate carries no readable valid_to", async () => {
    const probe = createNodeTlsProbe({ connect: connectResolvingWith({}) });
    const observation = await probe("example.com");
    expect(observation).toEqual({ kind: "trusted", notAfter: new Date(0).toISOString() });
  });

  it("reports a certificate verification failure as untrusted, with the platform's own reason", async () => {
    const probe = createNodeTlsProbe({ connect: connectEmitting("error", { message: "self-signed certificate", code: "DEPTH_ZERO_SELF_SIGNED_CERT" }) });
    const observation = await probe("example.com");
    expect(observation).toEqual({ kind: "untrusted", reason: "self-signed certificate" });
  });

  it("reports a hostname mismatch as untrusted", async () => {
    const probe = createNodeTlsProbe({ connect: connectEmitting("error", { message: "Hostname/IP does not match certificate's altnames", code: "ERR_TLS_CERT_ALTNAME_INVALID" }) });
    const observation = await probe("example.com");
    expect(observation).toEqual({ kind: "untrusted", reason: "Hostname/IP does not match certificate's altnames" });
  });

  it("reports a transport-level error code as unreachable, never untrusted", async () => {
    const probe = createNodeTlsProbe({ connect: connectEmitting("error", { message: "connect ECONNREFUSED", code: "ECONNREFUSED" }) });
    const observation = await probe("example.com");
    expect(observation).toEqual({ kind: "unreachable", detail: "connect ECONNREFUSED" });
  });

  it("reports an error with no code at all as unreachable, not untrusted", async () => {
    const probe = createNodeTlsProbe({ connect: connectEmitting("error", { message: "socket hang up" }) });
    const observation = await probe("example.com");
    expect(observation).toEqual({ kind: "unreachable", detail: "socket hang up" });
  });

  it("reports unreachable on a timeout", async () => {
    const probe = createNodeTlsProbe({ connect: connectEmitting("timeout") });
    const observation = await probe("example.com");
    expect(observation).toEqual({ kind: "unreachable", detail: "connection timed out" });
  });

  it("resolves unreachable/aborted without connecting when the signal is already aborted", async () => {
    const connect = vi.fn(connectResolvingWith(validCert));
    const probe = createNodeTlsProbe({ connect });
    const controller = new AbortController();
    controller.abort();
    const observation = await probe("example.com", controller.signal);
    expect(observation).toEqual({ kind: "unreachable", detail: "aborted" });
    expect(connect).not.toHaveBeenCalled();
  });
});
