/** Transient association shared only by the closed mounted adapter and binder.
 * It never caches a query output or a second selection/body. */
export const liveDesignerQueries = new WeakMap<object, string>();
