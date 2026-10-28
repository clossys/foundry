/** Structural Writer presentation seam. The host owns locale, approval and ICU formatting. */
export interface ShellCopyRef {
  readonly id: string;
  readonly locale?: string;
  readonly values?: Readonly<Record<string, string | number | boolean>>;
}
export type ShellCopyResolver = (ref: ShellCopyRef) => { readonly ref: ShellCopyRef; readonly text: string } | undefined;
const ref = (id: string): ShellCopyRef => Object.freeze({ id });

/** Stable references to the draft admin voice packet; these do not activate its records. */
export const SHELL_COPY_REFS = {
  frame: {
    skip: ref("st.z4jcxtzczb"), navigationOpen: ref("st.7x9ftenced"), navigationClose: ref("st.0a4zmsxntt"),
    panelOpen: ref("st.cc7evwgxmt"), panelClose: ref("st.dn12hzj7gn"), breadcrumb: ref("st.530zm3mffg"),
    collapsedBreadcrumb: ref("st.ymqz842p01"), pageInfo: ref("st.s7pfa71tzc"), pageActions: ref("st.y86a2b0gmd"),
  },
  navigation: { label: ref("st.jecfnpr6a1"), empty: ref("st.sqsqn2s9v0"), expand: ref("st.e85mfcrpb6"), collapse: ref("st.g7hbg5n2bs") },
  commands: { results: ref("st.s079k1p1qj") },
  theme: { system: ref("st.0mvj7s905h"), light: ref("st.3gsnmmts41"), dark: ref("st.mft1aas6kv"), toolbar: ref("st.zets8phbsa"), group: ref("st.vftkg73x02"), announcement: ref("st.ghrssyygxh") },
  dock: { label: ref("st.2ghaq0d8rs"), handle: ref("st.m9qh4b8zhn"), collapse: ref("st.322g37gnhz"), expand: ref("st.a2bvn2ep38") },
  banner: { dismiss: ref("st.ev3xsrhrwe") },
} as const;

export function resolveShellCopy(resolver: ShellCopyResolver | undefined, reference: ShellCopyRef, values?: ShellCopyRef["values"]): string {
  if (!resolver) throw new TypeError("Designer shell copy requires a host resolver or explicit host labels");
  if (values && Object.values(values).some(value => !(typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)))) throw new TypeError("Designer shell copy values must be finite primitives");
  const request = { ...reference, ...(values === undefined ? {} : { values }) };
  const result = resolver(request);
  if (!result || result.ref.id !== request.id || result.ref.locale !== request.locale || typeof result.text !== "string" || !result.text.trim()) throw new TypeError(`Designer shell copy unresolved: ${reference.id}`);
  return result.text;
}
