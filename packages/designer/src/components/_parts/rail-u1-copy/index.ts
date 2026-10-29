
export const INPUT_COPY_REFS = { searchClear: { id: "st.kcathn07y7" }, numberIncrement: { id: "st.46j4bj35p9" }, numberDecrement: { id: "st.vc888ap8qn" }, tagRemove: { id: "st.cxp8286800" } } as const;
type Ref = { id: string; values?: Readonly<Record<string, string | number | boolean>> };
export type InputCopyResolver = (ref: Ref) => { ref: Ref; text: string } | undefined;
export function inputCopy(copy: InputCopyResolver | undefined, key: keyof typeof INPUT_COPY_REFS, explicit?: string, values?: Ref["values"]): string {
  if (explicit?.trim()) return explicit;
  const ref = { ...INPUT_COPY_REFS[key], ...(values ? { values } : {}) };
  const resolved = copy?.(ref);
  if (!resolved || resolved.ref.id !== ref.id || !resolved.text.trim()) throw new TypeError("Input copy requires host resolution or explicit labels");
  return resolved.text;
}
