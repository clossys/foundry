/**
 * The request lens (foundry-build-0048 U7, Q1-Q11): Producer routes every request over the one queue
 * (clossys.queue-entry/2 kinds slot, change and fix), each closes with a link back to its requester, and no agent
 * keeps a store of its own, drops a need, writes another agent's slot or releases over an open fix. Pure functions of
 * the facts requests-model.ts reads; report-only like every lens.
 */
import { posix } from "node:path";
import type { Assertion } from "./assertions.js";
import type { AgentModel, ConformModel } from "./model.js";
import { statusOf, type QueueFact } from "./requests-model.js";

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const KINDS = ["slot", "change", "fix"] as const;
const ref = (fact: QueueFact) => `queue.${fact.kind}#${fact.id}`;
const from = (fact: QueueFact) => String(fact.doc.from ?? "");
const target = (fact: QueueFact) => String(fact.doc.target ?? "");
const route = (fact: QueueFact): Record<string, unknown> | undefined => object(fact.doc.route) ? fact.doc.route : undefined;
const targets = (agent: AgentModel, fact: QueueFact) => target(fact).startsWith(`${agent.agent}/`);
const raisedBy = (agent: AgentModel, fact: QueueFact) => from(fact).startsWith(`${agent.agent}/`);
const agentOf = (ref: string) => ref.slice(0, Math.max(0, ref.indexOf("/")));
const answers = (cites: readonly string[], fact: QueueFact) => cites.includes(ref(fact)) || cites.includes(`*#${fact.id}`);

