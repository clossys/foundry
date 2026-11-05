// R-WRITER-COPY violation fixture: a server row that composes words from a validator finding.
interface Finding { code: string; message: string }

export function rowIssues(findings: Finding[], identityDiffers: boolean): string[] {
  const issues = findings.map(issue => `${issue.code}: ${issue.message}`);
  if (identityDiffers) issues.push("candidate-identity: element identity differs");
  return issues;
}
