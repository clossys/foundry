// Your Next.js app's root layout (the "layout.tsx" file in the App
// Router's "app" directory)
import { Shell } from "@clossys/designer/shell";
import { Link } from "@clossys/designer/atoms";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <Shell>
      <Shell.Header>
        <strong>Acme</strong>
      </Shell.Header>
      <Shell.SideNav>
        <Link href="/prompts" variant="standalone">Prompts</Link>
        <Link href="/evals" variant="standalone">Evals</Link>
      </Shell.SideNav>
      <Shell.Main>{children}</Shell.Main>
      <Shell.Rail>
        <p>Context for the current record.</p>
      </Shell.Rail>
      <Shell.Footer>
        <small>© Acme</small>
      </Shell.Footer>
    </Shell>
  );
}
export const smokeProps = { children: <p>Page content.</p> } satisfies React.ComponentProps<typeof RootLayout>;
