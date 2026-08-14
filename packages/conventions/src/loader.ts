/**
 * The product loader: the one-line import that points a product's own
 * instruction file at the shared machine-wide guidance.
 *
 * This is generated rather than shipped as a file, and the reason is not
 * tidiness. The import target depends on where a manifest chose to install the
 * shared guidance and where that product keeps its own configuration -- two
 * facts this package does not know and must not assume. A shipped loader had to
 * hardcode one relative path, which silently became wrong the moment either end
 * moved, in a file whose only job is to point at the other end.
 *
 * Generating it makes the dependency explicit: the caller passes the path it
 * actually installed to.
 */

export interface ProductLoaderOptions {
  /**
   * Path to the shared guidance, as it should appear in the loader. Relative to
   * the loader's own installed location, or absolute -- the caller decides,
   * because only the caller knows both locations.
   */
  readonly guidancePath: string;
  /** Product name for the heading, e.g. "Claude". Defaults to a neutral heading. */
  readonly productName?: string;
}

/**
 * Render a product loader file's content.
 *
 * Deliberately minimal. An adapter carries discovery, permissions, hooks, and
 * interface metadata only; the moment it carries behavioral prose of its own
 * there are two sources of truth, and they drift.
 */
export function renderProductLoader(options: ProductLoaderOptions): string {
  const { guidancePath } = options;
  if (typeof guidancePath !== "string" || guidancePath.trim() === "") {
    throw new Error("renderProductLoader requires a guidancePath: the loader's only job is to point at one.");
  }
  const heading = options.productName ? `${options.productName} adapter` : "Product adapter";

  return `@${guidancePath}

# ${heading}

The imported file is the canonical machine-wide guidance, shared by every
coding agent on this machine. This product's own settings, permissions, hooks,
history, and authentication stay in its native configuration files and do not
define a separate workflow.

An adapter carries discovery, permissions, hooks, and interface metadata only.
The moment it carries behavioral prose of its own, there are two sources of
truth and they begin to drift — which is the failure this one-line import
exists to prevent.
`;
}
