import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createNodeTlsProbe } from "./node-tls.js";
import type { NodeTlsConnect } from "./node-tls.js";

type FakeSocket = EventEmitter & { getPeerCertificate: () => unknown; authorized: boolean; destroy: () => void };

function fakeSocket(cert: unknown, authorized: boolean): FakeSocket {
  const socket = new EventEmitter() as FakeSocket;
  socket.getPeerCertificate = () => cert;
  socket.authorized = authorized;
  socket.destroy = vi.fn();
  return socket;
}

function connectResolvingWith(cert: unknown, authorized: boolean): NodeTlsConnect {
  return ((_options: unknown, callback?: () => void) => {
    const socket = fakeSocket(cert, authorized);
    queueMicrotask(() => callback?.());
    return socket as unknown as ReturnType<NodeTlsConnect>;
  }) as unknown as NodeTlsConnect;
}

function connectEmitting(event: "error" | "timeout", detail?: string): NodeTlsConnect {
  return (() => {
    const socket = fakeSocket(undefined, false);
    queueMicrotask(() => socket.emit(event, detail === undefined ? undefined : new Error(detail)));
    return socket as unknown as ReturnType<NodeTlsConnect>;
  }) as unknown as NodeTlsConnect;
}

const validCert = { valid_from: "Jan 1 2020 00:00:00 GMT", valid_to: "Jan 1 2099 00:00:00 GMT", subjectaltname: "DNS:example.com" };

describe("createNodeTlsProbe", () => {
  it("observes a valid, hostname-authorized, chain-trusted certificate", async () => {
    const probe = createNodeTlsProbe({ connect: connectResolvingWith(validCert, true) });
    const observation = await probe("example.com");
    expect(observation).toEqual({ kind: "observed", validNow: true, notAfter: new Date(validCert.valid_to).toISOString(), hostnameAuthorized: true, chainTrusted: true });
  });

  it("reports chainTrusted false from an untrusted (e.g. self-signed) handshake without failing the probe", async () => {
    const probe = createNodeTlsProbe({ connect: connectResolvingWith(validCert, false) });
    const observation = await probe("example.com");
    expect(observation).toMatchObject({ kind: "observed", chainTrusted: false });
  });

  it("reports hostnameAuthorized false when the certificate does not name the host", async () => {
    const probe = createNodeTlsProbe({ connect: connectResolvingWith({ ...validCert, subjectaltname: "DNS:other.example.com" }, true) });
    const observation = await probe("example.com");
    expect(observation).toMatchObject({ kind: "observed", hostnameAuthorized: false });
  });

  it("reports validNow false for an expired certificate", async () => {
    const expired = { ...validCert, valid_to: "Jan 1 2000 00:00:00 GMT" };
    const probe = createNodeTlsProbe({ connect: connectResolvingWith(expired, true) });
    const observation = await probe("example.com");
    expect(observation).toMatchObject({ kind: "observed", validNow: false });
  });

  it("reports unreachable when no certificate was presented", async () => {
    const probe = createNodeTlsProbe({ connect: connectResolvingWith({}, false) });
    const observation = await probe("example.com");
    expect(observation).toEqual({ kind: "unreachable", detail: "no certificate was presented" });
  });

  it("reports unreachable on a socket error", async () => {
    const probe = createNodeTlsProbe({ connect: connectEmitting("error", "ECONNREFUSED") });
    const observation = await probe("example.com");
    expect(observation).toEqual({ kind: "unreachable", detail: "ECONNREFUSED" });
  });

  it("reports unreachable on a timeout", async () => {
    const probe = createNodeTlsProbe({ connect: connectEmitting("timeout") });
    const observation = await probe("example.com");
    expect(observation).toEqual({ kind: "unreachable", detail: "connection timed out" });
  });

  it("resolves unreachable/aborted without connecting when the signal is already aborted", async () => {
    const connect = vi.fn(connectResolvingWith(validCert, true));
    const probe = createNodeTlsProbe({ connect });
    const controller = new AbortController();
    controller.abort();
    const observation = await probe("example.com", controller.signal);
    expect(observation).toEqual({ kind: "unreachable", detail: "aborted" });
    expect(connect).not.toHaveBeenCalled();
  });
});
