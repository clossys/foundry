// Generated from docs/contracts/agents.json by `node scripts/check-agents-definition.mjs --write`. Do not edit:
// check:agents-definition fails when this file differs from that render by one byte.

/** One row per Foundry package: its id (the directory under packages/), package name and class. */
export const AGENT_ROWS = Object.freeze([
  Object.freeze({ id: "advisor", package: "@clossys/advisor", class: "other" }),
  Object.freeze({ id: "architect", package: "@clossys/architect", class: "other" }),
  Object.freeze({ id: "bouncer", package: "@clossys/bouncer", class: "other" }),
  Object.freeze({ id: "builder", package: "@clossys/builder", class: "other" }),
  Object.freeze({ id: "butler", package: "@clossys/butler", class: "other" }),
  Object.freeze({ id: "controller", package: "@clossys/controller", class: "other" }),
  Object.freeze({ id: "customer", package: "@clossys/customer", class: "other" }),
  Object.freeze({ id: "designer", package: "@clossys/designer", class: "content" }),
  Object.freeze({ id: "developer", package: "@clossys/developer", class: "factory" }),
  Object.freeze({ id: "director", package: "@clossys/director", class: "content" }),
  Object.freeze({ id: "giver", package: "@clossys/giver", class: "other" }),
  Object.freeze({ id: "influencer", package: "@clossys/influencer", class: "other" }),
  Object.freeze({ id: "inspector", package: "@clossys/inspector", class: "other" }),
  Object.freeze({ id: "integrator", package: "@clossys/integrator", class: "other" }),
  Object.freeze({ id: "keeper", package: "@clossys/keeper", class: "other" }),
  Object.freeze({ id: "launcher", package: "@clossys/launcher", class: "tooling" }),
  Object.freeze({ id: "locksmith", package: "@clossys/locksmith", class: "other" }),
  Object.freeze({ id: "messenger", package: "@clossys/messenger", class: "other" }),
  Object.freeze({ id: "observer", package: "@clossys/observer", class: "other" }),
  Object.freeze({ id: "planner", package: "@clossys/planner", class: "factory" }),
  Object.freeze({ id: "producer", package: "@clossys/producer", class: "tooling" }),
  Object.freeze({ id: "publisher", package: "@clossys/publisher", class: "content" }),
  Object.freeze({ id: "reviewer", package: "@clossys/reviewer", class: "factory" }),
  Object.freeze({ id: "starter", package: "@clossys/starter", class: "tooling" }),
  Object.freeze({ id: "writer", package: "@clossys/writer", class: "content" }),
]);

/** The named, ordered agent lists. Read a list by name; never write its ids out. */
export const AGENT_LISTS = Object.freeze({
  /** The content agents in chain order. Each owns slots, a loop and a queue. Its members are exactly the rows of class content. */
  "content": Object.freeze(["director", "designer", "writer", "publisher"]),
  /** The agents with a live record tree under clossys/agents: the content agents in chain order, then Producer. */
  "live": Object.freeze(["director", "designer", "writer", "publisher", "producer"]),
  /** The live agents in Studio nav and interview order: Producer, then the content agents in chain order. */
  "nav": Object.freeze(["producer", "director", "designer", "writer", "publisher"]),
  /** The first-party packages the end-to-end check installs and the overlay cohort packs: the nav agents, then Controller. */
  "e2e": Object.freeze(["producer", "director", "designer", "writer", "publisher", "controller"]),
  /** The roles a consumer install pack holds, each exactly once: what pack-five packs and advisor install accepts. */
  "install": Object.freeze(["controller", "director", "designer", "writer", "publisher", "producer", "advisor"]),
  /** The agents whose package IA places slots in a consumer; Publisher assembles and places none. */
  "placed": Object.freeze(["director", "designer", "writer"]),
  /** The agents whose owner decisions are asked as policy, not per slot. */
  "policy": Object.freeze(["designer", "writer", "publisher"]),
  /** The agents whose slot candidates carry copy keys and declared inputs. */
  "copy-keys": Object.freeze(["designer", "writer"]),
  /** The agents whose candidates are Markdown documents; the others' are JSON. */
  "markdown": Object.freeze(["director", "writer"]),
  /** The packages that ship rendered surfaces: Designer's components and Publisher's pages. */
  "surfaces": Object.freeze(["designer", "publisher"]),
  /** The packages the engine side-door scan reads, in scan order. */
  "side-door": Object.freeze(["producer", "designer", "writer", "publisher", "director"]),
  /** The agent words the assemble-only check reads in a page or route, in match order. */
  "assemble-only": Object.freeze(["designer", "writer", "director", "publisher", "producer"]),
  /** The roles whose package framework declares native cells. */
  "native-cells": Object.freeze(["director", "writer", "designer", "publisher"]),
  /** The first three packages ever published: the pre-cutover release target and the first wave of qualification. */
  "trio": Object.freeze(["advisor", "starter", "controller"]),
  /** Every published package in release order; Producer is not published. */
  "release-order": Object.freeze(["advisor", "starter", "controller", "launcher", "director", "writer", "designer", "customer", "architect", "bouncer", "butler", "giver", "influencer", "integrator", "keeper", "locksmith", "messenger", "observer", "builder", "inspector", "publisher"]),
  /** The agents a Publisher release hands over to, one per destination kind: what a release target, handover and receipt may name. */
  "release-receivers": Object.freeze(["builder", "messenger", "influencer"]),
  /** The packages whose catalogs Designer's IA coverage reads as external nodes: Writer's passages and copy records, Publisher's admin routes and compositions. */
  "coverage-externals": Object.freeze(["writer", "publisher"]),
  /** The packages whose sources, tests and scripts the DOM provenance attribute codemods rewrite and check. */
  "provenance-stamped": Object.freeze(["designer", "publisher", "producer", "writer"]),
  /** The agents that own the rules about the build process itself: the factory agents, then Controller. Each one's skill carries an owned-rules block that check:rules holds to exactly the registry rules it owns. */
  "rule-homes": Object.freeze(["planner", "developer", "reviewer", "controller"]),
});

/** The chain handoffs (flows.md N3): Director feeds Designer and Writer, and Designer and Writer feed Publisher. Each pair is upstream, then downstream. */
export const AGENT_HANDOFFS = Object.freeze([
  Object.freeze(["director", "designer"]),
  Object.freeze(["director", "writer"]),
  Object.freeze(["designer", "publisher"]),
  Object.freeze(["writer", "publisher"]),
]);
