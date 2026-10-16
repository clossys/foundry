import type { ResolvedSiteLink } from "./internal/resolveShell.js";

/** Resolved navigation links shared by the server shape and client island. */
export function NavLinks({ links }: { readonly links: readonly ResolvedSiteLink[] }) {
  return (
    <ul role="list" className="m-0 flex list-none flex-wrap items-center gap-sm p-0">
      {links.map((link, index) => (
        <li key={index}>
          <a
            href={link.href}
            className="inline-flex items-center px-xs text-inherit no-underline hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            style={{ minHeight: "var(--ui-layout-tap-target, 44px)" }}
          >
            {link.label}
          </a>
        </li>
      ))}
    </ul>
  );
}
