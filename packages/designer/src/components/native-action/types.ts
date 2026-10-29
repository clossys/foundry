interface CopyRef { readonly id: string; readonly locale?: string; readonly values?: Readonly<Record<string, string | number | boolean>> }
type CopyResolver = (ref: CopyRef) => { readonly ref: CopyRef; readonly text: string } | undefined
type ClassValue = string | number | boolean | null | undefined | object | ClassValue[]
type VariantProps<T extends (...args: any[]) => unknown> = Omit<NonNullable<Parameters<T>[0]>, "class" | "className">
export { type CopyRef, type CopyResolver, type ClassValue, type VariantProps }
