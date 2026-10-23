// Your Next.js app's root layout (the "layout.tsx" file in the App
// Router's "app" directory)
import { NavShell, SiteFooter, SiteHeader, SkipLink } from "@clossys/designer/shell";
import { Link } from "@clossys/designer/atoms";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SkipLink targetId="main-content">Skip to content</SkipLink>
      <SiteHeader
        brand={<Link href="/" variant="standalone">Acme</Link>}
        nav={
          <NavShell aria-label="Primary">
            <Link href="/products" variant="standalone">Products</Link>
            <Link href="/pricing" variant="standalone">Pricing</Link>
          </NavShell>
        }
        actions={<Link href="/sign-in" variant="standalone">Sign in</Link>}
      />
      <main id="main-content" tabIndex={-1}>
        {children}
      </main>
      <SiteFooter
        columns={
          <>
            <SiteFooter.Column heading="Product">
              <Link href="/products" variant="muted">Products</Link>
              <Link href="/pricing" variant="muted">Pricing</Link>
            </SiteFooter.Column>
            <SiteFooter.Column heading="Company">
              <Link href="/about" variant="muted">About</Link>
            </SiteFooter.Column>
          </>
        }
        secondary={
          <>
            <span>© 2026 Acme</span>
            <Link href="/privacy" variant="muted">Privacy</Link>
          </>
        }
      />
    </>
  );
}
export const smokeProps = { children: <p>Page content.</p> } satisfies React.ComponentProps<typeof RootLayout>;
