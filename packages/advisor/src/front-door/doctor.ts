/**
 * `advisor doctor`: machine prerequisites only. It runs the probes the tree names (version reports and
 * the repository root), reads no file, and never opens an environment file or secret.
 */
import { doctorProbeIssues } from "./guard.js";
import { ok, refused, type Host, type VerbResult } from "./host.js";
import { slotsByVerb, type AdvisorTree } from "./tree.js";

export interface DoctorStep { readonly id: string; readonly label: string; readonly ok: boolean; readonly detail: string }

export function runDoctor(tree: AdvisorTree, root: string, host: Host): VerbResult {
  const probes = slotsByVerb(tree, "doctor");
  const issues = probes.flatMap(([id, slot]) => slot.probe ? doctorProbeIssues(id, slot.probe) : [`${id}: no probe`]);
  if (issues.length) return refused(issues.map(issue => `doctor: refused: ${issue}`));
  const steps: DoctorStep[] = [];
  for (const [id, slot] of probes) {
    const probe = slot.probe!;
    const result = host.run(probe.command, probe.args, { cwd: root });
    const out = result.stdout.trim().split(/\r?\n/)[0] ?? "";
    let good = result.status === 0;
    let detail = good ? out : `${probe.command} not usable (${result.status === null ? "not found" : `exit ${result.status}`})`;
    if (good && probe.minMajor !== undefined) {
      const major = Number(/(\d+)\./.exec(out)?.[1] ?? NaN);
      if (!(major >= probe.minMajor)) { good = false; detail = `${out || "unknown version"}; needs ${probe.minMajor} or newer`; }
    }
    steps.push({ id, label: slot.label, ok: good, detail });
  }
  const lines = steps.map(step => `${step.ok ? "ok  " : "FIX "} ${step.label}: ${step.detail}`);
  const first = steps.find(step => !step.ok);
  const json = { schema: "clossys.advisor-doctor/1", ready: !first, steps };
  if (first) return refused([...lines, `next to fix: ${first.label}`], json);
  return ok([...lines, "ready: run advisor install --from <pack-dir>"], json);
}
