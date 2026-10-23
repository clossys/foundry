import { lintRenderedHead } from "@clossys/publisher/pack";

const findings = lintRenderedHead({
  siteName: "Example Co",
  pages: [{ path: "/about", html: "<html><head><title>About | Example Co</title></head><body></body></html>" }],
});
console.log(findings.map((finding) => `${finding.rule} ${finding.path}`));
