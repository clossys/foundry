/** The plain data shape a registered server loader may hand to its emitted client
 * page: strings, finite numbers, booleans, null, undefined, arrays and plain objects
 * with string keys. Functions, symbols, bigints and class instances (whose methods
 * map to never) are not assignable to it. */
export type RegisteredRouteSerializable<T> =
  T extends string | number | boolean | null | undefined ? T
  : T extends (...args: never[]) => unknown ? never
  : T extends readonly unknown[] ? { readonly [K in keyof T]: RegisteredRouteSerializable<T[K]> }
  : T extends object ? [Extract<keyof T, symbol>] extends [never] ? { readonly [K in keyof T]: RegisteredRouteSerializable<T[K]> } : never
  : never;
/** What a registered loader resolves to; the emitted client page's `data` prop type. */
export type RegisteredRouteServerData<Loader extends () => unknown> = Awaited<ReturnType<Loader>>;

function plain(value: unknown, path: string, seen: Set<object>): void {
  if (value === null || value === undefined || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") { if (!Number.isFinite(value)) throw new TypeError(`Registered route server data is not serializable at ${path}: non-finite number`); return; }
  if (typeof value !== "object") throw new TypeError(`Registered route server data is not serializable at ${path}: ${typeof value}`);
  if (seen.has(value)) throw new TypeError(`Registered route server data is not serializable at ${path}: cyclic reference`);
  seen.add(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) throw new TypeError(`Registered route server data is not serializable at ${path}: array subclass`);
    for (let index = 0; index < value.length; index++) {
      if (!Object.hasOwn(value, index)) throw new TypeError(`Registered route server data is not serializable at ${path}[${index}]: sparse array`);
      plain(value[index], `${path}[${index}]`, seen);
    }
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`Registered route server data is not serializable at ${path}: class instance`);
    if (Object.getOwnPropertySymbols(value).length) throw new TypeError(`Registered route server data is not serializable at ${path}: symbol key`);
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!("value" in descriptor)) throw new TypeError(`Registered route server data is not serializable at ${path}.${key}: accessor`);
      plain(descriptor.value, `${path}.${key}`, seen);
    }
  }
  seen.delete(value);
}
/** The emitted server page's only call besides the registered loader. The type
 * parameter refuses a non-serializable loader result at compile time (no cast); the
 * runtime walk is deterministic, linear in the payload and refuses the same shapes. */
export function registeredRouteServerData<T>(value: T, ...nonSerializable: [T] extends [RegisteredRouteSerializable<T>] ? [] : [nonSerializableRouteData: never]): T {
  if (nonSerializable.length) throw new TypeError("Registered route server data is not serializable");
  plain(value, "data", new Set());
  return value;
}
