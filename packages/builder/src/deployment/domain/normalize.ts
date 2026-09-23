import type { WebSurfaceDeclaration } from "./types.js";

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Sorts independent lists for a stable, diffable artifact without changing the declaration's meaning. */
export function normalizeWebSurfaceDeclaration(declaration: WebSurfaceDeclaration): WebSurfaceDeclaration {
  return {
    ...declaration,
    records: [...declaration.records].sort((left, right) => compare(`${left.type}\u0000${left.name}\u0000${left.value}`, `${right.type}\u0000${right.name}\u0000${right.value}`)),
    environments: [...declaration.environments].sort((left, right) => compare(left.environment, right.environment)),
    routes: [...declaration.routes].sort(compare),
  };
}

export function serializeWebSurfaceDeclaration(declaration: WebSurfaceDeclaration): string {
  return `${JSON.stringify(normalizeWebSurfaceDeclaration(declaration), null, 2)}\n`;
}
