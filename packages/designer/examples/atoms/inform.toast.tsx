// Your Next.js app's root layout (the "layout.tsx" file in the App
// Router's "app" directory)
import { Shell, Toaster } from "@clossys/designer/shell";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <Shell>
      <Shell.Main>{children}</Shell.Main>
      <Toaster />
    </Shell>
  );
}
export const smokeProps = { children: <p>Page content.</p> } satisfies React.ComponentProps<typeof RootLayout>;
