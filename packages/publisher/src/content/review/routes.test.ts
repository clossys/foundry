import { describe, expect, it } from "vitest";
import { reviewCandidate } from "./index.js";
import { addPeer, addPeerCandidate, peerSlotId, resnapshot, reviewInput } from "./__fixtures__/review.js";
import type { Fixture } from "./__fixtures__/review.js";
import type { ContentPlacement } from "../taxonomy.js";

const findings = (input: Fixture, check: string) => reviewCandidate(resnapshot(input)).findings.filter(f => f.check === check);
const redirectInput = (target = "/peer"): Fixture => {
  const input = reviewInput(); input.registry.slots[0]!.kind = "redirect";
  const candidate = input.registry.candidates[0]!; delete candidate.composition; candidate.redirectTarget = target; candidate.typeSettings = {};
  return resnapshot(input);
};
describe("links, URLs, fixed frames and redirect Review", () => {
  it("accepts a registered link target without requiring an active candidate", () => {
    const input = reviewInput(); addPeer(input);
    input.registry.candidates[0]!.links = [{ toSlotId: peerSlotId, relation: "nav", intent: "Read peer" }];
    expect(findings(input, "links")).toEqual([]);
    input.registry.candidates[0]!.links[0]!.toSlotId = "sl_zzzzzzzzzz";
    expect(findings(input, "links")).not.toEqual([]);
  });
  it("finds route collisions in the same deploy target", () => {
    const input = reviewInput(); addPeer(input, { route: "/home" });
    expect(findings(input, "url-collision")).not.toEqual([]);
  });
  it("keeps route namespaces separate across deploy targets", () => {
    const input = reviewInput(); addPeer(input, { route: "/home", deployTarget: "other" });
    expect(findings(input, "url-collision")).toEqual([]);
  });
  it("does not invent a deploy target for an unbound peer slot", () => {
    const input = reviewInput(); addPeer(input, { route: "/home" }); delete input.registry.slots[1]!.deployTarget;
    expect(findings(input, "url-collision")).toEqual([]);
  });
  it("does not invent a route when a peer has no URL", () => {
    const input = reviewInput(); addPeer(input); delete input.registry.slots[1]!.route;
    expect(findings(input, "url-collision")).toEqual([]);
  });
  it.each(["/home/", "/a/../home", "/%68ome", "/h%6fme/"])("canonicalizes collision route %s", route => {
    const input = reviewInput(); addPeer(input, { route }); expect(findings(input, "url-collision")).not.toEqual([]);
  });
  it.each(["//other.test/home", "https://other.test/home", "relative", "/bad%", "/bad\\path", "/bad\npath", "/%2f%2fother.test"])("rejects dangerous or invalid slot route %j", route => {
    const input = reviewInput(); input.registry.slots[0]!.route = route;
    expect(findings(input, "url-collision")).not.toEqual([]);
  });
  const frames: readonly [ContentPlacement, string][] = [
    [{ l1: "websites", l2: "site" }, "frames.site-shell"], [{ l1: "websites", l2: "demo" }, "frames.site-shell"],
    [{ l1: "websites", l2: "admin" }, "frames.app-shell"], [{ l1: "websites", l2: "app" }, "frames.app-shell"],
    [{ l1: "websites", l2: "auth" }, "frames.auth-shell"], [{ l1: "documents", l2: "docs" }, "frames.document"],
    [{ l1: "presentations", l2: "decks" }, "frames.deck"], [{ l1: "videos", l2: "clips" }, "frames.video"],
    [{ l1: "messages", l2: "email" }, "frames.message"], [{ l1: "social", l2: "posts" }, "frames.social"],
  ];
  it.each(frames)("enforces the LF-0 fixed frame for %j", (placement, frameId) => {
    const input = reviewInput(); Object.assign(input.registry.slots[0]!, placement);
    input.libraries[0]!.frames.push({ id: frameId + "-wrong", configIds: ["default"] });
    if (!input.libraries[0]!.frames.some(frame => frame.id === frameId)) input.libraries[0]!.frames.push({ id: frameId, configIds: ["default"] });
    input.registry.candidates[0]!.composition!.frame.frameId = frameId;
    expect(findings(input, "frame-per-l2")).toEqual([]);
    input.registry.candidates[0]!.composition!.frame.frameId = frameId + "-wrong";
    expect(findings(input, "frame-per-l2")).not.toEqual([]);
  });
  it.each(["/peer", "https://example.test/landing", "http://example.test/landing"])("accepts redirect target %s without fetching", target => {
    const input = redirectInput(target); if (target === "/peer") addPeer(input);
    expect(reviewCandidate(input).findings).toEqual([]);
    expect(reviewCandidate(input).checkedAgainst).toEqual({ libraryVersion: null, locales: ["en", "fr"] });
  });
  it("rejects an unresolved internal redirect destination", () => {
    expect(findings(redirectInput("/missing"), "redirect")).not.toEqual([]);
  });
  it.each(["javascript:alert(1)", "data:text/plain,sample", "ftp://example.test", "//example.test/path", "peer", "/bad%", "/bad\\path", "/bad\npath", "/%2f%2fexample.test"])("rejects invalid redirect target %j", target => {
    expect(findings(redirectInput(target), "redirect")).not.toEqual([]);
  });
  it("rejects a redirect to the same canonical route", () => {
    expect(findings(redirectInput("/a/../home/"), "redirect")).not.toEqual([]);
  });
  it("rejects a cycle through an active peer redirect", () => {
    const input = redirectInput(); addPeer(input, { kind: "redirect" }); addPeerCandidate(input);
    input.registry.candidates[1]!.redirectTarget = "/home";
    expect(findings(input, "redirect")).not.toEqual([]);
  });
  it("does not follow an inactive peer alternative as current redirect evidence", () => {
    const input = redirectInput(); addPeer(input, { kind: "redirect" }); addPeerCandidate(input);
    input.registry.candidates[1]!.state = "draft"; input.registry.candidates[1]!.redirectTarget = "/home";
    delete input.registry.slots[1]!.activeCandidateId;
    expect(findings(input, "redirect")).toEqual([]);
  });
  it("rejects composition on a redirect slot without skipping frame or copy checks", () => {
    const input = reviewInput(); input.registry.slots[0]!.kind = "redirect";
    expect(findings(input, "redirect")).not.toEqual([]);
  });
});