export const REQUEST_ASSERTIONS: Readonly<Record<string, Assertion>> = {
  /** Q1: one valid record in Producer's store; the agent keeps no request store of its own. */
  Q1: agent => {
    const facts = agent.requestFacts;
    const rows = [
      ...facts.localStores.map(row => `packages/${agent.agent}/${row}: requests live in Producer's queue only`),
      ...facts.entries.filter(fact => fact.issues.length).map(fact => `${ref(fact)}: no valid record (${fact.issues.slice(0, 2).join("; ")})`),
    ];
    return { rows, evidence: facts.sourceFiles + facts.entries.length };
  },
  /** Q2: every need about the agent has a record; none is only printed. */
  Q2: (agent, model) => {
    const facts = agent.requestFacts, machinery = model.machinery.requests;
    const rows = [...facts.unrecorded, ...machinery.printedGaps.map(code => `interview gap ${code}: printed, never filed as a queue entry`)];
    return { rows, evidence: facts.needs + machinery.gapCodes };
  },
  /** Q3: routing is data and total (one catch-all, last); the router alone writes a route; an open entry's re-derived route matches (a closed one keeps its own). */
  Q3: (agent, model) => {
    const facts = agent.requestFacts;
    const rows = [...model.machinery.requests.routingIssues.map(issue => `routing.json: ${issue}`)];
    for (const fact of facts.entries) {
      if (fact.routeIssue) rows.push(`${ref(fact)}: ${fact.routeIssue}`);
      const events = Array.isArray(fact.doc.events) ? fact.doc.events.filter(object) : [];
      if (route(fact) && !events.some(event => event.op === "routed" && event.by === "producer")) rows.push(`${ref(fact)}: has a route no producer routed event wrote`);
    }
    return { rows, evidence: 1 + facts.entries.length };
  },
  /** Q4: a change or slot entry on an owner class routes to an owner MC packet from the class's loop step, carrying the owning agent's skill and the owner's options (unless the owner handed it off). */
  Q4: (agent, model) => {
    const facts = agent.requestFacts, machinery = model.machinery.requests;
    const rows: string[] = [];
    if (!machinery.ownerPacketRow) rows.push("routing.json has no owner-packet row: an owner class would route to an agent");
    if (!machinery.ownerClassCount) rows.push("no owner class is read from the loop versions' owner steps");
    rows.push(...machinery.routingIssues.filter(issue => /owner class/.test(issue)).map(issue => `routing.json: ${issue}`));
    if (facts.ownerClasses.length && !facts.declared) rows.push(`${agent.agent} owns owner classes (${facts.ownerClasses.join(", ")}) and declares no request handling skill for their packets`);
    // A change or slot entry on an owner-reserved class goes to the owner; a fix goes to the handler (the loop it runs
    // keeps the class's owner step).
    // The owner's packet is a closed question (U7 r4): every entry assigned to the owner carries options, each a
    // Producer step; one the owner handed off (route.delegated) routes to its agent as the table would without the class.
    for (const fact of facts.entries.filter(item => targets(agent, item) && route(item)?.assignee === "owner")) {
      const options = Array.isArray(fact.doc.options) ? fact.doc.options.filter(object) : [];
      if (!options.length) rows.push(`${ref(fact)}: assigned to the owner with no options: the owner answers an option id, never free text`);
      for (const option of options) if (!object(option.then) || typeof option.then.verb !== "string") rows.push(`${ref(fact)}: option ${String(option.id)} has no step (then: a Producer verb and its args)`);
    }
    const owned = facts.entries.filter(fact => fact.ownerClass && targets(agent, fact) && fact.kind !== "fix" && route(fact)?.delegated !== true);
    for (const fact of owned) {
      const packet = object(route(fact)?.packet) ? route(fact)!.packet as Record<string, unknown> : undefined;
      const skill = facts.skills.find(item => item.kind === fact.kind)?.skill;
      if (route(fact)?.assignee !== "owner" || !packet) rows.push(`${ref(fact)}: ${target(fact)} is owner-reserved (${fact.ownerClass!.step}) but routes to ${String(route(fact)?.assignee ?? "nobody")}`);
      else {
        if (packet.queue !== fact.ownerClass!.queue || packet.step !== fact.ownerClass!.step) rows.push(`${ref(fact)}: the packet is ${String(packet.queue)} from ${String(packet.step)}, not ${fact.ownerClass!.queue} from ${fact.ownerClass!.step}`);
        if (packet.skill !== skill) rows.push(`${ref(fact)}: the packet's skill ${String(packet.skill ?? "none")} is not ${agent.agent}'s declared ${fact.kind} skill ${skill ?? "(none)"}`);
      }
    }
    return { rows, evidence: 1 + facts.ownerClasses.length + owned.length };
  },
  /** Q5: conform.json declares request handling for every kind; each skill exists, is hash-registered and says how; each loop is live. */
  Q5: (agent, model) => {
    const facts = agent.requestFacts;
    const rows: string[] = [];
    if (!facts.declared) rows.push(`packages/${agent.agent}/conform.json declares no requests`);
    for (const kind of KINDS) {
      const skill = facts.skills.find(item => item.kind === kind);
      if (!skill) { if (facts.declared) rows.push(`requests.handling.${kind}: undeclared`); continue; }
      if (!skill.exists) rows.push(`requests.handling.${kind}: ${skill.skill} is missing`);
      else if (!skill.registered) rows.push(`requests.handling.${kind}: ${skill.skill} is not hash-registered`);
      else if (!skill.hasRequests) rows.push(`requests.handling.${kind}: ${skill.skill} has no ## Requests section`);
      const loop = model.machinery.loops.get(skill.loop);
      if (!loop) rows.push(`requests.handling.${kind}: ${skill.loop} has no version`);
      // A step reaches the agent by name or as the owner of the entry's slot (the handler is that owner).
      else if (!loop.steps.some(step => object(step.decider) && (step.decider.agent === agent.agent || step.decider.agent === "<owner of slot>"))) rows.push(`requests.handling.${kind}: no step of ${skill.loop} reaches ${agent.agent}`);
    }
    return { rows, evidence: KINDS.length };
  },
  /** Q6: a request follows a declared issuing edge that a real input or uses edge backs. */
  Q6: agent => {
    const facts = agent.requestFacts;
    const rows: string[] = [];
    const issuing = facts.issuing ?? [];
    for (const edge of issuing) {
      if (!agent.edges.some(item => item.target === edge.to || agentOf(item.to) === edge.to)) rows.push(`requests.issuing to ${edge.to}: no input or uses edge of ${agent.agent} reads ${edge.to}`);
    }
    const crossing = facts.entries.filter(fact => raisedBy(agent, fact) && !targets(agent, fact));
    for (const fact of crossing) {
      const to = agentOf(target(fact));
      if (!issuing.some(edge => edge.to === to && edge.kinds.includes(fact.kind))) rows.push(`${ref(fact)}: ${agent.agent} raised ${fact.kind} to ${to} with no declared issuing edge`);
    }
    return { rows, evidence: issuing.length + crossing.length };
  },
  /**
   * Q7: a closed entry has an outcome, a resolving result ref and a notify event to the requester, and its requester
   * check passed (a producer verified event before the close; L4 is this row for kind slot). An entry that says it is
   * closed and does not read is red here too. A closed change or fix is re-checked now (its verified event is only
   * evidence): a requester check or fix check that fails on today's tree is red.
   */
  Q7: agent => {
    const closed = agent.requestFacts.entries.filter(fact => statusOf(fact) === "closed");
    const rows = closed.flatMap(fact => {
      const events = Array.isArray(fact.doc.events) ? fact.doc.events.filter(object) : [];
      const at = events.findIndex(event => event.id === fact.doc.closed);
      const verified = fact.kind === "slot" || (at >= 0 && events.slice(0, at).some(event => event.op === "verified" && event.by === "producer"));
      return [
        ...fact.issues.map(issue => `${ref(fact)}: ${issue}`),
        ...(fact.resultIssue ? [`${ref(fact)}: result ${String(fact.doc.result)} ${fact.resultIssue}`] : []),
        ...(!verified && !fact.issues.length ? [`${ref(fact)}: closed with no requester check passing before it`] : []),
        ...(fact.recheck ?? []).map(failure => `${ref(fact)}: closed, and ${failure}`),
      ];
    });
    return { rows, evidence: closed.length };
  },
  /** Q8: nothing stays open past its loop: done but open, stopped without an entry, or passed over. */
  Q8: (agent, model) => {
    const runs = model.machinery.requests.runs, reasked = model.machinery.requests.reasked;
    const held = agent.requestFacts.entries.filter(fact => fact.doc.assignee === agent.agent || targets(agent, fact) && fact.doc.assignee === "owner");
    const rows: string[] = [];
    let judged = 0;
    for (const fact of held.filter(item => statusOf(item) !== "closed")) {
      judged++;
      for (const run of runs.filter(item => answers(item.cites, fact))) {
        if (run.status === "done") rows.push(`${ref(fact)}: run ${run.id} (${run.loop}) is done and the entry is still open`);
        else if (run.status === "stopped" && !reasked.has(ref(fact))) rows.push(`${ref(fact)}: run ${run.id} (${run.loop}) stopped and no open entry re-asks it`);
      }
      const loop = object(route(fact)?.handler) ? String((route(fact)!.handler as Record<string, unknown>).loop) : undefined;
      const passed = runs.find(run => loop !== undefined && run.loop === loop && run.status === "done" && run.createdAt > String(fact.doc.createdAt ?? "")
        && !answers(run.cites, fact) && run.steps.some(step => step.agent === agent.agent));
      if (passed) rows.push(`${ref(fact)}: run ${passed.id} of ${loop} ran for ${agent.agent} after it was raised and passed it over`);
    }
    return { rows, evidence: judged + held.length };
  },
  /**
   * Q9: no cross-edit: every file a step decided by the agent wrote lies under the agent's own folder (the path
   * normalised, so `<agent>/../<other>` is the other agent's), and verbs refuse a seat acting on another agent's slot.
   */
  Q9: (agent, model) => {
    const rows = model.machinery.requests.seatGuardIssues.map(issue => `verb seat guard: ${issue}`);
    let steps = 0;
    for (const run of model.machinery.requests.runs) for (const step of run.steps) {
      if (step.by !== "agent" || step.agent !== agent.agent) continue;
      steps++;
      for (const file of step.wrote) {
        const path = posix.normalize(file.replace(/\\/g, "/"));
        if (!path.startsWith(`${agent.agent}/`)) rows.push(`run ${run.id} step ${step.id}: ${agent.agent} wrote ${file}, another agent's record`);
      }
    }
    return { rows, evidence: 1 + steps };
  },
  /** Q10: breakage is a kind fix entry with its check, findings and cause; nothing raises a queue-entry/1 queue.fix. */
  Q10: (agent, model) => {
    const facts = agent.requestFacts, machinery = model.machinery.requests;
    const fixes = facts.entries.filter(fact => fact.kind === "fix");
    const rows = [
      ...machinery.fixRaisers.map(file => `${file}: raises a clossys.queue-entry/1 queue.fix, not a kind fix entry`),
      ...facts.legacyFixes.filter(fix => fix.status === "open").map(fix => `queue.fix#${fix.id} (queue-entry/1) on ${fix.subject}: breakage held as a decision entry`),
      ...fixes.filter(fact => fact.doc.cause === undefined || fact.doc.check === undefined).map(fact => `${ref(fact)}: a fix entry without its check and cause`),
    ];
    return { rows, evidence: 1 + fixes.length + facts.legacyFixes.length };
  },
  /**
   * Q11: release is refused while an open fix entry's subject is in the publication's closure: the gate is a release
   * gate, runGates runs it, and on this consumer it refuses every open fix about the agent whose slot (or a record of
   * it) the release reads.
   */
  Q11: (agent, model: ConformModel) => {
    const machinery = model.machinery.requests;
    const rows: string[] = [];
    if (!machinery.releaseGates.includes("requests.open-fix")) rows.push("the release gates hold no requests.open-fix gate: a release would ship over an open fix");
    const gate = machinery.openFix;
    if (gate.error) rows.push(`the requests.open-fix gate does not run here: ${gate.error}`);
    else if (!gate.wired) rows.push("runGates runs no requests.open-fix gate: a release would ship over an open fix");
    const open = agent.requestFacts.entries.filter(fact => fact.kind === "fix" && statusOf(fact) === "open" && !fact.issues.length && targets(agent, fact));
    const judged = open.filter(fact => gate.closure.has(target(fact).split("#")[0]!));
    for (const fact of judged) if (!gate.refused.has(target(fact).split("#")[0]!)) rows.push(`${ref(fact)}: open on ${target(fact)}, which the release reads, and requests.open-fix passes`);
    // A queue.fix file that does not read might be an open fix: the gate refuses it by name, or the release ships over it.
    const unread = agent.requestFacts.entries.filter(fact => fact.issues.length && fact.file !== undefined && fact.file.split(posix.sep).includes("queue.fix"));
    for (const fact of unread) if (!gate.unread.has(fact.file!)) rows.push(`${fact.file}: does not read and requests.open-fix does not refuse it (it might be an open fix)`);
    return { rows, evidence: 1 + judged.length + unread.length };
  },
};
