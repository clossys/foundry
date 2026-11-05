// R-REAL-SPECIMENS fixture: a slot detail that shows the candidate file text when no specimen renders.
export function detailRows(candidate: { name: string; content: string }) {
  return [{ label: candidate.name, text: candidate.content }];
}
