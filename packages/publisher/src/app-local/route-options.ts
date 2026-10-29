/** App-local mode requires every first-party import to name an explicit relative source module. */
export interface AppLocalRouteSourceOptions { readonly appLocal?: Readonly<Record<string, string>> }
export function appLocalSpecifier(specifier: string, options?: AppLocalRouteSourceOptions): string {
  if (options?.appLocal === undefined) return specifier;
  const replacement = options.appLocal[specifier];
  if (typeof replacement !== "string" || !/^\.{1,2}\//.test(replacement) || /[\\\u0000-\u001f]/.test(replacement) || replacement.includes("@clossys/")) throw new Error("App-local imports require an explicit relative source mapping");
  return replacement;
}
