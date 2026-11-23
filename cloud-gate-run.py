#!/usr/bin/env python3
"""cloud-gate-run.py: run one unit's Validation commands at HEAD in this clone. No model.

Run at the repository root, on the unit branch, at its final commit, with a clean tree:
  python3 cloud-gate-run.py --spec specs/<UNIT>.json [--receipt FILE] [--coauthor "Name <mail>"] --publish
It builds the packages, runs every command in the spec, checks the merge into the integration
branch, and writes <UNIT>-mechanical.json. --publish commits that file (and the receipt) to
<unit branch>-gate and pushes that branch only. The unit branch is never changed.
"""
import argparse
import datetime
import hashlib
import json
import subprocess
import sys
import time
from pathlib import Path

TAIL = 30
TIMEOUT = 1800


def sh(cmd, cwd, timeout=TIMEOUT):
    t = time.time()
    try:
        p = subprocess.run(cmd, shell=True, cwd=cwd, timeout=timeout, text=True, errors="replace",
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        code, out = p.returncode, p.stdout
    except subprocess.TimeoutExpired as e:
        o = e.stdout or ""
        code, out = None, (o.decode(errors="replace") if isinstance(o, bytes) else o) + f"\nTIMEOUT after {timeout}s"
    return code, out or "", round(time.time() - t, 1)


def git(root, *args):
    p = subprocess.run(["git", *args], cwd=root, text=True, stdout=subprocess.PIPE,
                       stderr=subprocess.PIPE)
    return p.returncode, p.stdout.strip()


def scrub(text, root):
    text = text.replace(str(root), ".").replace(str(Path.home()), "~")
    return "\n".join(text.splitlines()[-TAIL:])


def exit_ok(expect, code):
    if code is None:
        return False
    return code != 0 if expect == "nonzero" else code == expect


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", required=True)
    ap.add_argument("--receipt", help="the unit's receipt file, kept outside the repository")
    ap.add_argument("--coauthor", help='"Name <mail>" for the Co-Authored-By trailer')
    ap.add_argument("--publish", action="store_true")
    ap.add_argument("--out", default=None, help="directory for the JSON (default: beside the spec)")
    a = ap.parse_args()
    spec = json.loads(Path(a.spec).read_text())
    rc, root = git(".", "rev-parse", "--show-toplevel")
    if rc or Path(root).resolve() != Path.cwd().resolve():
        sys.exit("REFUSED: run at the repository root")
    root = Path(root)
    _, branch = git(root, "rev-parse", "--abbrev-ref", "HEAD")
    if branch != spec["branch"]:
        sys.exit(f"REFUSED: on {branch}, the spec is for {spec['branch']}")
    _, dirty = git(root, "status", "--porcelain")
    if dirty:
        sys.exit("REFUSED: the tree is not clean (commit the work, keep receipts outside the "
                 "repository):\n" + dirty)
    _, head = git(root, "rev-parse", "HEAD")
    _, tree = git(root, "rev-parse", "HEAD^{tree}")
    int2 = spec["int2"]
    git(root, "fetch", "origin", f"+refs/heads/{int2}:refs/heads/{int2}")
    _, int2_sha = git(root, "rev-parse", int2)
    failures, prep, cmds = [], [], []
    for c in spec.get("prep", []):
        code, out, secs = sh(c, root)
        prep.append({"command": c, "exit": code, "seconds": secs, "tail": scrub(out, root)})
        if code != 0:
            failures.append(f"prep `{c}` exit {code}")
    for c in spec["commands"]:
        code, out, secs = sh(c["command"], root)
        ok = exit_ok(c["expect"], code)
        cmds.append({"command": c["command"], "expect": c["expect"], "exit": code, "ok": ok,
                     "seconds": secs, "tail": scrub(out, root)})
        if not ok:
            failures.append(f"`{c['command']}` exit {code}, expected {c['expect']}")
    _, dirty = git(root, "status", "--porcelain")
    if dirty:
        failures.append("the commands left the tree dirty: " + dirty.replace("\n", "; "))
    mcmd = ["merge-tree", "--write-tree", int2, head]
    mrc, mout = git(root, *mcmd)
    if mrc != 0:
        failures.append(f"merge into {int2} conflicts")
    res = {"tool": "cloud-gate-run.py", "ran_on": "cloud", "unit": spec["unit"],
           "branch": branch, "head": head, "tree": tree, "int2": int2, "int2_sha": int2_sha,
           "generated_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "spec_sha256": sha256(a.spec), "runner_sha256": sha256(__file__),
           "prep": prep, "commands": cmds,
           "merge_tree": {"command": "git " + " ".join(mcmd), "exit": mrc,
                          "tree": mout.splitlines()[0] if mout else "",
                          "conflicts": mout.splitlines()[1:] if mrc else []},
           "tree_clean": not dirty, "failures": failures,
           "verdict": "FAIL" if failures else "PASS"}
    outdir = Path(a.out) if a.out else Path(a.spec).resolve().parent
    name = f"{spec['unit']}-mechanical.json"
    out = outdir / name
    out.write_text(json.dumps(res, indent=1) + "\n")
    for c in cmds:
        print(f"{'ok  ' if c['ok'] else 'FAIL'} exit {c['exit']} (expect {c['expect']}) {c['command']}")
    for f in failures:
        print("failure:", f)
    print(f"{res['verdict']} {head} -> {out}")
    if a.publish:
        gate = branch + "-gate"
        entries = []
        files = [(name, out)] + ([(f"{spec['unit']}.md", Path(a.receipt))] if a.receipt else [])
        for fname, path in files:
            rc, blob = git(root, "hash-object", "-w", str(path))
            if rc:
                sys.exit(f"REFUSED: cannot store {path}")
            entries.append(f"100644 blob {blob}\t{fname}")
        p = subprocess.run(["git", "mktree"], cwd=root, input="\n".join(entries) + "\n",
                           text=True, stdout=subprocess.PIPE)
        gtree = p.stdout.strip()
        parent = []
        if git(root, "fetch", "origin", f"refs/heads/{gate}")[0] == 0:
            parent = ["-p", git(root, "rev-parse", "FETCH_HEAD")[1]]
        msg = f"gate: {spec['unit']} {head[:12]} {res['verdict']}\n"
        if a.coauthor:
            msg += f"\nCo-Authored-By: {a.coauthor}\n"
        rc, commit = git(root, "commit-tree", gtree, *parent, "-m", msg)
        if rc:
            sys.exit("REFUSED: git commit-tree failed (is user.name/user.email set?)")
        rc, _ = git(root, "push", "origin", f"{commit}:refs/heads/{gate}")
        print(("PUBLISHED " if rc == 0 else "PUSH FAILED ") + f"{gate} {commit}")
        if rc:
            return 1
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
