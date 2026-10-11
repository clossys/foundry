/** Length-prefixed caller seeds keep root, head and group references disjoint. */
export function ledgerDomIds(instanceId: string) {
  const stem = `${instanceId.length}:${instanceId}`;
  return {
    figureId: `${stem}:root`,
    headId: `${stem}:head`,
    groupId: (groupId: string) => `${stem}:group:${groupId.length}:${groupId}`,
  };
}
