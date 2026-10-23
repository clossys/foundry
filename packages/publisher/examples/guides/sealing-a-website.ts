import { checkSealEvidence } from "@clossys/publisher/pack";

const commit = "b".repeat(40);
const digest = "a".repeat(64);
const findings = checkSealEvidence(
  {
    schemaVersion: 1,
    itemId: "website",
    commit,
    observedAt: "2026-09-30T11:00:00Z",
    delivery: { state: "ready", deployedCommit: commit, productionUrl: "https://www.example.test/" },
    pages: [{ path: "/", status: 200, servedCommit: commit, desktopDigest: digest, mobileDigest: digest }],
    contactIntake: { kind: "none", reason: "the site has no contact form" },
  },
  {
    map: { entries: [{ id: "home", template: "landing", documentId: "doc-home", location: { kind: "path", path: "/" } }] },
    now: "2026-09-30T12:00:00Z",
    itemId: "website",
  },
);
console.log(findings.length === 0 ? "ready to seal" : findings.map((finding) => `${finding.rule} ${finding.path}`));
